import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';
import { parse } from 'yaml';

interface WorkflowStep {
  name?: string;
  uses?: string;
  if?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
  'continue-on-error'?: boolean;
}

interface WorkflowJob {
  name?: string;
  needs?: string | string[];
  if?: string;
  services?: Record<string, { image?: string }>;
  steps?: WorkflowStep[];
  outputs?: Record<string, string>;
}

interface Workflow {
  jobs?: Record<string, WorkflowJob>;
}

const workflowPath = path.join(
  process.cwd(),
  '.github',
  'workflows',
  'main.yml',
);
const workflow = parse(fs.readFileSync(workflowPath, 'utf8')) as Workflow;
const sourceHealthWorkflow = parse(
  fs.readFileSync(
    path.join(process.cwd(), '.github', 'workflows', 'check-source-domain.yml'),
    'utf8',
  ),
) as Workflow;

function getJob(id: string, targetWorkflow: Workflow = workflow) {
  const job = targetWorkflow.jobs?.[id];
  assert.ok(job, `job ${id} should exist`);
  return job;
}

function getNeeds(job: WorkflowJob) {
  if (Array.isArray(job.needs)) return job.needs;
  if (typeof job.needs === 'string') return [job.needs];
  return [];
}

function hasStep(job: WorkflowJob, name: string) {
  return job.steps?.some((step) => step.name === name) ?? false;
}

function getStep(job: WorkflowJob, name: string) {
  const step = job.steps?.find((item) => item.name === name);
  assert.ok(step, `step ${name} should exist`);
  return step;
}

interface WorkflowScenario {
  eventName: 'pull_request' | 'push' | 'schedule' | 'workflow_dispatch';
  task?: string;
  cron?: string;
  deployTarget?: string;
}

function githubExpression(expression: string) {
  return ['$', '{{ ', expression, ' }}'].join('');
}

