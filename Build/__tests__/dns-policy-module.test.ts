import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';
import {
  DNS_POLICY_SOURCE_URL,
  isDnsPolicyPlugin,
  loadDnsPolicyModule,
} from '../integration/plugin-converter/dns-policy-module';
import {
  getPluginRetirementReason,
  isRetiredPluginArtifact,
  RETIRED_PLUGIN_ARTIFACTS,
} from '../integration/plugin-converter/plugin-policy';
import { prepareModuleContent } from '../lib/module-merger/module-content';
import type { PluginInfo } from '../integration/plugin-converter/types';

// Upstream Prevent_DNS_Leaks.lpx, observed 2026-10-08; duplicate surfshark is intentional.
const DNS_SOURCE = `#!name=DNS防泄露
#!desc=专为小白设计的DNS防泄露
#!author=非正常人类研究中心
#!tag=DNS
#!homepage=https://hub.kelee.one
#!icon=https://raw.githubusercontent.com/luestr/IconResource/main/Other_icon/120px/Prevent_DNS_Leaks.png
#!date=2026-10-02 13:57:49

[Rule]
DOMAIN-SUFFIX, dnsleaktest.com, PROXY
DOMAIN-SUFFIX, dnsleak.com, PROXY
DOMAIN-SUFFIX, expressvpn.com, PROXY
DOMAIN-SUFFIX, nordvpn.com, PROXY
DOMAIN-SUFFIX, surfshark.com, PROXY
DOMAIN-SUFFIX, ipleak.net, PROXY
DOMAIN-SUFFIX, perfect-privacy.com, PROXY
DOMAIN-SUFFIX, browserleaks.com, PROXY
DOMAIN-SUFFIX, browserleaks.org, PROXY
DOMAIN-SUFFIX, vpnunlimited.com, PROXY
DOMAIN-SUFFIX, whoer.net, PROXY
DOMAIN-SUFFIX, whrq.net, PROXY
DOMAIN-SUFFIX, astrill.com, PROXY
DOMAIN-SUFFIX, astrill.org, PROXY
DOMAIN-SUFFIX, dnsleak.asn247.net, PROXY
DOMAIN-SUFFIX, surfshark.com, PROXY
DOMAIN-SUFFIX, surfsharkdns.com, PROXY
DOMAIN-SUFFIX, pixelscan.net, PROXY
DOMAIN, ipv4.ping0.cc, PROXY
DOMAIN, ipv6.ping0.cc, PROXY
DOMAIN-SUFFIX, ipapi.co, PROXY
DOMAIN, ip-scan.adspower.net, PROXY
`;

const dnsPlugin: PluginInfo = {
  name: 'Prevent_DNS_Leaks',
  url: 'https://kelee.one/Tool/Loon/Lpx/Prevent_DNS_Leaks.lpx',
  extension: 'lpx',
};
const tencentSource = 'https://kelee.one/Tool/Loon/Lpx/Tencent_Video_remove_ads.lpx';

