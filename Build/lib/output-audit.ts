import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { RuleConversionLosses, RuleDropSummary } from '../core/output/writing-strategy/base';
import type { SupportedPlatform } from './platform-config';
import type { RuleOutputFormat, RuleOutputSlot, RuleOutputStatus } from './rule-output-variants';
import { writeFileAtomic } from './atomic-file';
import { RuleLineUtils } from '../utils/validation/validators';
import type { FetchAssetsSelection } from '../utils/network/fetch-assets';

type SourceDownloadObserver = (selection: FetchAssetsSelection) => void;

const sourceDownloadObserver = new AsyncLocalStorage<SourceDownloadObserver>();

/**
 * Observe fetchAssets downloads started inside `fn`, including calls made through
 * other loaders, without changing their arguments or issuing extra requests.
 */
export function observeSourceDownloads<T>(observer: SourceDownloadObserver, fn: () => T): T {
  return sourceDownloadObserver.run(observer, fn);
}

export function getSourceDownloadObserver(): SourceDownloadObserver | undefined {
  return sourceDownloadObserver.getStore();
}

const RULE_OUTPUT_AUDIT_SCHEMA_VERSION = 1;
const SOURCE_SNAPSHOT_SCHEMA_VERSION = 1;
const SOURCE_DELTA_SCHEMA_VERSION = 1;
/** Bump when normalization or writer semantics change so old snapshots are not compared directly. */
export const RULE_OUTPUT_CONVERTER_VERSION = 'mirrrule-rule-output/1';

export const RULE_OUTPUT_AUDIT_PATH = 'Internal/rule-output-audit.json';
export const SOURCE_DELTA_PATH = 'Internal/source-delta.json';
const SOURCE_SNAPSHOT_DIR = 'Internal/source-snapshots';

export interface SourceDeltaAlertPolicy {
  /** Maximum condition samples kept for each of added and removed. */
  sampleLimit: number;
  /** Changes below this absolute count never produce ratio warnings. */
  minChangedConditions: number;
  /** Warn when (added + removed) / baseline count exceeds this ratio. */
  maxChangeRatio: number;
  /** Warn when removed / baseline count exceeds this ratio. */
  maxRemovedRatio: number;
}

/** Warning thresholds only; source deltas never fail the build. */
export const SOURCE_DELTA_ALERT_POLICY: Readonly<SourceDeltaAlertPolicy> = {
  sampleLimit: 20,
  minChangedConditions: 50,
  maxChangeRatio: 0.5,
  maxRemovedRatio: 0.3,
};

export interface RulesetStageCounts {
  inputLines: number;
  filtered: {
    emptyLines: number;
    commentsOrMarkers: number;
    excludedRuleType: number;
    sourcePolicy: number;
    invalid: number;
  };
  /** Canonical logical count; equals the legacy status.json ruleCount. */
  canonicalCount: number;
}

export interface RuleOutputFileAudit {
  platform: SupportedPlatform;
  variant: RuleOutputSlot;
  format: RuleOutputFormat;
  path: string;
  status: RuleOutputStatus;
  reason?: 'no-conditions' | 'extended-matching' | 'platform-unsupported';
  /** Canonical conditions routed to this output before platform support filtering. */
  routedConditionCount: number;
  effectiveConditionCount: number;
  ruleObjectCount?: number;
  bytes: number | null;
  sha256: string | null;
  drops: RuleDropSummary;
  /** Values and modifiers lost in conversion that drops do not count. */
  losses: RuleConversionLosses;
  /** Surge only: logical rules kept in non_ip, instead of ip, to keep set-wide extended matching. */
  reroutedFromIp?: { reason: 'extended-matching'; count: number };
}

/** Audit data produced by one EnhancedFileOutput publication. */
export interface RulesetOutputAudit {
  id: string;
  platforms: SupportedPlatform[];
  stages: RulesetStageCounts;
  outputs: RuleOutputFileAudit[];
  rawInputSha256: string;
  semanticSha256: string;
  /** Sorted canonical conditions including modifiers such as no-resolve. */
  conditions: string[];
  /** Digest of the processing options that shape canonical conditions. */
  contextSha256: string;
}

export interface SourceProvenance {
  configuredUrl: string;
  fallbackUrls: string[];
  selectedUrl: string | null;
  selection: 'primary' | 'fallback' | 'unknown';
  fallbackIndex: number | null;
  viaProxy: boolean | null;
  /** HTTP Age header of the selected response; it may come from the local HTTP cache or a CDN. */
  responseAgeSeconds: number | null;
  /** sha256 of the downloaded body before decoding and cleaning; null when the loader is not observed. */
  rawContentSha256: string | null;
  /** Lines of the downloaded body before cleaning; null when the loader is not observed. */
  rawLineCount: number | null;
}

