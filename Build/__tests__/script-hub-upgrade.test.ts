/* eslint-disable no-template-curly-in-string, no-await-in-loop -- Sequential fixture assertions use literal Loon templates. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import vm from 'node:vm';
import { patchScriptHubParser } from '../patch-script-hub';

// Script-Hub-Org/Script-Hub 1ab8fd775a9028b70ede9009d0540818edd5882c, GPL-3.0.
const upstream = fs.readFileSync(path.join(process.cwd(), 'Build/__tests__/fixtures/script-hub-upstream-1ab8fd7.txt'), 'utf8');

test('production patch accepts the actual latest pinned parser and preserves valid JavaScript', () => {
  assert.equal(createHash('sha256').update(upstream).digest('hex'), '2373438b02588d0a3534cd4739b35f68e4bfb12adf55d753c270ab68cdf12bc2');
  const patched = patchScriptHubParser(upstream);
  assert.doesNotThrow(() => new vm.Script(patched));
});

interface NormalizeResult { handled?: boolean; unsupported?: boolean; reason?: string }
interface BodyRewrite { type: string; regex: string; value: string }
interface HeaderRewrite { x: string }
interface UrlRewrite { rwvalue: string; rwtype: string; rwptn: string }
interface FixtureApi {
  run(action: string, target?: string, phase?: string): Promise<NormalizeResult | null>;
  line(source: string): Promise<NormalizeResult | null>;
  reset(): void;
  state(): { map: string[]; body: BodyRewrite[]; header: HeaderRewrite[]; url: UrlRewrite[] };
  setHttpResult(result: { status: number; body: string } | Error): void;
  requests(): string[];
}

function fixture(patch = true): FixtureApi {
  const source = patch ? patchScriptHubParser(upstream) : upstream;
  const helpers = source.slice(source.indexOf('function splitLoonV2TopLevel('), source.indexOf('function splitTopLevel('));
  const context = vm.createContext({ URL }, { codeGeneration: { strings: false, wasm: false } }) as vm.Context & { api: FixtureApi };
  vm.runInContext(`
let MapLocal = [], rwbodyBox = [], rwhdBox = [], rwBox = [];
const body = {}, reqHeaders = {};
let httpResult = { status: 200, body: 'fixture text' }, requests = [];
async function http(url) { requests.push(url); if (httpResult instanceof Error) throw httpResult; return httpResult }
${helpers}
globalThis.api = {
  run(action, target = 'surge-module', phase = 'response') {
    return normalizeLoonV2RewriteLine(phase + ' if \${url} == "https://example.test/mock" then ' + action, target, 0, '')
  },
  line(source) { return normalizeLoonV2RewriteLine(source, 'surge-module', 0, '') },
  reset() { MapLocal = []; rwbodyBox = []; rwhdBox = []; rwBox = []; requests = [] },
  state() { return JSON.parse(JSON.stringify({map: MapLocal, body: rwbodyBox, header: rwhdBox, url: rwBox})) },
  setHttpResult(result) { httpResult = result },
  requests() { return requests.slice() }
};`, context, { timeout: 1000 });
  return context.api;
}

function quoted(value: string): string {
  return '"' + value.replaceAll('\\', '\\\\').replaceAll('"', String.raw`\"`).replaceAll('\n', String.raw`\n`) + '"';
}

const prefix = String.raw`^https://example\.test/mock$`;

test('latest native response mock emits equivalent text/base64, MIME, and status', async () => {
  const api = fixture();
  const mimeTypes: Record<string, string> = {
    json: 'application/json', text: 'text/plain', plain: 'text/plain', css: 'text/css', html: 'text/html',
    javascript: 'text/javascript', png: 'image/png', gif: 'image/gif', jpeg: 'image/jpeg', tiff: 'image/tiff',
    svg: 'image/svg+xml', mp4: 'video/mp4', 'form-data': 'application/x-www-form-urlencoded',
  };
  for (const [kind, mime] of Object.entries(mimeTypes)) {
    api.reset();
    assert.equal((await api.run(`response.body.mock("${kind}", "hello", 201)`))?.handled, true);
    assert.deepEqual(Array.from(api.state().map), [`${prefix} data-type=text data="hello" status-code=201 header="Content-Type:${mime}"`]);
  }
  api.reset();
  assert.equal((await api.run('response.body.mock("png", "aGVsbG8=", 206, true)'))?.handled, true);
  assert.match(api.state().map[0], /data-type=base64 data="aGVsbG8=" status-code=206/);
  api.reset();
  const payload = '{"a":"(b),c","template":"${literal}"}';
  assert.equal((await api.run('response.body.mock("json", `' + payload + '`)'))?.handled, true);
  assert.ok(api.state().map[0].includes('data=' + quoted(payload)));
});

test('publication keeps invalid, mixed, request, and dynamic mock actions unsupported', async () => {
  const api = fixture();
  for (const action of [
    'response.body.mock("xml", "body")', 'response.body.mock(1, "body")', 'response.body.mock("text", 1)',
    'response.body.mock("text")', 'response.body.mock("text", "body", 199)', 'response.body.mock("text", "body", 600)',
    'response.body.mock("text", "body", 200.5)', 'response.body.mock("text", "body", 200, "true")',
    'response.body.mock("text", "body", 200, true, 1)', 'response.body.mock(${kind}, "body")',
    'response.body.mock("text", ${body})', 'response.body.mock("text", "body", ${status})',
    'response.body.mock("text", "body") | response.header.set("X-Test", "1")',
    'response.json.replace("ok", true) | response.body.mock("text", "body")',
    'response.body.mock("text", "one") | response.body.mock("text", "two")',
    'request.body.mock("text", "body")',
  ]) {
    api.reset();
    assert.equal((await api.run(action))?.unsupported, true, action);
    assert.equal(api.state().map.length, 0, action);
    assert.equal(api.state().body.length, 0, action);
  }
  assert.equal((await api.run('response.body.mock("text", "body")', 'shadowrocket-module'))?.unsupported, true);
  assert.equal((await api.run('request.body.mock("text", "body")', 'surge-module', 'request'))?.unsupported, true);
});

test('verified mock_file text is inlined and the gateway keeps the fetched payload unchanged', async () => {
  const api = fixture();
  const payload = '// comment\nconst sample = "hello";\n';
  for (const url of ['https://kelee.one/mock.txt', 'http://127.0.0.1:13193/asset/source']) {
    api.reset(); api.setHttpResult({ status: 200, body: payload });
    assert.equal((await api.run(`response.body.mock_file("javascript", "${url}", 201)`))?.handled, true);
    assert.deepEqual(Array.from(api.requests()), [url]);
    assert.deepEqual(Array.from(api.state().map), [`${prefix} data-type=text data=${quoted(payload)} status-code=201 header="Content-Type:text/javascript"`]);
  }
});

test('mock_file rejects missing/challenge/empty bodies and unverified URL or binary input', async () => {
  const api = fixture();
  for (const response of [{ status: 404, body: 'missing' }, { status: 200, body: ' ' }, { status: 200, body: '<html>challenge</html>' }, { status: 200, body: '<!doctype html>' }]) {
    api.reset(); api.setHttpResult(response);
    assert.equal((await api.run('response.body.mock_file("text", "https://kelee.one/mock.txt")'))?.unsupported, true);
    assert.equal(api.state().map.length, 0);
  }
  for (const action of [
    'response.body.mock_file("text", "body.txt")', 'response.body.mock_file("text", "http://example.test/mock.txt")',
    'response.body.mock_file("text", "https://user:password@example.test/mock.txt")',
    'response.body.mock_file("text", "http://127.0.0.1:9101/mock.txt")',
    'response.body.mock_file("png", "https://example.test/mock.png")',
    'response.body.mock_file("text", "https://example.test/mock.txt", 200, true)',
  ]) {
    api.reset(); assert.equal((await api.run(action))?.unsupported, true, action);
    assert.equal(api.state().map.length, 0); assert.equal(api.requests().length, 0);
  }
});

test('latest native body/header replace retains real corpus literal regex and replacement semantics', async () => {
  const api = fixture();
  const cases = [
    [String.raw`response.body.replace(/name="group_enable_watermark"\x20value="true"/, "name=\"group_enable_watermark\" value=\"false\"")`, String.raw`name="group_enable_watermark"\x20value="true"`, 'name="group_enable_watermark" value="false"'],
    [String.raw`response.body.replace(/([/(),]+)\d{1,3}/ims, "<$1>")`, String.raw`(?ims)([/(),]+)\d{1,3}`, '<$1>'],
    ['response.body.replace("old", "new")', 'old', 'new'],
  ];
  for (const [action, regex, replacement] of cases) {
    api.reset(); assert.equal((await api.run(action))?.handled, true, action);
    assert.equal(api.state().body[0].value, quoted(regex) + ' ' + quoted(replacement));
  }
  api.reset();
  assert.equal((await api.run('response.header.replace("X-Path", /[/(),]+/, "$1")'))?.handled, true);
  assert.ok(api.state().header[0].x.includes('header-replace-regex "X-Path" "[/(),]+" "$1"'));
});

test('unpatched latest parser fails the slash-in-character-class regression', async () => {
  const action = 'response.body.replace(/[/(),]+/, "new")';
  assert.equal((await fixture(false).run(action))?.unsupported, true);
  assert.equal((await fixture().run(action))?.handled, true);
});

test('regex lists, action separators, and flags preserve semantics or reject unsupported input', async () => {
  const api = fixture();
  assert.equal((await api.run('response.body.replace([/[/),]+/, /foo/], ["a", "b"]) | response.header.add("X", "1")'))?.handled, true);
  assert.equal(api.state().body.length, 2); assert.equal(api.state().header.length, 1);
  for (const action of ['response.body.replace(/foo/g, "bar")', 'response.body.replace(/foo/ii, "bar")', 'response.body.replace(${regex}, "bar")', 'response.header.replace("X", /foo/, 2)']) {
    api.reset(); assert.equal((await api.run(action))?.unsupported, true, action);
  }
});

test('capture-bound redirects preserve named groups, slash classes, and argument templates', async () => {
  const api = fixture();
  const line = 'request if ${url} ~= ' + String.raw`/^https:\/\/example.test\/([/a-z]+)\/([0-9]+)$/` + ' as captures then redirect(302, "https://new.test/${captures.1}/${captures.2}?q=${token}")';
  assert.equal((await api.line(line))?.handled, true);
  assert.equal(api.state().url[0].rwvalue, 'https://new.test/$1/$2?q={{{token}}}');
  assert.equal(api.state().url[0].rwtype, '302');
});

test('capture replacement rejects non-equivalent bindings before output', async () => {
  const api = fixture();
  for (const replacement of ['${other.1}', '${captures.2}', '${captures}', '$1', '${captures.name}']) {
    api.reset();
    const line = 'request if ${url} ~= /(foo)/ as captures then url.replace(' + JSON.stringify(replacement) + ')';
    assert.equal((await api.line(line))?.unsupported, true, replacement);
    assert.equal(api.state().url.length, 0);
  }
  assert.equal((await api.line('response if ${url} ~= /(foo)/ as captures then url.replace("${captures.1}")'))?.unsupported, true);
});

test('patch rejects missing, duplicated, reordered and already-patched parser anchors', () => {
  assert.throws(() => patchScriptHubParser('function unknown() {}'), /Unsupported Script-Hub parser/);
  assert.throws(() => patchScriptHubParser(upstream + upstream), /Unsupported Script-Hub parser/);
  assert.throws(() => patchScriptHubParser(patchScriptHubParser(upstream)), /Unsupported Script-Hub parser/);
  assert.throws(() => patchScriptHubParser(upstream.replace('function parseLoonV2RegexList(', 'function renamedRegexList(')), /Unsupported Script-Hub parser/);
});

test('latest native template wrapping avoids repeated braces and unsupported diagnostics remain visible', () => {
  const patched = patchScriptHubParser(upstream);
  const wrapping = patched.slice(patched.indexOf(String.raw`  body = body.replace(/\n{2,}/g`), patched.indexOf('  eval(evJsmodi)'));
  const diagnostics = patched.slice(patched.indexOf('  shNotify(otherRule)'), patched.indexOf('  shNotify(loonV2WarningText)'));
  const context = vm.createContext({}) as vm.Context & { output: string };
  vm.runInContext(`
let body = '{{{toggle}}} and {{{token}}}';
const isSurgeiOS = true, isShadowrocket = false, isStashiOS = false, isLooniOS = false;
const sgArg = [{ key: 'toggle' }];
function escapeRegExp(value) { return value }
${wrapping}
const otherRule = 'unsupported [Loon v2: unknown]';
function shNotify() {}
${diagnostics}
globalThis.output = body;
`, context, { timeout: 1000 });
  assert.equal(context.output, '{{{toggle}}} and {{{token}}}\n# [Loon v2: unsupported conversion]\n');
});

test('CLI patches the pinned source and never publishes a partial output on unsupported source', async t => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'mirrrule-script-hub-upgrade-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'parser.js');
  const output = path.join(directory, 'patched.js');
  const cli = (destination: string) => spawnSync(process.execPath,
    ['-r', '@swc-node/register', path.join(process.cwd(), 'Build/patch-script-hub.ts'), input, destination],
    { encoding: 'utf8' });
  await fsp.writeFile(input, upstream);
  const success = cli(output);
  assert.equal(success.status, 0, success.stderr);
  assert.equal(await fsp.readFile(output, 'utf8'), patchScriptHubParser(upstream));
  await fsp.writeFile(input, upstream.replace('function parseLoonV2RegexList(', 'function unknown('));
  const existing = await fsp.readFile(output, 'utf8');
  assert.equal(cli(output).status, 1);
  assert.equal(await fsp.readFile(output, 'utf8'), existing);
  const missing = path.join(directory, 'missing.js');
  const failure = cli(missing);
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /Unsupported Script-Hub parser/);
  assert.equal(fs.existsSync(missing), false);
});

test('native header.replace rejects obsolete two-argument form and dynamic/unsupported regex input', async () => {
  const api = fixture();
  for (const action of [
    'response.header.replace("X-Test", "new")',
    'request.header.replace(${name}, /old/, "new")',
    'request.header.replace("X-Test", ${pattern}, "new")',
    'request.header.replace("X-Test", /old/g, "new")',
    'request.header.replace("X-Test", /old/, ${replacement})',
    'response.body.replace(/old/i, ${replacement})',
  ]) {
    api.reset(); assert.equal((await api.run(action))?.unsupported, true, action);
    assert.equal(api.state().header.length, 0); assert.equal(api.state().body.length, 0);
  }
});

test('capture counting preserves capture zero, named groups, lookarounds and noncapturing groups', async () => {
  const api = fixture();
  assert.equal((await api.line('request if ${url} ~= /(?:prefix)(a)(?<named>b)(?=c)[()]/ as item then redirect(302, "${item.0}-${item.2}")'))?.handled, true);
  assert.equal(api.state().url[0].rwvalue, '$0-$2');
  api.reset();
  assert.equal((await api.line('request if ${url} ~= /(?:prefix)(a)(?<named>b)(?=c)[()]/ as item then redirect(302, "${item.3}")'))?.unsupported, true);
  assert.equal(api.state().url.length, 0);
});

test('capture binding preserves all non-equivalent phase/action/index/dynamic rejection boundaries', async () => {
  const api = fixture();
  for (const line of [
    'response if ${url} ~= /(a)/ as item then redirect(302, "${item.1}")',
    'request if ${url} ~= /(a)/ as item then reject(404)',
    'request if ${url} ~= /(a)/ as item then redirect(302, "${item.1}") | url.replace("x")',
    'request if ${url} ~= /(a)/ as 1item then redirect(302, "x")',
    'request if ${url} ~= /(a)/ as item then redirect(302, "${item.01}")',
    'request if ${url} ~= /(a)/ as item then redirect(302, `${item.1}`)',
    'request if ${url} ~= /(a)/ && ${request.method} == "GET" as item then redirect(302, "${item.1}")',
    'request if ${url} == "https://example.test" as item then redirect(302, "${item.0}")',
  ]) {
    api.reset(); assert.equal((await api.line(line))?.unsupported, true, line);
    assert.equal(api.state().url.length, 0);
  }
});

test('unbound URL redirects keep native output unchanged', async () => {
  const line = 'request if ${url} ~= /^http:/ then redirect(302, "https:")';
  const original = fixture(false); const patched = fixture();
  assert.equal((await original.line(line))?.handled, true);
  assert.equal((await patched.line(line))?.handled, true);
  assert.equal(JSON.stringify(original.state()), JSON.stringify(patched.state()));
});
