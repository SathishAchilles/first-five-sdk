import { SCRIPT_SELECTOR, isFirstFiveScript } from './config';
import { createFirstFive, type FirstFiveApi } from './index';

// Captured synchronously at script execution: document.currentScript is null in any later callback.
const script =
  (document.currentScript as HTMLScriptElement | null) ??
  document.querySelector<HTMLScriptElement>(SCRIPT_SELECTOR);

declare global {
  interface Window {
    FirstFive?: FirstFiveApi;
  }
}

if (!window.FirstFive) {
  const sdk = createFirstFive({ script });
  window.FirstFive = sdk;
  if (isFirstFiveScript(script)) void sdk.init();
  else
    console.warn(
      '[FirstFive] add data-firstfive-project="ffp_…" to the script tag; SDK not started',
    );
}
