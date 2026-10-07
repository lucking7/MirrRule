import type { HealthStatus, SourceHealthReport } from '../validate-domain-alive';
import type { SourceInventoryEntry } from './source-inventory';
import { redactUrl } from '../utils/network/url-redaction';

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

export interface PersistedSourceHealthState {
  sources: Record<string, SourceHealthState>
}

export interface SourceHealthAction {
  id: string,
  action: 'close',
  observedAt: string
}

function assertRecord(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Invalid source health ${name}`);
  }
}

function isHealthStatus(value: unknown): value is HealthStatus {
  return value === 'ok' || value === 'dead' || value === 'unknown';
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function validatePersistedSourceHealthState(value: unknown): asserts value is PersistedSourceHealthState {
  assertRecord(value, 'state');
  assertRecord(value.sources, 'state sources');
  for (const [id, source] of Object.entries(value.sources)) {
    assertRecord(source, 'state record');
    if (source.id !== id || !isNonnegativeInteger(source.deadStreak) ||
      !isHealthStatus(source.status) || typeof source.updatedAt !== 'string') {
      throw new TypeError(`Invalid source health state record: ${id}`);
    }
  }
}

/** A report may retire state only after covering the entire current inventory. */
function validateReport(
  value: unknown,
  inventory: readonly SourceInventoryEntry[]
): asserts value is SourceHealthReport {
  assertRecord(value, 'report');
  if (typeof value.generatedAt !== 'string' || !Number.isFinite(Date.parse(value.generatedAt))) {
    throw new TypeError('Invalid source health report timestamp');
  }
  assertRecord(value.summary, 'report summary');
  if (!Array.isArray(value.sources)) throw new TypeError('Invalid source health report sources');

  const expected = new Map(inventory.map(source => [source.id, source]));
  const seen = new Set<string>();
  const counts = { ok: 0, dead: 0, unknown: 0 };
  for (const source of value.sources) {
    assertRecord(source, 'report record');
    const configured = typeof source.id === 'string' ? expected.get(source.id) : undefined;
    if (!configured || seen.has(configured.id) || source.url !== redactUrl(configured.url) ||
      source.role !== configured.role || !isHealthStatus(source.status) ||
      typeof source.elapsedMs !== 'number' || !Number.isFinite(source.elapsedMs) || source.elapsedMs < 0 ||
      (source.httpStatus !== undefined && (!isNonnegativeInteger(source.httpStatus) || source.httpStatus < 100 || source.httpStatus > 599))) {
      throw new TypeError('Invalid or unexpected source health report record');
    }
    seen.add(configured.id);
    counts[source.status]++;
  }
  if (seen.size !== expected.size) throw new TypeError('Incomplete source health report');
  for (const status of ['ok', 'dead', 'unknown'] as const) {
    if (!isNonnegativeInteger(value.summary[status]) || value.summary[status] !== counts[status]) {
      throw new TypeError('Invalid source health report summary');
    }
  }
}

export function reconcileSourceHealth(
  previous: PersistedSourceHealthState,
  report: unknown,
  inventory: readonly SourceInventoryEntry[]
): { state: PersistedSourceHealthState, actions: SourceHealthAction[] } {
  validateReport(report, inventory);
  const state: PersistedSourceHealthState = { sources: {} };
  const actions: SourceHealthAction[] = [];
  for (const source of report.sources) {
    const transition = transitionSourceHealth(previous.sources[source.id], source.id, source.status, report.generatedAt);
    state.sources[source.id] = transition.state;
    if (transition.issueAction === 'close') {
      actions.push({ id: source.id, action: 'close', observedAt: report.generatedAt });
    }
  }
  for (const source of Object.values(previous.sources)) {
    if (!Object.hasOwn(state.sources, source.id) && source.deadStreak >= 3) {
      actions.push({ id: source.id, action: 'close', observedAt: report.generatedAt });
    }
  }
  return { state, actions };
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
