import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { checkProfileVariants, runProfileVariantCli } from '../check-profile-variants';

const BASE = 'https://nrrule.pages.dev/List';

function audit(published: Record<string, string[]>) {
  return {
    rulesets: Object.entries(published).map(([id, variants]) => ({
      id,
      outputs: ['merged', 'non_ip', 'ip'].flatMap(variant => [
        { platform: 'surge', variant, status: variants.includes(variant) ? 'published' : 'absent-empty' },
        // Other platforms never decide what a Surge profile must load.
        { platform: 'singbox', variant, status: 'published' },
      ]),
    })),
  };
}

describe('profile variant check', () => {
  it('reports a variant that appears for a ruleset loaded only through its variants', () => {
    const profile = [
      '[General]',
      `RULE-SET,${BASE}/ip/general.list,DIRECT`,
      '[Rule]',
      `RULE-SET,${BASE}/non_ip/download.list,Star # trailing comment`,
      `RULE-SET,${BASE}/non_ip/cdn.list,Star`,
      `RULE-SET,${BASE}/ip/cdn.list,Star`,
      `RULE-SET,${BASE}/google.list,Proxy,no-resolve`,
      `# RULE-SET,${BASE}/non_ip/commented.list,DIRECT`,
      `OR,((GEOIP,CN),(RULE-SET,${BASE}/non_ip/nested.list)),DIRECT`,
      'FINAL,Proxy',
    ].join('\n');
    const findings = checkProfileVariants(profile, audit({
      download: ['merged', 'non_ip', 'ip'],
      cdn: ['merged', 'non_ip', 'ip'],
      google: ['merged', 'non_ip', 'ip'],
      commented: ['merged', 'non_ip', 'ip'],
      nested: ['merged', 'non_ip', 'ip'],
    }));
    assert.deepEqual(findings, [
      { id: 'download', path: 'List/ip/download.list', kind: 'unreferenced' },
      { id: 'nested', path: 'List/ip/nested.list', kind: 'unreferenced' },
    ]);
  });

  it('reports loaded variants that are no longer published, including unknown rulesets', () => {
    const profile = `[Rule]\nRULE-SET,${BASE}/non_ip/download.list,Star\nRULE-SET,${BASE}/ip/download.list,Star\nRULE-SET,${BASE}/non_ip/gone.list,DIRECT\n`;
    assert.deepEqual(checkProfileVariants(profile, audit({ download: ['merged', 'non_ip'] })), [
      { id: 'download', path: 'List/ip/download.list', kind: 'absent' },
      { id: 'gone', path: 'List/non_ip/gone.list', kind: 'absent' },
    ]);
  });

  it('uses audited paths when canonical and legacy subscriptions cover the same split slot', () => {
    const currentAudit = { rulesets: [{
      id: 'download',
      outputs: [
        { platform: 'surge', variant: 'merged', path: 'List/download.list', status: 'published' },
        { platform: 'surge', variant: 'non_ip', path: 'List/non_ip/download.conf', status: 'published' },
        { platform: 'surge', variant: 'non_ip', path: 'List/non_ip/download.list', status: 'published' },
        { platform: 'surge', variant: 'ip', path: 'List/ip/download.conf', status: 'published' },
        { platform: 'surge', variant: 'ip', path: 'List/ip/download.list', status: 'published' },
        { platform: 'surge', variant: 'domainset', path: 'List/domainset/download.conf', status: 'published' },
      ],
    }] };
    const nonIp = `[Rule]\nRULE-SET,${BASE}/non_ip/download.list,Star\n`;
    const canonicalIp = `OR,((GEOIP,CN),(RULE-SET,"${BASE}/ip/download.conf?version=1")),DIRECT\n`;
    assert.deepEqual(checkProfileVariants(nonIp, currentAudit), [
      { id: 'download', path: 'List/ip/download.conf', kind: 'unreferenced' },
    ]);
    assert.deepEqual(checkProfileVariants(nonIp + canonicalIp, currentAudit), []);
    const oldAudit = { rulesets: [{
      id: 'download',
      outputs: currentAudit.rulesets[0].outputs.filter(output => output.path.endsWith('.list')),
    }] };
    assert.deepEqual(checkProfileVariants(nonIp + canonicalIp, oldAudit), [
      { id: 'download', path: 'List/ip/download.conf', kind: 'absent' },
      { id: 'download', path: 'List/ip/download.list', kind: 'unreferenced' },
    ]);
  });

  it('only checks the optional domainset output when the exact path is referenced', () => {
    const currentAudit = { rulesets: [{
      id: 'download',
      outputs: [
        { platform: 'surge', variant: 'non_ip', path: 'List/non_ip/download.conf', status: 'published' },
        { platform: 'surge', variant: 'domainset', path: 'List/domainset/download.conf', status: 'published' },
      ],
    }] };
    const profile = `[Rule]\nDOMAIN-SET,${BASE}/domainset/download.conf,DIRECT\n`;
    assert.deepEqual(checkProfileVariants(profile, currentAudit), []);
    assert.deepEqual(checkProfileVariants(profile.replace('.conf', '.list'), currentAudit), [
      { id: 'download', path: 'List/domainset/download.list', kind: 'absent' },
    ]);
    assert.deepEqual(checkProfileVariants(profile, audit({ download: ['non_ip'] })), [
      { id: 'download', path: 'List/domainset/download.conf', kind: 'absent' },
    ]);
  });

  it('exits 1 with findings and 0 when every published variant is loaded', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-profile-variants-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const auditPath = path.join(directory, 'audit.json');
    await fs.writeFile(auditPath, JSON.stringify(audit({ download: ['merged', 'non_ip', 'ip'] })));
    const profilePath = path.join(directory, 'profile.conf');
    await fs.writeFile(profilePath, `[Rule]\nRULE-SET,${BASE}/non_ip/download.list,Star\n`);
    assert.equal(await runProfileVariantCli(['--profile', profilePath, '--audit', auditPath]), 1);
    await fs.appendFile(profilePath, `RULE-SET,${BASE}/ip/download.list,Star\n`);
    assert.equal(await runProfileVariantCli(['--profile', profilePath, '--audit', auditPath]), 0);
    await assert.rejects(runProfileVariantCli(['--audit', auditPath]), /--profile is required/);
  });
});
