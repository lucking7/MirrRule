/**
 * 最小回归验证 — 覆盖 plans/2026-04-06-fix-project-reliability-v1.md 确认的 5 类故障模式
 *
 * 运行: pnpm test
 * 依赖: node:test (内置), @swc-node/register (已有)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ─── Plan #3: dispatcher 接线 ───────────────────────────────────────

describe('fetch-retry dispatcher wiring', () => {
  it('dispatcher is exported and not undefined', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS project, require for SWC compat
    const { dispatcher } = require('../utils/network/fetch-retry');
    assert.ok(dispatcher, 'dispatcher should be defined');
    assert.notEqual(typeof dispatcher, 'undefined');
  });

  it('$$fetch is a function that accepts url + init', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS project, require for SWC compat
    const { $$fetch } = require('../utils/network/fetch-retry');
    assert.equal(typeof $$fetch, 'function');
    assert.ok($$fetch.length >= 1, '$$fetch should accept at least 1 argument');
  });
});

// ─── Plan #5: 镜像同步错误汇总 ─────────────────────────────────────

describe('mirror-sync error aggregation', () => {
  it('mergeSyncResults aggregates failedFiles from all results', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS project
    const { mergeSyncResults } = require('../integration/mirror-sync/sync-engine');
    const result = mergeSyncResults([
      { hasChanges: false, updatedFiles: [], newFiles: [], failedFiles: [{ file: 'repo-a', error: 'timeout' }] },
      { hasChanges: true, updatedFiles: ['x.txt'], newFiles: [], failedFiles: [{ file: 'repo-b', error: 'not found' }] },
      { hasChanges: false, updatedFiles: [], newFiles: ['y.txt'], failedFiles: [] },
    ]);

    assert.equal(result.failedFiles.length, 2, 'should collect failedFiles from all results');
    assert.equal(result.hasChanges, true, 'should be true if any result has changes');
    assert.equal(result.updatedFiles.length, 1);
    assert.equal(result.newFiles.length, 1);
  });

  it('mergeSyncResults handles empty input', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS project
    const { mergeSyncResults } = require('../integration/mirror-sync/sync-engine');
    const result = mergeSyncResults([]);
    assert.equal(result.failedFiles.length, 0);
    assert.equal(result.hasChanges, false);
  });
});

// ─── Plan #6: validate-domain-alive 入口 ────────────────────────────

describe('validate-domain-alive entry point', () => {
  it('module exports validateDomainAlive', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS project
    const mod = require('../validate-domain-alive');
    assert.ok('validateDomainAlive' in mod, 'should export validateDomainAlive');
  });
});

// ─── rule-validator AND/OR/NOT 复合规则 ─────────────────────────────

describe('rule-validator compound rules', () => {
  it('does not flag AND/OR/NOT rules as having bad policy names', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS project
    const { RuleValidator } = require('../lib/validators/rule-validator');
    const validator = new RuleValidator();

    const fs = require('node:fs'); // eslint-disable-line @typescript-eslint/no-require-imports -- CJS
    const path = require('node:path'); // eslint-disable-line @typescript-eslint/no-require-imports -- CJS
    const os = require('node:os'); // eslint-disable-line @typescript-eslint/no-require-imports -- CJS

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
