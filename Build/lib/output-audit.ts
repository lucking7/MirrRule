import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import type { RuleConversionLosses, RuleDropSummary } from '../core/output/writing-strategy/base';
import type { SupportedPlatform } from './platform-config';
import type { RuleOutputFormat, RuleOutputSlot, RuleOutputStatus } from './rule-output-variants';
import { PLATFORM_OUTPUT_LAYOUT, resolveRuleOutputTarget } from './rule-output-variants';
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
export const RULE_OUTPUT_CONVERTER_VERSION = 'mirrrule-rule-output/2';
const SINGBOX_MATCHER_KEYS = new Set([
  'domain', 'domain_suffix', 'domain_keyword', 'domain_regex', 'ip_cidr',
]);

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
  /** Legacy conditions/semanticSha256 describe normalized source conditions, not writer output. */
  semanticScope: 'normalized-source';
  optimizations: RuleOptimizationAudit[];
  effectiveOutputs: EffectiveOutputSnapshot[];
  /** Sorted canonical conditions including modifiers such as no-resolve. */
  conditions: string[];
  /** Digest of the processing options that shape canonical conditions. */
  contextSha256: string;
}

export interface RuleOptimizationAudit {
  reason: 'keyword-coverage' | 'domain-coverage';
  conditionCount: number;
  byType: Record<string, number>;
  /** Bounded examples of conditions omitted before platform writers. */
  samples: string[];
}

export interface EffectiveOutputSnapshot {
  platform: SupportedPlatform;
  format: RuleOutputFormat;
  semanticSha256: string;
  /** Actual matcher entries; a text logical rule remains one condition. */
  conditions: string[];
}

