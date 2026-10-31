import path from 'node:path';
import process from 'node:process';
import type { Span } from '../trace';
import { boundedMap } from '../utils/concurrency';
import { PUBLIC_DIR } from '../constants/dir';
import { fetchAssets } from '../utils/network/fetch-assets';
import type { FetchAssetsSelection } from '../utils/network/fetch-assets';
import { loadRules } from '../utils/rule-loader';
import { EnhancedFileOutput } from './enhanced-file-output';
import type {
  FileConfig,
  RuleGroup,
  RulePolicy,
  RuleProcessingOptions,
  RuleTarget,
  SpecialRuleConfig,
} from './rule-source-types';
import { normalizeTargets } from './platform-config';
import type { SupportedPlatform } from './platform-config';
import { getErrorMessage } from './misc';
import { rulesetIdFromConfigPath } from './rule-output-variants';
import type { RuleOutputVariant } from './rule-output-variants';
import { observeSourceDownloads, readBaselineSnapshot, RULE_OUTPUT_CONVERTER_VERSION, sha256Hex, toPublicSourceUrl, toSourceId } from './output-audit';
import type { RulesetAuditRecord, RulesetOutputAudit, SourceProvenance } from './output-audit';

export interface RulesetSummary {
  id: string;
  platforms: SupportedPlatform[];
  ruleCount: number;
}

interface ProcessorStats {
  filesProcessed: number;
  rulesMerged: number;
  errors: Array<{ file: string; error: string }>;
  rulesets: RulesetSummary[];
  /** Output audit of each successfully published ruleset, in publication order. */
  audits: RulesetAuditRecord[];
}

/** One loaded source: public provenance plus the same-download raw input facts. */
interface SourceInput {
  provenance: SourceProvenance;
  selection: FetchAssetsSelection | undefined;
  rules: readonly string[];
}

type DownloadResult =
  | { ok: true; rules: string[]; selection?: FetchAssetsSelection }
  | { ok: false; error: Error };

/**
 * Explicit publication contract: `id` names the flat files `<PlatformDir>/<id>.<ext>`
 * and the variant files `<PlatformDir>/<variant>/<id>.<ext>`.
 */
interface RulesetPublication {
  id: string;
  /** Configured path, used only in error messages. */
  path: string;
  sources: SourceInput[];
  /** One variant per source; replaces type-based variant classification. */
  sourceVariants?: readonly RuleOutputVariant[];
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
    errors: [],
    rulesets: [],
    audits: [],
  };
}

function buildSourceProvenance(
  configuredUrl: string,
  fallbackUrls: readonly string[] | undefined,
  selection: FetchAssetsSelection | undefined
): SourceProvenance {
  return {
    configuredUrl: toPublicSourceUrl(configuredUrl),
    fallbackUrls: (fallbackUrls ?? []).map(toPublicSourceUrl),
    selectedUrl: selection ? toPublicSourceUrl(selection.sourceUrl) : null,
    selection: selection ? (selection.fallbackIndex < 0 ? 'primary' : 'fallback') : 'unknown',
    fallbackIndex: selection && selection.fallbackIndex >= 0 ? selection.fallbackIndex : null,
    viaProxy: selection?.viaProxy ?? null,
    responseAgeSeconds: selection?.responseAgeSeconds ?? null,
    rawContentSha256: selection?.rawContentSha256 ?? null,
    rawLineCount: selection?.rawLines.total ?? null,
  };
}

/**
 * Fold pre-cleaning facts from the downloads into the ruleset audit. fetchAssets drops
 * empty and comment lines before EnhancedFileOutput sees them, so those are added back,
 * and the raw digest covers the response bodies rather than the cleaned lines.
 */
function withSourceInputs(audit: RulesetOutputAudit, sources: readonly SourceInput[]): RulesetAuditRecord {
  let emptyLines = 0;
  let commentsOrMarkers = 0;
  const digests: string[] = [];
  for (const source of sources) {
    emptyLines += source.selection?.rawLines.emptyLines ?? 0;
    commentsOrMarkers += source.selection?.rawLines.commentsOrMarkers ?? 0;
    // Unobserved loaders (sing-box JSON, local modules) fall back to the loaded lines.
    digests.push(source.selection ? `raw:${source.selection.rawContentSha256}` : `lines:${sha256Hex(source.rules.join('\n'))}`);
  }
  return {
    ...audit,
    stages: {
      ...audit.stages,
      inputLines: audit.stages.inputLines + emptyLines + commentsOrMarkers,
      filtered: {
        ...audit.stages.filtered,
        emptyLines: audit.stages.filtered.emptyLines + emptyLines,
        commentsOrMarkers: audit.stages.filtered.commentsOrMarkers + commentsOrMarkers,
      },
    },
    rawInputSha256: sha256Hex(digests.join('\n')),
    sources: sources.map(source => source.provenance),
  };
}

