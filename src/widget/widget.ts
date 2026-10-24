import { WIDGET_CSS } from './styles';

export type WidgetView =
  | { kind: 'live'; task: string }
  | { kind: 'confirm'; reason: 'finish' | 'stuck' }
  | { kind: 'saving' }
  | { kind: 'complete' }
  | { kind: 'ended'; returnUrl: string }
  | { kind: 'error'; returnUrl: string }
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
    const style = document.createElement('style');
    style.textContent = WIDGET_CSS;
    this.panel = document.createElement('div');
    this.panel.className = 'ff';
    this.panel.setAttribute('role', 'region');
    this.panel.setAttribute('aria-label', 'First Five test controls');
    this.status = document.createElement('div');
    this.status.className = 'status';
    this.status.setAttribute('aria-live', 'polite');
    this.root.append(style, this.panel, this.status);
    document.documentElement.appendChild(this.host);
  }

  render(view: WidgetView): void {
    this.mount();
    this.view = view;
    const panel = this.panel as HTMLDivElement;
    panel.replaceChildren();
    const title = (t: string) => this.el('p', 'title', t);
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
  }

  destroy(): void {
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
