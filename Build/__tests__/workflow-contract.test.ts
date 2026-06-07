import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';
import { parse } from 'yaml';

interface WorkflowStep {
  name?: string;
  uses?: string;
  if?: string;
  with?: Record<string, unknown>;
}

interface WorkflowJob {
  name?: string;
  needs?: string | string[];
  if?: string;
  services?: Record<string, { image?: string }>;
  steps?: WorkflowStep[];
}

interface Workflow {
  jobs?: Record<string, WorkflowJob>;
}

const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'main.yml');
const workflow = parse(fs.readFileSync(workflowPath, 'utf8')) as Workflow;

function getJob(id: string) {
  const job = workflow.jobs?.[id];
  assert.ok(job, `job ${id} should exist`);
  return job;
}

function getNeeds(job: WorkflowJob) {
  if (Array.isArray(job.needs)) return job.needs;
  if (typeof job.needs === 'string') return [job.needs];
  return [];
}

function hasStep(job: WorkflowJob, name: string) {
  return job.steps?.some(step => step.name === name) ?? false;
}

function getStep(job: WorkflowJob, name: string) {
  const step = job.steps?.find(item => item.name === name);
  assert.ok(step, `step ${name} should exist`);
  return step;
}

describe('GitHub Actions workflow contract', () => {
  it('keeps Script-Hub out of the generic Build job', () => {
    const buildJob = getJob('build');

    assert.equal(buildJob.services?.['script-hub'], undefined);
    assert.ok(getNeeds(buildJob).includes('convert-plugins'));
    assert.ok(getNeeds(buildJob).includes('merge-modules'));

    const condition = buildJob.if ?? '';
    assert.match(condition, /always\(\)/);
    assert.match(condition, /needs\.prepare\.outputs\.should_build == 'true'/);
    assert.match(condition, /needs\.convert-plugins\.result == 'success'/);
    assert.match(condition, /needs\.convert-plugins\.result == 'skipped'/);
    assert.match(condition, /needs\.merge-modules\.result == 'success'/);
    assert.match(condition, /needs\.merge-modules\.result == 'skipped'/);
  });

  it('runs Script-Hub only in the plugin conversion job', () => {
    const convertJob = getJob('convert-plugins');

    assert.equal(convertJob.services?.['script-hub']?.image, 'xream/script-hub:latest');
    assert.match(convertJob.if ?? '', /should_convert_plugins == 'true'/);
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
    assert.match(mergeJob.if ?? '', /should_merge_modules == 'true'/);
    assert.match(mergeJob.if ?? '', /needs\.convert-plugins\.result == 'success'/);
    assert.match(mergeJob.if ?? '', /needs\.convert-plugins\.result == 'skipped'/);
    assert.equal(hasStep(mergeJob, 'Download plugin conversion output'), true);
    assert.equal(hasStep(mergeJob, 'Ensure converted modules exist'), true);

    const ensureStep = getStep(mergeJob, 'Ensure converted modules exist');
    assert.equal(ensureStep.if, undefined);

    assert.equal(hasStep(mergeJob, 'Merge modules'), true);
    assert.equal(hasStep(mergeJob, 'Upload module output'), true);
  });
});
