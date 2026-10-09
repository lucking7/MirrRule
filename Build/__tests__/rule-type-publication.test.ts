import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import { RuleSourceProcessor } from '../lib/rule-source-processor';
import { createSpan } from '../trace';

it('preserves every published platform when type filtering removes all conditions', async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('USER-AGENT,WeChat*\n');
  });
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address() as AddressInfo;
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-rule-type-publication-'));
  const paths = [['List', 'list'], ['Clash', 'txt'], ['Loon', 'list'], ['sing-box', 'json']]
    .map(([directory, extension]) => path.join(outputDir, directory, `wechat_no_ua.${extension}`));
  for (const file of paths) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'last-known-good');
  }
  try {
    const stats = await new RuleSourceProcessor(createSpan('rule-type-publication'), outputDir)
      .processSpecialRules([{
        name: 'WeChat without UA',
        targetFile: 'List/wechat_no_ua.list',
        sourceFiles: [`http://127.0.0.1:${port}/wechat.list`],
        targets: ['surge', 'clash', 'singbox', 'loon'],
        excludedRuleTypes: ['USER-AGENT'],
        defaultPolicy: null,
      }]);
    assert.equal(stats.filesProcessed, 0);
    assert.equal(stats.errors.length, 1);
    assert.match(stats.errors[0].error, /No rules remain after rule type filtering/);
    assert.deepEqual(stats.rulesets, []);
    for (const file of paths) assert.equal(fs.readFileSync(file, 'utf8'), 'last-known-good');
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    await new Promise<void>((resolve, reject) => {
      server.close(error => { if (error) reject(error); else resolve(); });
    });
  }
});
