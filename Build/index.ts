import process from 'node:process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

import { printTraceResult, task, whyIsNodeRunning } from './trace';
import { ROOT_DIR } from './constants/dir';
import { getErrorMessage } from './lib/misc';
import { downloadGEOIP } from './download-geoip';
import { buildPublic } from './build-public';
import { RuleSourceProcessor } from './lib/rule-source-processor';
import { ruleGroups, specialRules } from './lib/rule-sources';
import {
  buildStatusManifest,
  normalizeCommit,
  writeStatusManifestAtomic,
} from './lib/status-manifest';
import type { RulesetSummary } from './lib/rule-source-processor';
import type { Span } from './trace';

interface BuildStepResult {
  name: string;
  success: boolean;
  errors: string[];
  rulesets?: RulesetSummary[];
}

async function executeGeoIpBuildStep(span: Span): Promise<BuildStepResult> {
  try {
    const stats = await downloadGEOIP(span);
    return {
      name: 'geoip',
      success: stats.failed === 0,
      errors: stats.failed > 0 ? [`GEOIP download failed for ${stats.failed} file(s)`] : [],
    };
  } catch (error) {
    return { name: 'geoip', success: false, errors: [getErrorMessage(error)] };
  }
}

async function executeRuleProcessingBuildStep(span: Span, outputDir = 'public'): Promise<BuildStepResult> {
  try {
    const processor = new RuleSourceProcessor(span, outputDir);
    console.log(`Processing ${ruleGroups.length} groups, ${specialRules.length} special rules`);

    const groupStats = await processor.processRuleGroups(ruleGroups);
    console.log(`Groups: ${groupStats.filesProcessed} files, ${groupStats.errors.length} errors`);

    const ruleStats = await processor.processSpecialRules(specialRules);
    console.log(`Special: ${ruleStats.filesProcessed} files, ${ruleStats.rulesMerged} rules merged`);

    const errors = [...groupStats.errors, ...ruleStats.errors].map(
      ({ file, error }: { file: string; error: string }) => `[rule-processing] ${file}: ${error}`
    );

    return {
      name: 'rules',
      success: errors.length === 0,
      errors,
      rulesets: [...groupStats.rulesets, ...ruleStats.rulesets],
    };
  } catch (error) {
    return { name: 'rules', success: false, errors: [getErrorMessage(error)] };
  }
}

async function executeWebBuildStep(): Promise<BuildStepResult> {
  try {
    await buildPublic();
    return { name: 'web', success: true, errors: [] };
  } catch (error) {
    return { name: 'web', success: false, errors: [getErrorMessage(error)] };
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
  const steps = [
    await span.traceChildAsync('download GEOIP', stepSpan => executeGeoIpBuildStep(stepSpan)),
    await span.traceChildAsync('unified rule processing system', stepSpan =>
      executeRuleProcessingBuildStep(stepSpan, 'public')
    ),
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
        // Mirror synchronization is a separate workflow and is not run by this build.
        mirrors: [],
      });
      await writeStatusManifestAtomic(path.join(ROOT_DIR, 'public', 'status.json'), manifest);
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
