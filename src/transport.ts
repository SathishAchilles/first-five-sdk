import type { CanonicalEvent, EventsRequest, EventsResponse } from './contracts';
import { isRetryable, request, sleep } from './http';
import { uuid } from './ids';
import { keys, readJson, remove, writeJson } from './storage';

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
  private inFlight: Promise<boolean> | null = null;
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
    if (this.queue.length >= this.timing.batchSize) void this.sendWithRetry();
    else this.schedule();
  }

  /** Send everything queued, bounded by timeoutMs (C3). */
  async flush(timeoutMs: number): Promise<FlushResult> {
    this.clearTimer();
    let timedOut = false;
    const drain = (async () => {
      while (!this.stopped && this.queue.length > 0) {
        const ok = await this.sendWithRetry();
        if (!ok) break;
      }
    })();
    await Promise.race([
      drain,
      sleep(timeoutMs).then(() => {
        timedOut = this.queue.length > 0;
      }),
    ]);
    if (this.queue.length > 0) timedOut = true;
    return { ackedThrough: this.lastAcked, timedOut };
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

  private schedule(): void {
    if (this.timer || this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.sendWithRetry();
    }, this.timing.batchDelayMs);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async sendWithRetry(): Promise<boolean> {
    const delays = this.timing.retryDelaysMs;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      const result = await this.sendOnce();
      if (result !== 'retry') return result === 'ok';
      if (attempt < delays.length) await sleep(delays[attempt]);
    }
    return false;
  }

  /** One request at a time: a caller arriving mid-flight waits for it, then sends what is left. */
  private async sendOnce(): Promise<'ok' | 'retry' | 'fatal'> {
    while (this.inFlight) await this.inFlight;
    if (this.stopped) return 'fatal';
    if (this.queue.length === 0) return 'ok';
    const batch = this.queue.slice(0, Math.max(1, this.opts.maxBatchEvents));
    let outcome: 'ok' | 'retry' | 'fatal' = 'retry';
    this.inFlight = (async () => {
      try {
        const body: EventsRequest = { batch_id: uuid(), events: batch };
        const res = await request<EventsResponse>(this.opts.eventsUrl, {
          method: 'POST',
          body,
          credential: this.opts.credential,
        });
        if (res.status === 200 && res.body) {
          this.applyAck(batch, res.body);
          outcome = 'ok';
        } else if (res.status === 401 || res.status === 410) {
          outcome = 'fatal';
          this.discard();
          this.opts.onAuthFailure(res.status);
        } else if (isRetryable(res.status)) {
          outcome = 'retry';
          this.opts.onError(`events_http_${res.status}`);
        } else {
          // 4xx other than auth: drop the batch so it cannot wedge the queue
          this.removeIds(new Set(batch.map((e) => e.event_id)));
          outcome = 'ok';
          this.opts.onError(`events_http_${res.status}`);
        }
      } catch {
        outcome = 'retry';
        this.opts.onError('network');
      }
      return outcome === 'ok';
    })();
    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
    return outcome;
  }

  private applyAck(batch: CanonicalEvent[], ack: EventsResponse): void {
    const done = new Set<string>(ack.accepted ?? []);
    for (const r of ack.rejected ?? []) done.add(r.event_id);
    for (const e of batch) if (done.has(e.event_id)) this.acked.add(e.event_id);
    this.removeIds(done);
    if (typeof ack.last_acked_sequence === 'number') {
      this.lastAcked = Math.max(this.lastAcked, ack.last_acked_sequence);
    }
    this.opts.onAck(ack);
  }

  private removeIds(ids: Set<string>): void {
    this.queue = this.queue.filter((e) => !ids.has(e.event_id));
  }

  /** pagehide: keep unsent events for the next page on this origin (replaces sendBeacon). */
  persist(): void {
    if (this.queue.length > 0) writeJson(keys.queue(this.opts.scope), this.queue);
    else remove(keys.queue(this.opts.scope));
  }

  private restorePersisted(): void {
    const saved = readJson<CanonicalEvent[]>(keys.queue(this.opts.scope));
    remove(keys.queue(this.opts.scope));
    if (!saved || saved.length === 0) return;
    const seen = new Set(this.queue.map((e) => e.event_id));
    this.queue = [...saved.filter((e) => !seen.has(e.event_id)), ...this.queue];
    this.schedule();
  }
}
