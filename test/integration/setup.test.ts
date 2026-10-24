import { FirstFiveCore } from '../../src/core';
import { createFirstFive } from '../../src/index';
import {
  API,
  FAST,
  FF,
  FakeApi,
  PID,
  clickWidget,
  resetDom,
  setPath,
  waitFor,
  widgetText,
} from '../helpers';

type Sdk = ReturnType<typeof createFirstFive>;

describe('setup mode (C4, C5)', () => {
  let api: FakeApi;
  let navigate: ReturnType<typeof vi.fn>;
  let sdk: Sdk | null;

  const boot = async () => {
    setPath('/#ff_setup=setup-S1');
    sdk = createFirstFive({ ...FAST, navigate });
    await sdk.init({ projectId: PID, endpoint: API });
    return sdk;
  };

  beforeEach(() => {
    resetDom();
    api = new FakeApi();
    vi.stubGlobal('fetch', api.fetch);
    navigate = vi.fn();
    sdk = null;
    document.body.innerHTML =
      '<button data-firstfive-id="get_started">Get started</button>' +
      '<a href="/features">Explore features</a>' +
      '<button hidden>Hidden</button><input type="text" name="q">';
  });

  afterEach(() => {
    sdk?.stop();
    vi.unstubAllGlobals();
  });

  it('discovers unclicked elements as available, not clicked (A04)', async () => {
    const s = await boot();
    expect(s.diagnose().state).toBe('SETUP_ACTIVE');
    expect(s.diagnose().mode).toBe('setup');
    await waitFor(() => api.eventNames().filter((n) => n === 'ff_element_discovered').length === 2);
    const discovered = api.events.filter((e) => e.event_name === 'ff_element_discovered');
    expect(discovered.map((e) => e.element_id)).toContain('get_started');
    expect(discovered.every((e) => e.session_id === undefined && e.mode === 'setup')).toBe(true);
    expect(api.eventNames()).not.toContain('ff_element_clicked');
    expect(widgetText()).toContain('elements found');
  });

  it('emits a page view for a page with zero eligible elements (C5)', async () => {
    await boot();
    document.body.innerHTML = '<p>Just text</p>';
    window.history.pushState(null, '', '/about');
    await waitFor(() =>
      api.events.some((e) => e.event_name === 'ff_page_viewed' && e.page_path === '/about'),
    );
  });

  it('rescans after the DOM changes on a SPA route', async () => {
    await boot();
    window.history.pushState(null, '', '/features');
    const btn = document.createElement('button');
    btn.setAttribute('data-firstfive-id', 'late_button');
    btn.textContent = 'Late';
    document.body.appendChild(btn);
    await waitFor(
      () =>
        api.events.some(
          (e) =>
            e.event_name === 'ff_element_discovered' &&
            e.element_id === 'late_button' &&
            e.page_path === '/features',
        ),
      3000,
    );
  });

  it('finds elements revealed by un-hiding after a SPA route change', async () => {
    document.body.innerHTML +=
      '<section id="more" hidden><a href="/signup" data-firstfive-id="signup_from_features">Sign up</a></section>';
    await boot();
    window.history.pushState(null, '', '/features');
    (document.getElementById('more') as HTMLElement).hidden = false;
    await waitFor(
      () =>
        api.events.some(
          (e) => e.element_id === 'signup_from_features' && e.page_path === '/features',
        ),
      3000,
    );
  });

  it('keeps walk counts across a page load and does not re-report elements', async () => {
    setPath('/#ff_setup=setup-S1');
    const first = new FirstFiveCore({ ...FAST, navigate });
    await first.init({ projectId: PID, endpoint: API });
    await waitFor(() => api.eventNames().filter((n) => n === 'ff_element_discovered').length === 2);
    first.detach();
    setPath('/');
    const second = new FirstFiveCore({ ...FAST, navigate });
    await second.init({ projectId: PID, endpoint: API });
    expect(second.sm.state).toBe('SETUP_ACTIVE');
    await new Promise((r) => setTimeout(r, 700));
    expect(api.eventNames().filter((n) => n === 'ff_element_discovered')).toHaveLength(2);
    expect(widgetText()).toContain('1 page · 2 elements found');
    second.stop();
  });

  it('starts a new walk from sequence 1 when a fresh setup ticket arrives', async () => {
    const first = await boot();
    await waitFor(() => api.events.length >= 3);
    first.stop();
    api.events = [];
    document.querySelectorAll('first-five-widget').forEach((n) => n.remove());
    setPath('/#ff_setup=setup-S2');
    const second = createFirstFive({ ...FAST, navigate });
    await second.init({ projectId: PID, endpoint: API });
    await waitFor(() => api.events.length >= 1);
    expect(Math.min(...api.events.map((e) => e.client_sequence))).toBe(1);
    second.stop();
  });

  it('finishes the walk: flush, /setup/finish, return to First Five', async () => {
    const s = await boot();
    clickWidget('finish-setup');
    await waitFor(() => navigate.mock.calls.length === 1);
    const finish = api.callsTo('/api/sdk/setup/finish')[0];
    const sent = Math.max(...api.events.map((e) => e.client_sequence));
    expect((finish.body as { last_client_sequence: number }).last_client_sequence).toBe(sent);
    expect(navigate).toHaveBeenCalledWith(`${FF}/app/websites/p1`);
    expect(s.diagnose().state).toBe('READY');
    expect(window.sessionStorage.getItem('ff:cred:ffp_demo0001')).toBeNull();
  });

  it('falls back to the websites page when the server returns no return_url', async () => {
    api.opts.setupReturnUrl = null;
    await boot();
    clickWidget('finish-setup');
    await waitFor(() => navigate.mock.calls.length === 1);
    expect(navigate).toHaveBeenCalledWith(`${FF}/app/websites`);
  });

  it('rejects a foreign return_url', async () => {
    api.opts.setupReturnUrl = 'https://evil.example/';
    await boot();
    clickWidget('finish-setup');
    await waitFor(() => widgetText().includes("Couldn't save"));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows the expired banner when the setup ticket is rejected', async () => {
    api.opts.exchangeStatus = 410;
    const s = await boot();
    expect(s.diagnose().state).toBe('STOPPED');
    expect(widgetText()).toContain('Setup session expired');
  });
});
