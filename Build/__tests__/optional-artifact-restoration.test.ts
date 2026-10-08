import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { restorePreviousOptionalArtifacts } from '../restore-optional-artifacts';

function fixture() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'mirrrule-optional-'),
  );
  const current = path.join(directory, 'current');
  const previous = path.join(directory, 'previous');
  const required = path.join(
    current,
    'Modules',
    'Converted',
    'required.sgmodule',
  );
  const config = path.join(directory, 'config.json');
  fs.mkdirSync(path.dirname(required), { recursive: true });
  fs.mkdirSync(path.join(previous, 'Modules', 'Converted'), {
    recursive: true,
  });
  fs.mkdirSync(path.join(previous, 'Scripts'), { recursive: true });
  fs.writeFileSync(
    config,
    JSON.stringify({
      name: 'Test',
      version: '1',
      description: 'Test',
      category: 'Test',
      author: 'Test',
      modules: [{ url: required, header: 'Required' }],
      output: {
        sgmodule: './merged.sgmodule',
        rulelist: './merged.list',
        template: './template.txt',
      },
    }),
  );
  return { directory, current, previous, required, config };
}

test('optional restoration never substitutes a missing required current input', async (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.directory, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(data.previous, 'Modules', 'Converted', 'required.sgmodule'),
    '[Rule]\nDOMAIN,old.test,REJECT',
  );
  fs.writeFileSync(
    path.join(data.previous, 'Scripts', 'old.js'),
    'const old = true;',
  );
  await assert.rejects(
    restorePreviousOptionalArtifacts(data.config, data.previous, data.current),
    /Required current output is missing/,
  );
  assert.equal(fs.existsSync(data.required), false);
  assert.equal(
    fs.existsSync(path.join(data.current, 'Scripts', 'old.js')),
    false,
  );
});

test('optional restoration preserves missing subscriptions and scripts without overwriting fresh outputs', async (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.directory, { recursive: true, force: true }));
  const fresh = '[Rule]\nDOMAIN,fresh.test,REJECT';
  fs.writeFileSync(data.required, fresh);
  fs.writeFileSync(
    path.join(data.previous, 'Modules', 'Converted', 'required.sgmodule'),
    '[Rule]\nDOMAIN,old.test,REJECT',
  );
  const optional =
    '#!name=Optional\n[Script]\nrun=type=http-response, script-path=https://nrrule.pages.dev/Scripts/old.js';
  fs.writeFileSync(
    path.join(data.previous, 'Modules', 'Converted', 'optional.sgmodule'),
    optional,
  );
  fs.writeFileSync(
    path.join(data.previous, 'Scripts', 'old.js'),
    'const old = true;',
  );
  const result = await restorePreviousOptionalArtifacts(
    data.config,
    data.previous,
    data.current,
  );
  assert.deepEqual(result, { modules: 1, scripts: 1 });
  assert.equal(fs.readFileSync(data.required, 'utf8'), fresh);
  assert.equal(
    fs.readFileSync(
      path.join(data.current, 'Modules', 'Converted', 'optional.sgmodule'),
      'utf8',
    ),
    optional,
  );
  assert.deepEqual(
    await restorePreviousOptionalArtifacts(
      data.config,
      data.previous,
      data.current,
    ),
    { modules: 0, scripts: 0 },
  );
});

test('optional restoration skips broken previous artifacts without publishing them', async (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.directory, { recursive: true, force: true }));
  fs.writeFileSync(data.required, '[Rule]\nDOMAIN,fresh.test,REJECT');
  fs.writeFileSync(
    path.join(data.previous, 'Modules', 'Converted', 'optional.sgmodule'),
    '[Script]\nrun=type=http-response, script-path=https://nrrule.pages.dev/Scripts/missing.js',
  );
  assert.deepEqual(
    await restorePreviousOptionalArtifacts(
      data.config,
      data.previous,
      data.current,
    ),
    { modules: 0, scripts: 0 },
  );
  assert.equal(
    fs.existsSync(
      path.join(data.current, 'Modules', 'Converted', 'optional.sgmodule'),
    ),
    false,
  );
  fs.writeFileSync(
    path.join(data.previous, 'Scripts', 'missing.js'),
    '<html>challenge</html>',
  );
  assert.deepEqual(
    await restorePreviousOptionalArtifacts(
      data.config,
      data.previous,
      data.current,
    ),
    { modules: 0, scripts: 0 },
  );
  assert.equal(
    fs.existsSync(path.join(data.current, 'Scripts', 'missing.js')),
    false,
  );
});

test('optional restoration skips malformed script URLs and keeps restoring healthy modules', async (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.directory, { recursive: true, force: true }));
  const fresh = '[Rule]\nDOMAIN,fresh.test,REJECT';
  fs.writeFileSync(data.required, fresh);
  const oldRoot = path.join(data.previous, 'Modules', 'Converted');
  fs.writeFileSync(path.join(oldRoot, 'malformed.sgmodule'),
    '[Script]\nrun=type=http-response, script-path=https://nrrule.pages.dev/Scripts/%ZZ.js');
  const healthy = '[Rule]\nDOMAIN,healthy.test,REJECT';
  fs.writeFileSync(path.join(oldRoot, 'healthy.sgmodule'), healthy);

  assert.deepEqual(await restorePreviousOptionalArtifacts(data.config, data.previous, data.current),
    { modules: 1, scripts: 0 });
  const currentRoot = path.join(data.current, 'Modules', 'Converted');
  assert.equal(fs.existsSync(path.join(currentRoot, 'malformed.sgmodule')), false);
  assert.equal(fs.readFileSync(path.join(currentRoot, 'healthy.sgmodule'), 'utf8'), healthy);
  assert.equal(fs.readFileSync(data.required, 'utf8'), fresh);
});

test('optional restoration does not revive retired Tencent subscriptions', async (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.directory, { recursive: true, force: true }));
  fs.writeFileSync(data.required, '[Rule]\nDOMAIN,fresh.test,REJECT');
  const names = ['腾讯视频去广告.sgmodule', 'Tencent_Video_remove_ads.sgmodule'];
  const previous = path.join(data.previous, 'Modules', 'Converted');
  for (const name of names) {
    fs.writeFileSync(path.join(previous, name), '[Rule]\nDOMAIN,retired.test,REJECT');
  }
  fs.writeFileSync(path.join(previous, '哈罗去广告.sgmodule'), '[Rule]\nDOMAIN,optional.test,REJECT');
  assert.deepEqual(await restorePreviousOptionalArtifacts(data.config, data.previous, data.current),
    { modules: 1, scripts: 0 });
  const current = path.join(data.current, 'Modules', 'Converted');
  for (const name of names) assert.equal(fs.existsSync(path.join(current, name)), false);
  assert.equal(fs.existsSync(path.join(current, '哈罗去广告.sgmodule')), true);
});
