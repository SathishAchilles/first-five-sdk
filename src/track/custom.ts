export type CustomProps = Record<string, string | number | boolean>;

/** Keep only primitive props (max 10 keys, strings cut to 80 chars); drop anything else. */
export function cleanCustomProps(props: unknown): CustomProps {
  const out: CustomProps = {};
  if (!props || typeof props !== 'object') return out;
  let n = 0;
  for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
    if (n >= 10) break;
    const key = k.slice(0, 40);
    if (typeof v === 'string') out[key] = v.slice(0, 80);
    else if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    else if (typeof v === 'boolean') out[key] = v;
    else continue;
    n++;
  }
  return out;
}
