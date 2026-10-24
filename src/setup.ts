import type { SetupFinishResponse } from './contracts';
import type { FirstFiveCore } from './core';
import { clearCredential } from './handoff';
import { postWithRetry } from './http';

/** C4: finish the setup walk, flush (C3), then return the builder to First Five. */
export function finishSetup(core: FirstFiveCore): Promise<void> {
  if (core.finishing) return core.finishing;
  if (core.sm.state !== 'SETUP_ACTIVE') return Promise.resolve();
  core.finishing = run(core);
  return core.finishing;
}

async function run(core: FirstFiveCore): Promise<void> {
  const cred = core.credential;
  const transport = core.transport;
  if (!cred || !transport || !core.sequence) return;
  core.sm.to('SETUP_FLUSHING');
  core.widget.render({ kind: 'saving' });
  await transport.flush(core.flushTimeoutMs);
  transport.stop();

  const res = await postWithRetry<SetupFinishResponse>(
    `${core.endpoint}/api/sdk/setup/finish`,
    { last_client_sequence: core.sequence.current() },
    cred.credential,
    core.retryDelaysMs,
  );
  const url = res?.status === 200 ? res.body?.return_url : undefined;
  if (!url || !core.isFirstFiveUrl(url)) {
    core.fail(res ? `setup_finish_http_${res.status}` : 'setup_finish_network');
    core.widget.render({ kind: 'error', returnUrl: core.returnUrl() });
    return;
  }
  if (core.projectId) clearCredential(core.projectId);
  core.clearWalk();
  core.sm.to('SETUP_FINISHED');
  core.navigate(url);
  core.widget.destroy();
  core.sm.to('READY');
}
