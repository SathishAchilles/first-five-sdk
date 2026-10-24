import type {
  CanonicalEvent,
  EndRequest,
  EventsRequest,
  ExchangeRequest,
  SdkConfig,
} from '../src/contracts';

export const ORIGIN = 'http://localhost:3000';
export const API = 'https://api.firstfive.test';
export const FF = 'https://app.firstfive.test';

export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  at: number;
}

export interface FakeApiOptions {
  allowedOrigins?: string[];
  goalRoute?: string;
  exchangeStatus?: number;
  eventsStatus?: number;
  endStatus?: number;
  endUrl?: string;
  setupReturnUrl?: string;
  eventsDelayMs?: number;
  taskText?: string;
}

/** In-memory fake of the Render API contract, installed as global fetch. */
export class FakeApi {
  calls: Call[] = [];
  events: CanonicalEvent[] = [];
  goalVerified = false;
  constructor(public opts: FakeApiOptions = {}) {}

  config(): SdkConfig {
    return {
      status: 'active',
      allowed_origins: this.opts.allowedOrigins ?? [ORIGIN],
      events_url: `${API}/api/sdk/events`,
      event_allowlist: [],
      custom_event_allowlist: ['signup_completed'],
      max_batch_events: 20,
      first_five_origin: FF,
    };
  }

  callsTo(path: string): Call[] {
    return this.calls.filter((c) => new URL(c.url).pathname.endsWith(path));
  }

  eventNames(): string[] {
    return this.events.map((e) => e.event_name);
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    this.calls.push({ url, method: init.method ?? 'GET', headers, body, at: Date.now() });
    const path = new URL(url).pathname;
    const json = (status: number, data: unknown) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });

    if (path === '/api/sdk/config') return json(200, this.config());

    if (path === '/api/sdk/exchange') {
      const req = body as ExchangeRequest;
      if (this.opts.exchangeStatus && this.opts.exchangeStatus !== 200) {
        return json(this.opts.exchangeStatus, { error: 'expired' });
      }
      const live = req.kind === 'live';
      return json(200, {
        credential: `cred-${req.ticket}`,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        mode: req.kind,
        session_id: live ? 'ffx_1' : null,
        study_id: live ? 'ffs_1' : null,
        task_text: this.opts.taskText ?? 'Create an account and reach your dashboard',
      });
    }

    if (path === '/api/sdk/events') {
      if (this.opts.eventsDelayMs) await new Promise((r) => setTimeout(r, this.opts.eventsDelayMs));
      if (this.opts.eventsStatus && this.opts.eventsStatus !== 200) {
        return json(this.opts.eventsStatus, { error: 'x' });
      }
      const req = body as EventsRequest;
      const accepted: string[] = [];
      for (const e of req.events) {
        if (!this.events.some((x) => x.event_id === e.event_id)) this.events.push(e);
        accepted.push(e.event_id);
        if (
          this.opts.goalRoute &&
          e.mode === 'live' &&
          e.event_name === 'ff_page_viewed' &&
          e.page_path === this.opts.goalRoute
        ) {
          this.goalVerified = true;
        }
      }
      const live = req.events.some((e) => e.mode === 'live');
      return json(200, {
        accepted,
        rejected: [],
        last_acked_sequence: Math.max(0, ...this.events.map((e) => e.client_sequence)),
        ...(live ? { goal_status: this.goalVerified ? 'verified' : 'pending' } : {}),
      });
    }

    if (/^\/api\/sessions\/[^/]+\/end$/.test(path)) {
      const status = this.opts.endStatus ?? 200;
      if (status !== 200) return json(status, { error: 'x' });
      const req = body as EndRequest;
      return json(200, {
        outcome: this.goalVerified ? 'completed' : req.reason === 'stuck' ? 'dropped' : 'dropped',
        feedback_handoff: {
          url: this.opts.endUrl ?? `${FF}/study/ffs_1/feedback?handoff=h1`,
          expires_at: '',
        },
      });
    }

    if (path === '/api/sdk/setup/finish') {
      return json(200, {
        return_url: this.opts.setupReturnUrl ?? `${FF}/projects/ffp_1/discovery?setup=done`,
      });
    }

    return json(404, { error: 'not found' });
  };
}

export const FAST = {
  timing: { batchSize: 10, batchDelayMs: 10, retryDelaysMs: [5, 5, 5], maxQueue: 500 },
  retryDelaysMs: [5, 5, 5],
  flushTimeoutMs: 1000,
};

export async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

export function setPath(path: string): void {
  window.history.replaceState(null, '', path);
}

export function resetDom(): void {
  document.body.innerHTML = '';
  document.querySelectorAll('first-five-widget').forEach((n) => n.remove());
  window.sessionStorage.clear();
  setPath('/');
}

export function widgetActions(): string[] {
  const host = document.querySelector('first-five-widget');
  const root = host?.shadowRoot;
  if (!root) return [];
  return Array.from(root.querySelectorAll('[data-action]')).map(
    (b) => b.getAttribute('data-action') ?? '',
  );
}

export function widgetText(): string {
  return document.querySelector('first-five-widget')?.shadowRoot?.textContent ?? '';
}

export function clickWidget(action: string): void {
  const el = document
    .querySelector('first-five-widget')
    ?.shadowRoot?.querySelector<HTMLElement>(`[data-action="${action}"]`);
  if (!el) throw new Error(`widget action ${action} not found`);
  el.click();
}
