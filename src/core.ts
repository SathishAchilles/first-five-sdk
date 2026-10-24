import type {
  CanonicalEvent,
  EventName,
  EventsResponse,
  Mode,
  SdkConfig,
  StoredCredential,
} from './contracts';
import { fetchConfig, originAllowed, readScriptSettings } from './config';
import { Discovery } from './discovery';
import {
  clearCredential,
  exchange,
  loadCredential,
  readTicket,
  saveCredential,
  stripTicket,
} from './handoff';
import { Sequence, uuid } from './ids';
import { keys, readJson, remove, writeJson } from './storage';
import { StateMachine, TRACKING_STATES } from './state';
import { cleanCustomProps } from './track/custom';
import { installClicks } from './track/click';
import { installForms } from './track/form';
import { installPageviews } from './track/pageview';
import { Transport, type TransportTiming } from './transport';
import { Widget } from './widget/widget';
import { onAck as goalOnAck } from './goal';
import { requestEnd } from './finalize';
import { finishSetup } from './setup';
import { buildDiagnostics, type Diagnostics } from './diagnose';

export interface InitOptions {
  projectId?: string;
  endpoint?: string;
}

export interface CoreOptions {
  /** The <script> element captured synchronously at load time (IIFE build). */
  script?: HTMLScriptElement | null;
  /** Test hooks. */
  timing?: Partial<TransportTiming>;
  retryDelaysMs?: number[];
  flushTimeoutMs?: number;
  navigate?: (url: string) => void;
}

export class FirstFiveCore {
  readonly sm = new StateMachine();
  projectId: string | null = null;
  endpoint: string | null = null;
  config: SdkConfig | null = null;
  credential: StoredCredential | null = null;
  mode: Mode | null = null;
  transport: Transport | null = null;
  sequence: Sequence | null = null;
  discovery: Discovery | null = null;
  readonly widget: Widget;
  readonly routesSeen = new Set<string>();
  discoveredSeen = new Set<string>();
  currentRoute = '/';
  originAllowed: boolean | null = null;
  degraded = false;
  lastErrorCode: string | null = null;
  pendingReason: 'finish' | 'stuck' = 'finish';
  ending: Promise<void> | null = null;
  finishing: Promise<void> | null = null;
  private initPromise: Promise<void> | null = null;
  private uninstallers: (() => void)[] = [];

  constructor(readonly options: CoreOptions = {}) {
    this.widget = new Widget({
      stuck: () => this.confirm('stuck'),
      finish: () => this.confirm('finish'),
      confirm: (yes) => {
        if (yes) void requestEnd(this, this.pendingReason);
        else if (this.sm.state === 'LIVE_ACTIVE') this.renderLive();
      },
      continueToFeedback: () => void requestEnd(this, 'finish'),
      finishSetup: () => void finishSetup(this),
    });
    this.sm.onChange((next) => {
      if (!TRACKING_STATES.has(next)) this.uninstallTrackers();
    });
  }

  get flushTimeoutMs(): number {
    return this.options.flushTimeoutMs ?? 3000;
  }

  get retryDelaysMs(): number[] | undefined {
    return this.options.retryDelaysMs;
  }

  navigate(url: string): void {
    if (this.options.navigate) this.options.navigate(url);
    else window.location.assign(url);
  }

  init(opts: InitOptions = {}): Promise<void> {
    if (!this.initPromise) this.initPromise = this.doInit(opts);
    return this.initPromise;
  }

