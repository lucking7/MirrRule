import type { Span } from '../trace';
import { fetchAssets } from '../utils/network/fetch-assets';
import { loadRules } from '../utils/rule-loader';
import { EnhancedFileOutput } from './enhanced-file-output';
import type { RuleGroup, SpecialRuleConfig } from './rule-source-types';
import { normalizeTargets } from './platform-config';
import { applyDefaultConfig } from './rule-sources';
import { getErrorMessage } from './misc';
import path from 'node:path';
import fs from 'node:fs';

interface ProcessorStats {
  filesProcessed: number;
  rulesMerged: number;
  processingTime: number;
  errors: Array<{ file: string; error: string }>;
}

function createProcessorStats(): ProcessorStats {
  return {
    filesProcessed: 0,
    rulesMerged: 0,
    processingTime: 0,
    errors: [],
  };
}

export class RuleSourceProcessor {
  constructor(private readonly span: Span, private readonly outputDir = 'public') {}

  private static recordError(
    this: void,
    stats: ProcessorStats,
    file: string | undefined,
    error: unknown
  ) {
    stats.errors.push({
      file: file || 'unknown',
      error: getErrorMessage(error),
    });
  }

  private createOutput(
    span: Span,
    fileName: string,
    rawTargets: string[] | undefined,
    defaultPolicy: string | null,
    mergedConfig: ReturnType<typeof applyDefaultConfig>
  ) {
    return new EnhancedFileOutput(
      span,
      fileName,
      '',
      normalizeTargets(rawTargets),
      defaultPolicy,
      mergedConfig,
      this.outputDir
    );
  }

  private async processFileConfig(
    groupSpan: Span,
    group: RuleGroup,
    fileConfig: RuleGroup['files'][number],
    stats: ProcessorStats
  ) {
    try {
      const rules = await groupSpan
        .traceChild('download')
        .traceAsyncFn(() =>
          fetchAssets(fileConfig.url, fileConfig.fallbackUrls || null, true)
        );

      const mergedConfig = applyDefaultConfig(fileConfig);
      const fileExt = path.extname(fileConfig.path);
      const fileName = path.basename(fileConfig.path, fileExt).toLowerCase();

      const output = this.createOutput(
        groupSpan,
        fileName,
        group.targets,
        group.defaultPolicy === undefined ? null : group.defaultPolicy,
        mergedConfig
      );

      output
        .withTitle(fileConfig.title || group.name)
        .withDescription([
          fileConfig.description || group.description || `Rules for ${group.name}`,
          `Source: ${fileConfig.url}`,
        ]);

      output.addRules(rules);
      await output.write();

      stats.filesProcessed++;
      stats.rulesMerged += rules.length;
    } catch (error) {
      RuleSourceProcessor.recordError(stats, fileConfig.path, error);
    }
  }

  private static async loadSpecialRuleSource(
    this: void,
    ruleSpan: Span,
    source: string,
    stats: ProcessorStats
  ): Promise<string[]> {
    try {
      return await ruleSpan
        .traceChild('load')
        .traceAsyncFn(() => loadRules(source, { throwOnError: true }));
    } catch (error) {
      RuleSourceProcessor.recordError(stats, source, error);
      return [];
    }
  }

  async processRuleGroups(groups: RuleGroup[]): Promise<ProcessorStats> {
    const startTime = Date.now();
    const stats = createProcessorStats();

    for (const group of groups) {
      try {
        // Keep groups sequential to preserve deterministic trace ordering.
        // eslint-disable-next-line no-await-in-loop -- deterministic build trace/output order
        await this.span.traceChildAsync(`process group: ${group.name}`, async groupSpan => {
          if (group.files.length === 0) return;

          for (const fileConfig of group.files) {
            // Keep file processing sequential so trace output and generated files remain deterministic.
            // eslint-disable-next-line no-await-in-loop -- deterministic build trace/output order
            await this.processFileConfig(groupSpan, group, fileConfig, stats);
          }
        });
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        stats.errors.push({ file: group.name, error: errorMsg });
      }
    }

    stats.processingTime = Date.now() - startTime;
    return stats;
  }

  async processSpecialRules(rules: SpecialRuleConfig[]): Promise<ProcessorStats> {
    const startTime = Date.now();
    const stats = createProcessorStats();

    for (const ruleConfig of rules) {
      try {
        // Keep special rules sequential to preserve deterministic trace ordering.
        // eslint-disable-next-line no-await-in-loop -- deterministic build trace/output order
        await this.span.traceChildAsync(`process special: ${ruleConfig.name}`, async ruleSpan => {
          const errorCountBeforeSources = stats.errors.length;

          const allRules: string[] = [];
          for (const source of ruleConfig.sourceFiles) {
            // Keep source loading sequential so partial failures are reported in config order.
            // eslint-disable-next-line no-await-in-loop -- deterministic error reporting order
            const loadedRules = await RuleSourceProcessor.loadSpecialRuleSource(
              ruleSpan,
              source,
              stats
            );
            allRules.push(...loadedRules);
          }

          if (stats.errors.length > errorCountBeforeSources) {
            return;
          }

          if (allRules.length === 0) {
            RuleSourceProcessor.recordError(
              stats,
              ruleConfig.targetFile,
              new Error(`No rules loaded for special rule "${ruleConfig.name}"`)
            );
            return;
          }

          const mergedConfig = applyDefaultConfig(ruleConfig);
          const fileName = ruleConfig.targetFile
            ? path.basename(ruleConfig.targetFile, path.extname(ruleConfig.targetFile))
            : ruleConfig.name.toLowerCase();

          const output = this.createOutput(
            ruleSpan,
            fileName,
            ruleConfig.targets,
            ruleConfig.defaultPolicy === undefined ? null : ruleConfig.defaultPolicy,
            mergedConfig
          );

          output
            .withTitle(ruleConfig.name)
            .withDescription([
              ruleConfig.description || `Rules for ${ruleConfig.name}`,
              `Merged from ${ruleConfig.sourceFiles.length} sources`,
            ]);

          output.addRules(allRules);
          await output.write();

          stats.filesProcessed++;
          stats.rulesMerged += allRules.length;

          if (ruleConfig.deleteSourceFiles) {
            for (const sourceUrl of ruleConfig.sourceFiles) {
              try {
                const sourcePath = path.join(this.outputDir, path.basename(sourceUrl));
                if (fs.existsSync(sourcePath)) {
                  fs.unlinkSync(sourcePath);
                }
              } catch {
                // Ignore delete failures
              }
            }
          }
        });
      } catch (error) {
        RuleSourceProcessor.recordError(stats, ruleConfig.targetFile, error);
      }
    }

    stats.processingTime = Date.now() - startTime;
    return stats;
  }
}
