import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { reconcileSourceHealth, transitionSourceHealth } from '../lib/source-health-state';
import type { PersistedSourceHealthState, SourceHealthState } from '../lib/source-health-state';
import type { SourceInventoryEntry } from '../lib/source-inventory';
import type { HealthStatus, SourceHealthRecord, SourceHealthReport } from '../validate-domain-alive';
import { updateSourceHealthState } from '../update-source-health-state';

const observedAt = '2026-10-07T06:00:00.000Z';
const active: SourceInventoryEntry = {
  id: 'primary:https://active.test/rules',
  url: 'https://active.test/rules',
  role: 'primary',
  requestProfile: 'rule',
};
const uncertain: SourceInventoryEntry = {
  ...active,
  id: 'primary:https://uncertain.test/rules',
  url: 'https://uncertain.test/rules',
};

function record(source: SourceInventoryEntry, status: HealthStatus): SourceHealthRecord {
  return { ...source, status, elapsedMs: 0 };
}

function report(sources: SourceHealthRecord[]): SourceHealthReport {
  const summary = { ok: 0, dead: 0, unknown: 0 };
  for (const source of sources) summary[source.status]++;
  return { generatedAt: observedAt, summary, sources };
}

function previousState(id: string, deadStreak: number, status: HealthStatus = 'dead'): SourceHealthState {
  return { id, deadStreak, status, updatedAt: '2026-10-06T06:00:00.000Z' };
}

describe('source health three-strike state', () => {
  it('opens on three dead observations, ignores unknown, and closes on recovery', () => {
    let transition = transitionSourceHealth(undefined, 'source', 'dead', 't1');
    assert.equal(transition.issueAction, 'none');
    transition = transitionSourceHealth(transition.state, 'source', 'unknown', 't2');
    assert.equal(transition.state.deadStreak, 1);
    transition = transitionSourceHealth(transition.state, 'source', 'dead', 't3');
    assert.equal(transition.issueAction, 'none');
    transition = transitionSourceHealth(transition.state, 'source', 'dead', 't4');
    assert.equal(transition.issueAction, 'open-or-update');
    transition = transitionSourceHealth(transition.state, 'source', 'ok', 't5');
    assert.equal(transition.issueAction, 'close');
    assert.equal(transition.state.deadStreak, 0);
  });
});

