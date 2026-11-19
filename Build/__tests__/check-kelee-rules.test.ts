import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import { checkKeleeRules, verifyKeleeRuleAudits } from '../check-kelee-rules';
import { sha256Hex } from '../lib/output-audit';
import { RuleSourceProcessor } from '../lib/rule-source-processor';
import type { RuleGroup } from '../lib/rule-source-types';
import { createSpan } from '../trace';

it('verifies eight fresh Speedtest outputs and rejects baseline inputs or altered bytes', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'verify-kelee-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.end(`DOMAIN,${req.url?.slice(1)}.example\nIP-CIDR,192.0.2.0/24\n`);
  });
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const group: RuleGroup = {
    name: 'Fixture', targets: ['surge', 'clash', 'singbox', 'loon'],
    files: ['speedtest_china', 'speedtest_international'].map(id => ({
      path: `List/${id}.list`, url: `http://127.0.0.1:${address.port}/${id}`,
    })),
  };
  const receipts = await checkKeleeRules(dir, [group]);
  assert.equal(receipts.length, 2);
  for (const receipt of receipts) {
    assert.equal(receipt.outputs.length, 4);
    assert.equal(receipt.source.rawContentSha256, sha256Hex(`DOMAIN,${receipt.id}.example\nIP-CIDR,192.0.2.0/24\n`));
    assert.ok(!JSON.stringify(receipt).includes('.example'));
  }
  const { audits } = await new RuleSourceProcessor(createSpan('fixture'), dir).processRuleGroups([group]);
  const baseline = structuredClone(audits);
  baseline[0].sources[0].selection = 'baseline-snapshot';
  await assert.rejects(verifyKeleeRuleAudits(dir, baseline), /fresh primary/);
  const file = path.join(dir, receipts[0].outputs[0].path);
  const body = await fs.readFile(file);
  body[0] ^= 1;
  await fs.writeFile(file, body);
  await assert.rejects(verifyKeleeRuleAudits(dir, audits), /digest mismatch/);
});
