import { FirstFiveCore, type CoreOptions, type InitOptions } from './core';
import type { Diagnostics } from './diagnose';
import { SDK_VERSION } from './version';

export type * from './contracts';
export type { Diagnostics } from './diagnose';
export type { InitOptions } from './core';
export type { State } from './state';

export interface FirstFiveApi {
  init(opts?: InitOptions): Promise<void>;
  track(name: string, props?: Record<string, string | number | boolean>): void;
  diagnose(): Diagnostics;
  stop(reason?: string): void;
  readonly version: string;
}

/** Create an independent SDK instance (the IIFE build creates one and auto-inits it). */
export function createFirstFive(options: CoreOptions = {}): FirstFiveApi {
  const core = new FirstFiveCore(options);
  return {
    init: (opts) => core.init(opts),
    track: (name, props) => core.track(name, props),
    diagnose: () => core.diagnose(),
    stop: () => core.stop(),
    version: SDK_VERSION,
  };
}

/** Shared instance for npm consumers: call FirstFive.init({ projectId, endpoint }). */
export const FirstFive: FirstFiveApi = createFirstFive();