describe('source health inventory reconciliation', () => {
  it('retires removed failed sources without mutating prior durable state', () => {
    const previous: PersistedSourceHealthState = {
      sources: {
        retired: previousState('retired', 40),
        [active.id]: previousState(active.id, 1),
      },
    };
    const result = reconcileSourceHealth(previous, report([record(active, 'ok')]), [active]);
    assert.deepEqual(Object.keys(result.state.sources), [active.id]);
    assert.equal(result.state.sources[active.id].deadStreak, 0);
    assert.deepEqual(result.actions, [{ id: 'retired', action: 'close', observedAt }]);
    assert.equal(previous.sources.retired.deadStreak, 40);
    assert.equal(previous.sources[active.id].deadStreak, 1);
  });

  it('retains active failures and unknown streaks while removing retired sources', () => {
    const previous: PersistedSourceHealthState = {
      sources: {
        retired: previousState('retired', 15),
        [active.id]: previousState(active.id, 2),
        [uncertain.id]: previousState(uncertain.id, 4),
      },
    };
    const result = reconcileSourceHealth(previous, report([
      record(active, 'dead'), record(uncertain, 'unknown'),
    ]), [active, uncertain]);
    assert.deepEqual(Object.keys(result.state.sources), [active.id, uncertain.id]);
    assert.equal(result.state.sources[active.id].deadStreak, 3);
    assert.equal(result.state.sources[uncertain.id].deadStreak, 4);
    assert.equal(result.state.sources[uncertain.id].status, 'unknown');
  });

  it('accepts an empty report only when the configured inventory is also empty', () => {
    const previous = { sources: { retired: previousState('retired', 3) } };
    assert.throws(() => reconcileSourceHealth(previous, report([]), [active]), /Incomplete/);
    assert.deepEqual(reconcileSourceHealth(previous, report([]), []), {
      state: { sources: {} },
      actions: [{ id: 'retired', action: 'close', observedAt }],
    });
  });

  it('rejects incomplete, duplicate, foreign, malformed, and inconsistent reports', () => {
    const complete = report([record(active, 'ok'), record(uncertain, 'ok')]);
    const invalidReports: unknown[] = [
      null,
      {},
      { ...complete, generatedAt: '' },
      report([record(active, 'ok')]),
      report([record(active, 'ok'), record(active, 'ok')]),
      report([record(active, 'ok'), { ...record(uncertain, 'ok'), id: 'retired' }]),
      { ...complete, summary: { ok: 1, dead: 0, unknown: 0 } },
      { ...complete, sources: [record(active, 'ok'), { ...record(uncertain, 'ok'), status: 'broken' }] },
      report([record(active, 'ok'), { ...record(uncertain, 'ok'), url: 'https://wrong.test/rules' }]),
      report([record(active, 'ok'), { ...record(uncertain, 'ok'), elapsedMs: -1 }]),
    ];
    for (const invalidReport of invalidReports) {
      assert.throws(() => reconcileSourceHealth({ sources: {} }, invalidReport, [active, uncertain]));
    }
  });

  it('preserves both files when the report is missing, invalid JSON, malformed, or incomplete', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'source-health-state-'));
    try {
      const reportPath = path.join(directory, 'report.json');
      const statePath = path.join(directory, 'state.json');
      const actionsPath = path.join(directory, 'actions.json');
      const previous = JSON.stringify({ sources: { retired: previousState('retired', 40) } });
      const oldActions = '[{"id":"retired","action":"close"}]';
      await fs.writeFile(statePath, previous);
      await fs.writeFile(actionsPath, oldActions);
      const invalidInputs = [undefined, '{', '{}', JSON.stringify(report([]))];
      for (const invalidInput of invalidInputs) {
        if (invalidInput !== undefined) {
          // eslint-disable-next-line no-await-in-loop -- Each report is verified against the same durable files.
          await fs.writeFile(reportPath, invalidInput);
        }
        // eslint-disable-next-line no-await-in-loop -- Exercise missing and malformed report failures before reading the files.
        await assert.rejects(updateSourceHealthState(reportPath, statePath, actionsPath, [active]));
        // eslint-disable-next-line no-await-in-loop -- Verify that a failed update did not alter durable state.
        assert.equal(await fs.readFile(statePath, 'utf8'), previous);
        // eslint-disable-next-line no-await-in-loop -- Verify that a failed update did not alter transition actions.
        assert.equal(await fs.readFile(actionsPath, 'utf8'), oldActions);
      }
      await fs.writeFile(reportPath, JSON.stringify(report([record(active, 'ok')])));
      await fs.writeFile(statePath, '{');
      await assert.rejects(updateSourceHealthState(reportPath, statePath, actionsPath, [active]));
      assert.equal(await fs.readFile(statePath, 'utf8'), '{');
      assert.equal(await fs.readFile(actionsPath, 'utf8'), oldActions);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('writes reconciled state and permits a missing state file for first-run initialization', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'source-health-state-'));
    try {
      const reportPath = path.join(directory, 'report.json');
      const statePath = path.join(directory, 'state.json');
      const actionsPath = path.join(directory, 'actions.json');
      await fs.writeFile(reportPath, JSON.stringify(report([record(active, 'dead')])));
      await updateSourceHealthState(reportPath, statePath, actionsPath, [active]);
      const saved: PersistedSourceHealthState = JSON.parse(await fs.readFile(statePath, 'utf8'));
      assert.deepEqual(saved.sources[active.id], { id: active.id, status: 'dead', deadStreak: 1, updatedAt: observedAt });
      await fs.writeFile(statePath, JSON.stringify({ sources: { retired: previousState('retired', 40) } }));
      await updateSourceHealthState(reportPath, statePath, actionsPath, [active]);
      assert.deepEqual(JSON.parse(await fs.readFile(statePath, 'utf8')), saved);
      assert.deepEqual(JSON.parse(await fs.readFile(actionsPath, 'utf8')), [{ id: 'retired', action: 'close', observedAt }]);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
