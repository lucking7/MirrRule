import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { createSpan } from '../trace';
import { EnhancedFileOutput } from '../lib/enhanced-file-output';
import {
  buildStatusManifest,
  normalizeCommit,
  writeStatusManifestAtomic,
} from '../lib/status-manifest';

const BUILD_TIME = '2026-07-24T01:02:03.000Z';

describe('status manifest', () => {
  it('constructs the exact whitelist schema with canonical ordering and one timestamp', () => {
    const hostile = {
      PROXY: 'PROXY-secret',
      token: 'token-secret',
      path: '/internal/private/path',
      error: 'raw error secret',
    };
    const manifest = buildStatusManifest({
      buildTime: BUILD_TIME,
      commit: null,
      rulesets: [
        { id: 'zeta', platforms: ['loon', 'surge', 'clash', 'surge'], ruleCount: 9 },
        { id: 'alpha', platforms: ['singbox'], ruleCount: 2 },
      ],
      mirrors: [
        { id: 'z-mirror', status: 'not-run' },
        { id: 'a-mirror', status: 'included' },
      ],
      ...hostile,
    });

    assert.deepEqual(Object.keys(manifest), ['buildTime', 'commit', 'rulesets', 'mirrors']);
    assert.deepEqual(Object.keys(manifest.rulesets[0]), [
      'id', 'platforms', 'ruleCount', 'lastSuccess',
    ]);
    assert.deepEqual(Object.keys(manifest.mirrors[0]), ['id', 'status']);
    assert.deepEqual(manifest.rulesets.map(item => item.id), ['alpha', 'zeta']);
    assert.deepEqual(manifest.rulesets[1].platforms, ['surge', 'clash', 'loon']);
    assert.ok(manifest.rulesets.every(item => item.lastSuccess === manifest.buildTime));
    assert.deepEqual(manifest.mirrors.map(item => item.id), ['a-mirror', 'z-mirror']);

    const serialized = JSON.stringify(manifest);
    for (const secret of Object.values(hostile)) assert.equal(serialized.includes(secret), false);
  });

  it('is byte-deterministic for shuffled inputs', () => {
    const first = buildStatusManifest({
      buildTime: BUILD_TIME,
      commit: 'abcdef1',
      rulesets: [
        { id: 'b', platforms: ['loon', 'surge'], ruleCount: 1 },
        { id: 'a', platforms: ['clash'], ruleCount: 2 },
      ],
      mirrors: [{ id: 'b', status: 'not-run' }, { id: 'a', status: 'included' }],
    });
    const second = buildStatusManifest({
      buildTime: BUILD_TIME,
      commit: 'abcdef1',
      rulesets: [
        { id: 'a', platforms: ['clash'], ruleCount: 2 },
        { id: 'b', platforms: ['surge', 'loon'], ruleCount: 1 },
      ],
      mirrors: [{ id: 'a', status: 'included' }, { id: 'b', status: 'not-run' }],
    });
    assert.equal(JSON.stringify(first), JSON.stringify(second));
  });

  it('accepts only commit-like GITHUB_SHA values', () => {
    assert.equal(normalizeCommit(undefined), null);
    assert.equal(normalizeCommit('not-a-commit'), null);
    assert.equal(normalizeCommit('abcdef1234567'), 'abcdef1234567');
  });

  it('atomically replaces an existing manifest and cleans up on failure', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-status-'));
    try {
      const outputPath = path.join(tempDir, 'status.json');
      fs.writeFileSync(outputPath, 'old');
      const manifest = buildStatusManifest({
        buildTime: BUILD_TIME,
        commit: null,
        rulesets: [],
        mirrors: [],
      });
      await writeStatusManifestAtomic(outputPath, manifest);
      assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, 'utf8')), manifest);
      assert.deepEqual(fs.readdirSync(tempDir), ['status.json']);

      const missingOutput = path.join(tempDir, 'missing', 'status.json');
      await assert.rejects(writeStatusManifestAtomic(missingOutput, manifest));
      assert.equal(fs.existsSync(missingOutput), false);
      assert.deepEqual(fs.readdirSync(tempDir), ['status.json']);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('counts canonical normalized rules once across multiple target platforms', async () => {
    const output = new EnhancedFileOutput(
      createSpan('status-count'),
      'logical-rules',
      'mixed',
      ['loon', 'surge', 'clash', 'singbox'],
      null
    );
    output.addRules([
      'example.com',
      'DOMAIN,example.com',
      'IP-CIDR,10.0.0.0/25',
      'IP-CIDR,10.0.0.128/25',
    ]);
    await output.compile();

    assert.deepEqual(output.getOutputSummary(), {
      id: 'logical-rules',
      platforms: ['loon', 'surge', 'clash', 'singbox'],
      ruleCount: 2,
    });
  });
});
