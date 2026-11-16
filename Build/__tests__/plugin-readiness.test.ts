import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { RequiredPluginOutputError, verifyRequiredPluginOutputs } from '../integration/plugin-converter/readiness';
import type { ConversionResult } from '../integration/plugin-converter/types';
import { isUnavailableFailure, isUnavailableStatus } from '../integration/plugin-converter/upstream-failure';

function conversionResult(
  pluginName: string,
  status: ConversionResult['status'],
  outputPath?: string,
): ConversionResult {
  return {
    pluginName,
    sourceId: `${pluginName}-source-id`,
    sourceUrl: `https://plugins.test/${pluginName}.plugin`,
    status,
    outputPath,
    scripts: [],
  };
}

function writeFixture(
  directory: string,
  modules: Array<{ url: string; header: string; enabledByDefault?: boolean }>,
): { configPath: string; outputPaths: string[] } {
  const outputPaths = [path.join(directory, 'output.sgmodule')];
  const templatePath = path.join(directory, 'template.sgmodule');
  fs.writeFileSync(templatePath, '{{{header_extra}}}\n{{{sections_body}}}');

  const configPath = path.join(directory, 'config.json');
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      name: 'Plugin readiness fixture',
      version: '1',
      description: 'Test',
      category: 'Test',
      author: 'Test',
      modules: modules.map((module) => ({ ...module, id: module.header.replaceAll(/\W/g, '_') })),
      output: {
        sgmodule: outputPaths[0],
        template: templatePath,
      },
    }),
  );
  return { configPath, outputPaths };
}

describe('required plugin output readiness', () => {
  it('rejects a selected module missing from the current conversion outputs', async (t) => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'mirrrule-plugin-readiness-'),
    );
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const modulePath = path.join(directory, 'required.sgmodule');
    const { configPath } = writeFixture(directory, [
      {
        url: 'file://required.sgmodule',
        header: 'Required',
      },
    ]);

    await assert.rejects(
      verifyRequiredPluginOutputs(
        [conversionResult('Required', 'ready', modulePath)],
        configPath,
      ),
      /required.*missing|missing.*required/i,
    );
  });

  for (const testCase of [
    {
      name: 'degraded current result',
      status: 'degraded' as const,
      includeResult: true,
    },
    {
      name: 'stale file without a current result',
      status: 'ready' as const,
      includeResult: false,
    },
  ]) {
    it(`rejects a ${testCase.name}`, async (t) => {
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'mirrrule-plugin-readiness-'),
      );
      t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
      const modulePath = path.join(directory, 'required.sgmodule');
      fs.writeFileSync(modulePath, '[Rule]\nDOMAIN,required.test,REJECT');
      const { configPath } = writeFixture(directory, [
        {
          url: 'file://required.sgmodule',
          header: 'Required',
        },
      ]);
      const results = testCase.includeResult
        ? [conversionResult('Required', testCase.status, modulePath)]
        : [];

      await assert.rejects(
        verifyRequiredPluginOutputs(results, configPath),
        /required.*not ready/i,
      );
    });
  }

  it('requires every current result for the selected output path to be ready', async (t) => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'mirrrule-plugin-readiness-'),
    );
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const modulePath = path.join(directory, 'required.sgmodule');
    fs.writeFileSync(modulePath, '[Rule]\nDOMAIN,required.test,REJECT');
    const { configPath } = writeFixture(directory, [
      {
        url: 'file://required.sgmodule',
        header: 'Required',
      },
    ]);

    await assert.rejects(
      verifyRequiredPluginOutputs(
        [
          conversionResult('First name', 'ready', modulePath),
          conversionResult('Duplicate name', 'failed', modulePath),
        ],
        configPath,
      ),
      /required.*not ready/i,
    );
  });

  it('allows failed unconfigured and disabled plugins and does not write merge outputs', async (t) => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'mirrrule-plugin-readiness-'),
    );
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const requiredPath = path.join(directory, 'required.sgmodule');
    const disabledPath = path.join(directory, 'disabled.sgmodule');
    fs.writeFileSync(requiredPath, '[Rule]\nDOMAIN,required.test,REJECT');
    const { configPath, outputPaths } = writeFixture(directory, [
      { url: 'file://required.sgmodule', header: 'Required' },
      {
        url: 'file://disabled.sgmodule',
        header: 'Disabled',
        enabledByDefault: false,
      },
    ]);

    const requiredCount = await verifyRequiredPluginOutputs(
      [
        conversionResult('Required', 'ready', requiredPath),
        conversionResult('Disabled', 'failed', disabledPath),
        conversionResult(
          'Not configured',
          'failed',
          path.join(directory, 'other.sgmodule'),
        ),
      ],
      configPath,
    );

    assert.equal(requiredCount, 1);
    assert.deepEqual(
      outputPaths.map((outputPath) => fs.existsSync(outputPath)),
      [false],
    );
  });

  it('rejects an empty current output before merge validation', async (t) => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'mirrrule-plugin-readiness-'),
    );
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const modulePath = path.join(directory, 'required.sgmodule');
    fs.writeFileSync(modulePath, '');
    const { configPath } = writeFixture(directory, [
      {
        url: 'file://required.sgmodule',
        header: 'Required',
      },
    ]);

    await assert.rejects(
      verifyRequiredPluginOutputs(
        [conversionResult('Required', 'ready', modulePath)],
        configPath,
      ),
      /required.*empty/i,
    );
  });

  it('rejects remote required module sources without fetching them', async (t) => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'mirrrule-plugin-readiness-'),
    );
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const { configPath } = writeFixture(directory, [
      {
        url: 'https://modules.test/required.sgmodule',
        header: 'Remote required',
      },
    ]);

    await assert.rejects(
      verifyRequiredPluginOutputs([], configPath),
      /remote required.*remote/i,
    );
  });

  it('rejects an empty default selection', async (t) => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'mirrrule-plugin-readiness-'),
    );
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const { configPath } = writeFixture(directory, [
      {
        url: 'file://disabled.sgmodule',
        header: 'Disabled',
        enabledByDefault: false,
      },
    ]);

    await assert.rejects(
      verifyRequiredPluginOutputs([], configPath),
      /selection is empty/i,
    );
  });

  it('runs merge parsing in dry-run and rejects invalid module parameters without outputs', async (t) => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'mirrrule-plugin-readiness-'),
    );
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const modulePath = path.join(directory, 'required.sgmodule');
    fs.writeFileSync(
      modulePath,
      '[Script]\ncheck = type=generic, script-path=https://scripts.test/check.js, argument={{{missing}}}',
    );
    const { configPath, outputPaths } = writeFixture(directory, [
      {
        url: 'file://required.sgmodule',
        header: 'Required',
      },
    ]);

    await assert.rejects(
      verifyRequiredPluginOutputs(
        [conversionResult('Required', 'ready', modulePath)],
        configPath,
      ),
      /未定义/,
    );
    assert.deepEqual(
      outputPaths.map((outputPath) => fs.existsSync(outputPath)),
      [false],
    );
  });
});

