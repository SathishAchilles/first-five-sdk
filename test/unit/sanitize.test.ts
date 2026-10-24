import { elementKey, formKey, maskText, normalizeRoute, safeLabel } from '../../src/sanitize';

describe('normalizeRoute', () => {
  it('keeps the pathname only, lowercased, without trailing slash', () => {
    expect(normalizeRoute('/Signup/?email=a@b.com#x')).toBe('/signup');
    expect(normalizeRoute('https://x.test/Pricing/')).toBe('/pricing');
    expect(normalizeRoute('/')).toBe('/');
  });

  it('replaces sensitive segments with :id', () => {
    expect(normalizeRoute('/orders/12345/items')).toBe('/orders/:id/items');
    expect(normalizeRoute('/u/3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe('/u/:id');
    expect(normalizeRoute('/invite/jane%40example.com')).toBe('/invite/:id');
    expect(normalizeRoute('/reset/abcdefghijklmnopqrstuvwxyz0123')).toBe('/reset/:id');
    expect(normalizeRoute('/v2/dashboard')).toBe('/v2/dashboard');
  });
});

describe('labels', () => {
  it('masks emails and long digit runs and caps at 80 chars', () => {
    expect(maskText('Send to jane@example.com now')).toBe('Send to • now');
    expect(maskText('Card 4111 1111 1111 1111')).toBe('Card • • • •');
    expect(maskText('x'.repeat(200))).toHaveLength(80);
  });

  it('prefers aria-label and data-firstfive-label', () => {
    document.body.innerHTML =
      '<button id="a" aria-label="Create account">+</button><button id="b" data-firstfive-label="Go">x</button>';
    expect(safeLabel(document.getElementById('a') as Element)).toBe('Create account');
    expect(safeLabel(document.getElementById('b') as Element)).toBe('Go');
  });

  it('never reads input values (PRD §2.8)', () => {
    document.body.innerHTML = '<input id="i" type="submit" aria-label="Send" value="secret-value">';
    const input = document.getElementById('i') as HTMLInputElement;
    const spy = vi.spyOn(input, 'value', 'get');
    expect(safeLabel(input)).toBe('Send');
    elementKey(input);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('keys', () => {
  it('uses data-firstfive-id when present and a stable hash otherwise', () => {
    document.body.innerHTML =
      '<button data-firstfive-id="create_account">Create</button><button>Explore</button>';
    const [a, b] = Array.from(document.querySelectorAll('button'));
    expect(elementKey(a)).toBe('create_account');
    expect(elementKey(b)).toMatch(/^auto:[0-9a-f]{8}$/);
    expect(elementKey(b)).toBe(elementKey(b));
  });

  it('builds a form key without reading values', () => {
    document.body.innerHTML =
      '<form id="signup" action="/signup?x=1"><input name="email" value="a@b.c"></form>';
    expect(formKey(document.querySelector('form') as HTMLFormElement)).toMatch(/^auto:/);
  });
});
