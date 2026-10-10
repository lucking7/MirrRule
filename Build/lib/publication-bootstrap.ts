import fs from 'node:fs/promises';
import path from 'node:path';

import { ARTIFACT_LIFECYCLE_VERSION, isRetiredPublicPath } from './artifact-lifecycle';
import { writeFileAtomic } from './atomic-file';
import type { Clock } from './publication-check';
import { PRODUCTION_ORIGIN, isAllowlistedImmutableUrl, pollCloudflareCheck, systemClock } from './publication-check';
import type { GitHubClient } from './publication-github';
import { NRRULE_REPOSITORY } from './publication-github';
import type { GitRunner } from './publication-git';
import { runGit } from './publication-git';
import type { HttpFetcher, OriginFailure } from './publication-http';
import { checkOriginUntil, headerProbes, isPagesConfigPath, parseHeadersFile } from './publication-http';
import type { TreeFileDigest } from './publication-manifest';
import { comparePaths, hashFile, listTreeFiles, sha256Hex } from './publication-manifest';

const LEGACY_INVENTORY_SCHEMA_VERSION = 1;
export const LEGACY_INVENTORY_FILE = 'legacy-inventory.json';
const LEGACY_EVIDENCE_FILE = 'legacy-evidence.json';
/** Directories a legacy production tree may contribute to later candidates. */
const BOOTSTRAP_PRESERVABLE_DIRS = ['Mirror', 'Modules', 'Scripts'] as const;
/** Root files that identify the legacy production version. */
const BOOTSTRAP_IDENTITY_FILES = ['status.json', 'index.html', '404.html', 'README.md', 'LICENSE', '_headers', '_redirects'] as const;

export interface LegacyInventory {
  schemaVersion: typeof LEGACY_INVENTORY_SCHEMA_VERSION,
  kind: 'legacy-inventory',
  /** Pinned NRRule revision. */
  revision: string,
  immutableUrl: string,
  lifecycleVersion: number,
  generatedAt: string,
  preservedDirs: string[],
  identityFiles: string[],
  /** Registered retired paths found in the legacy tree; they are never preservable. */
  excludedRetired: string[],
  files: TreeFileDigest[]
}

interface LegacyEvidence {
  schemaVersion: 1,
  revision: string,
  immutableUrl: string,
  checkRunId: number,
  verifiedAt: string,
  origins: Array<{ origin: string, checkedFiles: number, headerRules: number, failures: OriginFailure[] }>
}

export class BootstrapVerificationError extends Error {
  // eslint-disable-next-line sukka/unicorn/custom-error-definition -- structured publication fields precede the message
  constructor(message: string, readonly failures: OriginFailure[] = []) {
    super(message);
    this.name = 'BootstrapVerificationError';
  }
}

export class BootstrapArtifactUnavailableError extends Error {
  constructor(detail: string, options?: ErrorOptions) {
    super(`Bootstrap artifact unavailable (${detail}); rerun the bootstrap-baseline task to re-verify the legacy revision`, options);
    this.name = 'BootstrapArtifactUnavailableError';
  }
}

