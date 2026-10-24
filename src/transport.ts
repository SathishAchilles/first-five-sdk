import type { CanonicalEvent, EventsRequest, EventsResponse } from './contracts';
import { isRetryable, request, sleep } from './http';
import { keys, readJson, remove, writeJson } from './storage';
import { SDK_VERSION } from './version';

export interface TransportOptions {
  eventsUrl: string;
  credential: string;
  /** Scope for the persisted queue key: session id, or `setup:<project>`. */
  scope: string;
  maxBatchEvents: number;
  onAck: (ack: EventsResponse) => void;
  onAuthFailure: (status: number) => void;
  onError: (code: string) => void;
  timing?: Partial<TransportTiming>;
}

export interface TransportTiming {
  batchSize: number;
  batchDelayMs: number;
  retryDelaysMs: number[];
  maxQueue: number;
}

export const DEFAULT_TIMING: TransportTiming = {
  batchSize: 10,
  batchDelayMs: 2000,
  retryDelaysMs: [1000, 2000, 4000],
  maxQueue: 500,
};

export interface FlushResult {
  ackedThrough: number;
  timedOut: boolean;
}

/**
 * Batches events, keeps exactly one request in flight, never resends an ACKed event,
 * retries 1/2/4 s on 429/5xx/network, and persists the unsent queue on pagehide.
 */
export class Transport {
  private queue: CanonicalEvent[] = [];
  private readonly acked = new Set<string>();
  private draining: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private lastAcked = 0;
  private readonly timing: TransportTiming;
  private readonly onPageHide = () => this.persist();
  private readonly onVisibility = () => {
    if (document.visibilityState === 'hidden') void this.flush(3000);
  };

  constructor(private readonly opts: TransportOptions) {
    this.timing = { ...DEFAULT_TIMING, ...opts.timing };
    this.restorePersisted();
    window.addEventListener('pagehide', this.onPageHide);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  get lastAckedSequence(): number {
    return this.lastAcked;
  }

  get queued(): number {
    return this.queue.length;
  }

  enqueue(event: CanonicalEvent): void {
    if (this.stopped || this.acked.has(event.event_id)) return;
    this.queue.push(event);
    if (this.queue.length > this.timing.maxQueue) {
      this.queue.splice(0, this.queue.length - this.timing.maxQueue);
      this.opts.onError('queue_overflow');
    }
    // write-through: a fast reload can skip pagehide, so the queue is always on disk
    this.persist();
    if (this.queue.length >= this.timing.batchSize) void this.kick();
    else this.schedule(this.timing.batchDelayMs);
  }

  /** Send everything queued, bounded by timeoutMs (C3). Joins the running drain loop. */
  async flush(timeoutMs: number): Promise<FlushResult> {
    this.clearTimer();
    await Promise.race([this.kick(), sleep(timeoutMs)]);
    return { ackedThrough: this.lastAcked, timedOut: this.queue.length > 0 };
  }

  stop(): void {
    this.stopped = true;
    this.clearTimer();
    window.removeEventListener('pagehide', this.onPageHide);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  /** Stop and discard queued + persisted events (credential is dead). */
  discard(): void {
    this.stop();
    this.queue = [];
    remove(keys.queue(this.opts.scope));
  }

  private schedule(ms: number): void {
    if (this.timer || this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.kick();
    }, ms);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /**
   * The single sender: every trigger (batch size, timer, flush, restore) joins this one loop,
   * so there is exactly one request in flight and one shared retry backoff.
   */
  private kick(): Promise<void> {
    if (!this.draining) {
      this.draining = this.drainLoop().finally(() => {
        this.draining = null;
      });
    }
    return this.draining;
  }

  private async drainLoop(): Promise<void> {
    const delays = this.timing.retryDelaysMs;
    let attempt = 0;
    while (!this.stopped && this.queue.length > 0) {
      const result = await this.sendOnce();
      if (result === 'ok') {
        attempt = 0;
        continue;
      }
      if (result === 'fatal') return;
      if (attempt >= delays.length) {
        // give up for now; try again later with a fresh backoff
        this.schedule(delays[delays.length - 1] ?? this.timing.batchDelayMs);
        return;
      }
      await sleep(delays[attempt++]);
    }
  }

  private async sendOnce(): Promise<'ok' | 'retry' | 'fatal'> {
    if (this.stopped) return 'fatal';
    if (this.queue.length === 0) return 'ok';
    const batch = this.queue.slice(0, Math.max(1, this.opts.maxBatchEvents));
    try {
      const body: EventsRequest = { schema_version: 1, sdk_version: SDK_VERSION, events: batch };
      const res = await request<EventsResponse>(this.opts.eventsUrl, {
        method: 'POST',
        body,
        credential: this.opts.credential,
      });
      if (
        (res.status === 200 || res.status === 422) &&
        res.body &&
        Array.isArray(res.body.accepted)
      ) {
        // 422 = every event in the batch was permanently rejected: still an ACK, never retried
        this.applyAck(batch, res.body);
        return 'ok';
      }
      if (res.status === 401 || res.status === 410) {
        this.discard();
        this.opts.onAuthFailure(res.status);
        return 'fatal';
      }
      this.opts.onError(`events_http_${res.status}`);
      if (isRetryable(res.status)) return 'retry';
      // other 4xx: drop the batch so it cannot wedge the queue
      this.removeIds(new Set(batch.map((e) => e.event_id)));
      return 'ok';
    } catch {
      this.opts.onError('network');
      return 'retry';
    }
  }

  private applyAck(batch: CanonicalEvent[], ack: EventsResponse): void {
    const done = new Set<string>([...(ack.accepted ?? []), ...(ack.duplicates ?? [])]);
    for (const r of ack.rejected ?? []) if (r.event_id) done.add(r.event_id);
    if ((ack.rejected ?? []).some((r) => !r.event_id)) {
      // a rejection the server could not attribute to an event id: drop the whole batch
      for (const e of batch) done.add(e.event_id);
    }
    for (const e of batch) {
      if (!done.has(e.event_id)) continue;
      this.acked.add(e.event_id);
      this.lastAcked = Math.max(this.lastAcked, e.client_sequence);
    }
    if (ack.rejected?.length) this.opts.onError(`events_rejected_${ack.rejected[0].code}`);
    this.removeIds(done);
    this.opts.onAck(ack);
  }

  private removeIds(ids: Set<string>): void {
    this.queue = this.queue.filter((e) => !ids.has(e.event_id));
    this.persist();
  }

  /** Keep unsent events for the next page on this origin (replaces sendBeacon). */
  persist(): void {
    if (this.stopped && this.queue.length === 0) return;
    if (this.queue.length > 0) writeJson(keys.queue(this.opts.scope), this.queue);
    else remove(keys.queue(this.opts.scope));
  }

  private restorePersisted(): void {
    const saved = readJson<CanonicalEvent[]>(keys.queue(this.opts.scope));
    if (!saved || saved.length === 0) return;
    const seen = new Set(this.queue.map((e) => e.event_id));
    this.queue = [...saved.filter((e) => !seen.has(e.event_id)), ...this.queue];
    this.schedule(this.timing.batchDelayMs);
  }
}
