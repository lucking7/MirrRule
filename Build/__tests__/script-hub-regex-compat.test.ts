/* eslint-disable no-template-curly-in-string -- These fixtures exercise literal Loon variables. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import vm from 'node:vm';
import { patchScriptHubRegexCompatibility } from '../script-hub-regex-compat';

interface NormalizeResult {
  handled?: boolean;
  unsupported?: boolean;
  reason?: string;
}

interface FixtureApi {
  normalizeLoonV2RewriteLine(
    action: string,
    targetApp?: string,
    sourceNum?: number,
  ): Promise<NormalizeResult>;
  reset(): void;
  getRwbodyBox(): BodyRewrite[];
  getRwhdBox(): HeaderRewrite[];
}

interface BodyRewrite {
  type: string;
  regex: string;
  value: string;
  mark: string;
}

interface HeaderRewrite {
  mark: string;
  noteK: string;
  x: string;
}

const fixturePath = path.join(
  process.cwd(),
  'Build',
  '__tests__',
  'fixtures',
  'script-hub-regex-handler.js',
);
const fixtureSource = fs.readFileSync(fixturePath, 'utf8');

function evaluateFixture(source: string): FixtureApi {
  const context = vm.createContext({}) as vm.Context & {
    fixtureApi?: FixtureApi;
  };
  vm.runInContext(source, context, { filename: fixturePath });
  assert.ok(context.fixtureApi);
  return context.fixtureApi;
}

function patchedFixture(): FixtureApi {
  return evaluateFixture(patchScriptHubRegexCompatibility(fixtureSource));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function quoteSurgeField(value: string): string {
  return `"${value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', String.raw`\"`)
    .replaceAll(/\r?\n/g, String.raw`\n`)}"`;
}

const realBodyCases = [
  {
    source: 'Remove_ads_by_keli.lpx',
    action: String.raw`response.body.replace(/<GetADResult>\.\*\?<\/GetADResult>/, "<GetADResult>{\"ret\":0,\"msg\":\"正常\",\"err_code\":0,\"data\":{\"ad\":[]}}</GetADResult>")`,
    pattern: String.raw`<GetADResult>\.\*\?<\/GetADResult>`,
    replacement:
      '<GetADResult>{"ret":0,"msg":"正常","err_code":0,"data":{"ad":[]}}</GetADResult>',
  },
  {
    source: 'UnnooQuan_remove_watermark.lpx',
    action: String.raw`response.body.replace(/name="group_enable_watermark"\x20value="true"/, "name=\"group_enable_watermark\" value=\"false\"")`,
    pattern: String.raw`name="group_enable_watermark"\x20value="true"`,
    replacement: 'name="group_enable_watermark" value="false"',
  },
  {
    source: 'TestFlightRegionUnlock.lpx',
    action: String.raw`request.body.replace(/"storefrontId"\x20:\x20"\d{6}-\d{2},\d{2}",/, "\"storefrontId\":\"143441-19,29\",")`,
    pattern: String.raw`"storefrontId"\x20:\x20"\d{6}-\d{2},\d{2}",`,
    replacement: '"storefrontId":"143441-19,29",',
  },
];

test('real Loon body.replace regex literals become Surge Body Rewrite entries', async () => {
  const api = patchedFixture();

  for (const fixture of realBodyCases) {
    api.reset();
    // eslint-disable-next-line no-await-in-loop -- Each assertion reads the shared fixture state before reset.
    const result = await api.normalizeLoonV2RewriteLine(fixture.action);
    const output = clone<BodyRewrite[]>(api.getRwbodyBox());

    assert.equal(result.handled, true, fixture.source);
    assert.deepEqual(
      output,
      [
        {
          type: fixture.action.startsWith('request')
            ? 'http-request'
            : 'http-response',
          regex: String.raw`^https://example\.test$`,
          value: `${quoteSurgeField(fixture.pattern)} ${quoteSurgeField(fixture.replacement)}`,
          mark: '',
        },
      ],
      fixture.source,
    );
  }
});

test('splitter keeps commas, quotes, parentheses, and a slash inside a regex character class', async () => {
  const api = patchedFixture();
  const pattern = String.raw`[/$,"()]+`;
  const result = await api.normalizeLoonV2RewriteLine(
    String.raw`response.body.replace(/[/$,"()]+/ims, "kept, value")`,
  );
  const [rewrite] = clone<BodyRewrite[]>(api.getRwbodyBox());

  assert.equal(result.handled, true);
  assert.equal(
    rewrite.value,
    `${quoteSurgeField(`(?ims)${pattern}`)} ${quoteSurgeField('kept, value')}`,
  );
});

test('string body.replace patterns keep the upstream behavior', async () => {
  const original = evaluateFixture(fixtureSource);
  const patched = patchedFixture();
  const action = 'response.body.replace("old,(value)", "new")';

  assert.equal(
    (await original.normalizeLoonV2RewriteLine(action)).handled,
    true,
  );
  assert.equal(
    (await patched.normalizeLoonV2RewriteLine(action)).handled,
    true,
  );
  assert.equal(
    JSON.stringify(patched.getRwbodyBox()),
    JSON.stringify(original.getRwbodyBox()),
  );
});

test('unsupported regex flags and dynamic body.replace arguments fail explicitly', async () => {
  const api = patchedFixture();
  const actions = [
    'response.body.replace(/old/g, "new")',
    'response.body.replace(/old/ii, "new")',
    'response.body.replace(${pattern}, "new")',
    'response.body.replace(/old/i, ${replacement})',
  ];

  for (const action of actions) {
    api.reset();
    // eslint-disable-next-line no-await-in-loop -- Each assertion reads the shared fixture state before reset.
    const result = await api.normalizeLoonV2RewriteLine(action);
    assert.equal(result.unsupported, true, action);
    assert.equal(api.getRwbodyBox().length, 0, action);
  }
});

test('real XiaoCan three-argument header.replace becomes header-replace-regex', async () => {
  const api = patchedFixture();
  const pattern =
    '.*(GetBannerList|IsShowOrderAwardPopup|UserLifeShopList|BrandBannerList|GetPromotionGlobalCfg)';
  const result = await api.normalizeLoonV2RewriteLine(
    `request.header.replace("methodname", /${pattern}/, "null")`,
  );
  const output = clone<HeaderRewrite[]>(api.getRwhdBox());

  assert.equal(result.handled, true);
  assert.deepEqual(output, [
    {
      mark: '',
      noteK: '',
      x: String.raw`http-request ^https://example\.test$ header-replace-regex "methodname" "${pattern}" "null"`,
    },
  ]);
});

test('header regex flags are preserved and old two-argument header.replace is unchanged', async () => {
  const original = evaluateFixture(fixtureSource);
  const patched = patchedFixture();

  assert.equal(
    (
      await patched.normalizeLoonV2RewriteLine(
        'response.header.replace("X-Test", /old/i, "new")',
      )
    ).handled,
    true,
  );
  assert.match(
    clone<HeaderRewrite[]>(patched.getRwhdBox())[0].x,
    /header-replace-regex "X-Test" "\(\?i\)old" "new"$/,
  );

  const oldAction = 'response.header.replace("X-Test", "new")';
  assert.equal(
    (await original.normalizeLoonV2RewriteLine(oldAction)).handled,
    true,
  );
  patched.reset();
  assert.equal(
    (await patched.normalizeLoonV2RewriteLine(oldAction)).handled,
    true,
  );
  assert.equal(
    JSON.stringify(patched.getRwhdBox()),
    JSON.stringify(original.getRwhdBox()),
  );
});

test('dynamic and unsupported header regexes fail without partial output', async () => {
  const api = patchedFixture();
  const actions = [
    'request.header.replace(${name}, /old/, "new")',
    'request.header.replace("X-Test", ${pattern}, "new")',
    'request.header.replace("X-Test", /old/g, "new")',
    'request.header.replace("X-Test", /old/, ${replacement})',
  ];

  for (const action of actions) {
    api.reset();
    // eslint-disable-next-line no-await-in-loop -- Each assertion reads the shared fixture state before reset.
    const result = await api.normalizeLoonV2RewriteLine(action);
    assert.equal(result.unsupported, true, action);
    assert.equal(api.getRwhdBox().length, 0, action);
  }
});

test('patch rejects missing, repeated, unpatched, and already-patched anchors', () => {
  assert.throws(
    () => patchScriptHubRegexCompatibility('function unknown() {}'),
    /missing or repeated/,
  );
  assert.throws(
    () =>
      patchScriptHubRegexCompatibility(
        `${fixtureSource}\nfunction splitLoonV2TopLevel(str, sep = ',') {}`,
      ),
    /missing or repeated/,
  );
  assert.throws(
    () =>
      patchScriptHubRegexCompatibility(
        fixtureSource.replace(
          String.raw`.body\.(replace)$/)`,
          String.raw`.body\.(replace|mock)$/)`,
        ),
      ),
    /replace-only body matcher/,
  );
  assert.throws(
    () =>
      patchScriptHubRegexCompatibility(
        patchScriptHubRegexCompatibility(fixtureSource),
      ),
    /anchor|boundary/,
  );
});
