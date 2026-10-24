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
const PROJECT_ID = 'ffp_demo';
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
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-FirstFive-SDK');
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
        status: 'active',
        allowed_origins: [HOST],
        events_url: `${FF}/api/sdk/events`,
        event_allowlist: [],
        custom_event_allowlist: ['signup_completed'],
        max_batch_events: 20,
        first_five_origin: FF,
      });
    }

    if (path === '/dev/mint') {
      const kind = url.searchParams.get('kind') === 'setup' ? 'setup' : 'live';
      const ticket = randomUUID();
      const session_id = kind === 'live' ? `ffx_${randomUUID().slice(0, 8)}` : null;
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
      const t = tickets.get(body.ticket);
      log(
        'exchange',
        body.kind,
        'sdk',
        body.sdk_version,
        t ? (t.used ? 'REUSED' : 'ok') : 'UNKNOWN',
      );
      if (!t || t.used || t.kind !== body.kind) return send(res, 410, { error: 'ticket_invalid' });
      t.used = true;
      const credential = randomUUID();
      credentials.set(credential, { kind: t.kind, session_id: t.session_id });
      return send(res, 200, {
        credential,
        expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
        mode: t.kind,
        session_id: t.session_id,
        study_id: t.session_id ? 'ffs_demo' : null,
        task_text: 'Create an account and reach your dashboard.',
      });
    }

    if (path === '/api/sdk/events' && req.method === 'POST') {
      const cred = auth(req);
      if (!cred) return send(res, 401, { error: 'unauthorized' });
      const body = await readBody(req);
      const accepted = [];
      const store = cred.session_id ? sessions.get(cred.session_id) : null;
      if (store && store.status !== 'pending' && store.status !== 'completed') {
        return send(res, 410, { error: 'session_ended' });
      }
      const target = store ? store.events : setupEvents;
      for (const e of body.events ?? []) {
        if (!target.some((x) => x.event_id === e.event_id)) target.push(e);
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
      const seqs = target.map((e) => e.client_sequence);
      log(
        'events',
        cred.kind,
        cred.session_id ?? '',
        (body.events ?? [])
          .map(
            (e) =>
              `${e.client_sequence}:${e.event_name}:${e.page_path}${e.element_key ? ':' + e.element_key : ''}`,
          )
          .join(' '),
      );
      return send(res, 200, {
        accepted,
        rejected: [],
        last_acked_sequence: seqs.length ? Math.max(...seqs) : 0,
        ...(store ? { goal_status: store.goal_verified ? 'verified' : 'pending' } : {}),
      });
    }

    const end = path.match(/^\/api\/sessions\/([^/]+)\/end$/);
    if (end && req.method === 'POST') {
      const cred = auth(req);
      if (!cred || cred.session_id !== end[1]) return send(res, 401, { error: 'unauthorized' });
      const body = await readBody(req);
      const s = sessions.get(end[1]);
      const maxSeq = s.events.length ? Math.max(...s.events.map((e) => e.client_sequence)) : 0;
      if (s.status === 'pending') s.status = 'dropped';
      s.ended_with = {
        reason: body.reason,
        last_client_sequence: body.last_client_sequence,
        acked_through: maxSeq,
      };
      log(
        'end',
        end[1],
        body.reason,
        'last_client_sequence',
        body.last_client_sequence,
        'acked',
        maxSeq,
        '->',
        s.status,
      );
      return send(res, 200, {
        outcome: s.status,
        feedback_handoff: {
          url: `${FF}/study/ffs_demo/feedback?handoff=${randomUUID()}`,
          expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        },
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
      return send(res, 200, { return_url: `${FF}/projects/${PROJECT_ID}/discovery?setup=done` });
    }

    if (path.startsWith('/study/') && path.endsWith('/feedback')) {
      return send(
        res,
        200,
        page('Feedback', '<h1>First Five · Feedback</h1><p>Feedback page stub.</p>'),
        'text/html',
      );
    }

    if (path.startsWith('/projects/')) {
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
