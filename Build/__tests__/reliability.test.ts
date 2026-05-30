/* eslint-disable @typescript-eslint/no-require-imports -- CJS project, node:test requires require() for SWC compat */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

describe('fetch-retry dispatcher wiring', () => {
  it('dispatcher is exported and not undefined', () => {
    const { dispatcher } = require('../utils/network/fetch-retry');
    assert.ok(dispatcher, 'dispatcher should be defined');
  });

  it('$$fetch is a function', () => {
    const { $$fetch } = require('../utils/network/fetch-retry');
    assert.equal(typeof $$fetch, 'function');
  });
});

describe('mirror-sync api error mapping', () => {
  it('maps 404 into a non-retryable not-found error', () => {
    const { mapGitHubApiError } = require('../integration/mirror-sync/github-api');

    const error = mapGitHubApiError(
      'https://api.github.com/repos/example/repo/releases/latest',
      { statusCode: 404, message: 'HTTP 404' },
      { notFoundMessage: 'missing repo' }
    );

    assert.equal(error.type, '404');
    assert.equal(error.canRetry, false);
    assert.equal(error.message, 'missing repo');
  });

  it('maps 403 into a retryable rate-limit error', () => {
    const { mapGitHubApiError } = require('../integration/mirror-sync/github-api');

    const error = mapGitHubApiError(
      'https://api.github.com/repos/example/repo/releases/latest',
      { statusCode: 403, message: 'HTTP 403' }
    );

    assert.equal(error.type, '403');
    assert.equal(error.canRetry, true);
  });
});

describe('validate-domain-alive entry point', () => {
  it('script exists at the workflow target path', () => {
    const entryPath = path.join(process.cwd(), 'Build', 'validate-domain-alive.ts');
    assert.equal(fs.existsSync(entryPath), true);
  });
});

describe('RuleLineUtils validates compound rules', () => {
  it('accepts AND/OR/NOT as valid rule types', () => {
    const { RuleLineUtils } = require('../utils/validation/validators');

    assert.equal(RuleLineUtils.isValidRule('DOMAIN-SUFFIX,example.com,REJECT'), true);
    assert.equal(RuleLineUtils.isValidRule('AND,((DOMAIN-SUFFIX,googlevideo.com,REJECT))'), true);
    assert.equal(RuleLineUtils.isValidRule('OR,((DOMAIN,foo.com),(DOMAIN,bar.com)),DIRECT'), true);
    assert.equal(RuleLineUtils.isValidRule('NOT,((DOMAIN-SUFFIX,ads.com)),PROXY'), true);
  });

  it('rejects comments and empty lines', () => {
    const { RuleLineUtils } = require('../utils/validation/validators');

    assert.equal(RuleLineUtils.isValidRule('# comment'), false);
    assert.equal(RuleLineUtils.isValidRule('// comment'), false);
    assert.equal(RuleLineUtils.isValidRule(''), false);
  });
});

describe('smartConvertRule handles MetaCubeX geosite syntax', () => {
  it('converts geosite suffix entries into domain suffix rules', () => {
    const { smartConvertRule } = require('../lib/misc');

    assert.equal(smartConvertRule('+.amazon'), 'DOMAIN-SUFFIX,amazon');
    assert.equal(smartConvertRule('+.amazonimages.com'), 'DOMAIN-SUFFIX,amazonimages.com');
  });

  it('keeps existing domain conversions stable', () => {
    const { smartConvertRule } = require('../lib/misc');

    assert.equal(smartConvertRule('.example.com'), 'DOMAIN-SUFFIX,example.com');
    assert.equal(smartConvertRule('example.com'), 'DOMAIN,example.com');
    assert.equal(smartConvertRule('DOMAIN,example.com'), 'DOMAIN,example.com');
  });

  it('converts common geosite prefixes', () => {
    const { smartConvertRule } = require('../lib/misc');

    assert.equal(smartConvertRule('full:example.com'), 'DOMAIN,example.com');
    assert.equal(smartConvertRule('domain:example.com'), 'DOMAIN-SUFFIX,example.com');
    assert.equal(smartConvertRule('keyword:amazon'), 'DOMAIN-KEYWORD,amazon');
  });
});
