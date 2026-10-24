import type { ElementType } from './contracts';
import { ELIGIBLE_SELECTOR, elementKey, elementType, isExcluded, safeLabel } from './sanitize';

export interface DiscoveredElement {
  route: string;
  element_key: string;
  element_type: ElementType;
  element_label: string;
}

export const MAX_PER_ROUTE = 200;

function hidden(el: Element): boolean {
  if (el.closest('[hidden],[aria-hidden="true"]')) return true;
  try {
    const style = window.getComputedStyle(el);
    return style.display === 'none' || style.visibility === 'hidden';
  } catch {
    return false;
  }
}

/**
 * Setup-mode discovery (C5). The caller emits ff_page_viewed for every route; this module
 * emits ff_element_discovered for eligible elements, deduplicated across the walk and capped
 * per route, and rescans after DOM changes (debounced) so SPA routes are scanned after render.
 */
export class Discovery {
  private readonly perRoute = new Map<string, number>();
  private observer: MutationObserver | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly currentRoute: () => string,
    private readonly onFound: (el: DiscoveredElement) => void,
    private readonly widgetHost: () => Element | null,
    /** route|element_key already reported during this setup walk (persisted across page loads). */
    private readonly seen: Set<string> = new Set(),
    private readonly debounceMs = 500,
  ) {
    for (const id of seen) {
      const route = id.slice(0, id.indexOf('|'));
      this.perRoute.set(route, (this.perRoute.get(route) ?? 0) + 1);
    }
  }

  start(): void {
    if (typeof MutationObserver === 'undefined' || !document.body) return;
    this.observer = new MutationObserver(() => this.scheduleScan());
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'style', 'class', 'aria-hidden'],
    });
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = null;
  }

  scheduleScan(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      this.scanPage();
    }, this.debounceMs);
  }

  scanPage(): number {
    const route = this.currentRoute();
    let found = 0;
    for (const el of Array.from(document.querySelectorAll(ELIGIBLE_SELECTOR))) {
      const count = this.perRoute.get(route) ?? 0;
      if (count >= MAX_PER_ROUTE) break;
      if (isExcluded(el, this.widgetHost()) || hidden(el)) continue;
      const key = elementKey(el);
      const id = `${route}|${key}`;
      if (this.seen.has(id)) continue;
      this.seen.add(id);
      this.perRoute.set(route, count + 1);
      found++;
      this.onFound({
        route,
        element_key: key,
        element_type: elementType(el),
        element_label: safeLabel(el),
      });
    }
    return found;
  }

  get elements(): number {
    return this.seen.size;
  }
}
