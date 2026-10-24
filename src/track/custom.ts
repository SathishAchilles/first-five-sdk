export type CustomProps = Record<string, string | number | boolean>;

/** Server rules (packages/sdk-contract): snake_case keys, ≤10, no sensitive-looking keys. */
const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const FORBIDDEN =
  /pass(word)?|pwd|otp|token|secret|card|cvv|cvc|iban|ssn|aadhaar|pan_?number|email|phone|address|dob|birth|value|input/i;
export const CUSTOM_EVENT_NAME = /^[a-z][a-z0-9_]{0,63}$/;

/** Keep only allowed keys with primitive values (strings cut to 120 chars); drop the rest. */
export function cleanCustomProps(props: unknown): CustomProps {
  const out: CustomProps = {};
  if (!props || typeof props !== 'object') return out;
  let n = 0;
  for (const [key, v] of Object.entries(props as Record<string, unknown>)) {
    if (n >= 10) break;
    if (!KEY.test(key) || FORBIDDEN.test(key)) continue;
    if (typeof v === 'string') out[key] = v.slice(0, 120);
    else if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    else if (typeof v === 'boolean') out[key] = v;
    else continue;
    n++;
  }
  return out;
}
