import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { ARTIFACT_LIFECYCLE_VERSION, assertNoRetiredArtifacts, isRetiredPublicPath, purgeRetiredArtifacts } from './artifact-lifecycle';
import { writeFileAtomic } from './atomic-file';
import type { ResolvedBaseline } from './publication-baseline';
import type { GitHubClient } from './publication-github';
import { assertRepository } from './publication-github';
import type { PublicationManifest, PublicationRollbackSource } from './publication-manifest';
import {
  LIFECYCLE_REPORT_FILE,
  OutputContractError,
  PUBLICATION_REPORTS,
  RULE_OUTPUT_AUDIT_FILE,
  SOURCE_DELTA_FILE,
  findOutputMismatches,
  readOutputContract,
} from './publication-outputs';
import { readPreservedArtifacts } from '../restore-optional-artifacts';
import {
  PUBLICATION_MANIFEST_PATH,
  buildManifest,
  comparePaths,
  hashFile,
  listTreeFiles,
  scanTree,
  serializeManifest,
  sha256Hex,
} from './publication-manifest';

/** Rule outputs and reports every production candidate must carry fresh. */
const CORE_DIRS = ['List', 'Clash', 'Loon', 'sing-box', 'GeoIP', 'Internal'] as const;
/** Directories refreshed only by their own task; otherwise preserved from the accepted baseline. */
const OPTIONAL_DIRS = ['Mirror', 'Modules', 'Scripts'] as const;
/** Files regenerated for the final tree by build-public. */
const REGENERATED_FILES = new Set(['index.html', '_headers', '404.html', 'README.md', 'LICENSE', LIFECYCLE_REPORT_FILE]);

export type StageErrorCode =
  | 'missing-core-dir'
  | 'copy-failed'
  | 'baseline-unavailable'
  | 'baseline-drift'
  | 'already-accepted'
  | 'missing-report'
  | 'invalid-report'
  | 'output-mismatch'
  | 'provenance-mismatch'
  | 'retired-present'
  | 'render-failed';

export class StageError extends Error {
  // eslint-disable-next-line sukka/unicorn/custom-error-definition -- structured publication fields precede the message
  constructor(readonly code: StageErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'StageError';
  }
}

/** Directories this run must take fresh from the candidate, derived from the task plan. */
export function freshDirsForTasks(tasks: readonly string[]): string[] {
  const dirs: string[] = [...CORE_DIRS];
  if (tasks.includes('mirror-sync')) dirs.push('Mirror');
  if (tasks.includes('convert-plugins') || tasks.includes('merge-modules')) dirs.push('Modules');
  if (tasks.includes('convert-plugins')) dirs.push('Scripts');
  return dirs;
}

function preservedDirsForTasks(tasks: readonly string[]): string[] {
  const fresh = new Set(freshDirsForTasks(tasks));
  return OPTIONAL_DIRS.filter(dir => !fresh.has(dir));
}

function isHidden(name: string): boolean {
  return name.startsWith('.');
}

