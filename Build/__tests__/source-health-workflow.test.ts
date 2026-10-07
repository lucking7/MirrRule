import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';
import { parse } from 'yaml';

interface Workflow {
  jobs: { check: { steps: Array<{ name?: string, run?: string }> } }
}

const workflow = parse(readFileSync(
  path.join(process.cwd(), '.github/workflows/check-source-domain.yml'), 'utf8'
)) as Workflow;

function runStep(name: string, directory: string, stub: string, env: Record<string, string> = {}) {
  const step = workflow.jobs.check.steps.find(candidate => candidate.name === name);
  assert.ok(step?.run, `Missing workflow step: ${name}`);
  return spawnSync('bash', ['-c', stub + step.run], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

async function withDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'source-health-workflow-'));
  try {
    await run(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

const gitStub = String.raw`
git() {
  case "$1" in
    ls-remote) return "$HEALTH_TEST_REMOTE_STATUS" ;;
    fetch) return "$HEALTH_TEST_FETCH_STATUS" ;;
    show)
      if [ "$HEALTH_TEST_SHOW_STATUS" -ne 0 ]; then
        return "$HEALTH_TEST_SHOW_STATUS"
      fi
      printf '%s\n' "$HEALTH_TEST_STATE"
      ;;
    *) return 99 ;;
  esac
}
`;

const issueStub = String.raw`
gh() {
  if [ "$1 $2" = 'issue list' ]; then
    printf '372\n'
  else
    printf 'CALL:%s\n' "$*" >&2
  fi
}
`;

describe('scheduled source health reconciliation workflow', () => {
  it('initializes empty state only when the remote branch is absent', async () => {
    await withDirectory(async directory => {
      const result = runStep('Load durable state', directory, gitStub, {
        HEALTH_TEST_REMOTE_STATUS: '2',
        HEALTH_TEST_FETCH_STATUS: '99',
        HEALTH_TEST_SHOW_STATUS: '99',
      });
      assert.equal(result.status, 0, result.stderr);
      const saved = await fs.readFile(path.join(directory, 'source-health-state-data/state.json'), 'utf8');
      assert.deepEqual(JSON.parse(saved), { sources: {} });
    });
  });

  it('loads the existing state from a successful fetch', async () => {
    await withDirectory(async directory => {
      const previous = JSON.stringify({ sources: { retired: { deadStreak: 40 } } });
      const result = runStep('Load durable state', directory, gitStub, {
        HEALTH_TEST_REMOTE_STATUS: '0',
        HEALTH_TEST_FETCH_STATUS: '0',
        HEALTH_TEST_SHOW_STATUS: '0',
        HEALTH_TEST_STATE: previous,
      });
      assert.equal(result.status, 0, result.stderr);
      const saved = await fs.readFile(path.join(directory, 'source-health-state-data/state.json'), 'utf8');
      assert.equal(saved.trim(), previous);
    });
  });

  for (const [name, remote, fetch, show, expectedExit] of [
    ['remote lookup', '128', '99', '99', 128],
    ['fetch', '0', '128', '99', 128],
    ['state extraction', '0', '0', '1', 1],
  ] as const) {
    it(`propagates ${name} failures instead of initializing empty state`, async () => {
      await withDirectory(async directory => {
        const result = runStep('Load durable state', directory, gitStub, {
          HEALTH_TEST_REMOTE_STATUS: remote,
          HEALTH_TEST_FETCH_STATUS: fetch,
          HEALTH_TEST_SHOW_STATUS: show,
        });
        assert.equal(result.status, expectedExit, result.stderr);
        const saved = await fs.readFile(path.join(directory, 'source-health-state-data/state.json'), 'utf8')
          .catch(() => '');
        assert.notEqual(saved.trim(), '{"sources":{}}');
      });
    });
  }

  it('closes a stale issue when no current source meets the threshold, even without close actions', async () => {
    await withDirectory(async directory => {
      const data = path.join(directory, 'source-health-state-data');
      await fs.mkdir(data);
      await fs.writeFile(path.join(data, 'state.json'), JSON.stringify({ sources: {
        active: { id: 'active', status: 'ok', deadStreak: 0 },
      } }));
      await fs.writeFile(path.join(data, 'actions.json'), '[]');
      const result = runStep('Manage health issue', directory, issueStub);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stderr, /CALL:issue close 372/);
      assert.doesNotMatch(result.stderr, /CALL:issue edit/);
    });
  });

  for (const status of ['dead', 'unknown']) {
    it(`keeps an active ${status} source above the threshold open`, async () => {
      await withDirectory(async directory => {
        const data = path.join(directory, 'source-health-state-data');
        await fs.mkdir(data);
        await fs.writeFile(path.join(data, 'state.json'), JSON.stringify({ sources: {
          active: { id: 'active', status, deadStreak: 3 },
        } }));
        const result = runStep('Manage health issue', directory, issueStub);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stderr, /CALL:issue edit 372/);
        assert.doesNotMatch(result.stderr, /CALL:issue close/);
      });
    });
  }

  it('propagates an unreadable state instead of closing the issue', async () => {
    await withDirectory(async directory => {
      const data = path.join(directory, 'source-health-state-data');
      await fs.mkdir(data);
      await fs.writeFile(path.join(data, 'state.json'), '{');
      const result = runStep('Manage health issue', directory, issueStub);
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(result.stderr, /CALL:issue close/);
    });
  });
});
