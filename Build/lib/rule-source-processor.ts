import type { Span } from '../trace';
import { boundedMap } from '../utils/concurrency';
import { fetchAssets } from '../utils/network/fetch-assets';
import { loadRules } from '../utils/rule-loader';
import { EnhancedFileOutput } from './enhanced-file-output';
import type {
  FileConfig,
  RuleGroup,
  RulePolicy,
  RuleTarget,
  SpecialRuleConfig,
} from './rule-source-types';
import { normalizeTargets } from './platform-config';
import type { SupportedPlatform } from './platform-config';
import { applyDefaultConfig } from './rule-sources';
import { getErrorMessage } from './misc';
import path from 'node:path';
import fs from 'node:fs';

export interface RulesetSummary {
  id: string;
  platforms: SupportedPlatform[];
  ruleCount: number;
}

interface ProcessorStats {
  filesProcessed: number;
  rulesMerged: number;
  processingTime: number;
  errors: Array<{ file: string; error: string }>;
  rulesets: RulesetSummary[];
}

type DownloadResult =
  | { ok: true; rules: string[] }
  | { ok: false; error: Error };

interface RulesetPublication {
  path: string;
  title: string;
  description: string[];
  targets?: RuleTarget[];
  defaultPolicy: RulePolicy;
  options: FileConfig | SpecialRuleConfig;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(getErrorMessage(error));
}

function createProcessorStats(): ProcessorStats {
  return {
    filesProcessed: 0,
    rulesMerged: 0,
    processingTime: 0,
    errors: [],
    rulesets: [],
  };
}

function appendRuleBatch(target: string[], source: readonly string[]): void {
  for (const rule of source) {
    target.push(rule);
  }
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

  private async publishRuleset(
    span: Span,
    rules: string[],
    publication: RulesetPublication
  ): Promise<RulesetSummary> {
    const mergedConfig = applyDefaultConfig(publication.options);
    const fileName = path.basename(
      publication.path,
      path.extname(publication.path)
    ).toLowerCase();
    const output = this.createOutput(
      span,
      fileName,
      publication.targets,
      publication.defaultPolicy,
      mergedConfig
    );

    output
      .withTitle(publication.title)
      .withDescription(publication.description);
    output.addRules(rules);
    await output.write();
    return output.getOutputSummary();
  }

  private async processFileConfig(
    groupSpan: Span,
    group: RuleGroup,
    fileConfig: RuleGroup['files'][number],
    stats: ProcessorStats,
    downloadResult: DownloadResult
  ) {
    if (!downloadResult.ok) {
      RuleSourceProcessor.recordError(stats, fileConfig.path, downloadResult.error);
      return;
    }

    try {
      const rules = downloadResult.rules;

      const summary = await this.publishRuleset(
        groupSpan,
        rules,
        {
          path: fileConfig.path,
          title: fileConfig.title || group.name,
          description: [
            fileConfig.description || group.description || `Rules for ${group.name}`,
            `Source: ${fileConfig.url}`,
          ],
          targets: group.targets,
          defaultPolicy: group.defaultPolicy === undefined ? null : group.defaultPolicy,
          options: fileConfig,
        }
      );

      stats.filesProcessed++;
      stats.rulesMerged += rules.length;
      stats.rulesets.push(summary);
    } catch (error) {
      RuleSourceProcessor.recordError(stats, fileConfig.path, error);
    }
  }

  private static async loadSpecialRuleSource(
    this: void,
    ruleSpan: Span,
    source: string,
    allowEmpty: boolean
  ): Promise<DownloadResult> {
    try {
      const rules = await ruleSpan
        .traceChild('load')
        .traceAsyncFn(() => loadRules(source, { throwOnError: true, allowEmpty }));
      return { ok: true, rules };
    } catch (error) {
      return { ok: false, error: toError(error) };
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

          const downloads = await boundedMap(group.files, async (fileConfig): Promise<DownloadResult> => {
            try {
              const rules = await groupSpan
                .traceChild('download')
                .traceAsyncFn(() =>
                  fetchAssets(
                    fileConfig.url,
                    fileConfig.fallbackUrls || null,
                    true,
                    fileConfig.allowEmpty ?? false
                  )
                );
              return { ok: true, rules };
            } catch (error) {
              return { ok: false, error: toError(error) };
            }
          });

          for (const [index, fileConfig] of group.files.entries()) {
            // Downloads are collected by index; writes and stats remain in configuration order.
            // eslint-disable-next-line no-await-in-loop -- deterministic build trace/output order
            await this.processFileConfig(groupSpan, group, fileConfig, stats, downloads[index]);
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

          const sourceResults = await boundedMap(ruleConfig.sourceFiles, source =>
            RuleSourceProcessor.loadSpecialRuleSource(
              ruleSpan,
              source,
              ruleConfig.allowEmpty ?? false
            )
          );

          const allRules: string[] = [];
          for (const [index, source] of ruleConfig.sourceFiles.entries()) {
            const result = sourceResults[index];
            if (!result.ok) {
              RuleSourceProcessor.recordError(stats, source, result.error);
            } else {
              appendRuleBatch(allRules, result.rules);
            }
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

          const summary = await this.publishRuleset(
            ruleSpan,
            allRules,
            {
              path: ruleConfig.targetFile,
              title: ruleConfig.name,
              description: [
                ruleConfig.description || `Rules for ${ruleConfig.name}`,
                `Merged from ${ruleConfig.sourceFiles.length} sources`,
              ],
              targets: ruleConfig.targets,
              defaultPolicy: ruleConfig.defaultPolicy === undefined ? null : ruleConfig.defaultPolicy,
              options: ruleConfig,
            }
          );

          stats.filesProcessed++;
          stats.rulesMerged += allRules.length;
          stats.rulesets.push(summary);

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
