import { StateMachine, TRANSITIONS, type State } from '../../src/state';

describe('state machine', () => {
  it('walks the live path', () => {
    const sm = new StateMachine();
    const path: State[] = [
      'CONFIG_LOADING',
      'READY',
      'LIVE_ACTIVE',
      'GOAL_CONFIRMED',
      'FLUSHING',
      'TASK_FINALIZING',
      'FEEDBACK_HANDOFF',
      'STOPPED',
    ];
    for (const s of path) expect(sm.to(s)).toBe(true);
  });

  it('walks the setup path back to READY', () => {
    const sm = new StateMachine();
    for (const s of [
      'CONFIG_LOADING',
      'READY',
      'SETUP_ACTIVE',
      'SETUP_FLUSHING',
      'SETUP_FINISHED',
      'READY',
    ] as State[]) {
      expect(sm.to(s)).toBe(true);
    }
  });

  it('ignores an illegal transition', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sm = new StateMachine();
    expect(sm.to('LIVE_ACTIVE')).toBe(false);
    expect(sm.state).toBe('UNINITIALIZED');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('STOPPED is terminal', () => {
    expect(TRANSITIONS.STOPPED).toEqual([]);
  });
});
