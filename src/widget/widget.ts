import { keys, readJson, writeJson } from '../storage';
import { CORNERS, applyCorner, pickCorner, type Corner } from './placement';
import { WIDGET_CSS } from './styles';

export type WidgetView =
  | { kind: 'live'; task: string }
  | { kind: 'confirm'; reason: 'finish' | 'stuck' }
  | { kind: 'saving' }
  | { kind: 'complete' }
  | { kind: 'ended'; returnUrl: string }
  | { kind: 'error'; returnUrl: string }
  | { kind: 'done'; returnUrl: string }
  | { kind: 'setup'; pages: number; elements: number }
  | { kind: 'setup_expired'; returnUrl: string };

export interface WidgetActions {
  stuck: () => void;
  finish: () => void;
  confirm: (yes: boolean) => void;
  continueToFeedback: () => void;
  finishSetup: () => void;
}

export const WIDGET_TAG = 'first-five-widget';

/** Shadow-DOM task control and setup banner (PRD §3.4 step 6). Text is always set via textContent. */
export class Widget {
  private host: HTMLElement | null = null;
  private root: ShadowRoot | null = null;
  private panel: HTMLDivElement | null = null;
  private status: HTMLDivElement | null = null;
  private corner: Corner = 'bl';
  /** Corner chosen by the participant with the move control; wins over auto placement. */
  private pinned = false;
  private minimised = false;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private readonly onResize = () => this.place();
  view: WidgetView | null = null;

  constructor(private readonly actions: WidgetActions) {}

  get element(): HTMLElement | null {
    return this.host;
  }

  get shadow(): ShadowRoot | null {
    return this.root;
  }

