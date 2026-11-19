import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { extractScriptUrls } from './integration/plugin-converter/script-extractor';
import { getMirrorFilename, validateScriptContent } from './integration/plugin-converter/script-mirror';
import type { ConversionResult } from './integration/plugin-converter/types';
import { selectModuleSources } from './lib/module-merger';
import { loadMergeConfig } from './lib/module-merger/config-loader';

type ReportEntry = Pick<ConversionResult, 'pluginName' | 'sourceId' | 'status' | 'upstreamUnavailable'> & { file?: string };
interface ConversionReport {
  schemaVersion: number;
  required?: { config: string; ready: number };
  results?: ReportEntry[];
}

const defaultConfig = 'Build/lib/module-merger/configs/pro-merge-config.yaml';

function digest(bytes: Uint8Array) {
  return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** All inputs come from the same clean CI checkout as convert-plugins --required-config. */
export async function verifyKeleeModules(reportPath: string, configPath = defaultConfig, root = process.cwd()) {
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8')) as ConversionReport;
  const { config } = await loadMergeConfig(path.resolve(root, configPath));
  const required = selectModuleSources(config.modules, {});
  assert.ok(report.schemaVersion === 1 && report.required && Array.isArray(report.results), 'Missing conversion results or merge dry-run evidence');
  assert.equal(path.resolve(root, report.required.config), path.resolve(root, configPath));
  assert.ok(required.length > 0 && report.required.ready === required.length, 'Incomplete required module selection');

  const cacheDir = path.join(root, '.cache');
  const provenance = JSON.parse(await fs.readFile(path.join(cacheDir, 'plugin-provenance.json'), 'utf8')) as {
    version: number; scripts: Record<string, string>;
  };
  assert.equal(provenance.version, 1);
  const scriptDigests = new Map<string, string>();
  for (const [url, sha256] of Object.entries(provenance.scripts)) {
    const [script] = extractScriptUrls(`script-path=${url}`);
    const name = getMirrorFilename(script);
    assert.ok(!scriptDigests.has(name) || scriptDigests.get(name) === sha256, `Conflicting script provenance for ${name}`);
    scriptDigests.set(name, sha256);
  }

  const inputs = await fs.readdir(path.join(cacheDir, 'plugins'));
  const modules = [];
  for (const source of required) {
    const file = path.basename(source.url);
    assert.equal(source.url, `file://public/Modules/Converted/${file}`, `Expected local converted module ${source.id}`);
    const matching: ReportEntry[] = report.results.filter(entry => entry.file === file);
    assert.ok(matching.length && matching.every(entry => entry.status === 'ready'), `Required module not ready: ${file}`);
    const sources = [];
    for (const { sourceId } of matching) {
      const names = inputs.filter(name => name === `${sourceId}.lpx` || name === `${sourceId}.plugin`);
      assert.equal(names.length, 1, `Missing or ambiguous source body for ${file}`);
      const original = await fs.readFile(path.join(cacheDir, 'plugins', names[0]));
      assert.ok(original.length, `Empty source for ${file}`);
      sources.push({ sourceId, ...digest(original) });
    }
    const content = await fs.readFile(path.join(root, 'public/Modules/Converted', file));
    assert.ok(content.toString().trim(), `Empty module: ${file}`);
    const scripts = [];
    for (const script of extractScriptUrls(content.toString().split('\n').filter(line => !/^\s*[#;]/.test(line)).join('\n'))) {
      assert.ok(script.isMirrored, `Unmirrored script in ${file}`);
      const filename = getMirrorFilename(script);
      const bytes = await fs.readFile(path.join(root, 'public/Scripts', filename));
      const actual = digest(bytes);
      assert.ok(validateScriptContent(bytes), `Invalid script: ${filename}`);
      assert.equal(actual.sha256, scriptDigests.get(filename), `Script digest mismatch: ${filename}`);
      scripts.push({ filename, ...actual });
    }
    modules.push({ id: source.id, file, sources, ...digest(content), scripts });
  }
  return modules;
}

if (require.main === module) {
  const report = process.env.PLUGIN_CONVERSION_REPORT;
  assert.ok(report, 'PLUGIN_CONVERSION_REPORT is required');
  verifyKeleeModules(report).then(modules => console.log(JSON.stringify(modules))).catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