const failed = (
  name: string,
  outputPath: string | undefined,
  upstreamUnavailable: boolean,
  status: ConversionResult['status'] = 'failed',
): ConversionResult => ({ ...conversionResult(name, status, outputPath), error: 'failure', upstreamUnavailable });

async function classify(
  t: { after: (fn: () => void) => void },
  results: (directory: string) => ConversionResult[],
  options: { existing?: boolean, content?: string } = {},
): Promise<RequiredPluginOutputError> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-plugin-outage-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  if (options.existing) fs.writeFileSync(path.join(directory, 'required.sgmodule'), options.content ?? '[Rule]\nDOMAIN,required.test,REJECT');
  const { configPath } = writeFixture(directory, [{ url: 'file://required.sgmodule', header: 'Required' }]);
  try {
    await verifyRequiredPluginOutputs(results(directory), configPath);
  } catch (error) {
    assert.ok(error instanceof RequiredPluginOutputError, String(error));
    return error;
  }
  throw new Error('verification unexpectedly passed');
}

describe('plugin upstream outage classification', () => {
  it('is upstream when a missing module matches plugin download failures (network error or 5xx)', async (t) => {
    const error = await classify(t, () => [failed('Plugin', undefined, true), failed('Other', undefined, true)]);
    assert.equal(error.upstreamUnavailable, true);
  });

  it('is upstream when a converted module waits on a script that returned 5xx', async (t) => {
    const error = await classify(t, directory => [failed('Required', path.join(directory, 'required.sgmodule'), true, 'degraded')], { existing: true });
    assert.equal(error.upstreamUnavailable, true);
  });

  it('is not upstream when a required script returned 404', async (t) => {
    const error = await classify(t, directory => [failed('Required', path.join(directory, 'required.sgmodule'), false)]);
    assert.equal(error.upstreamUnavailable, false);
  });

  it('is not upstream when the missing module cannot be matched to a download failure (rename)', async (t) => {
    const error = await classify(t, directory => [conversionResult('Renamed', 'ready', path.join(directory, 'renamed.sgmodule'))]);
    assert.equal(error.upstreamUnavailable, false);
  });

  it('is not upstream when a plugin without output failed in Script-Hub conversion', async (t) => {
    const error = await classify(t, () => [failed('Plugin', undefined, true), failed('Converter', undefined, false)]);
    assert.equal(error.upstreamUnavailable, false);
  });

  it('is not upstream when the merge dry-run fails', async (t) => {
    const error = await classify(
      t,
      directory => [conversionResult('Required', 'ready', path.join(directory, 'required.sgmodule')), failed('Other', undefined, true)],
      { existing: true, content: '[Script]\ncheck = type=generic, script-path=https://scripts.test/check.js, argument={{{missing}}}' },
    );
    assert.equal(error.upstreamUnavailable, false);
    assert.match(error.message, /dry-run/);
  });
});

describe('upstream availability classification', () => {
  it('treats outages and client refusals as unavailable but a removed file as a defect', () => {
    for (const status of [401, 403, 408, 429, 500, 502, 503, 530]) assert.equal(isUnavailableStatus(status), true, String(status));
    for (const status of [400, 404, 410, 451]) assert.equal(isUnavailableStatus(status), false, String(status));
    assert.equal(isUnavailableFailure(new TypeError('fetch failed')), true);
    assert.equal(isUnavailableFailure(Object.assign(new Error('gone'), { statusCode: 404 })), false);
    assert.equal(isUnavailableFailure(Object.assign(new Error('blocked'), { statusCode: 403 })), true);
  });
});
