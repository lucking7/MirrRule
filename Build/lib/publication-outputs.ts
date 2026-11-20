import fs from 'node:fs/promises';
import path from 'node:path';

import { normalizePublicPath } from './artifact-lifecycle';
import { comparePaths, hashFile } from './publication-manifest';
import type { SupportedPlatform } from './platform-config';
import {
  PLATFORM_OUTPUT_LAYOUT,
  RULE_OUTPUT_LAYOUT_VERSION,
  RULE_OUTPUT_VARIANT_DIRECTORIES,
  resolveRuleOutputTarget,
  supportsDomainset,
} from './rule-output-variants';

export const RULE_OUTPUT_AUDIT_FILE = 'Internal/rule-output-audit.json';
export const SOURCE_DELTA_FILE = 'Internal/source-delta.json';
const RULE_COVERAGE_FILE = 'Internal/rule-coverage.json';
const STATUS_FILE = 'status.json';
export const LIFECYCLE_REPORT_FILE = 'Internal/artifact-lifecycle.json';

/** Reports the rule build must deliver with every candidate, before index regeneration. */
const CANDIDATE_REPORTS = [RULE_OUTPUT_AUDIT_FILE, SOURCE_DELTA_FILE, RULE_COVERAGE_FILE, STATUS_FILE] as const;
/** Reports the final publication tree must contain. */
export const PUBLICATION_REPORTS = [...CANDIDATE_REPORTS, LIFECYCLE_REPORT_FILE] as const;

const OUTPUT_STATUSES = new Set(['published', 'absent-empty', 'absent-unsupported']);
const PLATFORM_BY_ROOT = new Map<string, SupportedPlatform>(
  (Object.keys(PLATFORM_OUTPUT_LAYOUT) as SupportedPlatform[]).map(platform => [PLATFORM_OUTPUT_LAYOUT[platform].directory, platform])
);
const DOMAINSET_DIRECTORIES = new Set(RULE_OUTPUT_VARIANT_DIRECTORIES.filter(directory => directory.endsWith('/domainset')));

export function isNativeDomainsetPath(relative: string): boolean {
  const [platform, variant] = relative.split('/', 2);
  return DOMAINSET_DIRECTORIES.has(`${platform}/${variant}`);
}

export interface AuditOutput {
  path: string,
  status: 'published' | 'absent-empty' | 'absent-unsupported',
  sha256: string | null,
  bytes: number | null
}

export interface OutputContract {
  outputs: AuditOutput[],
  /** Receipt the source delta was computed against; null when the build had no baseline. */
  deltaBaselineReceiptId: number | null
}

export class OutputContractError extends Error {
  // eslint-disable-next-line sukka/unicorn/custom-error-definition -- structured publication fields precede the message
  constructor(readonly code: 'missing-report' | 'invalid-report', message: string) {
    super(message);
    this.name = 'OutputContractError';
  }
}

