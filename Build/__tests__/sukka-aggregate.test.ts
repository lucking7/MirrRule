import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { RuleSourceProcessor } from '../lib/rule-source-processor';
import { specialRules } from '../lib/rule-sources';
import { createSpan } from '../trace';

const regions = ['us', 'hk', 'jp', 'tw', 'kr', 'eu'];

describe('Sukka aggregate subscriptions', () => {
  it('includes each regional source in stream and keeps phishing out of the reject aggregates', () => {
    const stream = specialRules.find(rule => rule.targetFile === 'List/stream.list');
    const extra = specialRules.find(rule => rule.targetFile === 'List/reject_extra.list');
    const phishing = specialRules.find(rule => rule.targetFile === 'List/reject_phishing.list');
    assert.ok(stream);
    assert.ok(extra);
    assert.ok(phishing);
    assert.equal(stream.sourceFiles.length, 8);
    assert.equal(new Set(stream.sourceFiles).size, 8);
    assert.notEqual(stream.allowEmpty, true);
    for (const region of regions) {
      const regional = specialRules.find(rule => rule.targetFile === `List/stream_${region}.list`);
      assert.ok(regional);
      assert.ok(regional.sourceFiles.every(source => stream.sourceFiles.includes(source)));
    }
    assert.deepEqual(extra.sourceFiles, ['https://ruleset.skk.moe/List/domainset/reject_extra.conf']);
    assert.equal(extra.sourceFiles.some(source => phishing.sourceFiles.includes(source)), false);
    assert.equal(extra.defaultPolicy, 'REJECT');
    const reject = specialRules.find(rule => rule.targetFile === 'List/reject.list');
    assert.ok(reject);
    assert.equal(reject.sourceFiles.some(source => phishing.sourceFiles.includes(source)), false);
    assert.equal(reject.applyNoResolve, undefined, 'preserve source DNS resolution behavior');
    assert.deepEqual(reject.sourceVariants, ['non_ip', 'non_ip', 'ip'], 'variants follow the upstream files');
    assert.deepEqual(reject.sourceFiles.map(source => source.split('/').at(-2)), ['domainset', 'non_ip', 'ip']);
    const cdn = specialRules.find(rule => rule.targetFile === 'List/cdn.list');
    assert.ok(cdn);
    assert.equal(cdn.applyNoResolve, undefined, 'upstream ip/cdn rules resolve the destination');
  });

  it('merges and deduplicates four-platform outputs and preserves old files on source failure', async () => {
    const bodies = new Map<string, string>([
      ['/domainset/reject.conf', '.base-block.test\n'],
      ['/non_ip/reject.conf', 'DOMAIN,other-block.test\nDOMAIN-SUFFIX,base-block.test\nIP-CIDR,203.0.113.7/32,no-resolve\n'],
      ['/ip/reject.conf', 'IP-CIDR,198.51.100.0/24\nIP-CIDR,192.0.2.0/24,no-resolve\n'],
      ['/non_ip/my_reject.conf', 'DOMAIN-SUFFIX,personal-block.test\n'],
      ['/non_ip/stream.conf', 'DOMAIN-SUFFIX,shared.test\nDOMAIN,child.shared.test\n'],
      ['/ip/stream.conf', 'IP-CIDR,203.0.113.0/24,no-resolve\nIP-CIDR6,2001:db8::/32\n'],
      ['/domainset/reject_extra.conf', '.shared-reject.test\n.extra.test\n'],
      ['/domainset/reject_phishing.conf', '.shared-reject.test\n.phishing.test\n'],
    ]);
    for (const region of regions) {
      bodies.set(`/non_ip/stream_${region}.conf`, `DOMAIN-SUFFIX,shared.test\nDOMAIN-SUFFIX,${region}.test\n`);
    }
    const server = http.createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      response.end(request.url === '/failed'
        ? '<html><body>upstream unavailable</body></html>'
        : bodies.get(request.url || ''));
    });
    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-sukka-aggregate-'));
    try {
      const configs = ['stream', 'reject_extra', 'stream_us', 'reject_phishing', 'reject', 'my_reject'].map(id => {
        const config = specialRules.find(rule => rule.targetFile === `List/${id}.list`);
        assert.ok(config);
        return { ...config, sourceFiles: config.sourceFiles.map(source => baseUrl + '/' + source.split('/List/')[1]) };
      });
      const processor = new RuleSourceProcessor(createSpan('sukka-aggregate'), outputDir);
      const stats = await processor.processSpecialRules(configs);
      assert.deepEqual(stats.errors, []);
      assert.equal(stats.filesProcessed, 6);
      const before = new Map<string, string>();
      for (const [directory, extension] of [['List', 'list'], ['Clash', 'txt'], ['Loon', 'list']]) {
        const streamPath = path.join(outputDir, directory, `stream.${extension}`);
        const extraPath = path.join(outputDir, directory, `reject_extra.${extension}`);
        const stream = fs.readFileSync(streamPath, 'utf8');
        const extra = fs.readFileSync(extraPath, 'utf8');
        before.set(streamPath, stream);
        before.set(extraPath, extra);
        for (const domain of ['shared.test', ...regions.map(region => `${region}.test`)]) {
          assert.equal(stream.split('\n').filter(line => line.startsWith(`DOMAIN-SUFFIX,${domain}`)).length, 1);
        }
        assert.equal(stream.includes('DOMAIN,child.shared.test'), false);
        assert.equal(stream.includes('7h15.ru1353t'), false);
        // Sukka sources keep their upstream no-resolve choice per rule.
        assert.equal(stream.split('\n').filter(line => line.startsWith('IP-CIDR,203.0.113.0/24')).length, 1);
        assert.ok(stream.split('\n').includes('IP-CIDR,203.0.113.0/24,no-resolve'));
        assert.ok(stream.split('\n').includes('IP-CIDR6,2001:db8::/32'));
        for (const domain of ['shared-reject.test', 'extra.test']) {
          assert.equal(extra.split('\n').filter(line => line.startsWith(`DOMAIN-SUFFIX,${domain}`)).length, 1);
        }
        assert.equal(extra.includes('phishing.test'), false);
        assert.ok(fs.readFileSync(path.join(outputDir, directory, `stream_us.${extension}`), 'utf8').includes('us.test'));
        assert.ok(fs.readFileSync(path.join(outputDir, directory, `reject_phishing.${extension}`), 'utf8').includes('phishing.test'));
      }
      for (const [id, domains] of [
        ['stream', ['shared.test', ...regions.map(region => `${region}.test`)]],
        ['reject_extra', ['shared-reject.test', 'extra.test']],
      ] as const) {
        const file = path.join(outputDir, 'sing-box', `${id}.json`);
        const content = fs.readFileSync(file, 'utf8');
        before.set(file, content);
        const json = JSON.parse(content);
        assert.deepEqual(new Set(json.rules[0].domain_suffix), new Set(domains));
        if (id === 'stream') {
          assert.deepEqual(new Set(json.rules[0].ip_cidr), new Set(['203.0.113.0/24', '2001:db8::/32']));
        }
      }
      for (const [directory, extension] of [['List', 'list'], ['Clash', 'txt'], ['Loon', 'list'], ['sing-box', 'json']]) {
        const base = fs.readFileSync(path.join(outputDir, directory, `reject.${extension}`), 'utf8');
        const personal = fs.readFileSync(path.join(outputDir, directory, `my_reject.${extension}`), 'utf8');
        assert.ok(base.includes('base-block.test'));
        assert.ok(base.includes('other-block.test'));
        assert.ok(base.includes('198.51.100.0/24'));
        if (extension !== 'json') {
          const lines = new Set(base.split('\n'));
          assert.ok(lines.has('IP-CIDR,198.51.100.0/24'));
          assert.ok(lines.has('IP-CIDR,192.0.2.0/24,no-resolve'));
        }
        assert.equal(base.includes('personal-block.test'), false);
        assert.ok(personal.includes('personal-block.test'));
        assert.equal(personal.includes('base-block.test'), false);
      }
      // Reject variants are the upstream files (domainset and non_ip together), not a type-based split.
      for (const [directory, extension] of [['List', 'list'], ['Clash', 'txt'], ['Loon', 'list']]) {
        const read = (slot: string) => new Set(
          fs.readFileSync(path.join(outputDir, directory, slot, `reject.${extension}`), 'utf8').split('\n').filter(line => line && !line.startsWith('#'))
        );
        const merged = read('.');
        assert.ok(merged.has('IP-CIDR,203.0.113.7/32,no-resolve'));
        assert.equal(merged.has('DOMAIN-SUFFIX,base-block.test'), true);
        assert.deepEqual(read('non_ip'), new Set([
          'DOMAIN,other-block.test', 'DOMAIN-SUFFIX,base-block.test', 'IP-CIDR,203.0.113.7/32,no-resolve',
        ]));
        assert.deepEqual(read('ip'), new Set(['IP-CIDR,198.51.100.0/24', 'IP-CIDR,192.0.2.0/24,no-resolve']));
      }
      const nonIp = JSON.parse(fs.readFileSync(path.join(outputDir, 'sing-box/non_ip/reject.json'), 'utf8'));
      assert.deepEqual(nonIp.rules[0].ip_cidr, ['203.0.113.7/32']);
      const mismatched = await processor.processSpecialRules([{ ...configs[4], sourceVariants: ['ip'] }]);
      assert.equal(mismatched.filesProcessed, 0);
      assert.match(mismatched.errors[0].error, /one variant per source/);

      const failures = await processor.processSpecialRules(configs.slice(0, 2).map(config => ({
        ...config,
        sourceFiles: [...config.sourceFiles, `${baseUrl}/failed`],
      })));
      assert.equal(failures.filesProcessed, 0);
      assert.equal(failures.errors.length, 2);
      assert.ok(failures.errors.every(error => error.error.includes('html response')));
      for (const [file, content] of before) assert.equal(fs.readFileSync(file, 'utf8'), content);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
      await new Promise<void>((resolve, reject) => {
        server.close(error => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });
});
