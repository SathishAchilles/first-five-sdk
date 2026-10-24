/** sessionStorage wrapper: every access is guarded because storage can be unavailable. */

export function readJson<T>(key: string): T | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: the SDK keeps working in memory
  }
}

export function remove(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export const keys = {
  credential: (projectId: string) => `ff:cred:${projectId}`,
  sequence: (scope: string) => `ff:seq:${scope}`,
  queue: (scope: string) => `ff:q:${scope}`,
  setupWalk: (projectId: string) => `ff:walk:${projectId}`,
  widgetCorner: () => 'ff:widget:corner',
};
