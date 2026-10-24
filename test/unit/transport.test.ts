import type { CanonicalEvent } from '../../src/contracts';
import { Sequence } from '../../src/ids';
import { Transport } from '../../src/transport';
import { API, FakeApi, resetDom, waitFor } from '../helpers';

const sid = 'ffx_t';

function event(seq: number): CanonicalEvent {
  return {
    schema_version: 1,
    event_id: `e${seq}`,
    event_name: 'ff_page_viewed',
    project_id: 'ffp_1',
    study_id: 'ffs_1',
    session_id: sid,
    mode: 'live',
    client_sequence: seq,
    client_timestamp: new Date().toISOString(),
    page_path: '/',
  };
}

function make(_api: FakeApi, overrides: Partial<ConstructorParameters<typeof Transport>[0]> = {}) {
  return new Transport({
    eventsUrl: `${API}/api/sdk/events`,
    credential: 'c',
    scope: sid,
    maxBatchEvents: 20,
    onAck: () => undefined,
    onAuthFailure: () => undefined,
    onError: () => undefined,
    timing: { batchDelayMs: 10, retryDelaysMs: [5, 5, 5] },
    ...overrides,
  });
}

describe('transport', () => {
  let api: FakeApi;
  beforeEach(() => {
    resetDom();
    api = new FakeApi();
    vi.stubGlobal('fetch', api.fetch);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('batches, sends the version header and never resends an ACKed event (A12)', async () => {
    const t = make(api);
    t.enqueue(event(1));
    t.enqueue(event(2));
    await waitFor(() => api.events.length === 2);
    t.enqueue(event(1)); // duplicate of an ACKed id
    await t.flush(200);
    const sends = api.callsTo('/api/sdk/events');
    expect(sends).toHaveLength(1);
    expect(sends[0].headers['X-FirstFive-SDK']).toBeTruthy();
    expect(sends[0].headers.Authorization).toBe('Bearer c');
    expect(t.lastAckedSequence).toBe(2);
    t.stop();
  });

  it('keeps one request in flight', async () => {
    api.opts.eventsDelayMs = 30;
    const t = make(api, { timing: { batchSize: 1, batchDelayMs: 10, retryDelaysMs: [5] } });
    let concurrent = 0;
    let maxConcurrent = 0;
    const inner = api.fetch;
    vi.stubGlobal('fetch', async (u: RequestInfo | URL, i?: RequestInit) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      try {
        return await inner(u, i);
      } finally {
        concurrent--;
      }
    });
    for (let i = 1; i <= 4; i++) t.enqueue(event(i));
    await t.flush(1000);
    expect(api.events).toHaveLength(4);
    expect(maxConcurrent).toBe(1);
    t.stop();
  });

  it('retries 5xx then succeeds', async () => {
    let fails = 2;
    const inner = api.fetch;
    vi.stubGlobal('fetch', async (u: RequestInfo | URL, i?: RequestInit) => {
      if (String(u).includes('/events') && fails-- > 0) return new Response('{}', { status: 503 });
      return inner(u, i);
    });
    const t = make(api);
    t.enqueue(event(1));
    const r = await t.flush(500);
    expect(r.timedOut).toBe(false);
    expect(api.events).toHaveLength(1);
    t.stop();
  });

  it('flush is bounded by its timeout (C3)', async () => {
    api.opts.eventsDelayMs = 300;
    const t = make(api);
    t.enqueue(event(1));
    const started = Date.now();
    const r = await t.flush(50);
    expect(Date.now() - started).toBeLessThan(250);
    expect(r.timedOut).toBe(true);
    t.stop();
  });

  it('persists the queue on pagehide and drains it on the next page', async () => {
    api.opts.eventsStatus = 503;
    const t1 = make(api, { timing: { batchDelayMs: 10_000, retryDelaysMs: [] } });
    t1.enqueue(event(1));
    window.dispatchEvent(new Event('pagehide'));
    t1.stop();
    api.opts.eventsStatus = 200;
    const t2 = make(api);
    await waitFor(() => api.events.length === 1);
    expect(api.events[0].event_id).toBe('e1');
    t2.stop();
  });

  it('401 discards the queue and reports auth failure', async () => {
    api.opts.eventsStatus = 401;
    const onAuthFailure = vi.fn();
    const t = make(api, { onAuthFailure });
    t.enqueue(event(1));
    await t.flush(200);
    expect(onAuthFailure).toHaveBeenCalledWith(401);
    expect(t.queued).toBe(0);
  });
});

describe('sequence', () => {
  beforeEach(() => resetDom());
  it('is monotonic across a simulated reload (A08, C3)', () => {
    const a = new Sequence('s1');
    expect(a.next()).toBe(1);
    expect(a.next()).toBe(2);
    const b = new Sequence('s1');
    expect(b.current()).toBe(2);
    expect(b.next()).toBe(3);
  });
});