export interface RulesetAuditRecord extends RulesetOutputAudit {
  sources: SourceProvenance[];
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Return a URL that is safe to publish: no credentials, query, fragment or local path. */
export function toPublicSourceUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'local-module';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'local-module';
  const hadQuery = url.search.length > 0;
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return hadQuery ? `${url.toString()}?[REDACTED]` : url.toString();
}

/** Stable report and snapshot identity for a ruleset id. */
export function toSourceId(rulesetId: string): string {
  return encodeURIComponent(rulesetId).replaceAll('*', '%2A');
}

const SINGBOX_MATCHER_KEYS = new Set([
  'domain', 'domain_suffix', 'domain_keyword', 'domain_regex', 'ip_cidr',
]);

/**
 * Count effective conditions in writer content without banner lines. Text formats
 * count one per non-comment line, so a logical expression counts once. sing-box
 * counts matcher entries across rule objects and reports objects separately.
 */
export function countEffectiveConditions(
  format: RuleOutputFormat,
  content: readonly string[]
): { effectiveConditionCount: number; ruleObjectCount?: number } {
  if (format === 'singbox-json-v2') {
    const parsed = JSON.parse(content.join('\n')) as { rules?: Array<Record<string, unknown>> };
    const rules = parsed.rules ?? [];
    let effectiveConditionCount = 0;
    for (const rule of rules) {
      for (const [key, value] of Object.entries(rule)) {
        if (SINGBOX_MATCHER_KEYS.has(key) && Array.isArray(value)) effectiveConditionCount += value.length;
      }
    }
    return { effectiveConditionCount, ruleObjectCount: rules.length };
  }
  let effectiveConditionCount = 0;
  for (const line of content) {
    const trimmed = line.trim();
    if (trimmed && !RuleLineUtils.isComment(trimmed)) effectiveConditionCount++;
  }
  return { effectiveConditionCount };
}

interface SourceSnapshot {
  schemaVersion: number;
  converterVersion: string;
  sourceId: string;
  rulesetId: string;
  contextSha256: string;
  sources: string[];
  rawInputSha256: string;
  semanticSha256: string;
  conditionCount: number;
  conditions: string[];
}

type DeltaStatus = 'compared' | 'baseline-unavailable' | 'not-comparable' | 'removed';

interface SourceDeltaEntry {
  sourceId: string;
  rulesetId: string;
  status: DeltaStatus;
  reason?: string;
  currentConditionCount: number;
  baselineConditionCount: number | null;
  rawInputChanged: boolean | null;
  semanticChanged: boolean | null;
  added: number | null;
  removed: number | null;
  changeRatio: number | null;
  addedByType: Record<string, number>;
  removedByType: Record<string, number>;
  samples: { added: string[]; removed: string[] };
  sourcesAdded: string[];
  sourcesRemoved: string[];
  warnings: string[];
}

type BaselineSnapshot =
  | { kind: 'unavailable'; reason: 'baseline-not-configured' | 'snapshot-missing' }
  | { kind: 'unreadable' }
  | { kind: 'snapshot'; snapshot: SourceSnapshot };

function buildSourceSnapshot(record: RulesetAuditRecord): SourceSnapshot {
  return {
    schemaVersion: SOURCE_SNAPSHOT_SCHEMA_VERSION,
    converterVersion: RULE_OUTPUT_CONVERTER_VERSION,
    sourceId: toSourceId(record.id),
    rulesetId: record.id,
    contextSha256: record.contextSha256,
    sources: record.sources.map(source => source.configuredUrl),
    rawInputSha256: record.rawInputSha256,
    semanticSha256: record.semanticSha256,
    conditionCount: record.conditions.length,
    conditions: record.conditions,
  };
}

async function readBaselineSnapshot(baselineDir: string | null, sourceId: string): Promise<BaselineSnapshot> {
  if (!baselineDir) return { kind: 'unavailable', reason: 'baseline-not-configured' };
  let text: string;
  try {
    text = await fs.readFile(path.join(baselineDir, SOURCE_SNAPSHOT_DIR, `${sourceId}.json`), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'unavailable', reason: 'snapshot-missing' };
    return { kind: 'unreadable' };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as SourceSnapshot).conditions)) {
      return { kind: 'unreadable' };
    }
    return { kind: 'snapshot', snapshot: parsed as SourceSnapshot };
  } catch {
    return { kind: 'unreadable' };
  }
}

