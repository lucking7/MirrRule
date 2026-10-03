/* eslint-disable no-template-curly-in-string -- These fixtures exercise literal Loon variables. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import vm from 'node:vm';
import { patchScriptHubParser } from '../patch-script-hub';

interface NormalizeResult {
  handled?: boolean;
  unsupported?: boolean;
  reason?: string;
}

interface FixtureApi {
  normalizeLoonV2RewriteLine(action: string, targetApp?: string, phase?: string): Promise<NormalizeResult | null>;
  reset(): void;
  getMapLocal(): string[];
  getRwbodyBox(): unknown[];
  finish(body: string, diagnostics: string, parameters: Array<{ key: string }>, keys: string[]): string;
}

const fixturePath = path.join(process.cwd(), 'Build', '__tests__', 'fixtures', 'script-hub-loon-v2-handler.js');
const fixtureSource = fs.readFileSync(fixturePath, 'utf8');
const bodyMatchAnchor = String.raw`    const bodyMatch = name.match(/^(request|response)\.body\.(replace|mock)$/)`;

function evaluateFixture(source: string): FixtureApi {
  const context = vm.createContext({}) as vm.Context & { fixtureApi?: FixtureApi };
  vm.runInContext(source, context, { filename: fixturePath });
  assert.ok(context.fixtureApi);
  return context.fixtureApi;
}

function patchedFixture(): FixtureApi {
  return evaluateFixture(patchScriptHubParser(fixtureSource));
}

function quoteSurgeField(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', String.raw`\"`).replaceAll(/\r?\n/g, String.raw`\n`)}"`;
}

function expectedMapLocal(dataType: 'text' | 'base64', data: string, status: number, mimeType: string): string {
  return [
    String.raw`^https://example\.test/mock$`,
    `data-type=${dataType}`,
    `data=${quoteSurgeField(data)}`,
    `status-code=${status}`,
    `header=${quoteSurgeField(`Content-Type:${mimeType}`)}`,
  ].join(' ');
}

test('response.body.mock supports two arguments with default status and text data', async () => {
  const api = patchedFixture();
  const data = '{"ok":true}';
  const result = await api.normalizeLoonV2RewriteLine(`response.body.mock("json", ${JSON.stringify(data)})`);

  assert.equal(result?.handled, true);
  assert.deepEqual(Array.from(api.getMapLocal()), [expectedMapLocal('text', data, 200, 'application/json')]);
});

test('response.body.mock supports an explicit valid status', async () => {
  const api = patchedFixture();
  const result = await api.normalizeLoonV2RewriteLine('response.body.mock("plain", "created", 201)');

  assert.equal(result?.handled, true);
  assert.deepEqual(Array.from(api.getMapLocal()), [expectedMapLocal('text', 'created', 201, 'text/plain')]);
});

test('response.body.mock emits base64 Map Local data for the fourth true argument', async () => {
  const api = patchedFixture();
  const data = 'iVBORw0KGgo=';
  const result = await api.normalizeLoonV2RewriteLine(`response.body.mock("png", "${data}", 206, true)`);

  assert.equal(result?.handled, true);
  assert.deepEqual(Array.from(api.getMapLocal()), [expectedMapLocal('base64', data, 206, 'image/png')]);
});

test('response.body.mock false Base64 flag keeps text Map Local data', async () => {
  const api = patchedFixture();
  const result = await api.normalizeLoonV2RewriteLine('response.body.mock("text", "body", 204, false)');

  assert.equal(result?.handled, true);
  assert.deepEqual(Array.from(api.getMapLocal()), [expectedMapLocal('text', 'body', 204, 'text/plain')]);
});

test('response.body.mock maps every supported Loon content type to the existing Script-Hub MIME', async () => {
  const mimeTypes: Record<string, string> = {
    json: 'application/json',
    text: 'text/plain',
    css: 'text/css',
    html: 'text/html',
    javascript: 'text/javascript',
    plain: 'text/plain',
    png: 'image/png',
    gif: 'image/gif',
    jpeg: 'image/jpeg',
    tiff: 'image/tiff',
    svg: 'image/svg+xml',
    mp4: 'video/mp4',
    'form-data': 'application/x-www-form-urlencoded',
  };
  const api = patchedFixture();

  for (const [contentType, mimeType] of Object.entries(mimeTypes)) {
    api.reset();
    const result = await api.normalizeLoonV2RewriteLine(`response.body.mock("${contentType}", "body")`);
    assert.equal(result?.handled, true, contentType);
    assert.deepEqual(
      Array.from(api.getMapLocal()),
      [expectedMapLocal('text', 'body', 200, mimeType)],
      contentType
    );
  }
});

test('official raw-string parsing preserves commas, parentheses, templates, and quotes', async () => {
  const api = patchedFixture();
  const data = '{"message":"a,b","group":"(x)","template":"${literal}"}';
  const result = await api.normalizeLoonV2RewriteLine(
    'response.body.mock("json", `{"message":"a,b","group":"(x)","template":"${literal}"}`)'
  );

  assert.equal(result?.handled, true);
  assert.deepEqual(Array.from(api.getMapLocal()), [expectedMapLocal('text', data, 200, 'application/json')]);
});

test('dynamic variables in mock arguments stay unsupported instead of being guessed', async () => {
  const actions = [
    'response.body.mock(${kind}, "body")',
    'response.body.mock("text", ${body})',
    'response.body.mock("text", "body", ${status})',
    'response.body.mock("text", "body", 200, ${base64})',
  ];
  const api = patchedFixture();

  for (const action of actions) {
    api.reset();
    const result = await api.normalizeLoonV2RewriteLine(action);
    assert.equal(result?.unsupported, true, action);
    assert.equal(api.getMapLocal().length, 0, action);
  }
});

test('mock MIME whitelist rejects inherited strings in the parser realm', async () => {
  const api = evaluateFixture('Object.prototype.xml = "text/xml";\n' + patchScriptHubParser(fixtureSource));
  const result = await api.normalizeLoonV2RewriteLine('response.body.mock("xml", "body")');

  assert.equal(result?.unsupported, true);
  assert.equal(api.getMapLocal().length, 0);
});

test('invalid type, body, status, Base64, and arity stay unsupported', async () => {
  const actions = [
    'response.body.mock("xml", "body")',
    'response.body.mock(1, "body")',
    'response.body.mock("text", 1)',
    'response.body.mock("text")',
    'response.body.mock("text", "body", 199)',
    'response.body.mock("text", "body", 600)',
    'response.body.mock("text", "body", 200.5)',
    'response.body.mock("text", "body", 200, "true")',
    'response.body.mock("text", "body", 200, true, "extra")',
  ];
  const api = patchedFixture();

  for (const action of actions) {
    api.reset();
    const result = await api.normalizeLoonV2RewriteLine(action);
    assert.equal(result?.unsupported, true, action);
    assert.equal(api.getMapLocal().length, 0, action);
  }
});

test('response.body.mock is limited to the response phase and surge-module target', async () => {
  const api = patchedFixture();
  const action = 'response.body.mock("text", "body")';

  assert.equal((await api.normalizeLoonV2RewriteLine(action, 'surge-module', 'request'))?.unsupported, true);
  api.reset();
  assert.equal((await api.normalizeLoonV2RewriteLine(action, 'shadowrocket-module'))?.unsupported, true);
  assert.equal(api.getMapLocal().length, 0);
});

test('mixed or repeated mock actions are rejected before any partial output', async () => {
  const actions = [
    'response.body.mock("text", "body") | response.header.set("X-Test", "1")',
    'response.json.replace("ok", true) | response.body.mock("text", "body")',
    'response.body.mock("text", "first") | response.body.mock("text", "second")',
  ];
  const api = patchedFixture();

  for (const action of actions) {
    api.reset();
    const result = await api.normalizeLoonV2RewriteLine(action);
    assert.equal(result?.unsupported, true, action);
    assert.equal(api.getMapLocal().length, 0, action);
    assert.equal(api.getRwbodyBox().length, 0, action);
  }
});

test('request mock and mock_file remain explicitly unsupported', async () => {
  const api = patchedFixture();

  assert.equal((await api.normalizeLoonV2RewriteLine('request.body.mock("text", "body")'))?.unsupported, true);
  api.reset();
  assert.equal(
    (await api.normalizeLoonV2RewriteLine('response.body.mock_file("text", "body.txt")'))?.unsupported,
    true
  );
  assert.equal(api.getMapLocal().length, 0);
});

test('body.replace retains the official handler behavior after patching', async () => {
  const action = 'response.body.replace("old", "new")';
  const original = evaluateFixture(fixtureSource);
  const patched = patchedFixture();

  const originalResult = await original.normalizeLoonV2RewriteLine(action);
  const patchedResult = await patched.normalizeLoonV2RewriteLine(action);

  assert.equal(originalResult?.handled, true);
  assert.equal(patchedResult?.handled, true);
  assert.equal(JSON.stringify(patched.getRwbodyBox()), JSON.stringify(original.getRwbodyBox()));
  assert.equal(patched.getMapLocal().length, 0);
});

test('patch rejects repeated, missing, and already-patched anchors', () => {
  assert.throws(() => patchScriptHubParser('function unknown() {}'), /found 0/);
  assert.throws(() => patchScriptHubParser(`${fixtureSource}\n${bodyMatchAnchor}`), /found 2/);

  const patched = patchScriptHubParser(fixtureSource);
  assert.throws(() => patchScriptHubParser(patched), /found 0/);
});

test('CLI reads one parser source and writes the patched output', async t => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'mirrrule-script-hub-patch-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'Rewrite-Parser.beta.js');
  const output = path.join(directory, 'Rewrite-Parser.patched.js');
  await fsp.writeFile(input, fixtureSource);

  const result = spawnSync(
    process.execPath,
    ['-r', '@swc-node/register', path.join(process.cwd(), 'Build', 'patch-script-hub.ts'), input, output],
    { encoding: 'utf8' }
  );

  assert.equal(result.status, 0, result.stderr);
  const patched = await fsp.readFile(output, 'utf8');
  const api = evaluateFixture(patched);
  assert.equal((await api.normalizeLoonV2RewriteLine('response.body.mock("text", "cli")'))?.handled, true);
});

test('unsupported native actions remain visible to the conversion consumer', () => {
  const api = patchedFixture();
  assert.match(api.finish('#!name=Partial', 'surge不支持 [Loon v2: unknown]', [], []), /\[Loon v2: unsupported conversion]/);
  assert.equal(api.finish('#!name=Ready', '', [], []), '#!name=Ready');
});

test('known argument templates are not expanded a second time', () => {
  const api = patchedFixture();
  assert.equal(api.finish('{{{toggle}}} script', '', [{ key: 'toggle' }], ['toggle']), '{{{toggle}}} script');
  assert.equal(api.finish('{onlyNative} script', '', [], ['onlyNative']), '{{{onlyNative}}} script');
});
