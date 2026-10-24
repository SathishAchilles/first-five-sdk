export const WIDGET_CSS = `
:host { all: initial; }
.ff { box-sizing: border-box; width: min(320px, calc(100vw - 24px)); max-height: min(240px, calc(100vh - 24px));
  overflow: auto; padding: 10px 12px 12px; border-radius: 10px;
  background: #ffffff; color: #1a1a1a; border: 1px solid #d0d0d0;
  box-shadow: 0 4px 16px rgba(0,0,0,.18);
  font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.head { display: flex; align-items: center; gap: 4px; margin: 0 0 4px; }
.title { flex: 1; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #555; margin: 0; }
.text { margin: 0 0 10px; }
.row { display: flex; gap: 8px; flex-wrap: wrap; }
button, a.btn { font: inherit; font-size: 13px; padding: 6px 12px; border-radius: 6px; cursor: pointer;
  border: 1px solid #1a1a1a; background: #1a1a1a; color: #fff; text-decoration: none; display: inline-block; }
button.secondary { background: #fff; color: #1a1a1a; }
button.icon { background: transparent; color: #555; border-color: transparent; padding: 2px 8px; font-size: 15px; line-height: 1; }
button.icon:hover { background: #f0f0f0; }
button.pill { border-radius: 999px; padding: 8px 14px; box-shadow: 0 4px 16px rgba(0,0,0,.18); }
button:focus-visible, a.btn:focus-visible { outline: 3px solid #2563eb; outline-offset: 2px; }
@media (pointer: coarse) {
  button, a.btn { min-height: 44px; padding: 10px 16px; font-size: 15px; }
  button.icon { min-width: 44px; }
}
.status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
`;
