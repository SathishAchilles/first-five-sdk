import type {
  CanonicalEvent,
  EndRequest,
  EventsRequest,
  SdkConfigResponse,
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

export const PID = 'ffp_demo0001';
export const SID = 'ffx_sess0001';
export const STID = 'ffs_stud0001';

export interface FakeApiOptions {
  allowedOrigins?: string[];
  allowedCustomEvents?: string[];
  goalRoute?: string;
  exchangeStatus?: number;
  eventsStatus?: number;
  endStatus?: number;
  endUrl?: string | null;
  setupReturnUrl?: string | null;
  eventsDelayMs?: number;
  taskText?: string;
  sessionStatusOverride?: 'dropped' | 'invalid';
}

const EVENT_KEYS = new Set([
  'schema_version',
  'event_id',
  'event_name',
  'project_id',
  'study_id',
  'session_id',
  'mode',
  'client_sequence',
  'timestamp',
  'page_path',
  'element_id',
  'element_type',
  'element_label',
  'custom_event_name',
  'properties',
]);

/** In-memory fake of the Render API contract (packages/sdk-contract), installed as global fetch. */
export class FakeApi {
  calls: Call[] = [];
  events: CanonicalEvent[] = [];
  goalVerified = false;
  constructor(public opts: FakeApiOptions = {}) {}

  config(): SdkConfigResponse {
    return {
      project_id: PID,
      status: 'active',
      contract_version: 1,
      api_base_url: API,
      allowed_origins: this.opts.allowedOrigins ?? [ORIGIN],
      event_allowlist: [
        'ff_page_viewed',
        'ff_element_clicked',
        'ff_form_submitted',
        'ff_custom_event',
        'ff_activity',
        'ff_client_error',
        'ff_element_discovered',
        'ff_goal_reached',
      ],
      allowed_custom_events: this.opts.allowedCustomEvents ?? ['signup_completed'],
      limits: { maxEventsPerBatch: 50 },
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
    const err = (status: number, code: string) => json(status, { error: { code, message: code } });

    if (path === '/api/sdk/config') return json(200, this.config());

    if (path === '/api/sdk/exchange') {
      const req = body as Record<string, unknown>;
      const extra = Object.keys(req).filter(
        (k) => !['project_id', 'ticket', 'sdk_version'].includes(k),
      );
      if (extra.length) return err(400, 'invalid_request');
      if (this.opts.exchangeStatus && this.opts.exchangeStatus !== 200) {
        return err(this.opts.exchangeStatus, 'ticket_consumed');
      }
      const ticket = String(req.ticket);
      const live = !ticket.startsWith('setup');
      const expires = new Date(Date.now() + 60_000).toISOString();
      return json(200, {
        credential: `cred-${ticket}`,
        mode: live ? 'live' : 'setup',
        expires_at: expires,
        project_id: PID,
        ...(live
          ? {
              study: {
                study_id: STID,
                session_id: SID,
                task: this.opts.taskText ?? 'Create an account and reach your dashboard',
                deadline_at: expires,
                goal_type: 'page_reached',
              },
            }
          : { setup: { setup_session_id: 'set_1', expires_at: expires } }),
      });
    }

    if (path === '/api/sdk/events') {
      if (this.opts.eventsDelayMs) await new Promise((r) => setTimeout(r, this.opts.eventsDelayMs));
      if (this.opts.eventsStatus && this.opts.eventsStatus !== 200) {
        return err(this.opts.eventsStatus, 'x');
      }
      const req = body as EventsRequest & Record<string, unknown>;
      if (
        req.schema_version !== 1 ||
        Object.keys(req).some((k) => !['schema_version', 'sdk_version', 'events'].includes(k))
      ) {
        return err(400, 'invalid_request');
      }
      const accepted: string[] = [];
      const duplicates: string[] = [];
      const rejected: { event_id: string | null; code: string; message: string }[] = [];
      for (const e of req.events) {
        const bad = Object.keys(e).filter((k) => !EVENT_KEYS.has(k));
        if (bad.length || (e.mode === 'setup' && (e.session_id || e.study_id))) {
          rejected.push({ event_id: e.event_id, code: 'invalid_schema', message: bad.join(',') });
          continue;
        }
        if (this.events.some((x) => x.event_id === e.event_id)) {
          duplicates.push(e.event_id);
          continue;
        }
        this.events.push(e);
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
      const status =
        this.opts.sessionStatusOverride ?? (this.goalVerified ? 'completed' : 'pending');
      return json(rejected.length && !accepted.length && !duplicates.length ? 422 : 200, {
        accepted,
        duplicates,
        rejected,
        goal: live ? { verified: this.goalVerified, verified_event_id: null } : null,
        session_status: live ? status : null,
      });
    }

    if (path === '/api/sdk/session/end') {
      const status = this.opts.endStatus ?? 200;
      if (status !== 200) return err(status, 'x');
      const req = body as EndRequest;
      if (!['finished', 'gave_up'].includes(req.reason)) return err(400, 'invalid_request');
      return json(200, {
        session_status: this.goalVerified ? 'completed' : 'dropped',
        final_reason: this.goalVerified
          ? 'goal_verified'
          : req.reason === 'gave_up'
            ? 'explicit_stop'
            : 'finished_without_goal',
        feedback_url:
          this.opts.endUrl === undefined ? `${FF}/t/${STID}/feedback#h=h1` : this.opts.endUrl,
      });
    }

    if (path === '/api/sdk/setup/finish') {
      const r = this.opts.setupReturnUrl;
      return json(
        200,
        r === null
          ? { status: 'finished' }
          : { status: 'finished', return_url: r ?? `${FF}/app/websites/p1` },
      );
    }

    return err(404, 'not_found');
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
