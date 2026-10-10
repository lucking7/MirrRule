import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';
import { parse } from 'yaml';

import { freshDirsForTasks } from '../lib/publication-stage';

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
  permissions?: Record<string, string>;
  concurrency?: { group?: string; 'cancel-in-progress'?: string | boolean };
}

interface Workflow {
  on?: { workflow_dispatch?: { inputs?: Record<string, { options?: string[]; default?: string }> } };
  permissions?: Record<string, string>;
  concurrency?: { group?: string; 'cancel-in-progress'?: string | boolean };
  jobs?: Record<string, WorkflowJob>;
}

const workflowPath = path.join(
  process.cwd(),
  '.github',
  'workflows',
  'main.yml',
);
const workflowText = fs.readFileSync(workflowPath, 'utf8');
const workflow = parse(workflowText) as Workflow;
const sourceHealthWorkflow = parse(
  fs.readFileSync(
    path.join(process.cwd(), '.github', 'workflows', 'check-source-domain.yml'),
    'utf8',
  ),
) as Workflow;
const expectedSetupPythonAction = 'actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97';

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
  it('queues schedules, pushes and manual runs instead of interrupting an active deployment', () => {
    // eslint-disable-next-line no-template-curly-in-string -- Literal GitHub Actions expressions.
    assert.equal(workflow.concurrency?.group, '${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}');
    // Only pull request runs may be cancelled; production runs queue so an in-flight push and verification finish.
    // eslint-disable-next-line no-template-curly-in-string -- Literal GitHub Actions expression.
    assert.equal(workflow.concurrency?.['cancel-in-progress'], '${{ github.event_name == \'pull_request\' }}');
    assert.deepEqual(workflow.permissions, { contents: 'read' });
  });
  it('publishes one task plan and normalizes the deploy target separately', () => {
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
      deployTarget: 'production',
    });
  });

  it('normalizes legacy deploy selectors to the single production chain with a migration notice', () => {
    const inputs = workflow.on?.workflow_dispatch?.inputs ?? {};
    assert.deepEqual(inputs.deploy_target?.options, ['production', 'all', 'github', 'cloudflare']);
    assert.equal(inputs.deploy_target?.default, 'production');
    for (const deployTarget of ['', 'production', 'all', 'github', 'cloudflare']) {
      assert.equal(
        evaluateTaskPlan({ eventName: 'workflow_dispatch', task: 'deploy', deployTarget }).deployTarget,
        'production',
        deployTarget || 'default'
      );
    }
    const decide = String(getStep(getJob('prepare'), 'Decide tasks to run').run);
    assert.match(decide, /::notice::deploy_target=\$DEPLOY_TARGET is a legacy selector/);
    assert.match(decide, /'github' no longer means repository-only/);
    assert.throws(() => evaluateTaskPlan({ eventName: 'workflow_dispatch', task: 'deploy', deployTarget: 'surge' }));
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
      [
        'manual bootstrap',
        { eventName: 'workflow_dispatch', task: 'bootstrap-baseline' },
        ['bootstrap-baseline'],
      ],
      [
        'manual rollback',
        { eventName: 'workflow_dispatch', task: 'rollback' },
        ['rollback'],
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
      expectedSetupPythonAction,
    );
    assert.equal(pythonSetup.with?.['python-version'], '3.11');

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
      expectedSetupPythonAction,
    );
    assert.equal(pythonSetup.with?.['python-version'], '3.11');
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

  it('runs the pinned Script-Hub container on the host network only for plugin conversion', () => {
    const convertJob = getJob('convert-plugins');

    assert.equal(convertJob.services?.['script-hub'], undefined);
    const configureStep = getStep(convertJob, 'Configure Script-Hub');
    const configureScript = String(configureStep.run);
    assert.match(configureScript, /docker create/);
    assert.match(configureScript, /pnpm run node Build\/patch-script-hub\.ts/);
    assert.match(configureScript, /docker cp .*mirrrule-script-hub:\/app\/Rewrite-Parser\.beta\.js/);
    assert.match(configureScript, /docker start mirrrule-script-hub/);
    assert.match(configureScript, /--name mirrrule-script-hub/);
    assert.match(configureScript, /--network host/);
    assert.match(
      configureScript,
      /xream\/script-hub@sha256:4e9e5055157d2d85f9c03abd045a0016fe594adc44d27410019cdb4818961f45/,
    );
    assert.match(configureScript, /127\.0\.0\.1 script\.hub/);
    assert.match(
      convertJob.if ?? '',
      /contains\(fromJSON\(needs\.prepare\.outputs\.tasks\), 'convert-plugins'\)/,
    );
    assert.equal(hasStep(convertJob, 'Convert plugins'), true);
    assert.equal(hasStep(convertJob, 'Prepare plugin artifact marker'), false);
    assert.equal(hasStep(convertJob, 'Verify converted outputs'), true);
    assert.equal(hasStep(convertJob, 'Upload plugin conversion output'), true);
    assert.equal(hasStep(convertJob, 'Stop plugin conversion services'), true);

    const uploadStep = getStep(convertJob, 'Upload plugin conversion output');
    assert.match(String(uploadStep.if), /success\(\)/);
    assert.doesNotMatch(String(uploadStep.with?.path), /public\/_artifacts/);
    assert.match(String(uploadStep.with?.path), /public\/Modules\/Converted/);
    assert.match(String(uploadStep.with?.path), /public\/Scripts/);
    assert.equal(uploadStep.with?.['if-no-files-found'], 'error');

    const cleanupStep = getStep(convertJob, 'Stop plugin conversion services');
    assert.match(String(cleanupStep.if), /always\(\)/);
    assert.match(String(cleanupStep.run), /docker rm --force mirrrule-script-hub/);
  });

  it('runs the browser gateway before plugin conversion and always uploads its diagnostics', () => {
    const convertJob = getJob('convert-plugins');
    const pythonSetup = convertJob.steps?.find((step) =>
      step.uses?.startsWith('actions/setup-python@'),
    );
    assert.equal(
      pythonSetup?.uses,
      expectedSetupPythonAction,
    );
    assert.equal(pythonSetup.with?.['python-version'], '3.11');
    assert.match(
      String(getStep(convertJob, 'Install browser gateway dependencies').run),
      /Build\/browser-rule-requirements\.txt/,
    );
    assert.match(
      String(getStep(convertJob, 'Run browser gateway tests').run),
      /python3 Build\/__tests__\/browser-rule-gateway\.test\.py/,
    );

    const startStep = getStep(convertJob, 'Start browser rule gateway');
    assert.match(String(startStep.run), /--port 13193/);
    assert.match(
      String(startStep.run),
      /--upstream-base https:\/\/cloudflare-proxy\.lucking\.workers\.dev/,
    );
    assert.match(String(startStep.run), /127\.0\.0\.1:13193\/health/);
    assert.match(String(startStep.run), /seq 1 30/);
    assert.match(String(startStep.run), /--max-time 2/);

    const convertStep = getStep(convertJob, 'Convert plugins');
    assert.equal(convertStep.env?.PROXY_BASE, 'http://127.0.0.1:13193?url=');
    assert.equal(convertStep['continue-on-error'], undefined);
    assert.doesNotMatch(String(convertStep.run), /--timeout/);
    assert.match(String(convertStep.run), /--required-config Build\/lib\/module-merger\/configs\/pro-merge-config\.yaml/);

    const logUpload = getStep(convertJob, 'Upload browser gateway log');
    assert.match(String(logUpload.if), /always\(\)/);
    assert.equal(
      logUpload.with?.path,
      githubExpression('runner.temp') + '/browser-rule-gateway.log',
    );
  });

  it('propagates the final plugin conversion failure after one bounded retry', () => {
    const convertScript = String(getStep(getJob('convert-plugins'), 'Convert plugins').run);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-convert-retry-'));
    const binDir = path.join(tempDir, 'bin');
    const attemptFile = path.join(tempDir, 'attempts');
    fs.mkdirSync(binDir);
    fs.writeFileSync(
      path.join(binDir, 'pnpm'),
      '#!/bin/bash\ncount=0\n[ ! -f "$ATTEMPT_FILE" ] || count=$(<"$ATTEMPT_FILE")\nprintf "%s\\n" "$((count + 1))" > "$ATTEMPT_FILE"\nexit 17\n',
      { mode: 0o755 },
    );
    fs.writeFileSync(path.join(binDir, 'sleep'), '#!/bin/bash\nexit 0\n', {
      mode: 0o755,
    });

    try {
      let exitStatus: number | undefined;
      try {
        execFileSync('/bin/bash', ['-c', convertScript], {
          cwd: tempDir,
          env: {
            ...process.env,
            ATTEMPT_FILE: attemptFile,
            PATH: `${binDir}:${process.env.PATH ?? ''}`,
          },
          stdio: 'pipe',
        });
      } catch (error) {
        exitStatus = (error as { status?: number }).status;
      }
      assert.equal(exitStatus, 17);
      assert.equal(fs.readFileSync(attemptFile, 'utf8').trim(), '2');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects zero converted modules before artifact upload', () => {
    const verifyScript = String(
      getStep(getJob('convert-plugins'), 'Verify converted outputs').run,
    );
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-convert-output-'));
    try {
      fs.mkdirSync(path.join(tempDir, 'public', 'Modules', 'Converted'), {
        recursive: true,
      });
      assert.throws(() => {
        execFileSync('/bin/bash', ['-eu', '-o', 'pipefail', '-c', verifyScript], {
          cwd: tempDir,
          stdio: 'pipe',
        });
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
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
    assert.match(String(ensureStep.run), /conversion was requested/i);
    assert.match(String(ensureStep.run), /exit 1/);
    assert.match(String(ensureStep.run), /existing converted modules/i);

    assert.equal(hasStep(mergeJob, 'Merge modules'), true);
    assert.equal(hasStep(mergeJob, 'Upload module output'), true);
  });

  it('preserves previous optional subscriptions from the accepted baseline only after fresh required modules have merged', () => {
    const mergeJob = getJob('merge-modules');
    assert.ok(getNeeds(mergeJob).includes('baseline'));
    const step = getStep(mergeJob, 'Preserve previous optional modules and scripts');
    assert.match(String(step.if), /convert-plugins/);
    assert.match(String(step.if), /needs\.baseline\.outputs\.available == 'true'/);
    assert.match(String(step.run), /restore-optional-artifacts\.ts/);
    assert.match(String(step.run), /publication-baseline/);
    assert.match(String(step.run), /--from-commit "\$from_commit"/);
    assert.equal(step.env?.DEPLOY_COMMIT, githubExpression('needs.baseline.outputs.deploy_commit'));
    const skipped = getStep(mergeJob, 'Report skipped optional restoration');
    assert.match(String(skipped.if), /needs\.baseline\.outputs\.available != 'true'/);
    assert.match(String(skipped.run), /::notice::/);
    assert.match(String(getStep(mergeJob, 'Upload module output').with?.path), /public\/Internal\/preserved-artifacts\.json/);
    assert.doesNotMatch(String(step.run), /git clone/, 'optional artifacts must not come from the unverified NRRule HEAD');
    const checkout = getStep(mergeJob, 'Check out accepted baseline tree');
    assert.match(String(checkout.run), /resolve-baseline/);
    assert.match(String(checkout.run), /--receipt-id "\$RECEIPT_ID"/);
    const ensure = String(getStep(mergeJob, 'Ensure converted modules exist').run);
    assert.doesNotMatch(ensure, /git clone|\|\| true/);
    assert.ok(ensure.indexOf('prepare-publication.ts purge --root public') > ensure.indexOf('cp -R "$BASELINE_CONVERTED/."'), 'retired modules copied from the baseline must be purged');
    const names = mergeJob.steps!.map(item => item.name);
    assert.ok(names.indexOf(checkout.name) < names.indexOf('Ensure converted modules exist'));
    assert.ok(names.indexOf('Merge modules') < names.indexOf(step.name));
    assert.ok(names.indexOf(step.name) < names.indexOf('Upload module output'));
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

  it('publishes coverage and audit reports as a required fresh directory', () => {
    for (const tasks of [['build', 'deploy'], ['mirror-sync', 'build', 'deploy'], ['convert-plugins', 'merge-modules', 'build', 'deploy']]) {
      assert.ok(freshDirsForTasks(tasks).includes('Internal'), tasks.join(','));
    }
    assert.match(String(getStep(getJob('publish'), 'Stage complete publication tree').run), /--tasks "\$TASKS"/);
  });

  it('has exactly one production write path and no direct Cloudflare upload', () => {
    assert.equal(workflow.jobs?.['deploy-cloudflare'], undefined);
    assert.equal(workflow.jobs?.['deploy-github'], undefined);
    assert.doesNotMatch(workflowText, /wrangler|CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID/);
    const writers: string[] = [];
    const deploymentWriters: string[] = [];
    const jobs = workflow.jobs ?? {};
    for (const [id, job] of Object.entries(jobs)) {
      if ((job.steps ?? []).some(step => /git push|prepare-publication\.ts push|secrets\.GIT_TOKEN/.test(`${step.run ?? ''}\n${JSON.stringify(step.env ?? {})}`))) writers.push(id);
      if (job.permissions?.deployments === 'write') deploymentWriters.push(id);
    }
    assert.deepEqual(writers, ['publish']);
    deploymentWriters.sort();
    assert.deepEqual(deploymentWriters, ['bootstrap-baseline', 'publish']);
    for (const id of deploymentWriters) {
      const job = getJob(id);
      assert.equal(job.permissions?.contents, 'read');
      assert.equal(job.concurrency?.group, 'nrrule-production');
      assert.equal(job.concurrency?.['cancel-in-progress'], false);
    }
  });

  it('does not publish build-only, mirror-only, plugin-only or pull request runs', () => {
    const publish = getJob('publish');
    const condition = publish.if ?? '';
    assert.match(condition, /contains\(fromJSON\(needs\.prepare\.outputs\.tasks\), 'deploy'\) && needs\.build\.result == 'success'/);
    assert.match(condition, /contains\(fromJSON\(needs\.prepare\.outputs\.tasks\), 'rollback'\) && needs\.build\.result == 'skipped'/);
    assert.match(condition, /github\.event_name != 'pull_request'/);
    assert.match(condition, /needs\.prepare\.outputs\.deploy_target == 'production'/);
    const nonPublishing: WorkflowScenario[] = [
      { eventName: 'pull_request' },
      { eventName: 'workflow_dispatch', task: 'build' },
      { eventName: 'workflow_dispatch', task: 'mirror-sync' },
      { eventName: 'workflow_dispatch', task: 'convert-plugins' },
      { eventName: 'workflow_dispatch', task: 'merge-modules' },
      { eventName: 'workflow_dispatch', task: 'bootstrap-baseline' },
    ];
    for (const scenario of nonPublishing) {
      const { tasks } = evaluateTaskPlan(scenario);
      assert.ok(!tasks.includes('deploy') && !tasks.includes('rollback'), JSON.stringify(scenario));
    }
  });

  it('stages, pushes, verifies and records the receipt in order, with archive cleanup always', () => {
    const publish = getJob('publish');
    const names = (publish.steps ?? []).map(step => step.name);
    const order = [
      'Resolve accepted baseline inside the production lock',
      'Stage complete publication tree',
      'Unarchive NRRule',
      'Clone NRRule and record remote HEAD',
      'Commit and push NRRule',
      'Verify Cloudflare deployment and production content',
      'Record acceptance receipt',
      'Archive NRRule',
    ];
    for (let index = 1; index < order.length; index++) {
      assert.ok(names.includes(order[index - 1]) && names.indexOf(order[index - 1]) < names.indexOf(order[index]), order[index]);
    }
    const lock = getStep(publish, 'Resolve accepted baseline inside the production lock');
    assert.match(String(lock.run), /--expected-receipt-id "\$EXPECTED_RECEIPT_ID"/);
    assert.doesNotMatch(String(lock.run), /--allow-missing/, 'production requires an accepted baseline');
    assert.match(String(getStep(publish, 'Stage complete publication tree').run), /--check-superseded/);
    const push = getStep(publish, 'Commit and push NRRule');
    assert.match(String(push.run), /--expected-head "\$EXPECTED_HEAD"/);
    assert.match(String(push.run), /deploy: \$\{\{ github\.repository \}\}@\$\{\{ github\.sha \}\} \[\$SCOPES\]/);
    assert.doesNotMatch(workflowText, /push --force|push -f\b|--force-with-lease/);
    assert.match(String(getStep(publish, 'Verify Cloudflare deployment and production content').if), /steps\.push\.outputs\.deploy_commit != ''/);
    assert.match(String(getStep(publish, 'Verify Cloudflare deployment and production content').run), /--timeout-minutes 15/);
    assert.match(String(getStep(publish, 'Record acceptance receipt').if), /steps\.verify\.outputs\.outcome == 'accepted'/);
    assert.match(String(getStep(publish, 'Archive NRRule').if), /always\(\)/);
    assert.equal(publish.outputs?.deploy_commit, githubExpression('steps.push.outputs.deploy_commit'));
    const publishSteps = publish.steps ?? [];
    for (const step of publishSteps) {
      assert.doesNotMatch(step.run ?? '', /\|\| true/, String(step.name));
    }
  });

  it('builds against the accepted baseline tree instead of the NRRule HEAD', () => {
    const buildJob = getJob('build');
    assert.ok(getNeeds(buildJob).includes('baseline'));
    assert.equal(hasStep(buildJob, 'Download missing directories for index.html'), false);
    const restore = getStep(buildJob, 'Restore preserved directories from accepted baseline');
    assert.match(String(restore.run), /restore-preserved/);
    assert.doesNotMatch(String(restore.run), /git clone|\|\| true|mkdir -p "public\/\$dir"/);
    const buildStep = buildJob.steps?.find(step => step.run === 'pnpm run build');
    assert.match(String(buildStep?.env?.PUBLICATION_BASELINE_DIR), /publication-baseline/);
    assert.equal(buildStep?.env?.PUBLICATION_BASELINE_RECEIPT_ID, githubExpression('needs.baseline.outputs.receipt_id'));
    const names = (buildJob.steps ?? []).map(step => step.name ?? step.run);
    assert.ok(names.indexOf('Check out accepted baseline tree') < names.indexOf('Restore preserved directories from accepted baseline'));
    assert.ok(names.indexOf('Restore preserved directories from accepted baseline') < names.indexOf('pnpm run build'));
    const baseline = getJob('baseline');
    assert.match(String(getStep(baseline, 'Select accepted receipt').run), /select-baseline --allow-missing/);
    assert.equal(baseline.permissions?.deployments, 'read');
  });

  it('bootstraps a pinned legacy revision through a 90-day artifact and a legacy-bootstrap receipt', () => {
    const job = getJob('bootstrap-baseline');
    assert.match(job.if ?? '', /'bootstrap-baseline'/);
    assert.match(job.if ?? '', /github\.ref == 'refs\/heads\/main'/);
    const verify = getStep(job, 'Verify pinned legacy revision');
    assert.match(String(verify.run), /prepare-publication\.ts bootstrap/);
    assert.equal(verify.env?.REVISION, githubExpression('github.event.inputs.bootstrap_revision'));
    assert.equal(verify.env?.IMMUTABLE_URL, githubExpression('github.event.inputs.bootstrap_immutable_url'));
    const upload = getStep(job, 'Upload legacy inventory');
    assert.equal(upload.with?.['retention-days'], 90);
    assert.equal(upload.with?.['if-no-files-found'], 'error');
    const record = getStep(job, 'Record legacy-bootstrap receipt');
    assert.match(String(record.run), /--kind legacy-bootstrap/);
    assert.equal(record.env?.ARTIFACT_ID, githubExpression('steps.upload.outputs.artifact-id'));
    assert.equal(record.env?.ARTIFACT_DIGEST, githubExpression('steps.upload.outputs.artifact-digest'));
  });

  it('skips automatic publication without a baseline receipt but fails explicit dispatches', () => {
    const publish = getJob('publish');
    const gate = getStep(publish, 'Check publication prerequisites');
    assert.equal(publish.steps?.[0], gate);
    assert.equal(gate.env?.BASELINE_AVAILABLE, githubExpression('needs.baseline.outputs.available'));
    const run = (available: string, eventName: string) => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-gate-'));
      const output = path.join(tempDir, 'out');
      try {
        const stdout = execFileSync('/bin/bash', ['-c', String(gate.run)], {
          env: { ...process.env, GITHUB_OUTPUT: output, BASELINE_AVAILABLE: available, EVENT_NAME: eventName },
          encoding: 'utf8',
          stdio: 'pipe',
        });
        return { status: 0, stdout, output: fs.readFileSync(output, 'utf8') };
      } catch (error) {
        return { status: (error as { status?: number }).status ?? -1, stdout: '', output: '' };
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    };
    assert.deepEqual(run('true', 'schedule'), { status: 0, stdout: '', output: 'proceed=true\n' });
    const skipped = run('false', 'schedule');
    assert.equal(skipped.status, 0);
    assert.match(skipped.stdout, /::warning::publication skipped: bootstrap required/);
    assert.equal(skipped.output, 'proceed=false\n');
    assert.equal(run('false', 'push').output, 'proceed=false\n');
    assert.equal(run('false', 'workflow_dispatch').status, 1);
    for (const name of ['Download build artifact', 'Resolve accepted baseline inside the production lock', 'Resolve rollback candidate', 'Stage complete publication tree']) {
      assert.match(String(getStep(publish, name).if), /steps\.gate\.outputs\.proceed == 'true'/, name);
    }
    for (const step of Object.values(workflow.jobs ?? {}).flatMap(job => job.steps ?? [])) {
      if (String(step.run).includes('resolve-baseline') && !String(step.run).includes('--receipt-id')) {
        assert.doesNotMatch(String(step.run), /--allow-missing/);
      }
    }
  });

  it('rolls back through the same staging, push and verification chain', () => {
    const publish = getJob('publish');
    const rollback = getStep(publish, 'Resolve rollback candidate');
    assert.match(String(rollback.if), /'rollback'/);
    assert.match(String(rollback.run), /resolve-baseline/);
    assert.match(String(rollback.run), /--receipt-id "\$ROLLBACK_RECEIPT_ID"/);
    assert.match(String(getStep(publish, 'Stage complete publication tree').run), /--rollback-evidence/);
    assert.equal(rollback.env?.ROLLBACK_RECEIPT_ID, githubExpression('github.event.inputs.rollback_receipt_id'));
  });

  it('builds fresh artifacts for main deployment and PR comparison after optional jobs skip', () => {
    const plan = evaluateTaskPlan({
      eventName: 'workflow_dispatch',
      task: 'deploy',
    });
    assert.deepEqual(plan.tasks, ['build', 'deploy']);

    const deployJob = getJob('publish');
    assert.ok(getNeeds(deployJob).includes('build'));
    assert.match(
      deployJob.if ?? '',
      /!cancelled\(\)/,
      'publish must override implicit success() when optional ancestor jobs are skipped, while still honoring cancellation',
    );
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

    const diffJob = getJob('diff-deployment-on-pr');
    assert.ok(getNeeds(diffJob).includes('build'));
    assert.match(diffJob.if ?? '', /!cancelled\(\)/);
    assert.match(diffJob.if ?? '', /github\.event_name == 'pull_request'/);
    assert.match(diffJob.if ?? '', /needs\.build\.result == 'success'/);
  });
});
