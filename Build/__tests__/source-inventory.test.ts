import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSourceInventory } from '../lib/source-inventory';
import { ruleGroups, specialRules } from '../lib/rule-sources';
import { MIRROR_GROUPS } from '../integration/mirror-sync/mirror-config';

describe('structured source inventory', () => {
  it('enumerates every network source role in stable order', () => {
    const inventory = createSourceInventory(
      [{ name: 'rules', files: [{ path: 'x', url: 'https://primary.test/a', fallbackUrls: ['https://fallback.test/a'] }] }],
      [{ name: 'special', targetFile: 'x', sourceFiles: ['./local.list', 'https://special.test/a'] }],
      [{ name: 'mirror', repositories: [{ repo: 'owner/repo', outputDir: '/tmp', allowedTypes: [] }] }]
    );
    assert.deepEqual(inventory.map(source => source.role),
      ['fallback', 'mirror-repository', 'primary', 'special-source']);
    assert.deepEqual(inventory.map(source => source.requestProfile),
      ['rule', 'github-release', 'rule', 'rule']);
    assert.equal(inventory.some(source => source.url.includes('local.list')), false);
    assert.equal(inventory.find(source => source.role === 'mirror-repository')?.url,
      'https://api.github.com/repos/owner/repo/releases/latest');
    assert.deepEqual(inventory, createSourceInventory(
      [{ name: 'rules', files: [{ path: 'x', url: 'https://primary.test/a', fallbackUrls: ['https://fallback.test/a'] }] }],
      [{ name: 'special', targetFile: 'x', sourceFiles: ['./local.list', 'https://special.test/a'] }],
      [{ name: 'mirror', repositories: [{ repo: 'owner/repo', outputDir: '/tmp', allowedTypes: [] }] }]
    ));
  });

  it('enumerates the production configuration without duplicate identities', () => {
    const inventory = createSourceInventory(ruleGroups, specialRules, MIRROR_GROUPS);
    assert.equal(new Set(inventory.map(source => source.id)).size, inventory.length);
    for (const role of ['primary', 'special-source', 'mirror-repository']) {
      assert.ok(inventory.some(source => source.role === role), role);
    }
    assert.equal(inventory.some(source => source.url.includes('Siri.V2')), false);
  });
});