  private async doInit(opts: InitOptions): Promise<void> {
    const fromScript = readScriptSettings(this.options.script ?? null);
    this.projectId = opts.projectId ?? fromScript.projectId;
    this.endpoint = (opts.endpoint ?? fromScript.endpoint)?.replace(/\/+$/, '') ?? null;
    if (!this.projectId || !this.endpoint) {
      console.warn('[FirstFive] missing data-project-id or endpoint; SDK not started');
      this.lastErrorCode = this.projectId ? 'missing_endpoint' : 'missing_project_id';
      return;
    }
    // Read and strip the one-time ticket before anything else, so it never lingers in the
    // address bar or history, even if config fails or the origin is not allowed.
    const ticket = readTicket();
    if (ticket) stripTicket();
    this.sm.to('CONFIG_LOADING');
    this.config = await fetchConfig(this.endpoint, this.projectId);
    if (!this.config) {
      this.fail('config_fetch_failed');
      this.sm.to('READY');
      return;
    }
    this.originAllowed = originAllowed(this.config, window.location.origin);
    this.sm.to('READY');
    if (!this.originAllowed) {
      this.lastErrorCode = 'origin_not_allowed';
      return;
    }

    if (ticket) {
      const result = await exchange(this.endpoint, this.projectId, ticket);
      if (result.kind === 'ok') {
        saveCredential(result.credential);
        if (result.credential.mode === 'setup') {
          // a fresh ticket starts a new walk: reset its sequence, counts and dedup
          remove(keys.sequence(`setup:${this.projectId}`));
          this.clearWalk();
        }
        this.start(result.credential);
      } else if (result.kind === 'rejected') {
        this.mode = ticket.kind;
        this.lastErrorCode = `exchange_${result.status}`;
        this.showEnded();
        this.sm.to('STOPPED');
      } else {
        this.fail('exchange_failed');
      }
      return;
    }

    const restored = loadCredential(this.projectId);
    if (restored) this.start(restored);
  }

  private start(cred: StoredCredential): void {
    const config = this.config as SdkConfig;
    this.credential = cred;
    this.mode = cred.mode;
    const scope =
      cred.mode === 'live' && cred.session_id ? cred.session_id : `setup:${cred.project_id}`;
    this.sequence = new Sequence(scope);
    this.transport = new Transport({
      eventsUrl: config.events_url || `${this.endpoint}/api/sdk/events`,
      credential: cred.credential,
      scope,
      maxBatchEvents: config.max_batch_events || 20,
      onAck: (ack) => this.onAck(ack),
      onAuthFailure: (status) => this.onAuthFailure(status),
      onError: (code) => this.fail(code),
      timing: this.options.timing,
    });

    if (cred.mode === 'setup') {
      this.sm.to('SETUP_ACTIVE');
      const walk = readJson<{ routes: string[]; seen: string[] }>(keys.setupWalk(cred.project_id));
      for (const r of walk?.routes ?? []) this.routesSeen.add(r);
      this.discoveredSeen = new Set(walk?.seen ?? []);
      this.discovery = new Discovery(
        () => this.currentRoute,
        (el) =>
          this.emit('ff_element_discovered', {
            page_path: el.route,
            element_key: el.element_key,
            element_type: el.element_type,
            element_label: el.element_label,
          }),
        () => this.widget.element,
        this.discoveredSeen,
      );
      this.renderSetup();
    } else {
      this.sm.to('LIVE_ACTIVE');
      this.renderLive();
    }
    this.installTrackers();
  }

  private installTrackers(): void {
    this.uninstallers.push(
      installPageviews((route) => {
        this.currentRoute = route;
        this.routesSeen.add(route);
        this.emit('ff_page_viewed', {});
        if (this.mode === 'setup' && this.discovery) {
          // scan after the route has rendered; the observer catches later changes
          this.discovery.scheduleScan();
          this.saveWalk();
          this.renderSetup();
        }
      }),
      installClicks(
        (info) => this.emit('ff_element_clicked', { ...info }),
        () => this.widget.element,
      ),
      installForms((key) => this.emit('ff_form_submitted', { form_key: key })),
    );
    if (this.discovery) {
      this.discovery.start();
      const d = this.discovery;
      this.uninstallers.push(() => d.stop());
    }
  }

  uninstallTrackers(): void {
    const list = this.uninstallers;
    this.uninstallers = [];
    for (const u of list) {
      try {
        u();
      } catch {
        // ignore
      }
    }
  }

