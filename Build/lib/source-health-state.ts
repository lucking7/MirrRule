import type { HealthStatus } from '../validate-domain-alive';

export interface SourceHealthState {
  id: string,
  deadStreak: number,
  status: HealthStatus,
  updatedAt: string
}

type IssueAction = 'none' | 'open-or-update' | 'close';

export interface StateTransition {
  state: SourceHealthState,
  issueAction: IssueAction
}

/** Pure three-strike transition. Unknown observations leave the prior streak intact. */
export function transitionSourceHealth(
  previous: SourceHealthState | undefined,
  id: string,
  status: HealthStatus,
  observedAt: string
): StateTransition {
  const priorStreak = previous?.deadStreak ?? 0;
  if (status === 'unknown') {
    return {
      state: { id, deadStreak: priorStreak, status, updatedAt: observedAt },
      issueAction: 'none',
    };
  }
  if (status === 'ok') {
    return {
      state: { id, deadStreak: 0, status, updatedAt: observedAt },
      issueAction: priorStreak >= 3 ? 'close' : 'none',
    };
  }

  const deadStreak = priorStreak + 1;
  return {
    state: { id, deadStreak, status, updatedAt: observedAt },
    issueAction: deadStreak >= 3 ? 'open-or-update' : 'none',
  };
}
