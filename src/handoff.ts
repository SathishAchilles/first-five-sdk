import type { ExchangeResponse, Mode, StoredCredential } from './contracts';
import { request } from './http';
import { keys, readJson, remove, writeJson } from './storage';
import { SDK_VERSION } from './version';

export interface Ticket {
  ticket: string;
  kind: Mode;
}

const HASH_KEYS: Record<string, Mode> = { ff_setup: 'setup', ff_launch: 'live' };

/** Read a one-time ticket from #ff_setup= / #ff_launch=, falling back to ?ff_t=&ff_k=. */
export function readTicket(loc: Location = window.location): Ticket | null {
  const hash = new URLSearchParams(loc.hash.replace(/^#/, ''));
  for (const [key, kind] of Object.entries(HASH_KEYS)) {
    const t = hash.get(key);
    if (t) return { ticket: t, kind };
  }
  const query = new URLSearchParams(loc.search);
  const t = query.get('ff_t');
  const k = query.get('ff_k');
  if (t && (k === 'setup' || k === 'live')) return { ticket: t, kind: k };
  return null;
}

/** Remove ticket parameters from the URL, keeping every other hash/query part (PRD §12.1). */
export function stripTicket(): void {
  try {
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    let changed = false;
    for (const key of Object.keys(HASH_KEYS)) {
      if (hash.has(key)) {
        hash.delete(key);
        changed = true;
      }
    }
    for (const key of ['ff_t', 'ff_k']) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    if (!changed) return;
    const h = hash.toString();
    url.hash = h ? `#${h}` : '';
    window.history.replaceState(window.history.state, '', url.toString());
  } catch {
    // never break the host page
  }
}

export type ExchangeOutcome =
  | { kind: 'ok'; credential: StoredCredential }
  | { kind: 'rejected'; status: number }
  | { kind: 'error' };

export async function exchange(
  endpoint: string,
  projectId: string,
  ticket: Ticket,
): Promise<ExchangeOutcome> {
  try {
    const res = await request<ExchangeResponse>(`${endpoint}/api/sdk/exchange`, {
      method: 'POST',
      body: {
        project_id: projectId,
        ticket: ticket.ticket,
        kind: ticket.kind,
        sdk_version: SDK_VERSION,
      },
    });
    if (res.status === 200 && res.body?.credential) {
      return { kind: 'ok', credential: { ...res.body, project_id: projectId } };
    }
    if (res.status === 401 || res.status === 403 || res.status === 410) {
      return { kind: 'rejected', status: res.status };
    }
    return { kind: 'error' };
  } catch {
    return { kind: 'error' };
  }
}

export function saveCredential(cred: StoredCredential): void {
  writeJson(keys.credential(cred.project_id), cred);
}

/** Restore an unexpired credential for this project (A08). */
export function loadCredential(
  projectId: string,
  now: number = Date.now(),
): StoredCredential | null {
  const cred = readJson<StoredCredential>(keys.credential(projectId));
  if (!cred) return null;
  if (Date.parse(cred.expires_at) <= now) {
    clearCredential(projectId);
    return null;
  }
  return cred;
}

export function clearCredential(projectId: string): void {
  remove(keys.credential(projectId));
}
