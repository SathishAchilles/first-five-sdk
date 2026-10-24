/**
 * Keep the widget clear of the host page's own floating UI (hosting badges, chat bubbles,
 * floating action buttons): probe each viewport corner for fixed/sticky host elements and
 * use the first free one.
 */
export type Corner = 'br' | 'bl' | 'tr' | 'tl';
export const CORNERS: Corner[] = ['br', 'bl', 'tr', 'tl'];
export const GAP = 12;

function isFloating(el: Element | null): boolean {
  for (
    let n: Element | null = el;
    n && n !== document.body && n !== document.documentElement;
    n = n.parentElement
  ) {
    try {
      const pos = window.getComputedStyle(n).position;
      if (pos === 'fixed' || pos === 'sticky') return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** Number of sample points in the corner box covered by host floating elements. */
export function occupancy(corner: Corner, width: number, height: number, self: Element): number {
  if (typeof document.elementsFromPoint !== 'function') return 0;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = corner === 'bl' || corner === 'tl' ? GAP : vw - GAP - width;
  const top = corner === 'tl' || corner === 'tr' ? GAP : vh - GAP - height;
  let hits = 0;
  for (const fx of [0.05, 0.5, 0.95]) {
    for (const fy of [0.05, 0.5, 0.95]) {
      const x = Math.round(left + width * fx);
      const y = Math.round(top + height * fy);
      if (x < 0 || y < 0 || x >= vw || y >= vh) continue;
      const hit = document
        .elementsFromPoint(x, y)
        .find(
          (e) =>
            e !== self &&
            !self.contains(e) &&
            e !== document.documentElement &&
            e !== document.body,
        );
      if (hit && isFloating(hit)) hits++;
    }
  }
  return hits;
}

/** First corner with no host floating UI, else the least covered one. */
export function pickCorner(width: number, height: number, self: Element): Corner {
  let best: Corner = 'br';
  let bestHits = Number.POSITIVE_INFINITY;
  for (const c of CORNERS) {
    const hits = occupancy(c, width, height, self);
    if (hits === 0) return c;
    if (hits < bestHits) {
      best = c;
      bestHits = hits;
    }
  }
  return best;
}

/** Position the (fixed) host element in a corner using CSSOM, which strict CSPs allow. */
export function applyCorner(host: HTMLElement, corner: Corner): void {
  const s = host.style;
  s.top = corner === 'tl' || corner === 'tr' ? `${GAP}px` : 'auto';
  s.bottom = corner === 'bl' || corner === 'br' ? `${GAP}px` : 'auto';
  s.left = corner === 'bl' || corner === 'tl' ? `${GAP}px` : 'auto';
  s.right = corner === 'br' || corner === 'tr' ? `${GAP}px` : 'auto';
}
