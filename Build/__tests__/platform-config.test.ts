import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeTargets } from '../lib/platform-config';

describe('platform config', () => {
  it('accepts supported targets', () => {
    assert.deepEqual(
      normalizeTargets(['surge', 'clash', 'singbox', 'loon']),
      ['surge', 'clash', 'singbox', 'loon']
    );
  });

  it('uses the Surge fallback for missing or empty targets', () => {
    assert.deepEqual(normalizeTargets(undefined), ['surge']);
    assert.deepEqual(normalizeTargets([]), ['surge']);
  });

  it('rejects an unknown-only target list and names the target', () => {
    assert.throws(
      () => normalizeTargets(['surfboard']),
      /Unknown platform target\(s\): surfboard/
    );
  });

  it('rejects mixed supported and unknown targets and names the unknown target', () => {
    assert.throws(
      () => normalizeTargets(['surge', 'invalid-platform']),
      /Unknown platform target\(s\): invalid-platform/
    );
  });
});
