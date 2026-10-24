import { keys, readJson, writeJson } from './storage';

export function uuid(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Monotonic client_sequence per scope, persisted so a reload continues the count (A08, C3). */
export class Sequence {
  private value: number;
  private readonly key: string;

  constructor(scope: string) {
    this.key = keys.sequence(scope);
    this.value = readJson<number>(this.key) ?? 0;
  }

  next(): number {
    this.value += 1;
    writeJson(this.key, this.value);
    return this.value;
  }

  current(): number {
    return this.value;
  }
}
