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
      { id: 'google', path: 'List/google.list', kind: 'retired' },
      { id: 'download', path: 'List/ip/download.list', kind: 'unreferenced' },
      { id: 'nested', path: 'List/ip/nested.list', kind: 'unreferenced' },
    ]);
  });

  it('rejects retired root paths inside compound rules even when their old audit marks them published', () => {
    const profile = [
      '[Rule]',
      `OR,((RULE-SET,"${BASE}/sample%2Elist?version=1"),(RULE-SET,${BASE}/other.list)),DIRECT`,
      `# RULE-SET,${BASE}/commented.list,DIRECT`,
      `RULE-SET,${BASE}/non_ip/sample.list,DIRECT`,
      `RULE-SET,${BASE}/sample.list,DIRECT`,
      `URL-REGEX,${BASE}/unrelated.list,DIRECT`
    ].join('\n');
    assert.deepEqual(checkProfileVariants(profile, audit({ sample: ['merged', 'non_ip'], other: ['merged'] })), [
      { id: 'sample', path: 'List/sample.list', kind: 'retired' },
      { id: 'other', path: 'List/other.list', kind: 'retired' },
    ]);
  });

  it('reports loaded variants that are no longer published, including unknown rulesets', () => {
    const profile = `[Rule]\nRULE-SET,${BASE}/non_ip/download.list,Star\nRULE-SET,${BASE}/ip/download.list,Star\nRULE-SET,${BASE}/non_ip/gone.list,DIRECT\n`;
    assert.deepEqual(checkProfileVariants(profile, audit({ download: ['merged', 'non_ip'] })), [
      { id: 'download', path: 'List/ip/download.list', kind: 'absent' },
      { id: 'gone', path: 'List/non_ip/gone.list', kind: 'absent' },
    ]);
  });

  it('rejects retired split URLs in the historical audit and prints their replacement', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-profile-retired-split-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const profile = `[Rule]\nRULE-SET,${BASE}/non_ip/streaming_%21cn.list,DIRECT\n`;
    const historicalAudit = audit({ 'streaming_!cn': ['non_ip', 'ip'] });
    assert.deepEqual(checkProfileVariants(profile, historicalAudit), [
      { id: 'streaming_!cn', path: 'List/non_ip/streaming_!cn.list', kind: 'retired' },
    ]);
    const auditPath = path.join(directory, 'audit.json');
    const profilePath = path.join(directory, 'profile.conf');
    await fs.writeFile(auditPath, JSON.stringify(historicalAudit));
    await fs.writeFile(profilePath, profile);
    const output: string[] = [];
    t.mock.method(console, 'log', (message: string) => { output.push(message); });
    assert.equal(await runProfileVariantCli(['--profile', profilePath, '--audit', auditPath]), 1);
    assert.match(output.join('\n'), /<platform>\/stream/);
  });

  it('recognizes canonical URLs in rule nodes without reading URL-REGEX values as subscriptions', () => {
    const profile = [
      '[Rule]',
      'RULE-SET,https://NRRULE.PAGES.DEV:443/%4Cist/non_ip/down%6coad.list,DIRECT',
      `URL-REGEX,"(RULE-SET,${BASE}/ip/download.list)",DIRECT`,
      `URL-REGEX,"(RULE-SET,${BASE}/download.list)",DIRECT`,
      `AND,((NOT,((DOMAIN,blocked.example))),(RULE-SET,'${BASE}/ip/Unknown.list')),DIRECT`,
    ].join('\n');
    assert.deepEqual(checkProfileVariants(profile, audit({ download: ['non_ip', 'ip'] })), [
      { id: 'download', path: 'List/ip/download.list', kind: 'unreferenced' },
      { id: 'unknown', path: 'List/ip/Unknown.list', kind: 'absent' },
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
      { id: 'download', path: 'List/domainset/download.list', kind: 'retired' },
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
