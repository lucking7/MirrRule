import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  parseRestoreArgs,
  PRESERVED_ARTIFACTS_PATH,
  readPreservedArtifacts,
  restorePreviousOptionalArtifacts,
} from '../restore-optional-artifacts';

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

function script(name: string): string {
  return `[Script]\nrun=type=http-response, script-path=https://nrrule.pages.dev/Scripts/${name}`;
}

test('optional restoration skips scripts owned only by retired modules and keeps shared scripts', async (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.directory, { recursive: true, force: true }));
  fs.writeFileSync(data.required, '[Rule]\nDOMAIN,fresh.test,REJECT');
  const previous = path.join(data.previous, 'Modules', 'Converted');
  fs.writeFileSync(path.join(previous, '腾讯视频去广告.sgmodule'), `${script('tencent.js')}\n${script('shared.js')}`);
  fs.writeFileSync(path.join(previous, 'Tencent_Video_remove_ads.sgmodule'), script('tencent.js'));
  fs.writeFileSync(path.join(previous, '哈罗去广告.sgmodule'), script('shared.js'));
  fs.writeFileSync(path.join(data.previous, 'Scripts', 'tencent.js'), 'const tencent = true;');
  fs.writeFileSync(path.join(data.previous, 'Scripts', 'shared.js'), 'const shared = true;');
  assert.deepEqual(await restorePreviousOptionalArtifacts(data.config, data.previous, data.current),
    { modules: 1, scripts: 1 });
  assert.equal(fs.existsSync(path.join(data.current, 'Scripts', 'tencent.js')), false);
  assert.equal(fs.readFileSync(path.join(data.current, 'Scripts', 'shared.js'), 'utf8'), 'const shared = true;');
  assert.equal(fs.existsSync(path.join(data.current, 'Modules', 'Converted', '哈罗去广告.sgmodule')), true);
  for (const name of ['腾讯视频去广告.sgmodule', 'Tencent_Video_remove_ads.sgmodule']) {
    assert.equal(fs.existsSync(path.join(data.current, 'Modules', 'Converted', name)), false);
  }
});

function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

test('optional restoration records sorted per-file provenance and merges later runs by path', async (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.directory, { recursive: true, force: true }));
  fs.writeFileSync(data.required, '[Rule]\nDOMAIN,fresh.test,REJECT');
  assert.equal(await readPreservedArtifacts(data.current), null);
  const previous = path.join(data.previous, 'Modules', 'Converted');
  const optional = script('old.js');
  const nested = '[Rule]\nDOMAIN,nested.test,REJECT';
  fs.mkdirSync(path.join(previous, 'Nested'));
  fs.writeFileSync(path.join(previous, 'optional.sgmodule'), optional);
  fs.writeFileSync(path.join(previous, 'Nested', 'b.sgmodule'), nested);
  fs.writeFileSync(path.join(data.previous, 'Scripts', 'old.js'), 'const old = true;');
  const commit = 'a'.repeat(40);
  assert.deepEqual(await restorePreviousOptionalArtifacts(data.config, data.previous, data.current, { fromCommit: commit }),
    { modules: 2, scripts: 1 });
  const expected = [
    { path: 'Modules/Converted/Nested/b.sgmodule', sha256: digest(nested), bytes: Buffer.byteLength(nested) },
    { path: 'Modules/Converted/optional.sgmodule', sha256: digest(optional), bytes: Buffer.byteLength(optional) },
    { path: 'Scripts/old.js', sha256: digest('const old = true;'), bytes: 17 },
  ];
  assert.deepEqual(await readPreservedArtifacts(data.current), { schemaVersion: 1, fromCommit: commit, files: expected });
  assert.ok(fs.existsSync(path.join(data.current, ...PRESERVED_ARTIFACTS_PATH.split('/'))));

  fs.rmSync(path.join(data.current, 'Modules', 'Converted', 'optional.sgmodule'));
  const changed = `${optional}\n# changed`;
  fs.writeFileSync(path.join(previous, 'optional.sgmodule'), changed);
  fs.writeFileSync(path.join(previous, 'later.sgmodule'), nested);
  assert.deepEqual(await restorePreviousOptionalArtifacts(data.config, data.previous, data.current),
    { modules: 2, scripts: 0 });
  const merged = await readPreservedArtifacts(data.current);
  assert.ok(merged);
  assert.equal(merged.fromCommit, commit);
  assert.deepEqual(merged.files.map(entry => entry.path), [
    'Modules/Converted/Nested/b.sgmodule', 'Modules/Converted/later.sgmodule',
    'Modules/Converted/optional.sgmodule', 'Scripts/old.js',
  ]);
  assert.equal(merged.files.find(entry => entry.path === 'Modules/Converted/optional.sgmodule')?.sha256, digest(changed));

  await assert.rejects(
    restorePreviousOptionalArtifacts(data.config, data.previous, data.current, { fromCommit: 'b'.repeat(40) }),
    /refusing to mix/,
  );
  await assert.rejects(
    restorePreviousOptionalArtifacts(data.config, data.previous, data.current, { fromCommit: 'not-a-sha' }),
    /Invalid fromCommit/,
  );
});

