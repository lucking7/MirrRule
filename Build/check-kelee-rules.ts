import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { countEffectiveConditions, sha256Hex } from './lib/output-audit';
import type { RulesetAuditRecord } from './lib/output-audit';
import { rulesetIdFromConfigPath, resolveRuleOutputTarget } from './lib/rule-output-variants';
import { RuleSourceProcessor } from './lib/rule-source-processor';
import type { RuleGroup } from './lib/rule-source-types';
import { ruleGroups } from './lib/rule-sources';
import { createSpan } from './trace';

const ids = ['speedtest_china', 'speedtest_international'];
const platforms = ['surge', 'clash', 'loon', 'singbox'] as const;

export async function verifyKeleeRuleAudits(directory: string, audits: RulesetAuditRecord[]) {
  assert.deepEqual(audits.map(audit => audit.id).sort(), ids, 'Missing or duplicate Speedtest audit');
  return Promise.all(audits.map(async (audit) => {
    assert.equal(audit.sources.length, 1);
    const [source] = audit.sources;
    assert.equal(source.selection, 'primary', `Expected fresh primary input for ${audit.id}`);
    assert.equal(source.selectedUrl, source.configuredUrl);
    assert.ok(source.rawLineCount && source.rawLineCount > 0);
    assert.match(source.rawContentSha256 ?? '', /^[\da-f]{64}$/);
    assert.equal(audit.rawInputSha256, sha256Hex(`raw:${source.rawContentSha256}`));
    const outputs = await Promise.all(platforms.map(async platform => {
      const { relativePath, format } = resolveRuleOutputTarget(platform, 'merged', audit.id);
      const matches = audit.outputs.filter(item => item.platform === platform && item.variant === 'merged');
      assert.equal(matches.length, 1, `Missing or duplicate audit for ${relativePath}`);
      const [item] = matches;
      assert.equal(item.status, 'published');
      assert.equal(item.path, relativePath);
      assert.equal(item.format, format);
      const body = await fs.readFile(path.join(directory, relativePath));
      assert.ok(body.length > 0 && body.length === item.bytes, `Output size mismatch for ${relativePath}`);
      assert.equal(sha256Hex(body), item.sha256, `Output digest mismatch for ${relativePath}`);
      const { effectiveConditionCount } = countEffectiveConditions(format, body.toString('utf8').split('\n'));
      assert.ok(effectiveConditionCount > 0 && effectiveConditionCount === item.effectiveConditionCount);
      return { path: relativePath, platform, bytes: body.length, sha256: item.sha256, effectiveConditionCount };
    }));
    return { id: audit.id, source, rawInputSha256: audit.rawInputSha256, outputs };
  }));
}

export async function checkKeleeRules(directory: string, groups: RuleGroup[] = ruleGroups) {
  assert.ok(!process.env.PUBLICATION_BASELINE_DIR, 'The internal check requires a baseline-free checkout');
  const selected: RuleGroup[] = [];
  for (const group of groups) {
    const files = group.files.filter(file => ids.includes(rulesetIdFromConfigPath(file.path)));
    if (files.length) selected.push({ ...group, files });
  }
  const processor = new RuleSourceProcessor(createSpan('verify-kelee'), directory);
  const stats = await processor.processRuleGroups(selected);
  assert.equal(stats.errors.length, 0, 'One or more Speedtest inputs could not be built');
  return verifyKeleeRuleAudits(directory, stats.audits);
}

if (require.main === module) {
  const temp = process.env.RUNNER_TEMP;
  assert.ok(temp, 'RUNNER_TEMP is required');
  checkKeleeRules(path.join(temp, 'kelee-rules'))
    .then(summary => fs.writeFile(path.join(temp, 'kelee-rule-audit.json'), JSON.stringify(summary)))
    .catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
}
