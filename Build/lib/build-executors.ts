import type { Span } from '../trace';
import { getErrorMessage } from '../utils/cli/logger';
import { createBuildStepResult } from './build-pipeline';

export async function executeGeoIpBuildStep(span: Span) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy loading keeps the orchestration layer thin
  const { downloadGEOIP } = require('../download-geoip.ts');

  try {
    const stats = await downloadGEOIP(span);
    return createBuildStepResult('geoip', stats.failed === 0, stats.failed > 0
      ? [`GEOIP download failed for ${stats.failed} file(s)`]
      : [], {
      success: stats.success,
      failed: stats.failed,
      total: stats.total,
    });
  } catch (error) {
    return createBuildStepResult('geoip', false, [getErrorMessage(error)]);
  }
}

export async function executeRuleProcessingBuildStep(span: Span, outputDir = 'public') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy loading keeps the orchestration layer thin
    const { RuleSourceProcessor } = require('./rule-source-processor.ts');
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy loading keeps the orchestration layer thin
    const { ruleGroups, specialRules } = require('./rule-sources.ts');

    const processor = new RuleSourceProcessor(span, outputDir);
    console.log(`Processing ${ruleGroups.length} groups, ${specialRules.length} special rules`);

    const groupStats = await processor.processRuleGroups(ruleGroups);
    console.log(`Groups: ${groupStats.filesProcessed} files, ${groupStats.errors.length} errors`);

    const ruleStats = await processor.processSpecialRules(specialRules);
    console.log(`Special: ${ruleStats.filesProcessed} files, ${ruleStats.rulesMerged} rules merged`);

    const errors = [...groupStats.errors, ...ruleStats.errors].map(
      ({ file, error }) => `[rule-processing] ${file}: ${error}`
    );

    return createBuildStepResult('rules', errors.length === 0, errors, {
      groupsProcessed: groupStats.filesProcessed,
      specialProcessed: ruleStats.filesProcessed,
      rulesMerged: ruleStats.rulesMerged,
    });
  } catch (error) {
    return createBuildStepResult('rules', false, [getErrorMessage(error)]);
  }
}

export async function executeWebBuildStep() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy loading keeps the orchestration layer thin
    const { buildPublic } = require('../build-public.ts');
    await buildPublic();
    return createBuildStepResult('web', true);
  } catch (error) {
    return createBuildStepResult('web', false, [getErrorMessage(error)]);
  }
}