test('optional restoration provenance excludes skipped retired modules and scripts', async (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.directory, { recursive: true, force: true }));
  fs.writeFileSync(data.required, '[Rule]\nDOMAIN,fresh.test,REJECT');
  const previous = path.join(data.previous, 'Modules', 'Converted');
  fs.writeFileSync(path.join(previous, '腾讯视频去广告.sgmodule'), script('tencent.js'));
  fs.writeFileSync(path.join(data.previous, 'Scripts', 'tencent.js'), 'const tencent = true;');
  assert.deepEqual(await restorePreviousOptionalArtifacts(data.config, data.previous, data.current),
    { modules: 0, scripts: 0 });
  assert.deepEqual(await readPreservedArtifacts(data.current), { schemaVersion: 1, fromCommit: null, files: [] });
});

test('preserved artifact reader rejects malformed provenance', async (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.directory, { recursive: true, force: true }));
  const file = path.join(data.current, ...PRESERVED_ARTIFACTS_PATH.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (const bad of [
    { schemaVersion: 2, fromCommit: null, files: [] },
    { schemaVersion: 1, fromCommit: 'zz', files: [] },
    { schemaVersion: 1, fromCommit: null, files: [{ path: '../x.js', sha256: 'a'.repeat(64), bytes: 1 }] },
    { schemaVersion: 1, fromCommit: null, files: [{ path: 'Scripts/x.js', sha256: 'short', bytes: 1 }] },
  ]) {
    fs.writeFileSync(file, JSON.stringify(bad));
    // eslint-disable-next-line no-await-in-loop -- each case rewrites the same file
    await assert.rejects(readPreservedArtifacts(data.current), /preserved artifact|Lifecycle path/i);
  }
});

test('restore CLI arguments keep positional usage and accept --from-commit anywhere', () => {
  assert.deepEqual(parseRestoreArgs(['config.yaml', 'previous']), { configPath: 'config.yaml', previousRoot: 'previous' });
  const sha = 'abc1234';
  for (const argv of [
    ['config.yaml', 'previous', '--from-commit', sha],
    ['--from-commit', sha, 'config.yaml', 'previous'],
    ['config.yaml', `--from-commit=${sha}`, 'previous'],
  ]) {
    assert.deepEqual(parseRestoreArgs(argv), { configPath: 'config.yaml', previousRoot: 'previous', fromCommit: sha });
  }
  assert.throws(() => parseRestoreArgs(['config.yaml']), /Usage/);
  assert.throws(() => parseRestoreArgs(['config.yaml', 'previous', 'extra']), /Usage/);
  assert.throws(() => parseRestoreArgs(['config.yaml', 'previous', '--from-commit']), /requires a commit/);
  assert.throws(() => parseRestoreArgs(['config.yaml', 'previous', '--from-commit', 'xyz']), /Invalid --from-commit/);
});
