export type State =
  | 'UNINITIALIZED'
  | 'CONFIG_LOADING'
  | 'READY'
  | 'SETUP_ACTIVE'
  | 'SETUP_FLUSHING'
  | 'SETUP_FINISHED'
  | 'LIVE_ACTIVE'
  | 'GOAL_CONFIRMED'
  | 'FLUSHING'
  | 'TASK_FINALIZING'
  | 'FEEDBACK_HANDOFF'
  | 'STOPPED';

export const TRANSITIONS: Record<State, State[]> = {
  UNINITIALIZED: ['CONFIG_LOADING', 'STOPPED'],
  CONFIG_LOADING: ['READY', 'STOPPED'],
  READY: ['SETUP_ACTIVE', 'LIVE_ACTIVE', 'STOPPED'],
  SETUP_ACTIVE: ['SETUP_FLUSHING', 'STOPPED'],
  SETUP_FLUSHING: ['SETUP_FINISHED', 'STOPPED'],
  SETUP_FINISHED: ['READY', 'STOPPED'],
  LIVE_ACTIVE: ['GOAL_CONFIRMED', 'FLUSHING', 'STOPPED'],
  GOAL_CONFIRMED: ['FLUSHING', 'STOPPED'],
  FLUSHING: ['TASK_FINALIZING', 'STOPPED'],
  TASK_FINALIZING: ['FEEDBACK_HANDOFF', 'STOPPED'],
  FEEDBACK_HANDOFF: ['STOPPED'],
  STOPPED: [],
};

/** States in which behavioural listeners may be attached (PRD §2.2). */
export const TRACKING_STATES: ReadonlySet<State> = new Set([
  'SETUP_ACTIVE',
  'LIVE_ACTIVE',
  'GOAL_CONFIRMED',
]);

export class StateMachine {
  private current: State = 'UNINITIALIZED';
  private readonly listeners: ((next: State, prev: State) => void)[] = [];

  get state(): State {
    return this.current;
  }

  can(next: State): boolean {
    return TRANSITIONS[this.current].includes(next);
  }

  /** Returns false (and logs) on an illegal transition instead of throwing. */
  to(next: State): boolean {
    if (!this.can(next)) {
      console.warn(`[FirstFive] ignored illegal transition ${this.current} -> ${next}`);
      return false;
    }
    const prev = this.current;
    this.current = next;
    for (const l of this.listeners) l(next, prev);
    return true;
  }

  onChange(listener: (next: State, prev: State) => void): void {
    this.listeners.push(listener);
  }
}
