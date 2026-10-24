import type { Mode } from './contracts';
import type { FirstFiveCore } from './core';
import type { State } from './state';
import { SDK_VERSION } from './version';

export interface Diagnostics {
  version: string;
  project_id: string | null;
  mode: Mode | null;
  state: State;
  endpoint: string | null;
  origin_allowed: boolean | null;
  last_acked_sequence: number;
  queued: number;
  degraded: boolean;
  last_error_code: string | null;
}

/** Non-secret diagnostics; never includes the credential. */
export function buildDiagnostics(core: FirstFiveCore): Diagnostics {
  return {
    version: SDK_VERSION,
    project_id: core.projectId,
    mode: core.mode,
    state: core.sm.state,
    endpoint: core.endpoint,
    origin_allowed: core.originAllowed,
    last_acked_sequence: core.transport?.lastAckedSequence ?? 0,
    queued: core.transport?.queued ?? 0,
    degraded: core.degraded,
    last_error_code: core.lastErrorCode,
  };
}
