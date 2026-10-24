import { normalizeRoute } from '../sanitize';

type HistoryMethod = 'pushState' | 'replaceState';

/**
 * Calls onRoute(route) on load, pushState, replaceState and popstate (A05).
 * History methods are wrapped (original first, never throws) and restored on uninstall.
 */
export function installPageviews(onRoute: (route: string) => void): () => void {
  let last: string | null = null;
  const emit = () => {
    try {
      const route = normalizeRoute(window.location.pathname);
      if (route === last) return;
      last = route;
      onRoute(route);
    } catch {
      // never break the host page
    }
  };

  const originals: Partial<Record<HistoryMethod, History[HistoryMethod]>> = {};
  const wrappers: Partial<Record<HistoryMethod, History[HistoryMethod]>> = {};
  for (const name of ['pushState', 'replaceState'] as HistoryMethod[]) {
    const original = window.history[name];
    originals[name] = original;
    const wrapper = function (this: History, ...args: Parameters<History[HistoryMethod]>) {
      const result = original.apply(this, args);
      emit();
      return result;
    };
    wrappers[name] = wrapper;
    window.history[name] = wrapper;
  }
  window.addEventListener('popstate', emit);
  emit();

  return () => {
    window.removeEventListener('popstate', emit);
    for (const name of ['pushState', 'replaceState'] as HistoryMethod[]) {
      if (window.history[name] === wrappers[name] && originals[name]) {
        window.history[name] = originals[name] as History[HistoryMethod];
      }
    }
  };
}