function invalid(file: string, detail: string): never {
  throw new OutputContractError('invalid-report', `${file} is invalid: ${detail}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseRuleOutputAudit(text: string, ignoreHistoricalDomainsets = false): AuditOutput[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    invalid(RULE_OUTPUT_AUDIT_FILE, 'not JSON');
  }
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.rulesets)) invalid(RULE_OUTPUT_AUDIT_FILE, 'unsupported schema');
  const currentLayout = value.layoutVersion === RULE_OUTPUT_LAYOUT_VERSION;
  const outputs: AuditOutput[] = [];
  const seen = new Set<string>();
  for (const ruleset of value.rulesets as unknown[]) {
    if (!isRecord(ruleset) || typeof ruleset.id !== 'string' || !Array.isArray(ruleset.outputs)) invalid(RULE_OUTPUT_AUDIT_FILE, 'ruleset entry');
    for (const output of ruleset.outputs as unknown[]) {
      if (!isRecord(output) || typeof output.path !== 'string' || typeof output.status !== 'string' || !OUTPUT_STATUSES.has(output.status)) {
        invalid(RULE_OUTPUT_AUDIT_FILE, `output entry of ${ruleset.id}`);
      }
      let normalized: string;
      try {
        normalized = normalizePublicPath(output.path);
      } catch {
        invalid(RULE_OUTPUT_AUDIT_FILE, `output path ${output.path}`);
      }
      const [root, variant] = normalized.split('/');
      const platform = PLATFORM_BY_ROOT.get(root);
      if (!platform || normalized !== output.path) invalid(RULE_OUTPUT_AUDIT_FILE, `output path ${output.path}`);
      if (seen.has(normalized)) invalid(RULE_OUTPUT_AUDIT_FILE, `duplicate output path ${normalized}`);
      seen.add(normalized);
      const status = output.status as AuditOutput['status'];
      if (variant === 'domainset') {
        // Historical layouts partitioned exact/suffix rules away from non_ip and sometimes
        // served a different format at the same URL. Those bodies cannot be rolled forward.
        if (!currentLayout && ignoreHistoricalDomainsets) continue;
        if (!currentLayout && status === 'published') {
          invalid(RULE_OUTPUT_AUDIT_FILE, `ruleset ${ruleset.id} uses the retired domainset variant layout (${normalized}); rebuild to publish the current subscription formats`);
        }
        if (currentLayout) {
          const expected = supportsDomainset(platform) ? resolveRuleOutputTarget(platform, 'domainset', ruleset.id) : null;
          if (expected?.relativePath !== normalized || output.format !== expected.format || output.variant !== expected.slot || output.platform !== expected.platform) {
            invalid(RULE_OUTPUT_AUDIT_FILE, `invalid domainset subscription for ${ruleset.id}: ${normalized}`);
          }
        }
      }
      if (status === 'published') {
        if (typeof output.sha256 !== 'string' || !/^[\da-f]{64}$/.test(output.sha256)) invalid(RULE_OUTPUT_AUDIT_FILE, `sha256 of ${normalized}`);
        if (typeof output.bytes !== 'number' || !Number.isSafeInteger(output.bytes) || output.bytes < 0) invalid(RULE_OUTPUT_AUDIT_FILE, `bytes of ${normalized}`);
        outputs.push({ path: normalized, status, sha256: output.sha256, bytes: output.bytes });
      } else {
        outputs.push({ path: normalized, status, sha256: null, bytes: null });
      }
    }
  }
  return outputs.sort((a, b) => comparePaths(a.path, b.path));
}

function parseSourceDeltaBaseline(text: string): number | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    invalid(SOURCE_DELTA_FILE, 'not JSON');
  }
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.baseline) || !Array.isArray(value.sources)) invalid(SOURCE_DELTA_FILE, 'unsupported schema');
  const id = value.baseline.receiptId;
  if (id === null) return null;
  if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) return id;
  if (typeof id === 'string' && /^\d+$/.test(id)) return Number(id);
  invalid(SOURCE_DELTA_FILE, 'baseline.receiptId');
}

function validateOtherReport(file: string, text: string): void {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    invalid(file, 'not JSON');
  }
  if (!isRecord(value)) invalid(file, 'not an object');
  if (file === STATUS_FILE && (typeof value.buildTime !== 'string' || Number.isNaN(Date.parse(value.buildTime)) || !Array.isArray(value.rulesets))) {
    invalid(file, 'buildTime or rulesets');
  }
  if (file === LIFECYCLE_REPORT_FILE && (typeof value.version !== 'number' || !Array.isArray(value.records) || !Array.isArray(value.removed))) {
    invalid(file, 'version, records or removed');
  }
}

async function readReport(root: string, file: string): Promise<string> {
  try {
    return await fs.readFile(path.join(root, ...file.split('/')), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new OutputContractError('missing-report', `${file} is missing`);
    throw error;
  }
}

/** Require and schema-check the given reports; returns the rule output contract. */
export async function readOutputContract(root: string, reports: readonly string[] = CANDIDATE_REPORTS): Promise<OutputContract> {
  let outputs: AuditOutput[] = [];
  let deltaBaselineReceiptId: number | null = null;
  for (const file of reports) {
    // eslint-disable-next-line no-await-in-loop -- report the first missing report deterministically
    const text = await readReport(root, file);
    if (file === RULE_OUTPUT_AUDIT_FILE) outputs = parseRuleOutputAudit(text);
    else if (file === SOURCE_DELTA_FILE) deltaBaselineReceiptId = parseSourceDeltaBaseline(text);
    else validateOtherReport(file, text);
  }
  return { outputs, deltaBaselineReceiptId };
}

async function fileState(file: string): Promise<'file' | 'absent' | 'other'> {
  try {
    return (await fs.lstat(file)).isFile() ? 'file' : 'other';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'absent';
    throw error;
  }
}

/** Current domainsets are exposed only when the file agrees with the native layout audit. */
export async function readPublishedDomainsetPaths(root: string): Promise<ReadonlySet<string>> {
  let audit: string;
  try {
    audit = await readReport(root, RULE_OUTPUT_AUDIT_FILE);
  } catch (error) {
    if (error instanceof OutputContractError && error.code === 'missing-report') return new Set();
    throw error;
  }
  const published = new Set<string>();
  for (const output of parseRuleOutputAudit(audit, true)) {
    if (output.status !== 'published' || !isNativeDomainsetPath(output.path)) continue;
    const file = path.join(root, output.path);
    // eslint-disable-next-line no-await-in-loop -- bound the file descriptors used for digest checks
    if (await fileState(file) !== 'file') continue;
    // eslint-disable-next-line no-await-in-loop -- bound the file descriptors used for digest checks
    const digest = await hashFile(file);
    if (digest.bytes === output.bytes && digest.sha256 === output.sha256) published.add(output.path);
  }
  return published;
}

/** Drop stale native files after a complete rule build has written its fresh audit. */
export async function pruneStaleNativeDomainsets(root: string): Promise<string[]> {
  const { outputs } = await readOutputContract(root, [RULE_OUTPUT_AUDIT_FILE]);
  const audited = new Set(outputs.map(output => output.path));
  const realRoot = await fs.realpath(root);
  const removed: string[] = [];
  for (const platform of PLATFORM_BY_ROOT.values()) {
    if (!supportsDomainset(platform)) continue;
    const sample = resolveRuleOutputTarget(platform, 'domainset', 'sample').relativePath;
    const extension = path.posix.extname(sample);
    const relativeDirectory = path.posix.dirname(sample);
    const directory = path.join(realRoot, relativeDirectory);
    // eslint-disable-next-line no-await-in-loop -- check each managed directory before deleting anything in it
    const realDirectory = await fs.realpath(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (realDirectory === null) continue;
    if (realDirectory !== directory) throw new Error(`Domainset directory resolves outside its output path: ${relativeDirectory}`);
    // eslint-disable-next-line no-await-in-loop -- deterministic cleanup and diagnostics
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(extension) || entry.name.startsWith('.')) continue;
      const relative = `${relativeDirectory}/${entry.name}`;
      if (audited.has(relative)) continue;
      // eslint-disable-next-line no-await-in-loop -- deterministic cleanup and diagnostics
      await fs.rm(path.join(directory, entry.name), { force: true });
      removed.push(relative);
    }
  }
  return removed.sort(comparePaths);
}

/**
 * Compare a tree with the output audit: every published output exists with the audited bytes
 * and digest, every absent output is missing, and no unaudited variant file remains.
 */
export async function findOutputMismatches(root: string, outputs: readonly AuditOutput[]): Promise<string[]> {
  const problems: string[] = [];
  const audited = new Map(outputs.map(output => [output.path, output]));
  for (const output of outputs) {
    if (/^List\/(?:non_ip|ip)\/[^/]+\.conf$/.test(output.path)) {
      const sourcePath = output.path.replace(/\.conf$/, '.list');
      const source = audited.get(sourcePath);
      if (source?.status !== output.status || source.bytes !== output.bytes || source.sha256 !== output.sha256) {
        problems.push(`${output.path}: alias does not match audited ${sourcePath}`);
      }
    }
    const file = path.join(root, ...output.path.split('/'));
    // eslint-disable-next-line no-await-in-loop -- sequential hashing bounds open descriptors
    const state = await fileState(file);
    if (output.status !== 'published') {
      if (state !== 'absent') problems.push(`${output.path}: audit says ${output.status} but the file is present`);
      continue;
    }
    if (state !== 'file') {
      problems.push(`${output.path}: published in the audit but missing`);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- sequential hashing bounds open descriptors
    const digest = await hashFile(file);
    if (digest.bytes !== output.bytes || digest.sha256 !== output.sha256) {
      problems.push(`${output.path}: ${digest.bytes} bytes sha256 ${digest.sha256}, audit expects ${output.bytes} bytes sha256 ${output.sha256}`);
    }
  }
  for (const directory of RULE_OUTPUT_VARIANT_DIRECTORIES) {
    // eslint-disable-next-line no-await-in-loop -- these are small directory reads
    const names = await fs.readdir(path.join(root, directory)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [] as string[];
      throw error;
    });
    for (const name of names) {
      const relative = `${directory}/${name}`;
      if (!audited.has(relative)) problems.push(`${relative}: variant file is not listed in the audit`);
    }
  }
  return problems.sort(comparePaths);
}

/** Paths the audit declares absent; production must answer 404 for each. */
export function auditAbsentPaths(outputs: readonly AuditOutput[]): string[] {
  return outputs.flatMap(output => (output.status === 'published' ? [] : [output.path]));
}