async function buildLegacyInventory(options: {
  treeDir: string,
  revision: string,
  immutableUrl: string,
  generatedAt: string
}): Promise<LegacyInventory> {
  const all = await listTreeFiles(options.treeDir);
  const preservable = new Set<string>(BOOTSTRAP_PRESERVABLE_DIRS);
  const identity = new Set<string>(BOOTSTRAP_IDENTITY_FILES);
  const files: TreeFileDigest[] = [];
  const excludedRetired: string[] = [];
  for (const relative of all) {
    const top = relative.split('/')[0];
    if (!(relative.includes('/') ? preservable.has(top) : identity.has(relative))) continue;
    if (isRetiredPublicPath(relative)) {
      excludedRetired.push(relative);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- sequential hashing bounds open descriptors
    files.push({ path: relative, ...await hashFile(path.join(options.treeDir, ...relative.split('/'))) });
  }
  const presentDirs = BOOTSTRAP_PRESERVABLE_DIRS.filter(dir => files.some(file => file.path.startsWith(`${dir}/`)));
  return {
    schemaVersion: LEGACY_INVENTORY_SCHEMA_VERSION,
    kind: 'legacy-inventory',
    revision: options.revision,
    immutableUrl: options.immutableUrl,
    lifecycleVersion: ARTIFACT_LIFECYCLE_VERSION,
    generatedAt: options.generatedAt,
    preservedDirs: [...presentDirs],
    identityFiles: files.flatMap(file => (file.path.includes('/') ? [] : [file.path])),
    excludedRetired: excludedRetired.sort(comparePaths),
    files,
  };
}

function serializeInventory(inventory: LegacyInventory): string {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

export function parseLegacyInventory(text: string): LegacyInventory {
  const value = JSON.parse(text) as Partial<LegacyInventory>;
  if (value.schemaVersion !== LEGACY_INVENTORY_SCHEMA_VERSION || value.kind !== 'legacy-inventory') {
    throw new Error('Invalid legacy inventory: unsupported schema');
  }
  if (typeof value.revision !== 'string' || !/^[\da-f]{40}$/.test(value.revision)) throw new Error('Invalid legacy inventory: revision');
  if (!Array.isArray(value.files) || !Array.isArray(value.preservedDirs)) throw new Error('Invalid legacy inventory: files');
  for (const file of value.files) {
    if (typeof file.path !== 'string' || typeof file.sha256 !== 'string' || !/^[\da-f]{64}$/.test(file.sha256)) {
      throw new Error('Invalid legacy inventory: file entry');
    }
    if (isRetiredPublicPath(file.path)) throw new Error(`Invalid legacy inventory: retired path ${file.path} listed as preservable`);
  }
  return value as LegacyInventory;
}

export interface RunBootstrapOptions {
  client: GitHubClient,
  treeDir: string,
  revision: string,
  immutableUrl: string,
  outDir: string,
  repository?: string,
  productionOrigin?: string,
  fetcher?: HttpFetcher,
  clock?: Clock,
  timeoutMs?: number,
  retryIntervalMs?: number,
  now?: () => Date,
  runner?: GitRunner
}

export interface BootstrapResult {
  inventory: LegacyInventory,
  inventorySha256: string,
  evidence: LegacyEvidence
}

/**
 * Verify a pinned legacy revision: its own Cloudflare check must name the given immutable URL,
 * and every preservable asset must match Git at the immutable URL and the production domain.
 * Pages configuration files are verified by Git content and observed header behavior.
 */
export async function runBootstrap(options: RunBootstrapOptions): Promise<BootstrapResult> {
  const clock = options.clock ?? systemClock;
  const immutableUrl = options.immutableUrl.replace(/\/$/, '').toLowerCase();
  if (!isAllowlistedImmutableUrl(immutableUrl)) throw new BootstrapVerificationError(`Immutable URL is not an allowlisted NRRule deployment: ${options.immutableUrl}`);
  const treeHead = (await (options.runner ?? runGit)(['rev-parse', 'HEAD'], options.treeDir)).stdout.trim();
  if (treeHead !== options.revision) throw new BootstrapVerificationError(`Tree is at ${treeHead || 'an unknown revision'}, expected ${options.revision}`);

  const deadline = clock.now() + (options.timeoutMs ?? 5 * 60000);
  const check = await pollCloudflareCheck({
    client: options.client,
    repository: options.repository ?? NRRULE_REPOSITORY,
    deployCommit: options.revision,
    deadline,
    clock,
  });
  if (check.state !== 'success') {
    throw new BootstrapVerificationError(`Revision ${options.revision} has no successful Cloudflare Pages check (${check.state})`);
  }
  if (check.immutableUrl !== immutableUrl) {
    throw new BootstrapVerificationError(`Cloudflare check for ${options.revision} names ${check.immutableUrl}, not ${immutableUrl}`);
  }

  const now = options.now ?? (() => new Date());
  const inventory = await buildLegacyInventory({
    treeDir: options.treeDir,
    revision: options.revision,
    immutableUrl,
    generatedAt: now().toISOString(),
  });
  const headersFile = inventory.files.find(file => file.path === '_headers');
  const probes = headersFile
    ? headerProbes(parseHeadersFile(await fs.readFile(path.join(options.treeDir, '_headers'), 'utf8')), inventory.files.map(file => file.path))
    : [];
  const origins: LegacyEvidence['origins'] = [];
  for (const origin of [immutableUrl, options.productionOrigin ?? PRODUCTION_ORIGIN]) {
    // eslint-disable-next-line no-await-in-loop -- immutable deployment first, then production
    const failures = await checkOriginUntil({
      origin,
      files: inventory.files,
      headerProbes: probes,
      fetcher: options.fetcher,
      clock,
      deadline,
      retryIntervalMs: options.retryIntervalMs,
    });
    origins.push({
      origin,
      checkedFiles: inventory.files.filter(file => !isPagesConfigPath(file.path)).length,
      headerRules: probes.length,
      failures,
    });
  }
  const evidence: LegacyEvidence = {
    schemaVersion: 1,
    revision: options.revision,
    immutableUrl,
    checkRunId: check.checkRunId,
    verifiedAt: now().toISOString(),
    origins,
  };
  await fs.mkdir(options.outDir, { recursive: true });
  await writeFileAtomic(path.join(options.outDir, LEGACY_EVIDENCE_FILE), `${JSON.stringify(evidence, null, 2)}\n`);
  const failures = origins.flatMap(item => item.failures);
  if (failures.length) {
    throw new BootstrapVerificationError(
      `Legacy assets do not match Git at ${failures.length} location(s): ${failures.slice(0, 10).map(item => item.url).join(', ')}`,
      failures
    );
  }
  const text = serializeInventory(inventory);
  await writeFileAtomic(path.join(options.outDir, LEGACY_INVENTORY_FILE), text);
  return { inventory, inventorySha256: sha256Hex(text), evidence };
}
