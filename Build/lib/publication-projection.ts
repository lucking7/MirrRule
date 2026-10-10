import fs from 'node:fs/promises';
import path from 'node:path';

import { createRuleCoverageReport, writeRuleCoverageReport } from '../audit-rule-coverage';
import { findLifecycleRecord, isRetiredPublicPath } from './artifact-lifecycle';
import { writeFileAtomic } from './atomic-file';
import { toSourceId, sourceSnapshotPath, listSourceSnapshotFiles } from './output-audit';
import { RULE_OUTPUT_AUDIT_FILE } from './publication-outputs';
import type { AuditOutput } from './publication-outputs';

type ProjectionOutput = AuditOutput & Record<string, unknown> & { platform?: string };
interface ProjectionRuleset extends Record<string, unknown> {
  id: string,
  outputs: ProjectionOutput[],
  snapshotPath?: string,
  effectiveOutputs?: Array<{ platform: string }>
}
interface ProjectionAudit extends Record<string, unknown> {
  rulesets: ProjectionRuleset[],
  summary?: Record<string, number>,
  retiredOutputs?: Array<ProjectionOutput & { rulesetId: string, lifecycleId: string }>
}

/** Project only registered retirements after the original output contract was verified. */
export async function projectRetiredRuleOutputs(root: string): Promise<{ changed: boolean, retiredPaths: string[], changedFiles: string[] }> {
  const file = path.join(root, RULE_OUTPUT_AUDIT_FILE);
  const audit = JSON.parse(await fs.readFile(file, 'utf8')) as ProjectionAudit;
  const retiredOutputs: NonNullable<ProjectionAudit['retiredOutputs']> = [];
  const fullyRetired = new Set<string>();
  const retiredPlatforms = new Map<string, Set<string>>();
  const changedFiles: string[] = [];
  const snapshotFiles = await listSourceSnapshotFiles(root);
  for (const ruleset of audit.rulesets) {
    const removed = ruleset.outputs.filter(output => isRetiredPublicPath(output.path));
    if (!removed.length) continue;
    const active = ruleset.outputs.filter(output => !isRetiredPublicPath(output.path));
    for (const output of removed) {
      retiredOutputs.push({ ...output, rulesetId: ruleset.id, lifecycleId: findLifecycleRecord(output.path)!.id });
    }
    ruleset.outputs = active;
    const activePlatforms = new Set<string>();
    for (const output of active) if (output.platform) activePlatforms.add(output.platform);
    const removedPlatforms = new Set<string>();
    for (const output of removed) if (output.platform && !activePlatforms.has(output.platform)) removedPlatforms.add(output.platform);
    retiredPlatforms.set(ruleset.id, removedPlatforms);
    if (Array.isArray(ruleset.platforms)) ruleset.platforms = ruleset.platforms.filter(platform => !removedPlatforms.has(String(platform)));
    if (ruleset.effectiveOutputs) ruleset.effectiveOutputs = ruleset.effectiveOutputs.filter(output => !removedPlatforms.has(output.platform));
    if (!active.length) fullyRetired.add(ruleset.id);
  }
  if (!retiredOutputs.length) return { changed: false, retiredPaths: [], changedFiles };

  for (const ruleset of audit.rulesets) {
    if (!fullyRetired.has(ruleset.id)) continue;
    const sourceId = toSourceId(ruleset.id);
    const filename = snapshotFiles.get(sourceId);
    const expected = filename ? `Internal/source-snapshots/${filename}` : sourceSnapshotPath(sourceId);
    if (ruleset.snapshotPath !== undefined && ruleset.snapshotPath !== expected) {
      throw new Error(`Retired ruleset ${ruleset.id} has an unexpected snapshot path: ${ruleset.snapshotPath}`);
    }
    // eslint-disable-next-line no-await-in-loop -- delete only the stable snapshot belonging to this ruleset
    await fs.rm(path.join(root, expected), { force: true });
  }
  audit.rulesets = audit.rulesets.filter(record => !fullyRetired.has(record.id));
  audit.retiredOutputs = [...(audit.retiredOutputs ?? []), ...retiredOutputs];
  const outputs = audit.rulesets.flatMap(record => record.outputs);
  audit.summary = {
    ...audit.summary,
    rulesets: audit.rulesets.length,
    outputs: outputs.length,
    published: outputs.filter(output => output.status === 'published').length,
    absentEmpty: outputs.filter(output => output.status === 'absent-empty').length,
    absentUnsupported: outputs.filter(output => output.status === 'absent-unsupported').length,
    retired: audit.retiredOutputs.length,
  };
  await writeFileAtomic(file, `${JSON.stringify(audit, null, 2)}\n`);
  changedFiles.push(RULE_OUTPUT_AUDIT_FILE);

  const statusPath = path.join(root, 'status.json');
  const status = JSON.parse(await fs.readFile(statusPath, 'utf8')) as { rulesets: Array<{ id: string, platforms?: string[] }> };
  status.rulesets = status.rulesets.filter(record => !fullyRetired.has(record.id));
  for (const record of status.rulesets) {
    const removed = retiredPlatforms.get(record.id);
    if (removed && record.platforms) record.platforms = record.platforms.filter(platform => !removed.has(platform));
  }
  await writeFileAtomic(statusPath, `${JSON.stringify(status, null, 2)}\n`);
  changedFiles.push('status.json');

  // Deleted subscriptions invalidate historical overlap findings; recompute the public example against this tree.
  await writeRuleCoverageReport(await createRuleCoverageReport({ rulesDir: path.join(root, 'List') }), path.join(root, 'Internal/rule-coverage.json'));
  changedFiles.push('Internal/rule-coverage.json');
  return { changed: true, retiredPaths: retiredOutputs.map(output => output.path), changedFiles };
}