describe('designated DNS policy module', () => {
  it('requires a fresh canonical source and preserves attribution while importing one policy argument', async () => {
    const calls: boolean[] = [];
    const result = await loadDnsPolicyModule(dnsPlugin, (plugin, forceUpdate) => {
      assert.equal(plugin, dnsPlugin);
      calls.push(forceUpdate ?? false);
      return Promise.resolve({ success: true, content: DNS_SOURCE });
    });
    assert.deepEqual(calls, [true]);
    assert.equal(result.sourceUrl, DNS_POLICY_SOURCE_URL);
    assert.equal(typeof result.content, 'string');
    if (typeof result.content !== 'string') assert.fail(result.content.error);
    const content = result.content;
    assert.match(content, /^#!name\s*=\s*DNS防泄露$/m);
    assert.match(content, /^#!author\s*=\s*非正常人类研究中心$/m);
    assert.match(content, /^#!homepage\s*=\s*https:\/\/hub\.kelee\.one$/m);
    assert.match(content, /^#!date\s*=\s*2026-10-02 13:57:49$/m);
    assert.deepEqual(content.match(/^#!arguments=.*$/gm), ['#!arguments=policy:Proxy']);
    const rules = content.split('\n').filter(line => /^DOMAIN(?:-SUFFIX)?,/.test(line));
    assert.equal(rules.length, 21);
    assert.equal(new Set(rules).size, 21);
    assert.ok(rules.every(line => line.endsWith(',{{{policy}}}')));
    assert.ok(rules.includes('DOMAIN,ipv4.ping0.cc,{{{policy}}}'));
    assert.ok(rules.includes('DOMAIN-SUFFIX,surfshark.com,{{{policy}}}'));

    const prepared = prepareModuleContent({
      header: 'DNS防泄露',
      content,
    }, false);
    assert.deepEqual(Array.from(prepared.defaults.values()), ['Proxy']);
    assert.equal(prepared.sections.length, 1);
    assert.equal(prepared.sections[0].type, 'Rule');
    assert.equal(prepared.sections[0].content.match(/{{{m_[^{}]+_policy}}}/g)?.length, 21);
  });

  it('uses validated fresh rules rather than a fixed domain snapshot', async () => {
    const result = await loadDnsPolicyModule(dnsPlugin, () => Promise.resolve({
      success: true,
      content: DNS_SOURCE + 'DOMAIN,new-dns-check.example,PROXY\n',
    }));
    assert.equal(typeof result.content, 'string');
    if (typeof result.content !== 'string') assert.fail(result.content.error);
    assert.match(result.content, /^DOMAIN,new-dns-check\.example,{{{policy}}}$/m);
    assert.equal(result.content.match(/^DOMAIN(?:-SUFFIX)?,/gm)?.length, 22);
  });

  for (const [name, content] of [
    ['mixed actions', DNS_SOURCE + '\n[Rewrite]\n^https://example.test - reject\n'],
    ['script dependencies', DNS_SOURCE + '\n[Script]\nresponse script("https://scripts.test/check.js")\n'],
    ['another policy', DNS_SOURCE.replace('dnsleaktest.com, PROXY', 'dnsleaktest.com, DIRECT')],
    ['another rule type', DNS_SOURCE + 'IP-CIDR,1.2.3.0/24,PROXY\n'],
    ['extra rule fields', DNS_SOURCE + 'DOMAIN,example.test,PROXY,no-resolve\n'],
    ['invalid domains', DNS_SOURCE + 'DOMAIN,{{{other}}},PROXY\n'],
    ['predeclared arguments', '#!arguments=policy:Direct\n' + DNS_SOURCE],
    ['an empty rules section', '#!name=DNS防泄露\n[Rule]\n# empty\n'],
    ['an action outside Rule', 'DOMAIN,example.test,PROXY\n' + DNS_SOURCE],
  ]) {
    it(`rejects ${name} instead of publishing a partial module`, async () => {
      const result = await loadDnsPolicyModule(dnsPlugin, () => Promise.resolve({ success: true, content }));
      assert.equal(typeof result.content, 'object');
      if (typeof result.content === 'string') assert.fail('Invalid source was accepted');
      assert.match(result.content.error, /DNS policy source/);
    });
  }

  for (const [name, response] of [
    ['404', { success: false, error: 'HTTP 404: Not Found' }],
    ['last-known-good content', { success: true, content: DNS_SOURCE, degraded: true, error: 'HTTP 404' }],
  ] as const) {
    it(`rejects ${name} when fresh content is unavailable`, async () => {
      const result = await loadDnsPolicyModule(dnsPlugin, () => Promise.resolve(response));
      assert.equal(typeof result.content, 'object');
      if (typeof result.content === 'string') assert.fail('Failed refresh was accepted');
      assert.match(result.content.error, /DNS policy download failed.*404/);
    });
  }

  it('limits the adapter to the exact canonical source', async () => {
    assert.equal(isDnsPolicyPlugin({ url: dnsPlugin.url + '#description' }), true);
    for (const url of [dnsPlugin.url + '?version=2', dnsPlugin.url.replace('kelee.one', 'plugins.test')]) {
      assert.equal(isDnsPolicyPlugin({ url }), false);
      let requested = false;
      const result = await loadDnsPolicyModule({ ...dnsPlugin, url }, () => {
        requested = true;
        return Promise.resolve({ success: true, content: DNS_SOURCE });
      });
      assert.equal(requested, false);
      assert.equal(typeof result.content, 'object');
    }
  });

  it('publishes through the real entry without Script-Hub and preserves the old file on refresh or validation failure', (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-dns-entry-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const converterDirectory = path.resolve(__dirname, '../integration/plugin-converter');
    const program = String.raw`
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      const path = require('node:path');
      const Module = require('node:module');
      const converterDirectory = ${JSON.stringify(converterDirectory)};
      const directory = ${JSON.stringify(directory)};
      const dnsSource = ${JSON.stringify(DNS_SOURCE)};
      const dnsUrl = ${JSON.stringify(dnsPlugin.url)};
      const tencentUrl = ${JSON.stringify(tencentSource)};
      const easyBikeUrl = 'https://kelee.one/Tool/Loon/Lpx/EasyBike_remove_ads.lpx';
      const otherTencentUrl = 'https://plugins.test/Tencent_Video_remove_ads.lpx';
      let catalog = [dnsUrl, tencentUrl, easyBikeUrl, otherTencentUrl];
      let dnsResponse = dnsSource;
      const requests = [];
      function replaceModule(filename, exports) {
        const module = new Module(filename);
        module.filename = filename;
        module.loaded = true;
        module.exports = exports;
        require.cache[filename] = module;
      }
      const fetchPath = require.resolve(path.join(converterDirectory, '../../utils/network/fetch-retry.ts'));
      replaceModule(fetchPath, {
        defaultRequestInit: {},
        $$fetch: async (url) => {
          requests.push(url);
          let body;
          if (url === 'https://catalog.test/list.json') body = JSON.stringify({ lists: catalog });
          else if (url === dnsUrl) body = dnsResponse;
          else if (url === 'https://raw.githubusercontent.com/fmz200/wool_scripts/main/Surge/module/blockAds.module') {
            body = '#!name=Native fixture\n[Rule]\nDOMAIN,native.example,REJECT\n';
          } else throw new Error('Unexpected network request: ' + url);
          return { ok: body !== null, status: body === null ? 404 : 200, statusText: 'fixture', text: async () => body ?? 'Not Found' };
        },
      });
      const mirrorPath = require.resolve(path.join(converterDirectory, 'plugin-mirror.ts'));
      const realMirror = require(mirrorPath);
      replaceModule(mirrorPath, {
        ...realMirror,
        getPluginContent: (plugin, forceUpdate) => realMirror.getPluginContent(plugin, forceUpdate, {
          mirrorDirectory: path.join(directory, 'plugin-cache'),
        }),
      });
      (async () => {
        const { getPluginList } = require(path.join(converterDirectory, 'plugin-list.ts'));
        const active = await getPluginList();
        assert.ok(Array.isArray(active));
        assert.equal(active.some(plugin => plugin.url === tencentUrl), false);
        assert.equal(active.some(plugin => plugin.url === easyBikeUrl), true);
        assert.equal(active.some(plugin => plugin.url === otherTencentUrl), true);
        const provenance = JSON.parse(fs.readFileSync(path.join(directory, '.cache/plugin-provenance.json'), 'utf8'));
        assert.equal(provenance.listCount, 4);
        catalog = [dnsUrl, tencentUrl];
        const { convertAndMirrorPlugins } = require(path.join(converterDirectory, 'index.ts'));
        const first = await convertAndMirrorPlugins(false, false);
        const dns = first.find(result => result.sourceUrl === dnsUrl);
        assert.equal(dns.status, 'ready');
        assert.equal(path.basename(dns.outputPath), 'DNS防泄露.sgmodule');
        assert.equal(dns.outputPath, path.join(process.env.PUBLIC_DIR, 'Modules/Converted/DNS防泄露.sgmodule'));
        assert.deepEqual(dns.scripts, []);
        const published = fs.readFileSync(dns.outputPath, 'utf8');
        assert.equal(published.match(/^DOMAIN(?:-SUFFIX)?,/gm).length, 21);
        assert.equal(published.match(/^#!arguments=/gm).length, 1);
        for (const failedSource of [null, dnsSource + 'DOMAIN,mixed.example,DIRECT\n']) {
          dnsResponse = failedSource;
          const failed = (await convertAndMirrorPlugins(false, false)).find(result => result.sourceUrl === dnsUrl);
          assert.equal(failed.status, 'failed');
          assert.match(failed.error, /DNS policy/);
          assert.equal(fs.readFileSync(dns.outputPath, 'utf8'), published);
        }
        assert.equal(requests.some(url => url.includes(':9101/')), false);
        assert.equal(requests.some(url => url === tencentUrl), false);
        assert.equal(requests.filter(url => url === dnsUrl).length, 3);
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `;
    const run = spawnSync(process.execPath, ['-r', require.resolve('@swc-node/register'), '-e', program], {
      cwd: directory,
      env: {
        ...process.env,
        SWC_NODE_IGNORE_DYNAMIC: 'true',
        SWC_NODE_PROJECT: path.resolve(__dirname, '../../tsconfig.json'),
        PUBLIC_DIR: path.join(directory, 'public'),
        PLUGIN_LIST_URL: 'https://catalog.test/list.json',
        PLUGIN_LIST_FORCE_PROXY: 'false',
        PROXY_BASE: '',
        GITHUB_STEP_SUMMARY: '',
      },
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.ifError(run.error);
    assert.equal(run.status, 0, run.stdout + run.stderr);
  });
});

describe('retired plugin source policy', () => {
  it('retires only the designated Tencent source and its exact historical artifacts', () => {
    assert.match(getPluginRetirementReason({ url: tencentSource }) ?? '', /no longer maintains/);
    assert.ok(getPluginRetirementReason({ url: tencentSource + '#description' }));
    assert.equal(getPluginRetirementReason({ url: tencentSource + '?version=2' }), undefined);
    assert.equal(getPluginRetirementReason({ url: tencentSource.replace('kelee.one', 'plugins.test') }), undefined);
    assert.equal(getPluginRetirementReason({ url: 'https://kelee.one/Tool/Loon/Lpx/EasyBike_remove_ads.lpx' }), undefined);
    for (const filename of RETIRED_PLUGIN_ARTIFACTS) assert.equal(isRetiredPluginArtifact(filename), true);
    for (const filename of ['腾讯文档去广告.sgmodule', '哈罗去广告.sgmodule', 'prefix腾讯视频去广告.sgmodule']) {
      assert.equal(isRetiredPluginArtifact(filename), false);
    }
  });
});
