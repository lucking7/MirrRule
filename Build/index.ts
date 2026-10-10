import process from 'node:process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

import { printTraceResult, task, whyIsNodeRunning } from './trace';
import { PUBLIC_DIR, ROOT_DIR } from './constants/dir';
import { getErrorMessage } from './lib/misc';
import { downloadGEOIP } from './download-geoip';
import { buildPublic } from './build-public';
import { RuleSourceProcessor } from './lib/rule-source-processor';
import { ruleGroups, specialRules } from './lib/rule-sources';
import { auditRulesDirectory, writeRuleCoverageReport } from './audit-rule-coverage';
import {
  buildStatusManifest,
  normalizeCommit,
  writeStatusManifestAtomic,
} from './lib/status-manifest';
import { RULE_OUTPUT_AUDIT_PATH, SOURCE_DELTA_PATH, writeRuleOutputReports } from './lib/output-audit';
import type { RulesetAuditRecord } from './lib/output-audit';
import type { RulesetSummary } from './lib/rule-source-processor';
import type { Span } from './trace';

interface BuildStepResult {
  success: boolean;
  errors: string[];
  rulesets?: RulesetSummary[];
  audits?: RulesetAuditRecord[];
}

async function executeGeoIpBuildStep(span: Span): Promise<BuildStepResult> {
  try {
    const stats = await downloadGEOIP(span);
    return {
      success: stats.failed === 0,
      errors: stats.failed > 0 ? [`GEOIP download failed for ${stats.failed} file(s)`] : [],
    };
  } catch (error) {
    return { success: false, errors: [getErrorMessage(error)] };
  }
}

async function executeRuleProcessingBuildStep(span: Span): Promise<BuildStepResult> {
  try {
    const processor = new RuleSourceProcessor(span);
    console.log(`Processing ${ruleGroups.length} groups, ${specialRules.length} special rules`);

    const groupStats = await processor.processRuleGroups(ruleGroups);
    console.log(`Groups: ${groupStats.filesProcessed} files, ${groupStats.errors.length} errors`);

    const ruleStats = await processor.processSpecialRules(specialRules);
    console.log(`Special: ${ruleStats.filesProcessed} files, ${ruleStats.rulesMerged} rules merged`);

    const errors = [...groupStats.errors, ...ruleStats.errors].map(
      ({ file, error }: { file: string; error: string }) => `[rule-processing] ${file}: ${error}`
    );

    return {
      success: errors.length === 0,
      errors,
      rulesets: [...groupStats.rulesets, ...ruleStats.rulesets],
      audits: [...groupStats.audits, ...ruleStats.audits],
    };
  } catch (error) {
    return { success: false, errors: [getErrorMessage(error)] };
  }
}

/**
 * PUBLICATION_BASELINE_DIR is the absolute root of an accepted published tree whose
 * Internal/source-snapshots are compared; PUBLICATION_BASELINE_RECEIPT_ID names its receipt.
 */
async function executeRuleOutputReportStep(records: RulesetAuditRecord[]): Promise<BuildStepResult> {
  try {
    const baselineDir = process.env.PUBLICATION_BASELINE_DIR?.trim() || null;
    if (baselineDir !== null && !path.isAbsolute(baselineDir)) {
      throw new Error('PUBLICATION_BASELINE_DIR must be an absolute path');
    }
    const { warnings } = await writeRuleOutputReports({
      outputRoot: PUBLIC_DIR,
      records,
      generatedAt: new Date().toISOString(),
      baselineDir,
      baselineReceiptId: process.env.PUBLICATION_BASELINE_RECEIPT_ID?.trim() || null,
    });
    for (const warning of warnings) console.warn(`[source-delta] ${warning}`);
    return { success: true, errors: [] };
  } catch (error) {
    return { success: false, errors: [`[rule-output-audit] ${getErrorMessage(error)}`] };
  }
}

async function executeWebBuildStep(): Promise<BuildStepResult> {
  try {
    await buildPublic();
    return { success: true, errors: [] };
  } catch (error) {
    return { success: false, errors: [getErrorMessage(error)] };
  }
}

async function executeCoverageAuditStep(): Promise<BuildStepResult> {
  try {
    const report = await auditRulesDirectory(path.join(PUBLIC_DIR, 'List'));
    if (report.summary.missingLocalSubscriptions > 0) {
      throw new Error('Coverage audit is missing required local subscriptions');
    }
    await writeRuleCoverageReport(report, path.join(PUBLIC_DIR, 'Internal', 'rule-coverage.json'));
    return { success: true, errors: [] };
  } catch (error) {
    return { success: false, errors: [`[rule-coverage] ${getErrorMessage(error)}`] };
  }
}

export const buildRuleset = task(
  require.main === module,
  __filename
)(async span => {
  console.log(`Node.js ${process.versions.node} on ${os.type()} ${os.arch()}`);

  const buildFinishedLock = path.join(ROOT_DIR, '.BUILD_FINISHED');
  if (fs.existsSync(buildFinishedLock)) {
    fs.unlinkSync(buildFinishedLock);
  }

  console.log('Starting ruleset build...');
  const geoIpStep = await span.traceChildAsync('download GEOIP', stepSpan => executeGeoIpBuildStep(stepSpan));
  const ruleStep = await span.traceChildAsync('unified rule processing system', stepSpan =>
    executeRuleProcessingBuildStep(stepSpan)
  );
  const reportStep = ruleStep.success
    ? await span.traceChildAsync('rule output audit', () => executeRuleOutputReportStep(ruleStep.audits ?? []))
    : { success: false, errors: ['[rule-output-audit] Skipped because rule processing failed'] };
  const coverageStep = ruleStep.success
    ? await span.traceChildAsync('cross-subscription coverage audit', () => executeCoverageAuditStep())
    : { success: false, errors: ['[rule-coverage] Skipped because rule processing failed'] };
  const steps = [
    geoIpStep,
    ruleStep,
    reportStep,
    coverageStep,
    await span.traceChildAsync('build web page', () => executeWebBuildStep()),
  ];

  const allErrors = steps.flatMap(step => step.errors);
  const allSuccess = steps.every(step => step.success);

  if (allSuccess) {
    try {
      const buildTime = new Date().toISOString();
      const rulesets = steps.flatMap(step => step.rulesets ?? []);
      const manifest = buildStatusManifest({
        buildTime,
        commit: normalizeCommit(process.env.GITHUB_SHA),
        rulesets,
        reports: { ruleOutputAudit: RULE_OUTPUT_AUDIT_PATH, sourceDelta: SOURCE_DELTA_PATH },
        // Mirror synchronization is a separate workflow and is not run by this build.
        mirrors: [],
      });
      await writeStatusManifestAtomic(path.join(PUBLIC_DIR, 'status.json'), manifest);
      fs.writeFileSync(buildFinishedLock, 'BUILD_FINISHED\n');
    } catch (error) {
      console.error(`[status-manifest] ${getErrorMessage(error)}`);
      console.error('Build completed with errors — .BUILD_FINISHED not written');
      process.exitCode = 1;
    }
  } else {
    for (const error of allErrors) {
      console.error(error);
    }
    console.error('Build completed with errors — .BUILD_FINISHED not written');
    process.exitCode = 1;
  }

  printTraceResult(span.traceResult);
  await whyIsNodeRunning();
});
