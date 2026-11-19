import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import { verifyKeleeModules } from '../check-kelee-modules';
import { extractScriptUrls } from '../integration/plugin-converter/script-extractor';
import { getMirrorFilename } from '../integration/plugin-converter/script-mirror';

it('binds a required module to its downloaded input and rejects a changed script', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kelee-artifacts-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const dir of ['public/Modules/Converted', 'public/Scripts', '.cache/plugins']) {
    await fs.mkdir(path.join(root, dir), { recursive: true });
  }
  const sourceId = 'a'.repeat(64);
  const url = 'https://example.org/demo.js';
  const name = getMirrorFilename(extractScriptUrls(`script-path=${url}`)[0]);
  const body = 'console.log("test");';
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  const write = (file: string, text: string) => fs.writeFile(path.join(root, file), text);
  const config = 'test.yaml';
  await write(config, JSON.stringify({
    name: 'test', output: { sgmodule: 'out.sgmodule', template: 'out.template' },
    modules: [{ id: 'demo', header: 'Demo', url: 'file://public/Modules/Converted/Demo.sgmodule' }],
  }));
  await write('report.json', JSON.stringify({
    schemaVersion: 1, required: { config, ready: 1 },
    results: [{ sourceId, file: 'Demo.sgmodule', status: 'ready' }],
  }));
  await write('.cache/plugin-provenance.json', JSON.stringify({ version: 1, scripts: { [url]: hash(body) } }));
  await write('public/Modules/Converted/Demo.sgmodule', `[Script]\ndemo=type=http-response,script-path=https://nrrule.pages.dev/Scripts/${name}`);
  await write(`public/Scripts/${name}`, body);
  const check = () => verifyKeleeModules(path.join(root, 'report.json'), config, root);
  await assert.rejects(check(), /source body/);
  await write(`.cache/plugins/${sourceId}.lpx`, 'test input');
  const [module] = await check();
  assert.equal(module.sources[0].sha256, hash('test input'));
  assert.equal(module.scripts[0].sha256, hash(body));
  await write(`public/Scripts/${name}`, 'console.log("changed");');
  await assert.rejects(check(), /Script digest mismatch/);
});