/** Semantic content without banners, independently of bytes and generation dates. */
export function snapshotEffectiveOutput(
  platform: SupportedPlatform,
  format: RuleOutputFormat,
  content: readonly string[]
): EffectiveOutputSnapshot {
  let conditions: string[];
  let semanticContent: unknown;
  if (format === 'singbox-json-v2') {
    const parsed = JSON.parse(content.join('\n')) as { version: number; rules: Array<Record<string, unknown>> };
    // Sort arrays and keys within each object, but keep rule object boundaries.
    const rules = parsed.rules.map(rule => Object.fromEntries(Object.entries(rule).sort(([a], [b]) => a.localeCompare(b)).map(
      ([key, values]) => [key, Array.isArray(values) ? [...new Set(values)].sort() : values]
    )));
    conditions = rules.flatMap(rule => Object.entries(rule).flatMap(([key, values]) => (
      SINGBOX_MATCHER_KEYS.has(key) && Array.isArray(values) ? values.map(value => `${key}:${String(value)}`) : []
    )));
    semanticContent = { version: parsed.version, rules };
  } else {
    conditions = [];
    for (const line of content) {
      const trimmed = line.trim();
      if (trimmed && !RuleLineUtils.isComment(trimmed)) conditions.push(trimmed);
    }
    semanticContent = [...new Set(conditions)].sort();
  }
  return {
    platform,
    format,
    conditions: [...new Set(conditions)].sort(),
    semanticSha256: sha256Hex(JSON.stringify({ format, content: semanticContent })),
  };
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

export interface SourceSnapshot {
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
  semanticScope?: 'normalized-source';
  /** Versioned independently so old source comparisons remain usable. */
  effectiveOutputVersion?: 1;
  effectiveOutputs?: EffectiveOutputSnapshot[];
}

type DeltaStatus = 'compared' | 'baseline-unavailable' | 'not-comparable' | 'removed';

interface SourceDeltaEntry {
  sourceId: string;
  rulesetId: string;
  converterVersion: string | null;
  status: DeltaStatus;
  reason?: string;
  currentConditionCount: number;
  baselineConditionCount: number | null;
  rawInputChanged: boolean | null;
  semanticChanged: boolean | null;
  semanticScope: 'normalized-source';
  effectiveOutputs: EffectiveOutputDelta[];
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

interface EffectiveOutputDelta {
  platform: SupportedPlatform;
  format: RuleOutputFormat;
  status: 'compared' | 'baseline-unavailable' | 'not-comparable' | 'removed';
  reason?: string;
  semanticChanged: boolean | null;
  currentConditionCount: number;
  baselineConditionCount: number | null;
  added: number | null;
  removed: number | null;
  samples: { added: string[]; removed: string[] };
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
    semanticScope: record.semanticScope,
    effectiveOutputVersion: 1,
    effectiveOutputs: record.effectiveOutputs,
  };
}

function compareEffectiveOutputs(
  current: SourceSnapshot,
  baseline: BaselineSnapshot,
  sampleLimit: number
): EffectiveOutputDelta[] {
  const previous = baseline.kind === 'snapshot' ? baseline.snapshot : null;
  const outputs = current.effectiveOutputs ?? [];
  const previousOutputs = previous?.effectiveOutputs ?? [];
  const platforms = new Set([...outputs, ...previousOutputs].map(output => output.platform));
  return [...platforms].sort().map(platform => {
    const output = outputs.find(candidate => candidate.platform === platform);
    const before = previousOutputs.find(candidate => candidate.platform === platform);
    const format = (output ?? before)!.format;
    const entry: EffectiveOutputDelta = {
      platform, format, status: 'not-comparable', semanticChanged: null,
      currentConditionCount: output?.conditions.length ?? 0,
      baselineConditionCount: before?.conditions.length ?? null,
      added: null, removed: null, samples: { added: [], removed: [] },
    };
    if (current.effectiveOutputVersion !== 1 || !current.effectiveOutputs) return { ...entry, reason: 'current-effective-output-snapshot-missing' };
    if (baseline.kind === 'unavailable') return { ...entry, status: 'baseline-unavailable', reason: baseline.reason };
    if (!previous) return { ...entry, reason: 'snapshot-unreadable' };
    if (previous.schemaVersion !== SOURCE_SNAPSHOT_SCHEMA_VERSION) return { ...entry, reason: 'schema-version-mismatch' };
    if (previous.converterVersion !== current.converterVersion) return { ...entry, reason: 'converter-version-mismatch' };
    if (previous.contextSha256 !== current.contextSha256) return { ...entry, reason: 'processing-context-changed' };
    if (previous.effectiveOutputVersion !== 1 || !previous.effectiveOutputs) return { ...entry, reason: 'effective-output-snapshot-missing' };
    if (!before) return { ...entry, status: 'baseline-unavailable', reason: 'platform-output-missing' };
    if (output && output.format !== before.format) return { ...entry, reason: 'output-format-changed' };
    const afterSet = new Set(output?.conditions);
    const beforeSet = new Set(before.conditions);
    const added = (output?.conditions ?? []).filter(condition => !beforeSet.has(condition));
    const removed = before.conditions.filter(condition => !afterSet.has(condition));
    return {
      ...entry,
      status: output ? 'compared' : 'removed',
      semanticChanged: output ? output.semanticSha256 !== before.semanticSha256 : before.conditions.length > 0,
      added: added.length, removed: removed.length,
      samples: { added: added.slice(0, sampleLimit), removed: removed.slice(0, sampleLimit) },
    };
  });
}

const gzipSnapshot = promisify(gzip);
const gunzipSnapshot = promisify(gunzip);

export function sourceSnapshotPath(sourceId: string, compressed = true): string {
  return `${SOURCE_SNAPSHOT_DIR}/${sourceId}.json${compressed ? '.gz' : ''}`;
}

/** Both historical JSON and compressed JSON are lossless snapshot encodings. */
export async function readSourceSnapshotFile(filename: string): Promise<unknown> {
  const body = await fs.readFile(filename);
  return JSON.parse((filename.endsWith('.json.gz') ? await gunzipSnapshot(body) : body).toString('utf8'));
}

export async function writeSourceSnapshotFile(filename: string, snapshot: unknown): Promise<void> {
  const body = JSON.stringify(snapshot);
  await writeFileAtomic(filename, filename.endsWith('.json.gz') ? await gzipSnapshot(body) : `${body}\n`);
}

/** Reject ambiguous encodings instead of silently choosing one source's evidence. */
export async function listSourceSnapshotFiles(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const filename of (await fs.readdir(path.join(root, SOURCE_SNAPSHOT_DIR))).sort()) {
    const suffix = filename.endsWith('.json.gz') ? '.json.gz' : (filename.endsWith('.json') ? '.json' : null);
    if (!suffix) continue;
    const sourceId = filename.slice(0, -suffix.length);
    if (files.has(sourceId)) throw new Error(`Duplicate source snapshot encodings: ${sourceId}`);
    files.set(sourceId, filename);
  }
  return files;
}

