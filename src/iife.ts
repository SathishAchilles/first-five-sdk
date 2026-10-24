import { createFirstFive, type FirstFiveApi } from './index';

// Captured synchronously at script execution: document.currentScript is null in any later callback.
const script =
  (document.currentScript as HTMLScriptElement | null) ??
  document.querySelector<HTMLScriptElement>('script[data-project-id]');

declare global {
  interface Window {
    FirstFive?: FirstFiveApi;
  }
}

if (!window.FirstFive) {
  const sdk = createFirstFive({ script });
  window.FirstFive = sdk;
  if (script?.getAttribute('data-project-id')) void sdk.init();
}
