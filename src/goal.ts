import type { EventsResponse } from './contracts';
import type { FirstFiveCore } from './core';

/**
 * C2: the server evaluates the goal inside the events transaction and reports it on every
 * live ACK (`goal.verified`). Verified moves the SDK to GOAL_CONFIRMED, also after a reload
 * (from the first ACK).
 */
export function onAck(core: FirstFiveCore, ack: EventsResponse): void {
  if (core.mode !== 'live' || !ack.goal?.verified) return;
  if (core.sm.state !== 'LIVE_ACTIVE') return;
  if (core.sm.to('GOAL_CONFIRMED')) core.widget.render({ kind: 'complete' });
}
