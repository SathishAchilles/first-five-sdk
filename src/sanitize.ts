/** Route, label and element-key sanitisation. Never reads input values (PRD §2.8). */

import type { ElementType } from './contracts';

export const ELIGIBLE_SELECTOR =
  'button,a[href],[role=button],input[type=submit],input[type=button],[data-firstfive-id]';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_DIGITS = /\d{4,}/;
const EMAIL = /[^\s@/]+@[^\s@/]+\.[^\s@/]+/;
const TOKEN = /^[A-Za-z0-9_\-.~%]{25,}$/;

function sensitiveSegment(seg: string): boolean {
  let s = seg;
  try {
    s = decodeURIComponent(seg);
  } catch {
    // keep raw
  }
  return UUID.test(s) || LONG_DIGITS.test(s) || EMAIL.test(s) || TOKEN.test(s);
}

/** Pathname only; query and hash always dropped; sensitive segments become ":id". */
export function normalizeRoute(input: string): string {
  let path = input;
  try {
    path = new URL(input, 'http://x').pathname;
  } catch {
    path = input.split(/[?#]/)[0] || '/';
  }
  const segs = path
    .split('/')
    .filter(Boolean)
    .map((s) => (sensitiveSegment(s) ? ':id' : s.toLowerCase()));
  return '/' + segs.join('/');
}

export function maskText(text: string): string {
  return text
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '•')
    .replace(/\d{4,}/g, '•')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

const EDITABLE = '[contenteditable]:not([contenteditable="false"]),input,textarea,select';

/** True when the element is, sits in, or contains user-editable content. */
function hasEditableText(el: Element): boolean {
  return (
    (el as HTMLElement).isContentEditable === true ||
    !!el.closest('[contenteditable]:not([contenteditable="false"])') ||
    !!el.querySelector(EDITABLE)
  );
}

/** Visible label only (never `.value`, never text typed into editable content). */
export function safeLabel(el: Element): string {
  const candidates = [
    el.getAttribute('aria-label'),
    el.getAttribute('data-firstfive-label'),
    hasEditableText(el) ? null : ((el as HTMLElement).innerText ?? el.textContent),
    el.getAttribute('title'),
    el.getAttribute('alt'),
  ];
  for (const c of candidates) {
    if (c && c.trim()) return maskText(c);
  }
  return '';
}

export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function elementKey(el: Element): string {
  const explicit = el.getAttribute('data-firstfive-id');
  if (explicit) return explicit.slice(0, 120);
  const parts = [
    el.tagName.toLowerCase(),
    el.getAttribute('id') ?? '',
    el.getAttribute('name') ?? '',
    safeLabel(el),
    el.getAttribute('role') ?? '',
  ];
  return 'auto:' + fnv1a(parts.join('|'));
}

/** Map an element to the contract's element_type enum. */
export function elementType(el: Element): ElementType {
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') return el.getAttribute('type') === 'submit' ? 'submit' : 'button';
  if (tag === 'button') return el.getAttribute('type') === 'submit' ? 'submit' : 'button';
  if (tag === 'a') return 'link';
  if (tag === 'form') return 'form';
  if (el.getAttribute('role') === 'button') return 'role_button';
  return 'other';
}

/** True when the element sits in an area the SDK must never record. */
export function isExcluded(el: Element, widgetHost?: Element | null): boolean {
  if (el.closest('[data-firstfive-ignore]')) return true;
  if (widgetHost && (el === widgetHost || widgetHost.contains(el))) return true;
  const form = el.closest('form');
  if (form && form.querySelector('[autocomplete^="cc-"]')) return true;
  return false;
}

export function formKey(form: HTMLFormElement): string {
  const explicit = form.getAttribute('data-firstfive-id');
  if (explicit) return explicit.slice(0, 80);
  let action = '';
  try {
    action = normalizeRoute(form.getAttribute('action') ?? '');
  } catch {
    action = '';
  }
  return (
    'auto:' +
    fnv1a([form.getAttribute('id') ?? '', form.getAttribute('name') ?? '', action].join('|'))
  );
}
