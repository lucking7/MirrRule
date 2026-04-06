/**
 * 最小回归验证 — 聚焦 build orchestration、mirror-sync 错误契约与入口存在性
 *
 * 运行: pnpm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';

describe('build pipeline result model', () => {
  it('summarizeBuildSteps treats any failed step as a failed build', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS project
    const { summarizeBuildSteps } = require('../lib/build-pipeline');

    const summary = summarizeBuildSteps([
      { name: 'geoip', success: true, errors: [] },
      { name: 'rules', success: false, errors: ['rules failed'] },
      { name: 'web', success: true, errors: [] },
    ]);

    assert.equal(summary.success, false);
    assert.equal(summary.shouldWriteBuildFinishedLock, false);
    assert.deepEqual(summary.errors, ['rules failed']);
  });

  it('summarizeBuildSteps allows writing .BUILD_FINISHED when all steps succeed', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS project
    const { summarizeBuildSteps } = require('../lib/build-pipeline');

    const summary = summarizeBuildSteps([
      { name: 'geoip', success: true, errors: [] },
      { name: 'rules', success: true, errors: [] },
      { name: 'web', success: true, errors: [] },
    ]);

    assert.equal(summary.success, true);
    assert.equal(summary.shouldWriteBuildFinishedLock, true);
    assert.deepEqual(summary.errors, []);
  });
});

describe('mirror-sync api error mapping', () => {
  it('maps 404 into a non-retryable not-found error', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS project
    const { mapGitHubApiError } = require('../integration/mirror-sync/api-error-utils');

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
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS project
    const { mapGitHubApiError } = require('../integration/mirror-sync/api-error-utils');

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

describe('rule-validator compound rules', () => {
  it('does not flag AND/OR/NOT rules as having bad policy names', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS project
    const { RuleFileValidator } = require('../lib/validators/rule-validator');
    const validator = new RuleFileValidator();

    const tmpFile = path.join(os.tmpdir(), `test-rules-${Date.now()}.list`);
    fs.writeFileSync(tmpFile, [
      '# comment',
      'DOMAIN-SUFFIX,example.com,REJECT',
      'AND,((DOMAIN-SUFFIX,googlevideo.com,REJECT))',
      'OR,((DOMAIN,foo.com),(DOMAIN,bar.com)),DIRECT',
      'NOT,((DOMAIN-SUFFIX,ads.com)),PROXY',
    ].join('\n'));

    try {
      const result = validator.validateFile(tmpFile);
      assert.equal(result.errors.length, 0, `unexpected errors: ${result.errors.join('; ')}`);
      const policyWarnings = result.warnings.filter((w: string) => w.includes('策略名称可能不正确'));
      assert.equal(policyWarnings.length, 0, `unexpected policy warnings: ${policyWarnings.join('; ')}`);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});
