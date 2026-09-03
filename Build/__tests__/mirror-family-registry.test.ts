import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';
import { parse } from 'yaml';
import {
  EXTERNAL_MIRROR_FAMILIES,
  MIRROR_GROUPS,
  getGenericMirrorFamilies
} from '../integration/mirror-sync/mirror-config';

interface PackageJson {
  scripts?: Record<string, string>;
}

interface WorkflowStep {
  name?: string;
  run?: string;
}

interface Workflow {
  jobs?: Record<string, { steps?: WorkflowStep[] }>;
}

const root = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as PackageJson;
const workflowText = fs.readFileSync(path.join(root, '.github', 'workflows', 'main.yml'), 'utf8');
const eligibleFamilies = getGenericMirrorFamilies();

function assertPackageScriptContract(scripts: Record<string, string>): void {
  const knownNames = new Set(MIRROR_GROUPS.map(group => group.name));
  const mirrorScripts = Object.entries(scripts).filter(([name]) => name.startsWith('mirror:'));

  for (const family of eligibleFamilies) {
    const scriptName = `mirror:${family.name.toLowerCase()}`;
    const expectedCommand = `pnpm run node ./Build/sync-mirrors.ts ${family.name}`;
    const matches = mirrorScripts.filter(
      ([name, command]) => name === scriptName && command === expectedCommand
    );
    assert.equal(matches.length, 1, `${family.name} should have exactly one ${scriptName} script`);
  }

  for (const [scriptName, command] of mirrorScripts) {
    const match = /(?:^|\s)\.\/Build\/sync-mirrors\.ts\s+(\S+)\s*$/.exec(command);
    assert.ok(match, `${scriptName} should target Build/sync-mirrors.ts with one family name`);
    assert.ok(knownNames.has(match[1]), `${scriptName} targets unknown mirror family ${match[1]}`);
  }
}

function assertWorkflowContract(source: string): void {
  const workflow = parse(source) as Workflow;
  assert.ok(workflow.jobs, 'workflow jobs should be parseable');
  const buildSteps = workflow.jobs.build.steps;
  assert.ok(Array.isArray(buildSteps), 'build job steps should be parseable');

  const genericSteps = buildSteps.filter(
    step => step.run?.trim() === 'pnpm run node ./Build/sync-mirrors.ts'
  );
  assert.equal(genericSteps.length, 1, 'generic mirror sync command should exist exactly once');

  const genericLabel = genericSteps[0].name ?? '';
  const summaryStep = buildSteps.find(step => step.name === 'Verify build output');
  assert.ok(summaryStep?.run, 'Verify build output summary should be parseable');

  for (const family of eligibleFamilies) {
    assert.ok(genericLabel.includes(family.name), `${family.name} should appear in sync step label`);
    assert.ok(summaryStep.run.includes(family.name), `${family.name} should appear in mirror summary`);
  }

  const fmzStep = buildSteps.find(step => step.run?.includes('Build/download-fmz200-split.ts'));
  assert.ok(fmzStep, 'fmz200 should retain its dedicated workflow step');
  const sukkaStep = buildSteps.find(step => step.run?.includes('Build/download-mock-modules.ts'));
  assert.ok(sukkaStep, 'Sukka should retain its dedicated workflow step');
}

describe('mirror family registry contract', () => {
  it('derives generic families and records the external fmz200 exception', () => {
    assert.deepEqual(
      eligibleFamilies.map(group => group.name),
      ['iRingo', 'DualSubs', 'BiliUniverse']
    );
    const externalFamilies = MIRROR_GROUPS.filter(group => !getGenericMirrorFamilies().includes(group));
    assert.deepEqual(externalFamilies.map(group => group.name), Object.keys(EXTERNAL_MIRROR_FAMILIES));
    assert.equal(externalFamilies[0].repositories.length, 0);
    assert.match(EXTERNAL_MIRROR_FAMILIES.fmz200, /download-fmz200-split\.ts/);
  });

  it('discovers current Siri release assets without stale debug downloads', () => {
    const iRingo = MIRROR_GROUPS.find(group => group.name === 'iRingo');
    const siri = iRingo?.repositories.find(repository => repository.repo === 'NSRingo/Siri');

    assert.ok(siri?.assetNamePattern);
    for (const name of [
      'iRingo.Siri.sgmodule',
      'iRingo.Search.plugin',
      'iRingo.Spotlight.stoverride',
    ]) {
      assert.match(name, siri.assetNamePattern);
    }
    assert.doesNotMatch('Siri.V2.beta.sgmodule', siri.assetNamePattern);
  });

  it('keeps package convenience scripts aligned with eligible registry families', () => {
    assertPackageScriptContract(packageJson.scripts ?? {});

    const missingDualSubs = { ...packageJson.scripts };
    delete missingDualSubs['mirror:dualsubs'];
    assert.throws(() => assertPackageScriptContract(missingDualSubs), /DualSubs/);

    assert.throws(
      () =>
        assertPackageScriptContract({
          ...packageJson.scripts,
          'mirror:unknown': 'pnpm run node ./Build/sync-mirrors.ts Unknown'
        }),
      /unknown mirror family Unknown/
    );
  });

  it('keeps workflow labels and summaries aligned with eligible registry families', () => {
    assertWorkflowContract(workflowText);
    assert.throws(() => assertWorkflowContract(workflowText.replaceAll('DualSubs', '')), /DualSubs/);
  });
});
