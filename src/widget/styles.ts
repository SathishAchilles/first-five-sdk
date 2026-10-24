export const WIDGET_CSS = `
:host { all: initial; }
.ff { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; box-sizing: border-box;
  max-width: 320px; max-height: 200px; overflow: auto; padding: 12px 14px; border-radius: 10px;
  background: #ffffff; color: #1a1a1a; border: 1px solid #d0d0d0;
  box-shadow: 0 4px 16px rgba(0,0,0,.15);
  font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.title { font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #555; margin: 0 0 4px; }
.text { margin: 0 0 10px; }
.row { display: flex; gap: 8px; flex-wrap: wrap; }
button, a.btn { font: inherit; font-size: 13px; padding: 6px 12px; border-radius: 6px; cursor: pointer;
  border: 1px solid #1a1a1a; background: #1a1a1a; color: #fff; text-decoration: none; display: inline-block; }
button.secondary { background: #fff; color: #1a1a1a; }
button:focus-visible, a.btn:focus-visible { outline: 3px solid #2563eb; outline-offset: 2px; }
.status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
`;
