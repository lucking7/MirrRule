import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GOOGLE_CLOUD_IP_RANGES_URL, GOOGLE_IP_RANGES_URL } from '../lib/primary-ip-sources';
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

  it('includes both Google IP range URLs in the production inventory', () => {
    const inventory = createSourceInventory(ruleGroups, specialRules, MIRROR_GROUPS);
    assert.equal(GOOGLE_IP_RANGES_URL, 'https://www.gstatic.com/ipranges/goog.json');
    assert.equal(GOOGLE_CLOUD_IP_RANGES_URL, 'https://www.gstatic.com/ipranges/cloud.json');
    for (const url of [GOOGLE_IP_RANGES_URL, GOOGLE_CLOUD_IP_RANGES_URL]) {
      assert.deepEqual(
        inventory.find(source => source.url === url),
        {
          id: `special-source:${url}`,
          url,
          role: 'special-source',
          requestProfile: 'rule',
        }
      );
    }
  });

  it('enumerates branchFiles mirrors as per-path github-raw entries', () => {
    const inventory = createSourceInventory(
      [],
      [],
      [{
        name: 'branch-mirror',
        repositories: [{
          repo: 'owner/branch-repo',
          outputDir: '/tmp',
          allowedTypes: [],
          branchFiles: {
            ref: 'main',
            paths: ['sgmodule/DNS.sgmodule', 'plugin/General.plugin'],
          },
        }],
      }]
    );
    assert.deepEqual(inventory, [
      {
        id: 'mirror-repository:https://raw.githubusercontent.com/owner/branch-repo/main/plugin/General.plugin',
        url: 'https://raw.githubusercontent.com/owner/branch-repo/main/plugin/General.plugin',
        role: 'mirror-repository',
        requestProfile: 'github-raw',
      },
      {
        id: 'mirror-repository:https://raw.githubusercontent.com/owner/branch-repo/main/sgmodule/DNS.sgmodule',
        url: 'https://raw.githubusercontent.com/owner/branch-repo/main/sgmodule/DNS.sgmodule',
        role: 'mirror-repository',
        requestProfile: 'github-raw',
      },
    ]);
  });
});