  emit(name: EventName, fields: Partial<CanonicalEvent>): void {
    if (
      !TRACKING_STATES.has(this.sm.state) ||
      !this.transport ||
      !this.sequence ||
      !this.credential
    ) {
      return;
    }
    const allow = this.config?.event_allowlist;
    if (allow && allow.length > 0 && !allow.includes(name)) return;
    const event: CanonicalEvent = {
      schema_version: 1,
      event_id: uuid(),
      event_name: name,
      project_id: this.credential.project_id,
      study_id: this.credential.study_id,
      session_id: this.credential.session_id,
      mode: this.credential.mode,
      client_sequence: this.sequence.next(),
      client_timestamp: new Date().toISOString(),
      page_path: this.currentRoute,
      ...fields,
    };
    this.transport.enqueue(event);
  }

  track(name: string, props?: Record<string, string | number | boolean>): void {
    if (!this.config?.custom_event_allowlist.includes(name)) return;
    this.emit('ff_custom_event', { custom_name: name, custom_props: cleanCustomProps(props) });
  }

  private onAck(ack: EventsResponse): void {
    goalOnAck(this, ack);
    if (this.mode === 'setup') {
      this.saveWalk();
      this.renderSetup();
    }
  }

  private onAuthFailure(status: number): void {
    this.lastErrorCode = `events_http_${status}`;
    this.showEnded();
    this.endSession();
  }

  private endSession(): void {
    this.uninstallTrackers();
    this.clearWalk();
    if (this.projectId) clearCredential(this.projectId);
    this.transport?.discard();
    this.sm.to('STOPPED');
  }

  showEnded(): void {
    const returnUrl = this.returnUrl();
    if (this.mode === 'setup') this.widget.render({ kind: 'setup_expired', returnUrl });
    else this.widget.render({ kind: 'ended', returnUrl });
  }

  returnUrl(): string {
    return this.config?.first_five_origin ?? '/';
  }

  renderLive(): void {
    this.widget.render({ kind: 'live', task: this.credential?.task_text || 'Complete the task.' });
  }

  renderSetup(): void {
    if (this.sm.state !== 'SETUP_ACTIVE') return;
    this.widget.render({
      kind: 'setup',
      pages: this.routesSeen.size,
      elements: this.discoveredSeen.size,
    });
  }

  /** Persist walk progress so banner counts and discovery dedup survive page loads. */
  saveWalk(): void {
    if (!this.projectId || this.mode !== 'setup') return;
    writeJson(keys.setupWalk(this.projectId), {
      routes: [...this.routesSeen],
      seen: [...this.discoveredSeen],
    });
  }

  clearWalk(): void {
    if (this.projectId) remove(keys.setupWalk(this.projectId));
  }

  private confirm(reason: 'finish' | 'stuck'): void {
    if (this.sm.state !== 'LIVE_ACTIVE') return;
    this.pendingReason = reason;
    this.widget.render({ kind: 'confirm', reason });
  }

  /** True when url is on the First Five origin (handoff / return URL safety). */
  isFirstFiveUrl(url: string): boolean {
    try {
      const origin = this.config?.first_five_origin;
      return !!origin && new URL(url).origin === new URL(origin).origin;
    } catch {
      return false;
    }
  }

  fail(code: string): void {
    this.degraded = true;
    this.lastErrorCode = code;
  }

  /**
   * Detach from the page without clearing session state (what a real page unload does).
   * Internal: used by tests to simulate a reload.
   */
  detach(): void {
    this.uninstallTrackers();
    this.transport?.persist();
    this.transport?.stop();
    this.widget.destroy();
  }

  stop(): void {
    this.uninstallTrackers();
    this.clearWalk();
    this.transport?.stop();
    if (this.projectId) clearCredential(this.projectId);
    this.widget.destroy();
    if (this.sm.state !== 'STOPPED') this.sm.to('STOPPED');
  }

  diagnose(): Diagnostics {
    return buildDiagnostics(this);
  }
}