async function readBaselineSnapshot(baselineDir: string | null, sourceId: string): Promise<BaselineSnapshot> {
  if (!baselineDir) return { kind: 'unavailable', reason: 'baseline-not-configured' };
  let files: Map<string, string>;
  try {
    files = await listSourceSnapshotFiles(baselineDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'unavailable', reason: 'snapshot-missing' };
    throw error;
  }
  const filename = files.get(sourceId);
  if (!filename) return { kind: 'unavailable', reason: 'snapshot-missing' };
  try {
    const parsed = await readSourceSnapshotFile(path.join(baselineDir, SOURCE_SNAPSHOT_DIR, filename));
    if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as SourceSnapshot).conditions)
      || !(parsed as SourceSnapshot).conditions.every(condition => typeof condition === 'string')) {
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
    converterVersion: current.converterVersion,
    status: 'baseline-unavailable',
    currentConditionCount: current.conditionCount,
    baselineConditionCount: null,
    rawInputChanged: null,
    semanticChanged: null,
    semanticScope: 'normalized-source',
    effectiveOutputs: compareEffectiveOutputs(current, baseline, policy.sampleLimit),
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
  if (previous.converterVersion !== current.converterVersion) {
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
  let files: Map<string, string>;
  try {
    files = await listSourceSnapshotFiles(baselineDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const removed: SourceDeltaEntry[] = [];
  for (const sourceId of files.keys()) {
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
      converterVersion: snapshot?.converterVersion ?? null,
      status: 'removed',
      ...(!snapshot && { reason: 'snapshot-unreadable' }),
      currentConditionCount: 0,
      baselineConditionCount: snapshot ? conditions.length : null,
      rawInputChanged: null,
      semanticChanged: snapshot ? conditions.length > 0 : null,
      semanticScope: 'normalized-source',
      effectiveOutputs: snapshot?.effectiveOutputs?.map(output => ({
        platform: output.platform, format: output.format, status: 'removed',
        semanticChanged: output.conditions.length > 0,
        currentConditionCount: 0, baselineConditionCount: output.conditions.length,
        added: 0, removed: output.conditions.length,
        samples: { added: [], removed: output.conditions.slice(0, policy.sampleLimit) },
      })) ?? [],
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
  baselineReceiptId: string | number | null;
  policy?: SourceDeltaAlertPolicy;
}

interface SourceDeltaOptions {
  baselineDir: string | null;
  baselineReceiptId: string | number | null;
  generatedAt?: string;
  policy?: SourceDeltaAlertPolicy;
  retiredOutputPaths?: readonly string[];
}

async function writeSourceDelta(
  outputRoot: string,
  snapshots: readonly SourceSnapshot[],
  options: SourceDeltaOptions
): Promise<{ warnings: string[] }> {
  const policy = options.policy ?? SOURCE_DELTA_ALERT_POLICY;
  const deltas: SourceDeltaEntry[] = [];
  for (const snapshot of snapshots) {
    // eslint-disable-next-line no-await-in-loop -- bounded sequential reads keep report order deterministic
    const baseline = await readBaselineSnapshot(options.baselineDir, snapshot.sourceId);
    deltas.push(computeSourceDelta(snapshot, baseline, policy));
  }
  for (const removed of await readRemovedSources(options.baselineDir, new Set(snapshots.map(snapshot => snapshot.sourceId)), policy)) {
    deltas.push(removed);
  }
  const warnings = deltas.flatMap(delta => delta.warnings.map(warning => `${delta.rulesetId}: ${warning}`));
  const countStatus = (status: DeltaStatus) => deltas.filter(delta => delta.status === status).length;
  const converters = new Set(snapshots.map(snapshot => snapshot.converterVersion));
  await writeFileAtomic(path.join(outputRoot, SOURCE_DELTA_PATH), toJson({
    schemaVersion: SOURCE_DELTA_SCHEMA_VERSION,
    converterVersion: converters.size === 1 ? snapshots[0].converterVersion : null,
    toolConverterVersion: RULE_OUTPUT_CONVERTER_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    baseline: { configured: options.baselineDir !== null, receiptId: options.baselineReceiptId },
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
  return { warnings };
}

function assertCurrentSnapshot(value: unknown, sourceId: string): asserts value is SourceSnapshot {
  const snapshot = value as SourceSnapshot | null;
  const semanticScope = (value as { semanticScope?: unknown } | null)?.semanticScope;
  const strings = (items: unknown): items is string[] => Array.isArray(items) && items.every(item => typeof item === 'string');
  if (!snapshot || typeof snapshot !== 'object' || snapshot.schemaVersion !== SOURCE_SNAPSHOT_SCHEMA_VERSION
    || typeof snapshot.rulesetId !== 'string' || snapshot.sourceId !== sourceId || toSourceId(snapshot.rulesetId) !== sourceId
    || typeof snapshot.converterVersion !== 'string' || !strings(snapshot.conditions) || !strings(snapshot.sources)
    || snapshot.conditionCount !== snapshot.conditions.length || !isSha256(snapshot.contextSha256)
    || !isSha256(snapshot.rawInputSha256) || !isSha256(snapshot.semanticSha256)
    || snapshot.semanticSha256 !== sha256Hex(snapshot.conditions.join('\n'))
    || (semanticScope !== undefined && semanticScope !== 'normalized-source')
    || new Set(snapshot.conditions).size !== snapshot.conditions.length) {
    throw new Error(`Invalid current source snapshot: ${sourceId}`);
  }
  if (snapshot.effectiveOutputVersion === undefined && snapshot.effectiveOutputs === undefined) return;
  if (snapshot.effectiveOutputVersion !== 1 || !Array.isArray(snapshot.effectiveOutputs)) {
    throw new Error(`Invalid current effective output snapshots: ${sourceId}`);
  }
  const platforms = new Set<string>();
  for (const candidate of snapshot.effectiveOutputs as unknown[]) {
    const output = candidate as EffectiveOutputSnapshot | null;
    if (!output || !Object.hasOwn(PLATFORM_OUTPUT_LAYOUT, output.platform) || platforms.has(output.platform)
      || output.format !== PLATFORM_OUTPUT_LAYOUT[output.platform].format || !strings(output.conditions) || !isSha256(output.semanticSha256)) {
      throw new Error(`Invalid current effective output snapshot: ${sourceId}`);
    }
    platforms.add(output.platform);
  }
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[\da-f]{64}$/.test(value);
}

interface AuditedSnapshotBinding {
  id: string;
  sourceId: string;
  snapshotPath: string;
  semanticSha256: string;
  rawInputSha256: string;
  sources: Array<{ configuredUrl: string }>;
  contextSha256?: string;
  normalizedConditionCount?: number;
  outputs: RuleOutputFileAudit[];
  effectiveOutputs?: Array<Omit<EffectiveOutputSnapshot, 'conditions'> & { conditionCount: number }>;
}

async function assertAuditedSnapshot(publicDir: string, snapshot: SourceSnapshot, audit: AuditedSnapshotBinding, filename: string): Promise<void> {
  if (audit.sourceId !== snapshot.sourceId || audit.snapshotPath !== `${SOURCE_SNAPSHOT_DIR}/${filename}`
    || audit.semanticSha256 !== snapshot.semanticSha256 || audit.rawInputSha256 !== snapshot.rawInputSha256
    || (audit.contextSha256 !== undefined && audit.contextSha256 !== snapshot.contextSha256)
    || (audit.normalizedConditionCount !== undefined && audit.normalizedConditionCount !== snapshot.conditionCount)) {
    throw new Error(`Current source snapshot does not match output audit: ${snapshot.sourceId}`);
  }
  if (!Array.isArray(audit.sources) || JSON.stringify(audit.sources.map(source => source.configuredUrl)) !== JSON.stringify(snapshot.sources)) {
    throw new Error(`Current source identities do not match output audit: ${snapshot.sourceId}`);
  }
  // Historical snapshots have no writer-level data; keep that absence explicit in deltas.
  if (!snapshot.effectiveOutputs) {
    if (audit.effectiveOutputs) throw new Error(`Current effective output snapshot missing: ${snapshot.sourceId}`);
    return;
  }
  const merged = audit.outputs.filter(output => output.variant === 'merged' && output.status === 'published');
  const expectedPlatforms = new Set(merged.map(output => output.platform));
  if (expectedPlatforms.size !== snapshot.effectiveOutputs.length || snapshot.effectiveOutputs.some(output => !expectedPlatforms.has(output.platform))) {
    throw new Error(`Current effective output inventory does not match output audit: ${snapshot.sourceId}`);
  }
  for (const output of snapshot.effectiveOutputs) {
    const target = resolveRuleOutputTarget(output.platform, 'merged', snapshot.rulesetId);
    const audited = merged.find(candidate => candidate.platform === output.platform)!;
    const metadata = audit.effectiveOutputs?.find(candidate => candidate.platform === output.platform);
    if (audited.path !== target.relativePath || audited.format !== output.format
      || metadata?.format !== output.format || metadata.semanticSha256 !== output.semanticSha256 || metadata.conditionCount !== output.conditions.length) {
      throw new Error(`Current effective output does not match output audit: ${snapshot.sourceId}/${output.platform}`);
    }
    // eslint-disable-next-line no-await-in-loop -- bind each platform snapshot to the actual staged file
    const body = await fs.readFile(path.join(publicDir, ...target.relativePath.split('/')), 'utf8');
    const actual = snapshotEffectiveOutput(output.platform, output.format, body.split('\n'));
    if (actual.semanticSha256 !== output.semanticSha256 || JSON.stringify(actual.conditions) !== JSON.stringify(output.conditions)) {
      throw new Error(`Current effective output snapshot does not match file: ${snapshot.sourceId}/${output.platform}`);
    }
  }
}

/** Rebase audited snapshot data without fetching upstream or rewriting rule files. */
export async function recomputeSourceDeltaFromSnapshots(
  publicDir: string,
  options: SourceDeltaOptions
): Promise<{ warnings: string[] }> {
  const snapshotDir = path.join(publicDir, SOURCE_SNAPSHOT_DIR);
  const snapshots: SourceSnapshot[] = [];
  const changed: SourceSnapshot[] = [];
  const retired = new Set(options.retiredOutputPaths);
  const snapshotFiles = await listSourceSnapshotFiles(publicDir);
  for (const [sourceId, filename] of snapshotFiles) {
    // eslint-disable-next-line no-await-in-loop -- validate all snapshots before writing any projection
    const value: unknown = await readSourceSnapshotFile(path.join(snapshotDir, filename));
    assertCurrentSnapshot(value, sourceId);
    if (value.effectiveOutputs) {
      const filtered = value.effectiveOutputs.filter(output => !retired.has(resolveRuleOutputTarget(output.platform, 'merged', value.rulesetId).relativePath));
      if (filtered.length !== value.effectiveOutputs.length) {
        value.effectiveOutputs = filtered;
        changed.push(value);
      }
    }
    snapshots.push(value);
  }
  const audit = JSON.parse(await fs.readFile(path.join(publicDir, RULE_OUTPUT_AUDIT_PATH), 'utf8')) as {
    converterVersion: string;
    rulesets: AuditedSnapshotBinding[];
  };
  const ids = new Map(snapshots.map(snapshot => [snapshot.rulesetId, snapshot]));
  if (!Array.isArray(audit.rulesets) || new Set(audit.rulesets.map(ruleset => ruleset.id)).size !== audit.rulesets.length) {
    throw new Error('Invalid current output audit ruleset inventory');
  }
  for (const ruleset of audit.rulesets) {
    const snapshot = ids.get(ruleset.id);
    if (!snapshot) throw new Error(`Current source snapshot missing for audited ruleset: ${ruleset.id}`);
    if (snapshot.converterVersion !== audit.converterVersion) throw new Error(`Current snapshot converter does not match output audit: ${snapshot.sourceId}`);
    // eslint-disable-next-line no-await-in-loop -- validate all bindings before replacing evidence
    await assertAuditedSnapshot(publicDir, snapshot, ruleset, snapshotFiles.get(snapshot.sourceId)!);
  }
  if (ids.size !== audit.rulesets.length) throw new Error('Current source snapshot inventory does not match output audit');
  // Read the baseline before projecting snapshots, including an explicitly in-place baseline.
  const result = await writeSourceDelta(publicDir, snapshots, options);
  for (const snapshot of changed) {
    // eslint-disable-next-line no-await-in-loop -- only explicit retirement projections replace snapshots
    await writeSourceSnapshotFile(path.join(snapshotDir, snapshotFiles.get(snapshot.sourceId)!), snapshot);
  }
  return result;
}

/**
 * Write source snapshots, the source delta and the rule output audit. Baselines are
 * read before any write so an in-place baseline is never compared with itself.
 */
export async function writeRuleOutputReports(options: RuleOutputReportOptions): Promise<{ warnings: string[] }> {
  const records = [...options.records].sort((a, b) => a.id.localeCompare(b.id));
  const seen = new Set<string>();
  for (const record of records) {
    const sourceId = toSourceId(record.id);
    if (seen.has(sourceId)) throw new Error(`Duplicate ruleset source id: ${sourceId}`);
    seen.add(sourceId);
  }

  const snapshots = records.map(buildSourceSnapshot);
  // Read an in-place baseline before replacing snapshots.
  const { warnings } = await writeSourceDelta(options.outputRoot, snapshots, options);

  const snapshotDir = path.join(options.outputRoot, SOURCE_SNAPSHOT_DIR);
  await fs.mkdir(snapshotDir, { recursive: true });
  for (const snapshot of snapshots) {
    // eslint-disable-next-line no-await-in-loop -- sequential atomic writes keep failures attributable
    await writeSourceSnapshotFile(path.join(options.outputRoot, sourceSnapshotPath(snapshot.sourceId)), snapshot);
  }
  const expected = new Set(snapshots.map(snapshot => `${snapshot.sourceId}.json.gz`));
  for (const entry of await fs.readdir(snapshotDir)) {
    // eslint-disable-next-line no-await-in-loop -- remove snapshots of rulesets that are no longer built
    if ((entry.endsWith('.json') || entry.endsWith('.json.gz')) && !expected.has(entry)) await fs.rm(path.join(snapshotDir, entry), { force: true });
  }

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
      semanticScope: record.semanticScope,
      contextSha256: record.contextSha256,
      normalizedConditionCount: record.conditions.length,
      optimizations: record.optimizations,
      effectiveOutputs: record.effectiveOutputs.map(({ conditions: _conditions, ...output }) => ({
        ...output,
        conditionCount: _conditions.length,
      })),
      snapshotPath: sourceSnapshotPath(toSourceId(record.id)),
      stages: record.stages,
      outputs: record.outputs,
    })),
  }));

  return { warnings };
}
