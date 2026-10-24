// Local executable reference for the First Five SDK wire contract (src/contracts.ts).
// API + "First Five" pages on http://localhost:5173, demo customer site on http://localhost:5174.
// Usage: npm run dev, then open http://localhost:5173/dev/mint?kind=setup or ?kind=live
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_PORT = Number(process.env.FF_API_PORT ?? 5173);
const HOST_PORT = Number(process.env.FF_HOST_PORT ?? 5174);
const FF = `http://localhost:${API_PORT}`;
const HOST = `http://localhost:${HOST_PORT}`;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROJECT_ID = 'ffp_demo0001';
const GOAL_ROUTE = '/dashboard';

const tickets = new Map(); // ticket -> { kind, used, session_id }
const credentials = new Map(); // credential -> { kind, session_id }
const sessions = new Map(); // session_id -> { status, goal_verified, events: [], ended_with }
const setupEvents = [];

function log(...args) {
  console.log(new Date().toISOString().slice(11, 23), ...args);
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  // mirror the Render API: only content-type and authorization are allowed
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  res.setHeader('Access-Control-Max-Age', '600');
}

function send(res, status, data, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(type === 'application/json' ? JSON.stringify(data) : data);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function auth(req) {
  const h = req.headers.authorization ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  return credentials.get(token) ?? null;
}

function page(title, body) {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font:16px system-ui;max-width:640px;margin:40px auto">${body}</body>`;
}

const api = createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') return send(res, 204, '');
  const url = new URL(req.url, FF);
  const path = url.pathname;
  try {
    if (path === '/sdk/v1/firstfive.js' || path === '/sdk/firstfive.js') {
      const js = await readFile(join(ROOT, 'dist/firstfive.iife.min.js'));
      return send(res, 200, js, 'application/javascript');
    }

    if (path === '/api/sdk/config') {
      return send(res, 200, {
        project_id: PROJECT_ID,
        status: 'active',
        contract_version: 1,
        api_base_url: FF,
        allowed_origins: [HOST],
        event_allowlist: [
          'ff_page_viewed',
          'ff_element_clicked',
          'ff_form_submitted',
          'ff_custom_event',
          'ff_element_discovered',
        ],
        allowed_custom_events: ['signup_completed'],
        limits: { maxEventsPerBatch: 50 },
      });
    }

    if (path === '/dev/mint') {
      const kind = url.searchParams.get('kind') === 'setup' ? 'setup' : 'live';
      const ticket = randomUUID();
      const session_id =
        kind === 'live' ? `ffx_${randomUUID().replace(/-/g, '').slice(0, 12)}` : null;
      tickets.set(ticket, { kind, used: false, session_id });
      if (session_id)
        sessions.set(session_id, { status: 'pending', goal_verified: false, events: [] });
      log('mint', kind, session_id ?? '');
      res.writeHead(302, {
        Location: `${HOST}/#${kind === 'setup' ? 'ff_setup' : 'ff_launch'}=${ticket}`,
      });
      return res.end();
    }

    if (path === '/dev/log')
      return send(res, 200, { sessions: Object.fromEntries(sessions), setupEvents });

    if (path === '/api/sdk/exchange' && req.method === 'POST') {
      const body = await readBody(req);
      const extra = Object.keys(body).filter(
        (k) => !['project_id', 'ticket', 'sdk_version'].includes(k),
      );
      if (extra.length)
        return send(res, 400, {
          error: { code: 'invalid_request', message: `unknown keys ${extra}` },
        });
      const t = tickets.get(body.ticket);
      log('exchange sdk', body.sdk_version, t ? (t.used ? 'REUSED' : t.kind) : 'UNKNOWN');
      if (!t || t.used)
        return send(res, 410, {
          error: { code: 'ticket_consumed', message: 'Ticket already used.' },
        });
      t.used = true;
      const credential = randomUUID();
      credentials.set(credential, { kind: t.kind, session_id: t.session_id });
      const expires_at = new Date(Date.now() + 30 * 60_000).toISOString();
      return send(res, 200, {
        credential,
        mode: t.kind,
        expires_at,
        project_id: PROJECT_ID,
        ...(t.session_id
          ? {
              study: {
                study_id: 'ffs_demo0001',
                session_id: t.session_id,
                task: 'Create an account and reach your dashboard.',
                deadline_at: expires_at,
                goal_type: 'page_reached',
              },
            }
          : { setup: { setup_session_id: 'set_demo', expires_at } }),
      });
    }

    if (path === '/api/sdk/events' && req.method === 'POST') {
      const cred = auth(req);
      if (!cred)
        return send(res, 401, { error: { code: 'unauthenticated', message: 'No credential.' } });
      const body = await readBody(req);
      if (body.schema_version !== 1)
        return send(res, 400, { error: { code: 'invalid_request', message: 'schema_version' } });
      const store = cred.session_id ? sessions.get(cred.session_id) : null;
      const target = store ? store.events : setupEvents;
      const accepted = [];
      const duplicates = [];
      for (const e of body.events ?? []) {
        if (target.some((x) => x.event_id === e.event_id)) {
          duplicates.push(e.event_id);
          continue;
        }
        target.push(e);
        accepted.push(e.event_id);
        if (
          store &&
          e.event_name === 'ff_page_viewed' &&
          e.page_path === GOAL_ROUTE &&
          store.status === 'pending'
        ) {
          store.goal_verified = true;
          store.status = 'completed';
          log('GOAL VERIFIED', cred.session_id, 'seq', e.client_sequence);
        }
      }
      log(
        'events',
        cred.kind,
        cred.session_id ?? '',
        (body.events ?? [])
          .map(
            (e) =>
              `${e.client_sequence}:${e.event_name}:${e.page_path ?? ''}${e.element_id ? ':' + e.element_id : ''}${duplicates.includes(e.event_id) ? '(dup)' : ''}`,
          )
          .join(' '),
      );
      return send(res, 200, {
        accepted,
        duplicates,
        rejected: [],
        goal: store ? { verified: store.goal_verified, verified_event_id: null } : null,
        session_status: store ? store.status : null,
      });
    }

    if (path === '/api/sdk/session/end' && req.method === 'POST') {
      const cred = auth(req);
      if (!cred || !cred.session_id)
        return send(res, 401, {
          error: { code: 'unauthenticated', message: 'No live credential.' },
        });
      const id = cred.session_id;
      const body = await readBody(req);
      const s = sessions.get(id);
      const maxSeq = s.events.length ? Math.max(...s.events.map((e) => e.client_sequence)) : 0;
      if (s.status === 'pending') s.status = 'dropped';
      s.ended_with = {
        reason: body.reason,
        last_client_sequence: body.last_client_sequence,
        acked_through: maxSeq,
      };
      log(
        'end',
        id,
        body.reason,
        'last_client_sequence',
        body.last_client_sequence,
        'acked',
        maxSeq,
        '->',
        s.status,
      );
      return send(res, 200, {
        session_status: s.status,
        final_reason:
          s.status === 'completed'
            ? 'goal_verified'
            : body.reason === 'gave_up'
              ? 'explicit_stop'
              : 'finished_without_goal',
        feedback_url: `${FF}/t/ffs_demo0001/feedback#h=${randomUUID()}`,
      });
    }

    if (path === '/api/sdk/setup/finish' && req.method === 'POST') {
      const cred = auth(req);
      if (!cred || cred.kind !== 'setup') return send(res, 401, { error: 'unauthorized' });
      const body = await readBody(req);
      log(
        'setup/finish last_client_sequence',
        body.last_client_sequence,
        'events',
        setupEvents.length,
      );
      return send(res, 200, { status: 'finished', return_url: `${FF}/app/websites/demo` });
    }

    if (path.startsWith('/t/') && path.endsWith('/feedback')) {
      return send(
        res,
        200,
        page('Feedback', '<h1>First Five · Feedback</h1><p>Feedback page stub.</p>'),
        'text/html',
      );
    }

    if (path.startsWith('/app/websites')) {
      const pages = [...new Set(setupEvents.map((e) => e.page_path))];
      const els = setupEvents.filter((e) => e.event_name === 'ff_element_discovered');
      return send(
        res,
        200,
        page(
          'Discovery',
          `<h1>First Five · Discovery</h1><p>${pages.length} pages · ${els.length} elements</p>`,
        ),
        'text/html',
      );
    }

    return send(res, 404, { error: 'not_found' });
  } catch (err) {
    log('error', err);
    return send(res, 500, { error: 'server_error' });
  }
});

const ROUTES = { '/': 'index.html', '/signup': 'signup.html', '/dashboard': 'dashboard.html' };
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };

const host = createServer(async (req, res) => {
  const url = new URL(req.url, HOST);
  let file = ROUTES[url.pathname];
  if (!file) {
    const safe = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
    file = extname(safe)
      ? safe.slice(1)
      : url.pathname.startsWith('/dashboard')
        ? 'dashboard.html'
        : 'index.html';
  }
  try {
    const content = await readFile(join(ROOT, 'dev/demo-host', file));
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'text/plain' });
    res.end(content);
  } catch {
    res.writeHead(404).end('not found');
  }
});

api.listen(API_PORT, () =>
  log(`First Five mock API on ${FF}  (mint: ${FF}/dev/mint?kind=live|setup, log: ${FF}/dev/log)`),
);
host.listen(HOST_PORT, () => log(`Demo customer site on ${HOST}`));