async function countFiles(directory: string): Promise<number> {
  try {
    return (await listTreeFiles(directory)).length;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
}

async function copyTree(source: string, target: string): Promise<void> {
  try {
    await fs.cp(source, target, {
      recursive: true,
      errorOnExist: true,
      force: false,
      filter: item => !isHidden(path.basename(item)) || item === source,
    });
  } catch (error) {
    throw new StageError('copy-failed', `copy ${source} -> ${target}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const [expected, actual] = await Promise.all([
    listTreeFiles(source).then(files => files.filter(file => !file.split('/').some(isHidden))),
    listTreeFiles(target),
  ]);
  if (expected.length !== actual.length) {
    throw new StageError('copy-failed', `copy ${source} -> ${target} produced ${actual.length} of ${expected.length} files`);
  }
}

/** Copy exactly the verified baseline files under one directory, checking each digest. */
async function copyVerifiedFiles(baselineTree: string, baseline: ResolvedBaseline, dir: string, target: string): Promise<string[]> {
  const copied: string[] = [];
  for (const file of baseline.files) {
    if (!file.path.startsWith(`${dir}/`)) continue;
    const from = path.join(baselineTree, ...file.path.split('/'));
    const to = path.join(target, ...file.path.split('/'));
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential copy with digest verification
      await fs.mkdir(path.dirname(to), { recursive: true });
      // eslint-disable-next-line no-await-in-loop -- sequential copy with digest verification
      await fs.copyFile(from, to, fs.constants.COPYFILE_EXCL);
    } catch (error) {
      throw new StageError('copy-failed', `preserve ${file.path} from ${baseline.deployCommit}: ${error instanceof Error ? error.message : String(error)}`);
    }
    // eslint-disable-next-line no-await-in-loop -- sequential copy with digest verification
    const { sha256 } = await hashFile(to);
    if (sha256 !== file.sha256) throw new StageError('copy-failed', `preserved ${file.path} digest changed during copy`);
    copied.push(file.path);
  }
  return copied;
}

/**
 * Files that optional-artifact restoration copied from the accepted baseline into fresh
 * directories. Each must still carry the recorded digest and match the baseline evidence.
 */
async function verifiedRestorationProvenance(out: string, baseline: ResolvedBaseline | null): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  let provenance;
  try {
    provenance = await readPreservedArtifacts(out);
  } catch (error) {
    throw new StageError('provenance-mismatch', error instanceof Error ? error.message : String(error));
  }
  if (!provenance?.files.length) return result;
  if (!baseline) throw new StageError('provenance-mismatch', `restored artifacts come from ${provenance.fromCommit ?? 'an unknown commit'}, but no accepted baseline is available`);
  if (provenance.fromCommit !== baseline.deployCommit) {
    throw new StageError('provenance-mismatch', `restored artifacts come from ${provenance.fromCommit ?? 'an unknown commit'}, but the accepted baseline is ${baseline.deployCommit}`);
  }
  const accepted = new Map(baseline.files.map(file => [file.path, file.sha256]));
  for (const entry of provenance.files) {
    if (isRetiredPublicPath(entry.path)) continue;
    let digest;
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential hashing bounds open descriptors
      digest = await hashFile(path.join(out, ...entry.path.split('/')));
    } catch (error) {
      throw new StageError('provenance-mismatch', `restored ${entry.path} is missing: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (digest.sha256 !== entry.sha256 || digest.bytes !== entry.bytes) throw new StageError('provenance-mismatch', `restored ${entry.path} changed after restoration`);
    if (accepted.get(entry.path) !== entry.sha256) throw new StageError('provenance-mismatch', `restored ${entry.path} is not the accepted baseline version`);
    result.set(entry.path, provenance.fromCommit);
  }
  return result;
}

interface RenderOptions {
  builtAt: string,
  removed: readonly string[]
}

export type RenderPublic = (stagingDir: string, options: RenderOptions) => Promise<void>;

const PREPARE_CLI = path.resolve(__dirname, '..', 'prepare-publication.ts');

/** Run build-public with PUBLIC_DIR pointed at the staging tree, in a child process. */
export const renderPublicInChild: RenderPublic = (stagingDir, options) => new Promise((resolve, reject) => {
  execFile(
    process.execPath,
    ['-r', '@swc-node/register', PREPARE_CLI, 'render-public', '--built-at', options.builtAt, '--removed', JSON.stringify(options.removed)],
    {
      cwd: path.resolve(__dirname, '..', '..'),
      env: { ...process.env, PUBLIC_DIR: path.resolve(stagingDir), SWC_NODE_IGNORE_DYNAMIC: 'true' },
      maxBuffer: 32 * 1024 * 1024,
    },
    (error, _stdout, stderr) => {
      if (error) reject(new StageError('render-failed', `build-public failed for ${stagingDir}: ${stderr.trim() || error.message}`));
      else resolve();
    }
  );
});

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Build time recorded by the candidate; deterministic for retries of the same artifact. */
export async function readCandidateBuiltAt(candidateDir: string): Promise<string | null> {
  const status = await readJson(path.join(candidateDir, 'status.json')) as { buildTime?: unknown } | undefined;
  return typeof status?.buildTime === 'string' && !Number.isNaN(Date.parse(status.buildTime)) ? status.buildTime : null;
}

export type BaselineDrift =
  | { state: 'none' }
  | { state: 'already-accepted', receiptId: number, deployCommit: string }
  | { state: 'drift', declared: number | null, current: number | null };

const RULE_DIRS = ['List', 'Clash', 'Loon', 'sing-box', 'GeoIP'] as const;

/**
 * Compare the receipt the candidate's source delta was computed against with the accepted
 * baseline seen inside the production lock. When they differ only because this same candidate
 * was already accepted (for example a lost response after the receipt was written), the
 * publication is an idempotent retry. Any other difference needs a rebuild: the source delta
 * is computed by the rule build and is not recomputed here.
 */
export async function classifyBaselineDrift(options: {
  candidateDir: string,
  baseline: ResolvedBaseline | null,
  sourceCommit: string,
  builtAt: string | null
}): Promise<BaselineDrift> {
  const { deltaBaselineReceiptId: declared } = await readOutputContract(options.candidateDir, [SOURCE_DELTA_FILE]);
  const { baseline } = options;
  const current = baseline?.receiptId ?? null;
  if (declared === current) return { state: 'none' };
  if (
    baseline?.kind === 'manifest'
    && baseline.parentReceiptId === declared
    && baseline.sourceCommit === options.sourceCommit
    && baseline.generatedAt !== null
    && baseline.generatedAt === options.builtAt
  ) {
    const compared = new Set<string>(RULE_DIRS);
    const isCompared = (relative: string) => compared.has(relative.split('/')[0]) || relative === RULE_OUTPUT_AUDIT_FILE || relative === SOURCE_DELTA_FILE;
    const accepted = new Map<string, string>();
    for (const file of baseline.files) {
      if (isCompared(file.path)) accepted.set(file.path, file.sha256);
    }
    const candidateFiles = (await scanTree(options.candidateDir)).filter(file => isCompared(file.path) && !isRetiredPublicPath(file.path));
    const same = candidateFiles.length === accepted.size && candidateFiles.every(file => accepted.get(file.path) === file.sha256);
    if (same) return { state: 'already-accepted', receiptId: baseline.receiptId, deployCommit: baseline.deployCommit };
  }
  return { state: 'drift', declared, current };
}

function stageContractError(error: unknown): never {
  if (error instanceof OutputContractError) throw new StageError(error.code, error.message);
  throw error;
}

export interface StageOptions {
  candidateDir: string,
  outDir: string,
  tasks: readonly string[],
  sourceCommit: string,
  baseline: ResolvedBaseline | null,
  baselineTreeDir: string | null,
  render: RenderPublic,
  /** Accepted tree used as the whole candidate; all of its files are preserved. */
  rollbackOf?: PublicationRollbackSource | null,
  builtAt?: string,
  log?: (message: string) => void
}

export interface StageResult {
  manifest: PublicationManifest,
  manifestText: string,
  manifestSha256: string,
  removed: string[]
}

/**
 * Assemble the complete production tree: required fresh directories from the candidate,
 * other optional directories from the accepted baseline, retired paths purged across the
 * whole tree, public index regenerated for the final tree, and the manifest written last.
 */
export async function stagePublication(options: StageOptions): Promise<StageResult> {
  const candidate = path.resolve(options.candidateDir);
  const out = path.resolve(options.outDir);
  const rollback = options.rollbackOf ?? null;
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(out, { recursive: true });

  const fresh = rollback ? [...CORE_DIRS] : freshDirsForTasks(options.tasks);
  for (const dir of fresh) {
    // eslint-disable-next-line no-await-in-loop -- report the first missing directory deterministically
    if (await countFiles(path.join(candidate, dir)) === 0) {
      throw new StageError('missing-core-dir', `${dir}/ is missing or empty in the candidate; production keeps the accepted version`);
    }
  }

  const builtAt = options.builtAt ?? await readCandidateBuiltAt(candidate) ?? new Date().toISOString();
  await readOutputContract(candidate).catch(stageContractError);
  if (!rollback) {
    const drift = await classifyBaselineDrift({ candidateDir: candidate, baseline: options.baseline, sourceCommit: options.sourceCommit, builtAt });
    if (drift.state === 'already-accepted') {
      throw new StageError('already-accepted', `this candidate is already accepted as receipt ${drift.receiptId} (NRRule ${drift.deployCommit}); nothing to publish`);
    }
    if (drift.state === 'drift') {
      throw new StageError(
        'baseline-drift',
        `rebuild required: ${SOURCE_DELTA_FILE} was computed against receipt ${drift.declared ?? 'none'}, but the accepted baseline is now ${drift.current ?? 'none'}`
      );
    }
  }

  const preservedFrom = new Map<string, string>();
  const preservedDirs: string[] = [];
  const entries = await fs.readdir(candidate, { withFileTypes: true });
  const optional = new Set<string>(OPTIONAL_DIRS);
  for (const entry of entries) {
    if (isHidden(entry.name)) continue;
    const from = path.join(candidate, entry.name);
    const to = path.join(out, entry.name);
    if (entry.isDirectory()) {
      if (!rollback && optional.has(entry.name) && !fresh.includes(entry.name)) continue;
      // eslint-disable-next-line no-await-in-loop -- sequential copy keeps error attribution precise
      await copyTree(from, to);
    } else if (entry.isFile()) {
      try {
        // eslint-disable-next-line no-await-in-loop -- sequential copy keeps error attribution precise
        await fs.copyFile(from, to, fs.constants.COPYFILE_EXCL);
      } catch (error) {
        throw new StageError('copy-failed', `copy ${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      throw new StageError('copy-failed', `candidate root entry ${entry.name} is not a regular file or directory`);
    }
  }

  if (rollback) {
    for (const relative of await listTreeFiles(out)) preservedFrom.set(relative, rollback.deployCommit);
    preservedDirs.push(...OPTIONAL_DIRS.filter(dir => [...preservedFrom.keys()].some(file => file.startsWith(`${dir}/`))));
  } else {
    const wanted = preservedDirsForTasks(options.tasks);
    if (wanted.length && (!options.baseline || !options.baselineTreeDir)) {
      throw new StageError('baseline-unavailable', `no accepted baseline to preserve ${wanted.join(', ')}; run the bootstrap-baseline task first`);
    }
    for (const dir of wanted) {
      // eslint-disable-next-line no-await-in-loop -- sequential verified copy
      const copied = await copyVerifiedFiles(options.baselineTreeDir!, options.baseline!, dir, out);
      if (!copied.length) {
        options.log?.(`Accepted baseline ${options.baseline!.deployCommit} has no ${dir}/ files; ${dir}/ stays absent`);
        continue;
      }
      preservedDirs.push(dir);
      for (const relative of copied) preservedFrom.set(relative, options.baseline!.deployCommit);
      options.log?.(`Preserved ${dir}/ (${copied.length} files) from accepted ${options.baseline!.deployCommit}`);
    }
  }

  if (!rollback) {
    for (const [relative, commit] of await verifiedRestorationProvenance(out, options.baseline)) preservedFrom.set(relative, commit);
  }

  await fs.rm(path.join(out, ...PUBLICATION_MANIFEST_PATH.split('/')), { force: true });
  const removed = await purgeRetiredArtifacts(out);
  try {
    await assertNoRetiredArtifacts(out);
  } catch (error) {
    throw new StageError('retired-present', error instanceof Error ? error.message : String(error));
  }

  const candidateReport = await readJson(path.join(candidate, ...LIFECYCLE_REPORT_FILE.split('/'))) as { removed?: unknown } | undefined;
  const reportRemoved = Array.isArray(candidateReport?.removed) ? candidateReport.removed.filter((item): item is string => typeof item === 'string') : [];
  // Placeholder so the regenerated index lists the manifest written below.
  await writeFileAtomic(path.join(out, ...PUBLICATION_MANIFEST_PATH.split('/')), '{}\n');
  await options.render(out, { builtAt, removed: [...new Set([...reportRemoved, ...removed])].sort(comparePaths) });
  try {
    await assertNoRetiredArtifacts(out);
  } catch (error) {
    throw new StageError('retired-present', error instanceof Error ? error.message : String(error));
  }
  const contract = await readOutputContract(out, PUBLICATION_REPORTS).catch(stageContractError);
  const mismatches = await findOutputMismatches(out, contract.outputs);
  if (mismatches.length) {
    throw new StageError('output-mismatch', `rule outputs disagree with ${RULE_OUTPUT_AUDIT_FILE}: ${mismatches.slice(0, 10).join('; ')}${mismatches.length > 10 ? ` (+${mismatches.length - 10} more)` : ''}`);
  }

  for (const relative of REGENERATED_FILES) preservedFrom.delete(relative);
  const files = await scanTree(out);
  const published = new Set(files.map(file => file.path));
  const removedPaths = new Set(removed);
  for (const file of options.baseline?.files ?? []) {
    if (!published.has(file.path) && file.path !== PUBLICATION_MANIFEST_PATH) removedPaths.add(file.path);
  }
  const manifest = buildManifest({
    kind: rollback ? 'rollback' : 'build',
    sourceCommit: options.sourceCommit,
    baselineReceiptId: options.baseline?.receiptId ?? null,
    baselineDeployCommit: options.baseline?.deployCommit ?? null,
    lifecycleVersion: ARTIFACT_LIFECYCLE_VERSION,
    generatedAt: builtAt,
    freshDirs: rollback ? [] : fresh.filter(dir => files.some(file => file.path.startsWith(`${dir}/`))),
    preservedDirs,
    retiredRemoved: removed,
    removedPaths: [...removedPaths],
    rollbackOf: rollback,
    files,
    preservedFrom: relative => preservedFrom.get(relative),
  });
  const manifestText = serializeManifest(manifest);
  await writeFileAtomic(path.join(out, ...PUBLICATION_MANIFEST_PATH.split('/')), manifestText);
  return { manifest, manifestText, manifestSha256: sha256Hex(manifestText), removed };
}

/**
 * Before the rule build, replace optional directories this run does not refresh with the
 * verified files of the accepted baseline, so the build-time index reflects the final tree.
 */
export async function restorePreservedDirs(options: {
  publicDir: string,
  tasks: readonly string[],
  baseline: ResolvedBaseline,
  baselineTreeDir: string,
  log?: (message: string) => void
}): Promise<string[]> {
  const restored: string[] = [];
  for (const dir of preservedDirsForTasks(options.tasks)) {
    // eslint-disable-next-line no-await-in-loop -- sequential replacement
    await fs.rm(path.join(options.publicDir, dir), { recursive: true, force: true });
    // eslint-disable-next-line no-await-in-loop -- sequential replacement
    const copied = await copyVerifiedFiles(options.baselineTreeDir, options.baseline, dir, options.publicDir);
    options.log?.(`Restored ${dir}/ (${copied.length} files) from accepted ${options.baseline.deployCommit}`);
    if (copied.length) restored.push(dir);
  }
  return restored;
}

export type SupersededResult = { superseded: false, note?: string } | { superseded: true, reason: string };

/** A candidate is superseded when the accepted baseline already carries newer source or build time. */
export async function checkSuperseded(options: {
  client: GitHubClient,
  repository: string,
  sourceCommit: string,
  builtAt: string,
  baseline: ResolvedBaseline | null
}): Promise<SupersededResult> {
  const { baseline } = options;
  if (baseline?.kind !== 'manifest') return { superseded: false };
  if (baseline.sourceCommit === options.sourceCommit) {
    if (baseline.generatedAt && Date.parse(baseline.generatedAt) > Date.parse(options.builtAt)) {
      return { superseded: true, reason: `accepted receipt ${baseline.receiptId} has a newer build (${baseline.generatedAt}) of the same source` };
    }
    return { superseded: false };
  }
  const repository = assertRepository(options.repository);
  const { data } = await options.client.request<{ status: string }>(
    'GET',
    `/repos/${repository}/compare/${baseline.sourceCommit}...${options.sourceCommit}`
  );
  if (data.status === 'behind') {
    return { superseded: true, reason: `accepted receipt ${baseline.receiptId} publishes newer source ${baseline.sourceCommit}` };
  }
  if (data.status === 'diverged') return { superseded: false, note: `source ${options.sourceCommit} diverged from accepted ${baseline.sourceCommit}` };
  return { superseded: false };
}

/** Commit-message scope label, e.g. `rules+mirrors+modules+scripts` or `rollback:<receipt>`. */
export function publicationScopeLabel(manifest: Pick<PublicationManifest, 'freshDirs' | 'rollbackOf'>): string {
  if (manifest.rollbackOf) return `rollback:${manifest.rollbackOf.receiptId}`;
  const labels = ['rules'];
  if (manifest.freshDirs.includes('Mirror')) labels.push('mirrors');
  if (manifest.freshDirs.includes('Modules')) labels.push('modules');
  if (manifest.freshDirs.includes('Scripts')) labels.push('scripts');
  return labels.join('+');
}