function evaluateTaskPlan(scenario: WorkflowScenario) {
  const decide = getStep(getJob('prepare'), 'Decide tasks to run');
  let script = decide.run ?? '';
  const replacements = new Map([
    [githubExpression('github.event.inputs.task'), scenario.task ?? ''],
    [
      githubExpression('github.event.inputs.deploy_target'),
      scenario.deployTarget ?? '',
    ],
    [githubExpression('github.event.schedule'), scenario.cron ?? ''],
    [githubExpression('github.event_name'), scenario.eventName],
  ]);

  for (const [expression, value] of replacements) {
    script = script.replaceAll(expression, value);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-workflow-'));
  const outputPath = path.join(tempDir, 'github-output');
  try {
    execFileSync('/bin/bash', ['-eu', '-o', 'pipefail', '-c', script], {
      env: { ...process.env, GITHUB_OUTPUT: outputPath },
      stdio: 'pipe',
    });
    const outputs = Object.fromEntries(
      fs
        .readFileSync(outputPath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => {
          const separator = line.indexOf('=');
          return [line.slice(0, separator), line.slice(separator + 1)];
        }),
    );
    const tasks = outputs.tasks;
    assert.ok(tasks, 'prepare should emit a tasks output');
    return {
      tasks: JSON.parse(tasks) as string[],
      deployTarget: outputs.deploy_target,
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

describe('GitHub Actions workflow contract', () => {
  it('publishes one task plan and preserves the deploy target separately', () => {
    const prepare = getJob('prepare');
    assert.deepEqual(Object.keys(prepare.outputs ?? {}).sort(), [
      'deploy_target',
      'tasks',
    ]);

    const plan = evaluateTaskPlan({
      eventName: 'workflow_dispatch',
      task: 'deploy',
      deployTarget: 'github',
    });
    assert.deepEqual(plan, {
      tasks: ['build', 'deploy'],
      deployTarget: 'github',
    });
  });

  it('keeps the event and manual task behavior matrix explicit', () => {
    const fullPlan = [
      'convert-plugins',
      'merge-modules',
      'mirror-sync',
      'build',
      'deploy',
    ];
    const scenarios: Array<[string, WorkflowScenario, string[]]> = [
      ['push', { eventName: 'push' }, fullPlan],
      ['pull request', { eventName: 'pull_request' }, ['build']],
      [
        'full schedule',
        { eventName: 'schedule', cron: '0 5,17 * * *' },
        fullPlan,
      ],
      [
        'fast schedule',
        { eventName: 'schedule', cron: '0 */4 * * *' },
        ['build', 'deploy'],
      ],
      [
        'mirror schedule',
        { eventName: 'schedule', cron: '0 6,14,22 * * *' },
        ['mirror-sync', 'build', 'deploy'],
      ],
      [
        'plugin schedule',
        { eventName: 'schedule', cron: '30 7,19 * * *' },
        ['convert-plugins', 'merge-modules', 'build', 'deploy'],
      ],
      ['manual all', { eventName: 'workflow_dispatch', task: 'all' }, fullPlan],
      ['manual default', { eventName: 'workflow_dispatch' }, fullPlan],
      [
        'manual build',
        { eventName: 'workflow_dispatch', task: 'build' },
        ['build'],
      ],
      [
        'manual plugin conversion',
        { eventName: 'workflow_dispatch', task: 'convert-plugins' },
        ['convert-plugins'],
      ],
      [
        'manual module merge',
        { eventName: 'workflow_dispatch', task: 'merge-modules' },
        ['merge-modules'],
      ],
      [
        'manual mirror sync',
        { eventName: 'workflow_dispatch', task: 'mirror-sync' },
        ['mirror-sync', 'build'],
      ],
      [
        'manual deploy',
        { eventName: 'workflow_dispatch', task: 'deploy' },
        ['build', 'deploy'],
      ],
    ];

    for (const [name, scenario, expectedTasks] of scenarios) {
      assert.deepEqual(evaluateTaskPlan(scenario).tasks, expectedTasks, name);
    }
  });

  it('keeps Script-Hub out of the generic Build job', () => {
    const buildJob = getJob('build');

    assert.equal(buildJob.services?.['script-hub'], undefined);
    assert.ok(getNeeds(buildJob).includes('convert-plugins'));
    assert.ok(getNeeds(buildJob).includes('merge-modules'));

    const condition = buildJob.if ?? '';
    assert.match(condition, /always\(\)/);
    assert.match(
      condition,
      /contains\(fromJSON\(needs\.prepare\.outputs\.tasks\), 'build'\)/,
    );
    assert.match(condition, /needs\.convert-plugins\.result == 'success'/);
    assert.match(condition, /needs\.convert-plugins\.result == 'skipped'/);
    assert.match(condition, /needs\.merge-modules\.result == 'success'/);
    assert.match(condition, /needs\.merge-modules\.result == 'skipped'/);
  });

  it('requires the build finished marker before uploading artifacts', () => {
    const buildJob = getJob('build');
    const verifyStep = getStep(buildJob, 'Verify build output');
    assert.match(String(verifyStep.run), /\.BUILD_FINISHED/);

    const verifyIndex = buildJob.steps?.indexOf(verifyStep) ?? -1;
    const uploadIndex =
      buildJob.steps?.findIndex(
        (step) =>
          step.uses?.startsWith('actions/upload-artifact@') &&
          String(step.with?.name).startsWith('build-artifact-'),
      ) ?? -1;
    assert.ok(verifyIndex >= 0 && uploadIndex > verifyIndex);
  });

  it('runs the pinned Python browser gateway before the Node build', () => {
    const buildJob = getJob('build');
    const pythonSetup = buildJob.steps?.find((step) =>
      step.uses?.startsWith('actions/setup-python@'),
    );
    assert.equal(
      pythonSetup?.uses,
      'actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065',
    );
    assert.equal(pythonSetup?.with?.['python-version'], '3.11');

    const installStep = getStep(buildJob, 'Install browser gateway dependencies');
    assert.match(String(installStep.run), /python3 -m pip install/);
    assert.match(String(installStep.run), /Build\/browser-rule-requirements\.txt/);
    assert.match(
      String(getStep(buildJob, 'Run browser gateway tests').run),
      /python3 Build\/__tests__\/browser-rule-gateway\.test\.py/,
    );

    const startStep = getStep(buildJob, 'Start browser rule gateway');
    assert.match(String(startStep.run), /--port 13193/);
    assert.match(
      String(startStep.run),
      /--upstream-base https:\/\/cloudflare-proxy\.lucking\.workers\.dev/,
    );
    assert.match(String(startStep.run), /127\.0\.0\.1:13193\/health/);
    assert.match(String(startStep.run), /seq 1 30/);
    assert.match(String(startStep.run), /--max-time 2/);
    assert.match(
      String(getStep(buildJob, 'Stop browser rule gateway').if),
      /always\(\)/,
    );
    assert.match(String(getStep(buildJob, 'Stop browser rule gateway').run), /kill/);

    const buildStep = buildJob.steps?.find((step) =>
      step.run?.includes('pnpm run build'),
    );
    assert.equal(buildStep?.env?.PROXY_BASE, 'http://127.0.0.1:13193?url=');
  });

  it('uses the same bounded gateway contract for source health and propagates health failures', () => {
    const healthJob = getJob('check', sourceHealthWorkflow);
    const pythonSetup = healthJob.steps?.find((step) =>
      step.uses?.startsWith('actions/setup-python@'),
    );
    assert.equal(
      pythonSetup?.uses,
      'actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065',
    );
    assert.equal(pythonSetup?.with?.['python-version'], '3.11');
    assert.match(
      String(getStep(healthJob, 'Install browser gateway dependencies').run),
      /Build\/browser-rule-requirements\.txt/,
    );
    assert.match(
      String(getStep(healthJob, 'Run browser gateway tests').run),
      /python3 Build\/__tests__\/browser-rule-gateway\.test\.py/,
    );

    const startStep = getStep(healthJob, 'Start browser rule gateway');
    assert.match(String(startStep.run), /--port 13193/);
    assert.match(
      String(startStep.run),
      /--upstream-base https:\/\/cloudflare-proxy\.lucking\.workers\.dev/,
    );
    assert.match(String(startStep.run), /127\.0\.0\.1:13193\/health/);
    assert.match(String(startStep.run), /seq 1 30/);
    assert.match(String(startStep.run), /--max-time 2/);
    assert.equal(
      getStep(healthJob, 'Check sources').env?.PROXY_BASE,
      'http://127.0.0.1:13193?url=',
    );
    assert.equal(getStep(healthJob, 'Check sources')['continue-on-error'], true);
    assert.match(
      String(getStep(healthJob, 'Propagate health result').if),
      /steps\.health\.outcome == 'failure'/,
    );
    assert.match(
      String(getStep(healthJob, 'Stop browser rule gateway').if),
      /always\(\)/,
    );
    assert.match(String(getStep(healthJob, 'Stop browser rule gateway').run), /kill/);
  });

  it('runs Script-Hub only in the plugin conversion job', () => {
    const convertJob = getJob('convert-plugins');

    // Supply-chain contract: the Script-Hub image must be pinned by digest,
    // not a mutable tag (see plans/009-pin-ci-publishing-supply-chain.md).
    assert.match(
      convertJob.services?.['script-hub']?.image ?? '',
      /^xream\/script-hub@sha256:[\da-f]{64}$/,
    );
    assert.match(
      convertJob.if ?? '',
      /contains\(fromJSON\(needs\.prepare\.outputs\.tasks\), 'convert-plugins'\)/,
    );
    assert.equal(hasStep(convertJob, 'Configure Script-Hub'), true);
    assert.equal(hasStep(convertJob, 'Convert plugins'), true);
    assert.equal(hasStep(convertJob, 'Prepare plugin artifact marker'), true);
    assert.equal(hasStep(convertJob, 'Upload plugin conversion output'), true);

    const uploadStep = getStep(convertJob, 'Upload plugin conversion output');
    assert.match(String(uploadStep.if), /always\(\)/);
    assert.match(String(uploadStep.with?.path), /public\/_artifacts/);
  });

  it('merges modules without starting a Script-Hub service', () => {
    const mergeJob = getJob('merge-modules');

    assert.equal(mergeJob.services?.['script-hub'], undefined);
    assert.ok(getNeeds(mergeJob).includes('convert-plugins'));
    assert.match(mergeJob.if ?? '', /always\(\)/);
    assert.match(
      mergeJob.if ?? '',
      /contains\(fromJSON\(needs\.prepare\.outputs\.tasks\), 'merge-modules'\)/,
    );
    assert.match(
      mergeJob.if ?? '',
      /needs\.convert-plugins\.result == 'success'/,
    );
    assert.match(
      mergeJob.if ?? '',
      /needs\.convert-plugins\.result == 'skipped'/,
    );
    assert.equal(hasStep(mergeJob, 'Download plugin conversion output'), true);
    assert.equal(hasStep(mergeJob, 'Ensure converted modules exist'), true);

    const ensureStep = getStep(mergeJob, 'Ensure converted modules exist');
    assert.equal(ensureStep.if, undefined);

    assert.equal(hasStep(mergeJob, 'Merge modules'), true);
    assert.equal(hasStep(mergeJob, 'Upload module output'), true);
  });

  it('builds mirror-sync output without implicitly deploying it', () => {
    const plan = evaluateTaskPlan({
      eventName: 'workflow_dispatch',
      task: 'mirror-sync',
    });
    assert.deepEqual(plan.tasks, ['mirror-sync', 'build']);

    const buildJob = getJob('build');
    assert.match(
      getStep(buildJob, 'Sync mirrors (iRingo, DualSubs, BiliUniverse)').if ??
      '',
      /'mirror-sync'/,
    );
  });

  it('builds a fresh artifact before a manual deploy and keeps deployment on main', () => {
    const plan = evaluateTaskPlan({
      eventName: 'workflow_dispatch',
      task: 'deploy',
    });
    assert.deepEqual(plan.tasks, ['build', 'deploy']);

    for (const jobId of ['deploy-cloudflare', 'deploy-github']) {
      const deployJob = getJob(jobId);
      assert.ok(getNeeds(deployJob).includes('build'));
      assert.match(deployJob.if ?? '', /'deploy'/);
      assert.match(deployJob.if ?? '', /github\.ref == 'refs\/heads\/main'/);
      assert.match(deployJob.if ?? '', /needs\.build\.result == 'success'/);
      assert.ok(
        deployJob.steps?.some(
          (step) =>
            step.uses?.startsWith('actions/download-artifact@') &&
            String(step.with?.name).startsWith('build-artifact-'),
        ),
      );
    }
  });
});
