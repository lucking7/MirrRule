import fs from 'node:fs/promises';
import path from 'node:path';

import { normalizePublicPath } from './artifact-lifecycle';
import { comparePaths, hashFile } from './publication-manifest';

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
const RULE_OUTPUT_ROOTS = new Set(['List', 'Clash', 'Loon', 'sing-box']);
const VARIANT_DIRS = ['domainset', 'non_ip', 'ip'] as const;

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

function parseRuleOutputAudit(text: string): AuditOutput[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    invalid(RULE_OUTPUT_AUDIT_FILE, 'not JSON');
  }
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.rulesets)) invalid(RULE_OUTPUT_AUDIT_FILE, 'unsupported schema');
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
      if (normalized !== output.path || !RULE_OUTPUT_ROOTS.has(normalized.split('/')[0])) invalid(RULE_OUTPUT_AUDIT_FILE, `output path ${output.path}`);
      if (seen.has(normalized)) invalid(RULE_OUTPUT_AUDIT_FILE, `duplicate output path ${normalized}`);
      seen.add(normalized);
      const status = output.status as AuditOutput['status'];
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

/**
 * Compare a tree with the output audit: every published output exists with the audited bytes
 * and digest, every absent output is missing, and no unaudited variant file remains.
 */
export async function findOutputMismatches(root: string, outputs: readonly AuditOutput[]): Promise<string[]> {
  const problems: string[] = [];
  for (const output of outputs) {
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
  const audited = new Set(outputs.map(output => output.path));
  for (const platform of RULE_OUTPUT_ROOTS) {
    for (const variant of VARIANT_DIRS) {
      // eslint-disable-next-line no-await-in-loop -- twelve small directory reads
      const names = await fs.readdir(path.join(root, platform, variant)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [] as string[];
        throw error;
      });
      for (const name of names) {
        const relative = `${platform}/${variant}/${name}`;
        if (!audited.has(relative)) problems.push(`${relative}: variant file is not listed in the audit`);
      }
    }
  }
  return problems.sort(comparePaths);
}

/** Paths the audit declares absent; production must answer 404 for each. */
export function auditAbsentPaths(outputs: readonly AuditOutput[]): string[] {
  return outputs.flatMap(output => (output.status === 'published' ? [] : [output.path]));
}