function appendRuleBatch(target: string[], source: readonly string[]): void {
  for (const rule of source) {
    target.push(rule);
  }
}

export class RuleSourceProcessor {
  constructor(private readonly span: Span, private readonly outputDir = PUBLIC_DIR) {}

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
    options: RuleProcessingOptions
  ) {
    return new EnhancedFileOutput(
      span,
      fileName,
      normalizeTargets(rawTargets),
      defaultPolicy,
      options,
      this.outputDir
    );
  }

  private async publishRuleset(
    span: Span,
    rules: string[],
    publication: RulesetPublication
  ): Promise<{ summary: RulesetSummary; audit: RulesetAuditRecord }> {
    const output = this.createOutput(
      span,
      publication.id,
      publication.targets,
      publication.defaultPolicy,
      publication.options
    );

    output
      .withTitle(publication.title)
      .withDescription(publication.description);
    output.addRules(rules);
    if (publication.sourceVariants) {
      if (publication.sourceVariants.length !== publication.sources.length) {
        throw new Error(`sourceVariants must list one variant per source: ${publication.path}`);
      }
      for (const [index, source] of publication.sources.entries()) {
        output.addVariantSource(publication.sourceVariants[index], [...source.rules]);
      }
    }
    if (
      (
        publication.options.sourcePolicies !== undefined ||
        publication.options.excludedRuleTypes !== undefined ||
        publication.options.excludedRules !== undefined
      ) &&
      !publication.options.allowEmpty &&
      output.getOutputSummary().ruleCount === 0
    ) {
      const filter = publication.options.sourcePolicies !== undefined
        ? 'source policy'
        : (publication.options.excludedRuleTypes === undefined ? 'rule' : 'rule type');
      throw new Error(`No rules remain after ${filter} filtering: ${publication.path}`);
    }
    const audit = await output.write();
    return {
      summary: output.getOutputSummary(),
      audit: withSourceInputs(audit, publication.sources),
    };
  }

  /**
   * When a ruleset cannot be downloaded, republish the conditions stored in the accepted
   * baseline's source snapshot, so one unreachable upstream does not stop every other ruleset
   * from updating. The snapshot holds the canonical conditions after processing; running them
   * through the same options reproduces the accepted outputs. Returns null without a usable
   * snapshot, and throws when the result differs from the snapshot, because the configuration
   * then no longer matches what the baseline published.
   */
  private async republishBaselineSnapshot(
    span: Span,
    publication: Omit<RulesetPublication, 'sources' | 'sourceVariants'>,
    configured: SourceProvenance[],
    failure: Error
  ): Promise<{ summary: RulesetSummary, audit: RulesetAuditRecord } | null> {
    const baselineDir = process.env.PUBLICATION_BASELINE_DIR?.trim();
    if (!baselineDir || !path.isAbsolute(baselineDir)) return null;
    const baseline = await readBaselineSnapshot(baselineDir, toSourceId(publication.id));
    if (baseline.kind !== 'snapshot' || baseline.snapshot.converterVersion !== RULE_OUTPUT_CONVERTER_VERSION) return null;
    const { conditions, contextSha256, semanticSha256 } = baseline.snapshot;
    if (conditions.length === 0) return null;
    const sources = configured.map((provenance, index) => ({
      provenance: { ...provenance, selection: 'baseline-snapshot' as const },
      selection: undefined,
      rules: index === 0 ? conditions : [],
    }));
    const result = await this.publishRuleset(span, conditions, { ...publication, sources });
    if (result.audit.contextSha256 !== contextSha256 || result.audit.semanticSha256 !== semanticSha256) {
      throw new Error(`${publication.path}: download failed (${failure.message}) and the accepted baseline snapshot does not reproduce under the current processing options`);
    }
    console.warn(`::warning::${publication.path}: download failed (${failure.message}); republished ${conditions.length} conditions from the accepted baseline snapshot, which may be stale`);
    return result;
  }

  private async processFileConfig(
    groupSpan: Span,
    group: RuleGroup,
    fileConfig: RuleGroup['files'][number],
    stats: ProcessorStats,
    downloadResult: DownloadResult
  ) {
    if (!downloadResult.ok) {
      try {
        const reused = await this.republishBaselineSnapshot(groupSpan, {
          id: rulesetIdFromConfigPath(fileConfig.path),
          path: fileConfig.path,
          title: fileConfig.title || group.name,
          description: [
            fileConfig.description || group.description || `Rules for ${group.name}`,
            `Source: ${fileConfig.url}`,
          ],
          targets: group.targets,
          defaultPolicy: group.defaultPolicy === undefined ? null : group.defaultPolicy,
          options: fileConfig,
        }, [buildSourceProvenance(fileConfig.url, fileConfig.fallbackUrls, undefined)], downloadResult.error);
        if (reused) {
          stats.filesProcessed++;
          stats.rulesets.push(reused.summary);
          stats.audits.push(reused.audit);
          return;
        }
      } catch (error) {
        RuleSourceProcessor.recordError(stats, fileConfig.path, error);
        return;
      }
      RuleSourceProcessor.recordError(stats, fileConfig.path, downloadResult.error);
      return;
    }

    try {
      const rules = downloadResult.rules;

      const { summary, audit } = await this.publishRuleset(
        groupSpan,
        rules,
        {
          id: rulesetIdFromConfigPath(fileConfig.path),
          path: fileConfig.path,
          sources: [{
            provenance: buildSourceProvenance(fileConfig.url, fileConfig.fallbackUrls, downloadResult.selection),
            selection: downloadResult.selection,
            rules,
          }],
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
      stats.audits.push(audit);
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
      let selection: FetchAssetsSelection | undefined;
      const rules = await ruleSpan
        .traceChild('load')
        .traceAsyncFn(() => observeSourceDownloads(
          selected => { selection = selected; },
          () => loadRules(source, { throwOnError: true, allowEmpty })
        ));
      return { ok: true, rules, selection };
    } catch (error) {
      return { ok: false, error: toError(error) };
    }
  }

  async processRuleGroups(groups: RuleGroup[]): Promise<ProcessorStats> {
    const stats = createProcessorStats();

    for (const group of groups) {
      try {
        // Keep groups sequential to preserve deterministic trace ordering.
        // eslint-disable-next-line no-await-in-loop -- deterministic build trace/output order
        await this.span.traceChildAsync(`process group: ${group.name}`, async groupSpan => {
          if (group.files.length === 0) return;

          const downloads = await boundedMap(group.files, async (fileConfig): Promise<DownloadResult> => {
            try {
              let selection: FetchAssetsSelection | undefined;
              const rules = await groupSpan
                .traceChild('download')
                .traceAsyncFn(() =>
                  fetchAssets(
                    fileConfig.url,
                    fileConfig.fallbackUrls || null,
                    true,
                    fileConfig.allowEmpty ?? false,
                    selected => { selection = selected; }
                  )
                );
              return { ok: true, rules, selection };
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

    return stats;
  }

  async processSpecialRules(rules: SpecialRuleConfig[]): Promise<ProcessorStats> {
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
          const sourceInputs: SourceInput[] = [];
          for (const [index, source] of ruleConfig.sourceFiles.entries()) {
            const result = sourceResults[index];
            if (!result.ok) {
              RuleSourceProcessor.recordError(stats, source, result.error);
            } else {
              appendRuleBatch(allRules, result.rules);
              // Special sources have no fallbacks; a successful load used the configured source.
              const provenance = buildSourceProvenance(source, undefined, result.selection);
              sourceInputs.push({
                provenance: { ...provenance, selectedUrl: toPublicSourceUrl(source), selection: 'primary' },
                selection: result.selection,
                rules: result.rules,
              });
            }
          }

          if (stats.errors.length > errorCountBeforeSources) {
            // Per-source variants are not recoverable from the merged snapshot conditions.
            if (ruleConfig.sourceVariants) return;
            const failures = stats.errors.slice(errorCountBeforeSources);
            const reused = await this.republishBaselineSnapshot(ruleSpan, {
              id: rulesetIdFromConfigPath(ruleConfig.targetFile),
              path: ruleConfig.targetFile,
              title: ruleConfig.name,
              description: [
                ruleConfig.description || `Rules for ${ruleConfig.name}`,
                `Merged from ${ruleConfig.sourceFiles.length} sources`,
              ],
              targets: ruleConfig.targets,
              defaultPolicy: ruleConfig.defaultPolicy === undefined ? null : ruleConfig.defaultPolicy,
              options: ruleConfig,
            }, ruleConfig.sourceFiles.map(source => buildSourceProvenance(source, undefined, undefined)),
            new Error(failures.map(failure => `${failure.file}: ${failure.error}`).join('; ')));
            if (!reused) return;
            stats.errors.splice(errorCountBeforeSources);
            stats.filesProcessed++;
            stats.rulesets.push(reused.summary);
            stats.audits.push(reused.audit);
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

          const { summary, audit } = await this.publishRuleset(
            ruleSpan,
            allRules,
            {
              id: rulesetIdFromConfigPath(ruleConfig.targetFile),
              path: ruleConfig.targetFile,
              sources: sourceInputs,
              sourceVariants: ruleConfig.sourceVariants,
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
          stats.audits.push(audit);
        });
      } catch (error) {
        RuleSourceProcessor.recordError(stats, ruleConfig.targetFile, error);
      }
    }

    return stats;
  }
}
