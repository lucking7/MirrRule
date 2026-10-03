import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { verifyRequiredPluginOutputs } from '../integration/plugin-converter/readiness';
import type { ConversionResult } from '../integration/plugin-converter/types';

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
  const outputPaths = [
    path.join(directory, 'output.sgmodule'),
    path.join(directory, 'output.list'),
  ];
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
      modules,
      output: {
        sgmodule: outputPaths[0],
        rulelist: outputPaths[1],
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
      [false, false],
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
      [false, false],
    );
  });
});
