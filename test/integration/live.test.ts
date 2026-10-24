import { FirstFiveCore } from '../../src/core';
import { requestEnd } from '../../src/finalize';
import { createFirstFive } from '../../src/index';
import {
  API,
  FAST,
  FF,
  FakeApi,
  clickWidget,
  resetDom,
  setPath,
  waitFor,
  widgetActions,
  widgetText,
} from '../helpers';

type Sdk = ReturnType<typeof createFirstFive>;

describe('live mode', () => {
  let api: FakeApi;
  let navigate: ReturnType<typeof vi.fn>;
  let sdk: Sdk | null;

  const boot = async (path: string) => {
    setPath(path);
    sdk = createFirstFive({ ...FAST, navigate });
    await sdk.init({ projectId: 'ffp_1', endpoint: API });
    return sdk;
  };

  beforeEach(() => {
    resetDom();
    api = new FakeApi({ goalRoute: '/dashboard' });
    vi.stubGlobal('fetch', api.fetch);
    navigate = vi.fn();
    sdk = null;
    document.body.innerHTML =
      '<a href="/pricing" id="pricing">Pricing</a><button data-firstfive-id="create_account">Create account</button>';
  });

  afterEach(() => {
    sdk?.stop();
    vi.unstubAllGlobals();
  });

  it('records nothing from a disallowed origin (A03)', async () => {
    api.opts.allowedOrigins = ['https://other.example'];
    const s = await boot('/start#ff_launch=T1');
    (document.getElementById('pricing') as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 50));
    expect(s.diagnose().state).toBe('READY');
    expect(s.diagnose().last_error_code).toBe('origin_not_allowed');
    expect(window.location.hash).toBe('');
    expect(api.callsTo('/api/sdk/exchange')).toHaveLength(0);
    expect(api.callsTo('/api/sdk/events')).toHaveLength(0);
  });

  it('records nothing without a ticket or credential (A06)', async () => {
    const s = await boot('/');
    (document.getElementById('pricing') as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 50));
    expect(s.diagnose().state).toBe('READY');
    expect(api.callsTo('/api/sdk/events')).toHaveLength(0);
  });

  it('exchanges the ticket, strips it and binds events to the attempt (A07)', async () => {
    const s = await boot('/start?ref=x#ff_launch=T1&keep=1');
    expect(window.location.hash).toBe('#keep=1');
    expect(window.location.search).toBe('?ref=x');
    const ex = api.callsTo('/api/sdk/exchange')[0].body as { ticket: string; sdk_version: string };
    expect(ex.ticket).toBe('T1');
    expect(ex.sdk_version).toBeTruthy();
    // config GET stays CORS-simple: no custom headers, so no preflight
    expect(api.callsTo('/api/sdk/config')[0].headers).toEqual({});
    expect(s.diagnose().state).toBe('LIVE_ACTIVE');
    (document.getElementById('pricing') as HTMLElement).click();
    await waitFor(() => api.eventNames().includes('ff_element_clicked'));
    expect(api.events.every((e) => e.session_id === 'ffx_1' && e.study_id === 'ffs_1')).toBe(true);
    const click = api.events.find((e) => e.event_name === 'ff_element_clicked');
    expect(click?.page_path).toBe('/start');
    expect(widgetText()).toContain('Create an account');
  });

  it('restores the attempt on reload and continues the sequence (A08)', async () => {
    setPath('/start#ff_launch=T1');
    const first = new FirstFiveCore({ ...FAST, navigate });
    await first.init({ projectId: 'ffp_1', endpoint: API });
    await waitFor(() => api.events.length >= 1);
    const maxBefore = Math.max(...api.events.map((e) => e.client_sequence));
    first.detach(); // simulate unload: listeners gone, session state kept
    const countBefore = api.events.length;
    setPath('/start');
    const second = new FirstFiveCore({ ...FAST, navigate });
    await second.init({ projectId: 'ffp_1', endpoint: API });
    expect(second.sm.state).toBe('LIVE_ACTIVE');
    expect(api.callsTo('/api/sdk/exchange')).toHaveLength(1);
    (document.getElementById('pricing') as HTMLElement).click();
    await waitFor(() => api.events.length > countBefore + 1);
    const fromSecond = api.events.slice(countBefore);
    expect(fromSecond.map((e) => e.event_name)).toEqual(['ff_page_viewed', 'ff_element_clicked']);
    expect(fromSecond.every((e) => e.session_id === 'ffx_1')).toBe(true);
    expect(Math.min(...fromSecond.map((e) => e.client_sequence))).toBe(maxBefore + 1);
    second.stop();
  });

  it('shows the ended UI when the ticket is expired or reused (A28)', async () => {
    api.opts.exchangeStatus = 410;
    const s = await boot('/start#ff_launch=OLD');
    expect(s.diagnose().state).toBe('STOPPED');
    expect(widgetText()).toContain('This test has ended');
    expect(widgetActions()).toContain('return');
  });

  it('shows Task complete when the ACK verifies the goal (A26, C2)', async () => {
    const s = await boot('/start#ff_launch=T1');
    window.history.pushState(null, '', '/dashboard');
    await waitFor(() => s.diagnose().state === 'GOAL_CONFIRMED');
    expect(widgetText()).toContain('Task complete');
    expect(widgetActions()).toEqual(['continue']);
  });

  it('restores GOAL_CONFIRMED after a reload from the first ACK (A26 + A08)', async () => {
    setPath('/start#ff_launch=T1');
    const first = new FirstFiveCore({ ...FAST, navigate });
    await first.init({ projectId: 'ffp_1', endpoint: API });
    window.history.pushState(null, '', '/dashboard');
    await waitFor(() => first.sm.state === 'GOAL_CONFIRMED');
    first.detach();
    const again = new FirstFiveCore({ ...FAST, navigate });
    await again.init({ projectId: 'ffp_1', endpoint: API });
    expect(again.sm.state).toBe('LIVE_ACTIVE');
    await waitFor(() => again.sm.state === 'GOAL_CONFIRMED');
    expect(widgetActions()).toEqual(['continue']);
    again.stop();
  });

  it('flushes the goal click before /end and sends the matching last_client_sequence (A27, C3)', async () => {
    api.opts.eventsDelayMs = 40;
    await boot('/signup#ff_launch=T1');
    (document.querySelector('[data-firstfive-id="create_account"]') as HTMLElement).click();
    clickWidget('finish');
    clickWidget('confirm-yes');
    await waitFor(() => navigate.mock.calls.length === 1);
    const end = api.callsTo('/end')[0];
    const eventsCalls = api.callsTo('/api/sdk/events');
    const lastEventsCall = eventsCalls[eventsCalls.length - 1];
    expect(lastEventsCall && lastEventsCall.at <= end.at).toBe(true);
    const sent = Math.max(...api.events.map((e) => e.client_sequence));
    expect((end.body as { last_client_sequence: number }).last_client_sequence).toBe(sent);
    expect(api.eventNames()).toContain('ff_element_clicked');
    expect(navigate).toHaveBeenCalledWith(`${FF}/study/ffs_1/feedback?handoff=h1`);
  });

  it("sends reason 'stuck' and redirects to feedback (A10)", async () => {
    const s = await boot('/start#ff_launch=T1');
    clickWidget('stuck');
    clickWidget('confirm-yes');
    await waitFor(() => navigate.mock.calls.length === 1);
    expect((api.callsTo('/end')[0].body as { reason: string }).reason).toBe('stuck');
    expect(s.diagnose().state).toBe('STOPPED');
  });

  it('sends exactly one /end when ending is requested twice (idempotent)', async () => {
    setPath('/start#ff_launch=T1');
    const core = new FirstFiveCore({ ...FAST, navigate });
    await core.init({ projectId: 'ffp_1', endpoint: API });
    const a = requestEnd(core, 'finish');
    const b = requestEnd(core, 'stuck');
    expect(a).toBe(b);
    await a;
    expect(api.callsTo('/end')).toHaveLength(1);
    expect(navigate).toHaveBeenCalledTimes(1);
    core.stop();
  });

  it('rejects a feedback handoff on a foreign origin', async () => {
    api.opts.endUrl = 'https://evil.example/phish';
    await boot('/start#ff_launch=T1');
    clickWidget('finish');
    clickWidget('confirm-yes');
    await waitFor(() => widgetText().includes("Couldn't save"));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows a recovery link when /end keeps failing', async () => {
    api.opts.endStatus = 503;
    await boot('/start#ff_launch=T1');
    clickWidget('finish');
    clickWidget('confirm-yes');
    await waitFor(() => widgetText().includes("Couldn't save"));
    expect(api.callsTo('/end')).toHaveLength(4);
    expect(widgetActions()).toContain('return');
  });

  it('goes to the ended UI on a 401 from events', async () => {
    const s = await boot('/start#ff_launch=T1');
    api.opts.eventsStatus = 401;
    (document.getElementById('pricing') as HTMLElement).click();
    await waitFor(() => s.diagnose().state === 'STOPPED');
    expect(widgetText()).toContain('This test has ended');
    expect(window.sessionStorage.getItem('ff:cred:ffp_1')).toBeNull();
  });

  it('records a form submission without reading values, and allowlisted custom events', async () => {
    document.body.innerHTML += '<form data-firstfive-id="signup_form"><input name="email"></form>';
    const s = await boot('/signup#ff_launch=T1');
    const input = document.querySelector('input') as HTMLInputElement;
    const spy = vi.spyOn(input, 'value', 'get');
    (document.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    s.track('signup_completed', { plan: 'free', nested: { a: 1 } as unknown as string });
    s.track('not_allowed');
    await waitFor(() => api.eventNames().includes('ff_custom_event'));
    const form = api.events.find((e) => e.event_name === 'ff_form_submitted');
    expect(form?.form_key).toBe('signup_form');
    const custom = api.events.filter((e) => e.event_name === 'ff_custom_event');
    expect(custom).toHaveLength(1);
    expect(custom[0].custom_props).toEqual({ plan: 'free' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('records one page view per SPA route change without duplicates (A05)', async () => {
    await boot('/start#ff_launch=T1');
    window.history.pushState(null, '', '/pricing');
    window.history.replaceState(null, '', '/pricing');
    window.history.pushState(null, '', '/pricing?tab=2');
    await waitFor(() => api.events.filter((e) => e.event_name === 'ff_page_viewed').length >= 2);
    await new Promise((r) => setTimeout(r, 40));
    const views = api.events
      .filter((e) => e.event_name === 'ff_page_viewed')
      .map((e) => e.page_path);
    expect(views).toEqual(['/start', '/pricing']);
  });
});