  private mount(): void {
    if (this.host) return;
    this.host = document.createElement(WIDGET_TAG);
    this.host.setAttribute('data-firstfive-ignore', '');
    this.root = this.host.attachShadow({ mode: 'open' });
    // Constructable stylesheets are CSSOM, so a strict style-src CSP does not block them;
    // fall back to an inline <style> where they are unsupported.
    let style: HTMLStyleElement | null = null;
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(WIDGET_CSS);
      this.root.adoptedStyleSheets = [sheet];
    } catch {
      style = document.createElement('style');
      style.textContent = WIDGET_CSS;
    }
    this.panel = document.createElement('div');
    this.panel.className = 'ff';
    this.panel.setAttribute('role', 'region');
    this.panel.setAttribute('aria-label', 'First Five test controls');
    this.status = document.createElement('div');
    this.status.className = 'status';
    this.status.setAttribute('aria-live', 'polite');
    if (style) this.root.append(style);
    this.root.append(this.panel, this.status);
    this.styleHost(this.host);
    document.documentElement.appendChild(this.host);
    // Top layer: nothing on the host page can paint over the widget, whatever its z-index.
    try {
      this.host.setAttribute('popover', 'manual');
      (this.host as HTMLElement & { showPopover?: () => void }).showPopover?.();
    } catch {
      this.host.removeAttribute('popover');
    }
    const saved = readJson<Corner>(keys.widgetCorner());
    if (saved && CORNERS.includes(saved)) {
      this.corner = saved;
      this.pinned = true;
    }
    this.place();
    // Host badges and chat widgets often load late: re-check the corner a few times.
    for (const ms of [800, 2500, 6000]) this.timers.push(setTimeout(() => this.place(), ms));
    window.addEventListener('resize', this.onResize);
  }

  /** Fixed, transparent, maximum z-index host; set via CSSOM so strict CSPs allow it. */
  private styleHost(host: HTMLElement): void {
    const s = host.style;
    s.setProperty('position', 'fixed', 'important');
    s.setProperty('z-index', '2147483647', 'important');
    s.setProperty('margin', '0', 'important');
    s.setProperty('padding', '0', 'important');
    s.setProperty('border', '0', 'important');
    s.setProperty('background', 'transparent', 'important');
    s.setProperty('width', 'auto', 'important');
    s.setProperty('height', 'auto', 'important');
    s.setProperty('overflow', 'visible', 'important');
    s.setProperty('inset', 'auto');
  }

  /** Pick the free corner (unless the participant moved it) and apply it. */
  place(): void {
    if (!this.host) return;
    if (!this.pinned) {
      const box = this.panel?.getBoundingClientRect();
      const w = box && box.width > 0 ? box.width : Math.min(320, window.innerWidth - 24);
      const h = box && box.height > 0 ? box.height : 140;
      this.corner = pickCorner(w, h, this.host);
    }
    applyCorner(this.host, this.corner);
  }

  /** Move control: cycle corners and remember the choice for this tab. */
  private move(): void {
    this.corner = CORNERS[(CORNERS.indexOf(this.corner) + 1) % CORNERS.length];
    this.pinned = true;
    writeJson(keys.widgetCorner(), this.corner);
    this.place();
  }

  private setMinimised(value: boolean): void {
    this.minimised = value;
    if (this.view) this.render(this.view);
  }

  render(view: WidgetView): void {
    this.mount();
    this.view = view;
    const panel = this.panel as HTMLDivElement;
    panel.replaceChildren();
    // States that need the participant's attention always open the panel.
    if (['complete', 'ended', 'error', 'done', 'setup_expired', 'confirm'].includes(view.kind)) {
      this.minimised = false;
    }
    if (this.minimised) {
      panel.style.setProperty('padding', '0');
      panel.style.setProperty('border', '0');
      panel.style.setProperty('background', 'transparent');
      panel.style.setProperty('box-shadow', 'none');
      panel.style.setProperty('width', 'auto');
      const label =
        view.kind === 'setup' || view.kind === 'setup_expired'
          ? 'First Five setup ▴'
          : 'First Five test ▴';
      const pill = this.button(label, () => this.setMinimised(false), 'expand');
      pill.className = 'pill';
      pill.setAttribute('aria-label', 'Show First Five controls');
      panel.append(pill);
      this.place();
      return;
    }
    panel.removeAttribute('style');
    const title = (t: string) => {
      const head = this.el('div', 'head');
      const move = this.button('⇆', () => this.move(), 'move', true);
      move.className = 'icon';
      move.setAttribute('aria-label', 'Move this panel to another corner');
      move.title = 'Move';
      const min = this.button('–', () => this.setMinimised(true), 'minimise', true);
      min.className = 'icon';
      min.setAttribute('aria-label', 'Minimise this panel');
      min.title = 'Minimise';
      head.append(this.el('p', 'title', t), move, min);
      return head;
    };
    const text = (t: string) => this.el('p', 'text', t);
    const row = (...children: HTMLElement[]) => {
      const r = this.el('div', 'row');
      r.append(...children);
      return r;
    };
    let announce = '';
    switch (view.kind) {
      case 'live':
        panel.append(
          title('First Five test'),
          text(view.task),
          row(
            this.button('Finish test', () => this.actions.finish(), 'finish'),
            this.button("I'm stuck", () => this.actions.stuck(), 'stuck', true),
          ),
        );
        announce = 'Test in progress';
        break;
      case 'confirm':
        panel.append(
          title('First Five test'),
          text('End the test?'),
          row(
            this.button('Yes', () => this.actions.confirm(true), 'confirm-yes'),
            this.button('No', () => this.actions.confirm(false), 'confirm-no', true),
          ),
        );
        announce = 'Confirm ending the test';
        break;
      case 'saving':
        panel.append(title('First Five test'), text('Saving…'));
        announce = 'Saving';
        break;
      case 'complete':
        panel.append(
          title('First Five test'),
          text('Task complete ✓'),
          row(
            this.button(
              'Continue to feedback',
              () => this.actions.continueToFeedback(),
              'continue',
            ),
          ),
        );
        announce = 'Task complete';
        break;
      case 'ended':
        panel.append(
          title('First Five test'),
          text('This test has ended.'),
          row(this.link('Return to First Five', view.returnUrl)),
        );
        announce = 'This test has ended';
        break;
      case 'error':
        panel.append(
          title('First Five test'),
          text("Couldn't save."),
          row(this.link('Return to First Five', view.returnUrl)),
        );
        announce = "Couldn't save";
        break;
      case 'done':
        panel.append(
          title('First Five test'),
          text('Thanks, the test has ended.'),
          row(this.link('Return to First Five', view.returnUrl)),
        );
        announce = 'The test has ended';
        break;
      case 'setup':
        panel.append(
          title('First Five setup walk'),
          text(
            `${view.pages} ${view.pages === 1 ? 'page' : 'pages'} · ${view.elements} ${view.elements === 1 ? 'element' : 'elements'} found`,
          ),
          row(this.button('Finish setup', () => this.actions.finishSetup(), 'finish-setup')),
        );
        announce = '';
        break;
      case 'setup_expired':
        panel.append(
          title('First Five setup walk'),
          text('Setup session expired.'),
          row(this.link('Return to First Five', view.returnUrl)),
        );
        announce = 'Setup session expired';
        break;
    }
    if (announce && this.status) this.status.textContent = announce;
    this.place();
  }

  destroy(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    window.removeEventListener('resize', this.onResize);
    this.host?.remove();
    this.host = null;
    this.root = null;
    this.panel = null;
    this.status = null;
    this.view = null;
  }

  private el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls: string,
    text?: string,
  ): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  private button(
    label: string,
    onClick: () => void,
    action: string,
    secondary = false,
  ): HTMLButtonElement {
    const b = this.el('button', secondary ? 'secondary' : '', label);
    b.type = 'button';
    b.setAttribute('data-action', action);
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      onClick();
    });
    return b;
  }

  private link(label: string, href: string): HTMLAnchorElement {
    const a = this.el('a', 'btn', label);
    a.href = href;
    a.setAttribute('data-action', 'return');
    return a;
  }
}
