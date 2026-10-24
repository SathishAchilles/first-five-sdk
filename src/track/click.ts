import { ELIGIBLE_SELECTOR, elementKey, elementType, isExcluded, safeLabel } from '../sanitize';

export interface ClickInfo {
  element_key: string;
  element_type: string;
  element_label: string;
}

/** One capture-phase listener; never prevents or stops the host's own handling. */
export function installClicks(
  onClick: (info: ClickInfo) => void,
  widgetHost: () => Element | null,
): () => void {
  const handler = (ev: Event) => {
    try {
      const target = ev.target as Element | null;
      if (!target || typeof target.closest !== 'function') return;
      const el = target.closest(ELIGIBLE_SELECTOR);
      if (!el || isExcluded(el, widgetHost())) return;
      onClick({
        element_key: elementKey(el),
        element_type: elementType(el),
        element_label: safeLabel(el),
      });
    } catch {
      // never break the host page
    }
  };
  document.addEventListener('click', handler, true);
  return () => document.removeEventListener('click', handler, true);
}
