/* eslint-disable no-await-in-loop, no-template-curly-in-string -- Sequential fixture assertions use literal Loon templates. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import vm from 'node:vm';
import { patchScriptHubCoreParser as patchScriptHubParser } from '../patch-script-hub';
import { patchScriptHubCaptureCompatibility } from '../script-hub-capture-compat';

interface NormalizeResult {
  handled?: boolean;
  unsupported?: boolean;
  reason?: string;
}

interface RewriteEntry {
  rwptn: string;
  rwvalue: string;
  rwtype: string;
}

interface FixtureApi {
  normalizeLoonV2RewriteLine(
    line: string,
    targetApp?: string,
  ): Promise<NormalizeResult | null>;
  reset(): void;
  getRwBox(): RewriteEntry[];
}

const baseFixturePath = path.join(
  process.cwd(),
  'Build',
  '__tests__',
  'fixtures',
  'script-hub-loon-v2-handler.js',
);

const CONDITION_HELPERS = String.raw`
function stripLoonV2OuterParentheses(value) {
  return String(value ?? '').trim()
}

function readLoonV2Regex(value) {
  const raw = String(value ?? '').trim()
  if (!raw.startsWith('/')) return { reason: 'URL 条件右值必须是正则字面量' }
  let escaped = false
  let closing = -1
  for (let i = 1; i < raw.length; i++) {
    const char = raw[i]
    if (char === '/' && !escaped) {
      closing = i
      break
    }
    if (escaped) escaped = false
    else if (char === '\\') escaped = true
  }
  if (closing === -1) return { reason: 'URL 正则缺少结束分隔符 /' }
  const pattern = raw.slice(1, closing)
  const flags = raw.slice(closing + 1).trim()
  if (/[&|]|\$\{/.test(flags)) return { reason: 'URL 条件包含额外逻辑条件' }
  if (!/^[ims]*$/.test(flags) || new Set(flags).size !== flags.length) {
    return { reason: '仅支持 Loon v2 的 i、m、s 正则标记' }
  }
  const modifiers = flags.split('').join('')
  return { pattern: modifiers ? '(?' + modifiers + ')' + pattern : pattern }
}

function parseLoonV2UrlCondition(condition) {
  const source = stripLoonV2OuterParentheses(condition)
  const regexMatched = source.match(/^\$\{\s*url\s*\}\s*~=\s*([\s\S]+)$/i)
  if (regexMatched) return readLoonV2Regex(regexMatched[1])
  const equalMatched = source.match(/^\$\{\s*url\s*\}\s*==\s*([\s\S]+)$/i)
  if (equalMatched) {
    const url = unwrapLoonV2String(equalMatched[1])
    if (url == null) return { reason: 'URL 等值条件右值必须是字符串' }
    const escaped = url.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&')
    return { pattern: '^' + escaped + '$' }
  }
  return { reason: '当前只转换单一 URL 条件' }
}
`;

const REDIRECT_HANDLER = [
  '    if (name === \'redirect\' || name === \'url.replace\') {',
  '      if (name === \'redirect\') {',
  '        if (args.length !== 2) return { unsupported: true, reason: \'redirect 需要 status 和 URL 两个参数\' }',
  '        const status = parseLoonV2Literal(args[0], \'redirect status\')',
  '        const target = parseLoonV2Literal(args[1], \'redirect URL\')',
  '        if (status.reason || target.reason) return { unsupported: true, reason: status.reason || target.reason }',
  '        if (![302, 307].includes(status.value) || typeof target.value !== \'string\') {',
  '          return { unsupported: true, reason: \'Surge 只支持 302/307 且 redirect URL 必须是字符串\' }',
  '        }',
  '        rwBox.push({ mark, noteK: \'\', rwptn: pattern, rwvalue: target.value, rwtype: `${status.value}` })',
  '      } else {',
  '        if (args.length !== 1) return { unsupported: true, reason: \'url.replace 需要 replacement 参数\' }',
  '        const target = parseLoonV2Literal(args[0], \'url.replace replacement\')',
  '        if (target.reason || typeof target.value !== \'string\') {',
  '          return { unsupported: true, reason: target.reason || \'url.replace replacement 必须是字符串\' }',
  '        }',
  '        rwBox.push({ mark, noteK: \'\', rwptn: pattern, rwvalue: target.value, rwtype: \'header\' })',
  '      }',
  '      continue',
  '    }',
  '',
].join('\n');

function makeCaptureFixture(): string {
  let source = fs.readFileSync(baseFixturePath, 'utf8');
  source = source.replace(
    'let rwbodyBox = []',
    () => 'let rwbodyBox = []\nlet rwBox = []',
  );
  source = source.replace(
    'async function normalizeLoonV2RewriteLine(actionSource, targetApp = \'surge-module\', phase = \'response\') {',
    () =>
      `${CONDITION_HELPERS}\nasync function normalizeLoonV2RewriteLine(line, targetApp = 'surge-module') {`,
  );
  source = source.replace(
    [
      String.raw`  const pattern = '^https://example\\.test/mock$'`,
      '  const mark = \'\'',
      '  const actions = splitLoonV2ActionList(actionSource)',
    ].join('\n'),
    () =>
      [
        String.raw`  const match = String(line ?? '').trim().match(/^(request|response)\s+if\s+([\s\S]+?)\s+then\s+([\s\S]+)$/i)`,
        '  if (!match) return null',
        '  const condition = parseLoonV2UrlCondition(match[2])',
        '  if (condition.reason) return { unsupported: true, reason: condition.reason }',
        '  const pattern = condition.pattern',
        '  const phase = match[1].toLowerCase()',
        '  const mark = \'\'',
        '  const actions = splitLoonV2ActionList(match[3])',
      ].join('\n'),
  );
  source = source.replace(
    '    return { unsupported: true, reason: `暂不支持 Loon v2 Action：${name}` }',
    () =>
      `${REDIRECT_HANDLER}    return { unsupported: true, reason: \`暂不支持 Loon v2 Action：\${name}\` }`,
  );
  source = source.replace(
    '    rwbodyBox = []',
    () => '    rwbodyBox = []\n    rwBox = []',
  );
  source = source.replace(
    '  getRwbodyBox() {\n    return rwbodyBox\n  },',
    () =>
      '  getRwbodyBox() {\n    return rwbodyBox\n  },\n  getRwBox() {\n    return rwBox\n  },',
  );
  return source;
}

function evaluateFixture(source: string): FixtureApi {
  const context = vm.createContext({}) as vm.Context & {
    fixtureApi?: FixtureApi;
  };
  vm.runInContext(source, context, { filename: baseFixturePath });
  assert.ok(context.fixtureApi);
  return context.fixtureApi;
}

function patchedFixture(): FixtureApi {
  const source = makeCaptureFixture();
  return evaluateFixture(
    patchScriptHubCaptureCompatibility(patchScriptHubParser(source)),
  );
}

test('real QQ, Spotify, Telegram, and QuickSearch URL captures map to Surge replacements', async () => {
  const cases: Array<{ line: string; expected: RewriteEntry }> = [
    {
      line: 'request if ${url} ~= /(^https:\\/\\/c\\.pc\\.qq\\.com\\/middlem\\.html\\?pfurl=)(http.*)(&pfuin=.*)/i as urlMatch then redirect(307, "${urlMatch.2}")',
      expected: {
        rwptn: String.raw`(?i)(^https:\/\/c\.pc\.qq\.com\/middlem\.html\?pfurl=)(http.*)(&pfuin=.*)`,
        rwvalue: '$2',
        rwtype: '307',
      },
    },
    {
      line: 'request if ${url} ~= /^https:\\/\\/(?:\\w+-spclient|spclient\\.wg)\\.spotify\\.com(?::443)?\\/artistview\\/v1\\/artist\\/(.*)&platform=iphone/i as urlMatch then url.replace("https://spclient.wg.spotify.com/artistview/v1/artist/${urlMatch.1}&platform=ipad")',
      expected: {
        rwptn: String.raw`(?i)^https:\/\/(?:\w+-spclient|spclient\.wg)\.spotify\.com(?::443)?\/artistview\/v1\/artist\/(.*)&platform=iphone`,
        rwvalue:
          'https://spclient.wg.spotify.com/artistview/v1/artist/$1&platform=ipad',
        rwtype: 'header',
      },
    },
    {
      line: 'request if ${url} ~= /^https:\\/\\/t\\.me\\/([A-Za-z][A-Za-z0-9_]{3,30}[A-Za-z0-9])\\/?$/ as item then redirect(307, "${app}://resolve?domain=${item.1}")',
      expected: {
        rwptn: String.raw`^https:\/\/t\.me\/([A-Za-z][A-Za-z0-9_]{3,30}[A-Za-z0-9])\/?$`,
        rwvalue: '{{{app}}}://resolve?domain=$1',
        rwtype: '307',
      },
    },
    {
      line: 'request if ${url} ~= /^https:\\/\\/duckduckgo\\.com\\/\\?q=bd\\+([^&]+).+/i as urlMatch then redirect(307, "https://www.baidu.com/s?wd=${urlMatch.1}")',
      expected: {
        rwptn: String.raw`(?i)^https:\/\/duckduckgo\.com\/\?q=bd\+([^&]+).+`,
        rwvalue: 'https://www.baidu.com/s?wd=$1',
        rwtype: '307',
      },
    },
  ];
  const api = patchedFixture();

  for (const fixture of cases) {
    api.reset();
    const result = await api.normalizeLoonV2RewriteLine(fixture.line);
    assert.equal(result?.handled, true, fixture.line);
    assert.deepEqual(
      JSON.parse(
        JSON.stringify(
          api.getRwBox().map(({ rwptn, rwvalue, rwtype }) => ({
            rwptn,
            rwvalue,
            rwtype,
          })),
        ),
      ),
      [fixture.expected],
    );
    assert.doesNotMatch(api.getRwBox()[0].rwvalue, /\${(?:urlMatch|item)\./);
  }
});

test('capture zero, named groups, lookarounds, noncapturing groups, and character classes are counted safely', async () => {
  const api = patchedFixture();
  const valid =
    'request if ${url} ~= /(?:prefix)(a)(?<named>b)(?=c)[()]/ as item then redirect(302, "${item.0}-${item.2}")';
  const result = await api.normalizeLoonV2RewriteLine(valid);

  assert.equal(result?.handled, true);
  assert.equal(api.getRwBox()[0].rwvalue, '$0-$2');
  api.reset();
  const invalid =
    'request if ${url} ~= /(?:prefix)(a)(?<named>b)(?=c)[()]/ as item then redirect(302, "${item.3}")';
  assert.equal(
    (await api.normalizeLoonV2RewriteLine(invalid))?.unsupported,
    true,
  );
  assert.equal(api.getRwBox().length, 0);
});

test('capture compatibility rejects non-equivalent phase, action, binding, index, and dynamic forms before output', async () => {
  const lines = [
    'response if ${url} ~= /(a)/ as item then redirect(302, "${item.1}")',
    'request if ${url} ~= /(a)/ as item then reject(404)',
    'request if ${url} ~= /(a)/ as item then redirect(302, "${item.1}") | url.replace("x")',
    'request if ${url} ~= /(a)/ as 1item then redirect(302, "x")',
    'request if ${url} ~= /(a)/ as item then redirect(302, "${other.1}")',
    'request if ${url} ~= /(a)/ as item then redirect(302, "${item}")',
    'request if ${url} ~= /(a)/ as item then redirect(302, "${item.2}")',
    'request if ${url} ~= /(a)/ as item then redirect(302, "${item.01}")',
    'request if ${url} ~= /(a)/ as item then redirect(302, "$1")',
    'request if ${url} ~= /(a)/ as item then redirect(302, `${item.1}`)',
    'request if ${url} ~= /(a)/ && ${request.method} == "GET" as item then redirect(302, "${item.1}")',
    'request if ${url} == "https://example.test" as item then redirect(302, "${item.0}")',
  ];
  const api = patchedFixture();

  for (const line of lines) {
    api.reset();
    const result = await api.normalizeLoonV2RewriteLine(line);
    assert.equal(result?.unsupported, true, line);
    assert.equal(api.getRwBox().length, 0, line);
  }
});

test('unbound fixed URL rewrites retain the official handler behavior', async () => {
  const source = makeCaptureFixture();
  const original = evaluateFixture(patchScriptHubParser(source));
  const patched = patchedFixture();
  const line = 'request if ${url} ~= /^http:/ then redirect(302, "https:")';

  assert.equal(
    (await original.normalizeLoonV2RewriteLine(line))?.handled,
    true,
  );
  assert.equal((await patched.normalizeLoonV2RewriteLine(line))?.handled, true);
  assert.equal(
    JSON.stringify(patched.getRwBox()),
    JSON.stringify(original.getRwBox()),
  );
});

test('patch requires one copy of every known upstream anchor and rejects reapplication', () => {
  const source = patchScriptHubParser(makeCaptureFixture());
  assert.throws(
    () => patchScriptHubCaptureCompatibility('function unknown() {}'),
    /URL condition anchor, found 0/,
  );
  assert.throws(
    () => patchScriptHubCaptureCompatibility(`${source}\n${source}`),
    /URL condition anchor, found 2/,
  );
  const patched = patchScriptHubCaptureCompatibility(source);
  assert.throws(
    () => patchScriptHubCaptureCompatibility(patched),
    /URL condition anchor, found 0/,
  );
});
