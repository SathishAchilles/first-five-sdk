import type { EndResponse } from './contracts';
import type { FirstFiveCore } from './core';
import { clearCredential } from './handoff';
import { postWithRetry } from './http';

/**
 * C3: flush outstanding events (bounded), then POST /end with last_client_sequence,
 * then redirect to the First Five feedback handoff. Idempotent: one /end per session.
 */
export function requestEnd(core: FirstFiveCore, reason: 'finish' | 'stuck'): Promise<void> {
  if (core.ending) return core.ending;
  const state = core.sm.state;
  if (state !== 'LIVE_ACTIVE' && state !== 'GOAL_CONFIRMED') return Promise.resolve();
  core.ending = run(core, reason);
  return core.ending;
}

async function run(core: FirstFiveCore, reason: 'finish' | 'stuck'): Promise<void> {
  const cred = core.credential;
  const transport = core.transport;
  if (!cred || !transport || !core.sequence) return;
  core.sm.to('FLUSHING');
  core.widget.render({ kind: 'saving' });
  await transport.flush(core.flushTimeoutMs);
  transport.stop();
  transport.persist();
  core.sm.to('TASK_FINALIZING');

  const res = await postWithRetry<EndResponse>(
    `${core.apiBaseUrl}/api/sdk/session/end`,
    {
      reason: reason === 'stuck' ? 'gave_up' : 'finished',
      last_client_sequence: core.sequence.current(),
    },
    cred.credential,
    core.retryDelaysMs,
  );
  if (res?.status === 401 || res?.status === 410) {
    // the session is already over on the server: same terminal path as events
    core.lastErrorCode = `end_http_${res.status}`;
    core.showEnded();
    core.terminate();
    return;
  }
  if (res?.status !== 200 || !res.body) {
    core.fail(res ? `end_http_${res.status}` : 'end_network');
    core.widget.render({ kind: 'error', returnUrl: core.returnUrl() });
    return;
  }
  const url = res.body.feedback_url;
  if (url === null) {
    // the server offers no feedback for this attempt (e.g. invalid): finish politely
    if (core.projectId) clearCredential(core.projectId);
    core.widget.render({ kind: 'done', returnUrl: core.returnUrl() });
    core.sm.to('STOPPED');
    return;
  }
  if (!url || !core.isFirstFiveUrl(url)) {
    core.fail('end_bad_feedback_url');
    core.widget.render({ kind: 'error', returnUrl: core.returnUrl() });
    return;
  }
  if (core.projectId) clearCredential(core.projectId);
  core.sm.to('FEEDBACK_HANDOFF');
  core.navigate(url);
  core.widget.destroy();
  core.sm.to('STOPPED');
}