function countByType(conditions: Iterable<string>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const condition of conditions) {
    const comma = condition.indexOf(',');
    const type = (comma === -1 ? condition : condition.slice(0, comma)).toUpperCase();
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function computeSourceDelta(
  current: SourceSnapshot,
  baseline: BaselineSnapshot,
  policy: SourceDeltaAlertPolicy = SOURCE_DELTA_ALERT_POLICY
): SourceDeltaEntry {
  const entry: SourceDeltaEntry = {
    sourceId: current.sourceId,
    rulesetId: current.rulesetId,
    status: 'baseline-unavailable',
    currentConditionCount: current.conditionCount,
    baselineConditionCount: null,
    rawInputChanged: null,
    semanticChanged: null,
    added: null,
    removed: null,
    changeRatio: null,
    addedByType: {},
    removedByType: {},
    samples: { added: [], removed: [] },
    sourcesAdded: [],
    sourcesRemoved: [],
    warnings: [],
  };
  if (baseline.kind === 'unavailable') return { ...entry, reason: baseline.reason };
  if (baseline.kind === 'unreadable') return { ...entry, status: 'not-comparable', reason: 'snapshot-unreadable' };

  const previous = baseline.snapshot;
  entry.baselineConditionCount = previous.conditions.length;
  if (previous.schemaVersion !== SOURCE_SNAPSHOT_SCHEMA_VERSION) {
    return { ...entry, status: 'not-comparable', reason: 'schema-version-mismatch' };
  }
  if (previous.converterVersion !== RULE_OUTPUT_CONVERTER_VERSION) {
    return { ...entry, status: 'not-comparable', reason: 'converter-version-mismatch' };
  }
  if (previous.contextSha256 !== current.contextSha256) {
    return { ...entry, status: 'not-comparable', reason: 'processing-context-changed' };
  }

  const before = new Set(previous.conditions);
  const after = new Set(current.conditions);
  const added = current.conditions.filter(condition => !before.has(condition));
  const removed = previous.conditions.filter(condition => !after.has(condition));
  const previousSources = new Set(previous.sources);
  const currentSources = new Set(current.sources);
  const changed = added.length + removed.length;
  const denominator = Math.max(previous.conditions.length, 1);

  entry.status = 'compared';
  entry.rawInputChanged = previous.rawInputSha256 !== current.rawInputSha256;
  entry.semanticChanged = previous.semanticSha256 !== current.semanticSha256;
  entry.added = added.length;
  entry.removed = removed.length;
  entry.changeRatio = Number((changed / denominator).toFixed(6));
  entry.addedByType = countByType(added);
  entry.removedByType = countByType(removed);
  entry.samples = { added: added.slice(0, policy.sampleLimit), removed: removed.slice(0, policy.sampleLimit) };
  entry.sourcesAdded = current.sources.filter(source => !previousSources.has(source));
  entry.sourcesRemoved = previous.sources.filter(source => !currentSources.has(source));

  if (previous.conditions.length > 0 && current.conditions.length === 0) entry.warnings.push('all-conditions-removed');
  if (changed >= policy.minChangedConditions && changed / denominator > policy.maxChangeRatio) {
    entry.warnings.push('change-ratio-exceeded');
  }
  if (removed.length >= policy.minChangedConditions && removed.length / denominator > policy.maxRemovedRatio) {
    entry.warnings.push('removed-ratio-exceeded');
  }
  return entry;
}

/** Baseline sources with no current ruleset: every baseline condition counts as removed. */
async function readRemovedSources(
  baselineDir: string | null,
  currentSourceIds: ReadonlySet<string>,
  policy: SourceDeltaAlertPolicy
): Promise<SourceDeltaEntry[]> {
  if (!baselineDir) return [];
  let entries: string[];
  try {
    entries = await fs.readdir(path.join(baselineDir, SOURCE_SNAPSHOT_DIR));
  } catch {
    return [];
  }
  const removed: SourceDeltaEntry[] = [];
  for (const entry of entries.filter(name => name.endsWith('.json')).sort()) {
    const sourceId = entry.slice(0, -'.json'.length);
    if (currentSourceIds.has(sourceId)) continue;
    // eslint-disable-next-line no-await-in-loop -- bounded sequential reads keep report order deterministic
    const baseline = await readBaselineSnapshot(baselineDir, sourceId);
    const snapshot = baseline.kind === 'snapshot' ? baseline.snapshot : null;
    let rulesetId = snapshot?.rulesetId;
    if (typeof rulesetId !== 'string') {
      try {
        rulesetId = decodeURIComponent(sourceId);
      } catch {
        rulesetId = sourceId;
      }
    }
    const conditions = snapshot ? snapshot.conditions : [];
    removed.push({
      sourceId,
      rulesetId,
      status: 'removed',
      ...(!snapshot && { reason: 'snapshot-unreadable' }),
      currentConditionCount: 0,
      baselineConditionCount: snapshot ? conditions.length : null,
      rawInputChanged: null,
      semanticChanged: snapshot ? conditions.length > 0 : null,
      added: 0,
      removed: snapshot ? conditions.length : null,
      changeRatio: snapshot ? (conditions.length > 0 ? 1 : 0) : null,
      addedByType: {},
      removedByType: countByType(conditions),
      samples: { added: [], removed: conditions.slice(0, policy.sampleLimit) },
      sourcesAdded: [],
      sourcesRemoved: snapshot && Array.isArray(snapshot.sources) ? snapshot.sources : [],
      warnings: ['ruleset-removed'],
    });
  }
  return removed;
}

function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export interface RuleOutputReportOptions {
  outputRoot: string;
  records: readonly RulesetAuditRecord[];
  generatedAt: string;
  /** Root of an accepted published tree containing Internal/source-snapshots, or null. */
  baselineDir: string | null;
  baselineReceiptId: string | null;
  policy?: SourceDeltaAlertPolicy;
}

/**
 * Write source snapshots, the source delta and the rule output audit. Baselines are
 * read before any write so an in-place baseline is never compared with itself.
 */
export async function writeRuleOutputReports(options: RuleOutputReportOptions): Promise<{ warnings: string[] }> {
  const policy = options.policy ?? SOURCE_DELTA_ALERT_POLICY;
  const records = [...options.records].sort((a, b) => a.id.localeCompare(b.id));
  const seen = new Set<string>();
  for (const record of records) {
    const sourceId = toSourceId(record.id);
    if (seen.has(sourceId)) throw new Error(`Duplicate ruleset source id: ${sourceId}`);
    seen.add(sourceId);
  }

  const snapshots = records.map(buildSourceSnapshot);
  const deltas: SourceDeltaEntry[] = [];
  for (const snapshot of snapshots) {
    // eslint-disable-next-line no-await-in-loop -- bounded sequential reads keep report order deterministic
    const baseline = await readBaselineSnapshot(options.baselineDir, snapshot.sourceId);
    deltas.push(computeSourceDelta(snapshot, baseline, policy));
  }
  // Removed sources follow the current ones.
  for (const removed of await readRemovedSources(options.baselineDir, seen, policy)) deltas.push(removed);

  const snapshotDir = path.join(options.outputRoot, SOURCE_SNAPSHOT_DIR);
  await fs.mkdir(snapshotDir, { recursive: true });
  for (const snapshot of snapshots) {
    // eslint-disable-next-line no-await-in-loop -- sequential atomic writes keep failures attributable
    await writeFileAtomic(path.join(snapshotDir, `${snapshot.sourceId}.json`), toJson(snapshot));
  }
  const expected = new Set(snapshots.map(snapshot => `${snapshot.sourceId}.json`));
  for (const entry of await fs.readdir(snapshotDir)) {
    // eslint-disable-next-line no-await-in-loop -- remove snapshots of rulesets that are no longer built
    if (entry.endsWith('.json') && !expected.has(entry)) await fs.rm(path.join(snapshotDir, entry), { force: true });
  }

  const warnings = deltas.flatMap(delta => delta.warnings.map(warning => `${delta.rulesetId}: ${warning}`));
  const countStatus = (status: DeltaStatus) => deltas.filter(delta => delta.status === status).length;
  await writeFileAtomic(path.join(options.outputRoot, SOURCE_DELTA_PATH), toJson({
    schemaVersion: SOURCE_DELTA_SCHEMA_VERSION,
    converterVersion: RULE_OUTPUT_CONVERTER_VERSION,
    generatedAt: options.generatedAt,
    baseline: {
      configured: options.baselineDir !== null,
      receiptId: options.baselineReceiptId,
    },
    policy,
    summary: {
      sources: deltas.length,
      compared: countStatus('compared'),
      baselineUnavailable: countStatus('baseline-unavailable'),
      notComparable: countStatus('not-comparable'),
      removed: countStatus('removed'),
      warnings: warnings.length,
    },
    sources: deltas,
  }));

  const outputs = records.flatMap(record => record.outputs);
  const countOutputs = (status: RuleOutputStatus) => outputs.filter(output => output.status === status).length;
  await writeFileAtomic(path.join(options.outputRoot, RULE_OUTPUT_AUDIT_PATH), toJson({
    schemaVersion: RULE_OUTPUT_AUDIT_SCHEMA_VERSION,
    converterVersion: RULE_OUTPUT_CONVERTER_VERSION,
    generatedAt: options.generatedAt,
    summary: {
      rulesets: records.length,
      outputs: outputs.length,
      published: countOutputs('published'),
      absentEmpty: countOutputs('absent-empty'),
      absentUnsupported: countOutputs('absent-unsupported'),
    },
    rulesets: records.map(record => ({
      id: record.id,
      sourceId: toSourceId(record.id),
      platforms: record.platforms,
      sources: record.sources,
      rawInputSha256: record.rawInputSha256,
      semanticSha256: record.semanticSha256,
      snapshotPath: `${SOURCE_SNAPSHOT_DIR}/${toSourceId(record.id)}.json`,
      stages: record.stages,
      outputs: record.outputs,
    })),
  }));

  return { warnings };
}
