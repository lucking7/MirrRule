import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { normalizePublicPath } from './artifact-lifecycle';

const PUBLICATION_MANIFEST_SCHEMA_VERSION = 1;
/** Publication-root relative location; the manifest never lists or hashes itself. */
export const PUBLICATION_MANIFEST_PATH = 'Internal/publication-manifest.json';

type PublicationFileOrigin = 'generated' | 'preserved';
type PublicationKind = 'build' | 'rollback';

interface PublicationManifestFile {
  path: string,
  sha256: string,
  bytes: number,
  origin: PublicationFileOrigin,
  preservedFromCommit?: string
}

export interface PublicationRollbackSource {
  receiptId: number,
  deployCommit: string,
  sourceCommit: string
}

export interface PublicationManifest {
  schemaVersion: typeof PUBLICATION_MANIFEST_SCHEMA_VERSION,
  kind: PublicationKind,
  /** MirrRule revision that produced the candidate content. */
  sourceCommit: string,
  /** Content address of every listed file; identical trees share one candidate id. */
  candidateId: string,
  baselineReceiptId: number | null,
  /** NRRule revision of the accepted baseline; never the unverified remote HEAD. */
  baselineDeployCommit: string | null,
  lifecycleVersion: number,
  generatedAt: string,
  /** Directories that this run required fresh from the candidate. */
  freshDirs: string[],
  /** Directories copied from the accepted baseline tree. */
  preservedDirs: string[],
  /** Registered retired paths removed while staging this tree. */
  retiredRemoved: string[],
  /** Paths of the accepted baseline (and retired paths) that this tree no longer publishes; they must answer 404. */
  removedPaths: string[],
  rollbackOf: PublicationRollbackSource | null,
  files: PublicationManifestFile[]
}

export interface TreeFileDigest {
  path: string,
  sha256: string,
  bytes: number
}

export function comparePaths(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export async function hashFile(file: string): Promise<{ sha256: string, bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    const buffer = chunk as Uint8Array;
    bytes += buffer.length;
    hash.update(buffer);
  }
  return { sha256: hash.digest('hex'), bytes };
}

/** Every regular file under root except the `.git` directory, as sorted `/` relative paths. */
export async function listTreeFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (directory: string, prefix: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!prefix && entry.name === '.git') continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop -- bounded recursive walk with deterministic output
        await walk(full, relative);
      } else if (entry.isFile()) {
        files.push(relative);
      } else {
        throw new Error(`Publication tree contains a non-regular file: ${relative}`);
      }
    }
  };
  await walk(path.resolve(root), '');
  return files.sort(comparePaths);
}

export async function scanTree(root: string, exclude: ReadonlySet<string> = new Set([PUBLICATION_MANIFEST_PATH])): Promise<TreeFileDigest[]> {
  const relatives = (await listTreeFiles(root)).filter(relative => !exclude.has(relative));
  const digests: TreeFileDigest[] = [];
  for (const relative of relatives) {
    // eslint-disable-next-line no-await-in-loop -- sequential hashing bounds open descriptors
    const digest = await hashFile(path.join(root, ...relative.split('/')));
    digests.push({ path: relative, ...digest });
  }
  return digests;
}

export function computeCandidateId(files: ReadonlyArray<Pick<TreeFileDigest, 'path' | 'sha256'>>): string {
  const hash = createHash('sha256');
  for (const file of [...files].sort((a, b) => comparePaths(a.path, b.path))) {
    hash.update(`${file.path}\0${file.sha256}\n`);
  }
  return `sha256:${hash.digest('hex')}`;
}

export interface BuildManifestInput {
  kind: PublicationKind,
  sourceCommit: string,
  baselineReceiptId: number | null,
  baselineDeployCommit: string | null,
  lifecycleVersion: number,
  generatedAt: string,
  freshDirs: readonly string[],
  preservedDirs: readonly string[],
  retiredRemoved: readonly string[],
  removedPaths?: readonly string[],
  rollbackOf?: PublicationRollbackSource | null,
  files: readonly TreeFileDigest[],
  /** Commit a preserved file was copied from; undefined marks the file as generated. */
  preservedFrom: (relative: string) => string | undefined
}

export function buildManifest(input: BuildManifestInput): PublicationManifest {
  const files: PublicationManifestFile[] = [];
  for (const file of input.files) {
    if (file.path === PUBLICATION_MANIFEST_PATH) continue;
    const from = input.preservedFrom(file.path);
    files.push(from === undefined
      ? { path: file.path, sha256: file.sha256, bytes: file.bytes, origin: 'generated' }
      : { path: file.path, sha256: file.sha256, bytes: file.bytes, origin: 'preserved', preservedFromCommit: from });
  }
  files.sort((a, b) => comparePaths(a.path, b.path));
  return {
    schemaVersion: PUBLICATION_MANIFEST_SCHEMA_VERSION,
    kind: input.kind,
    sourceCommit: input.sourceCommit,
    candidateId: computeCandidateId(files),
    baselineReceiptId: input.baselineReceiptId,
    baselineDeployCommit: input.baselineDeployCommit,
    lifecycleVersion: input.lifecycleVersion,
    generatedAt: input.generatedAt,
    freshDirs: [...input.freshDirs].sort(comparePaths),
    preservedDirs: [...input.preservedDirs].sort(comparePaths),
    retiredRemoved: [...new Set(input.retiredRemoved)].sort(comparePaths),
    removedPaths: [...new Set([...input.removedPaths ?? [], ...input.retiredRemoved])].sort(comparePaths),
    rollbackOf: input.rollbackOf ?? null,
    files,
  };
}

export function serializeManifest(manifest: PublicationManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

const SHA256_PATTERN = /^[\da-f]{64}$/;
const COMMIT_PATTERN = /^[\da-f]{40}$/;

function fail(message: string): never {
  throw new Error(`Invalid publication manifest: ${message}`);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

export function parseManifest(text: string): PublicationManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    fail('not JSON');
  }
  if (!value || typeof value !== 'object') fail('not an object');
  const manifest = value as Record<string, unknown>;
  if (manifest.schemaVersion !== PUBLICATION_MANIFEST_SCHEMA_VERSION) fail(`unsupported schemaVersion ${String(manifest.schemaVersion)}`);
  if (manifest.kind !== 'build' && manifest.kind !== 'rollback') fail('kind');
  if (typeof manifest.sourceCommit !== 'string' || !COMMIT_PATTERN.test(manifest.sourceCommit)) fail('sourceCommit');
  if (typeof manifest.candidateId !== 'string' || !manifest.candidateId.startsWith('sha256:')) fail('candidateId');
  if (manifest.baselineReceiptId !== null && typeof manifest.baselineReceiptId !== 'number') fail('baselineReceiptId');
  if (manifest.baselineDeployCommit !== null && (typeof manifest.baselineDeployCommit !== 'string' || !COMMIT_PATTERN.test(manifest.baselineDeployCommit))) fail('baselineDeployCommit');
  if (typeof manifest.lifecycleVersion !== 'number') fail('lifecycleVersion');
  if (typeof manifest.generatedAt !== 'string' || Number.isNaN(Date.parse(manifest.generatedAt))) fail('generatedAt');
  if (!isStringArray(manifest.freshDirs) || !isStringArray(manifest.preservedDirs) || !isStringArray(manifest.retiredRemoved) || !isStringArray(manifest.removedPaths)) fail('directory lists');
  if (!Array.isArray(manifest.files)) fail('files');
  let previous = '';
  for (const raw of manifest.files as unknown[]) {
    const file = raw as Record<string, unknown>;
    if (typeof file.path !== 'string' || normalizePublicPath(file.path) !== file.path) fail(`file path ${String(file.path)}`);
    if (file.path === PUBLICATION_MANIFEST_PATH) fail('lists itself');
    if (previous && comparePaths(previous, file.path) >= 0) fail(`files not sorted or duplicated at ${file.path}`);
    previous = file.path;
    if (typeof file.sha256 !== 'string' || !SHA256_PATTERN.test(file.sha256)) fail(`sha256 of ${file.path}`);
    if (typeof file.bytes !== 'number' || file.bytes < 0) fail(`bytes of ${file.path}`);
    if (file.origin !== 'generated' && file.origin !== 'preserved') fail(`origin of ${file.path}`);
    if (file.origin === 'preserved' && (typeof file.preservedFromCommit !== 'string' || !COMMIT_PATTERN.test(file.preservedFromCommit))) {
      fail(`preservedFromCommit of ${file.path}`);
    }
  }
  const typed = value as PublicationManifest;
  if (computeCandidateId(typed.files) !== typed.candidateId) fail('candidateId does not match the file list');
  return typed;
}

export interface ManifestDiff {
  added: string[],
  removed: string[],
  changed: string[]
}

export function diffManifests(
  previous: ReadonlyArray<Pick<TreeFileDigest, 'path' | 'sha256'>>,
  next: ReadonlyArray<Pick<TreeFileDigest, 'path' | 'sha256'>>
): ManifestDiff {
  const before = new Map(previous.map(file => [file.path, file.sha256]));
  const after = new Map(next.map(file => [file.path, file.sha256]));
  const added: string[] = [];
  const changed: string[] = [];
  for (const [relative, sha] of after) {
    const old = before.get(relative);
    if (old === undefined) added.push(relative);
    else if (old !== sha) changed.push(relative);
  }
  const removed = [...before.keys()].filter(relative => !after.has(relative));
  return { added: added.sort(comparePaths), removed: removed.sort(comparePaths), changed: changed.sort(comparePaths) };
}

export interface TreeVerification {
  missing: string[],
  extra: string[],
  mismatched: string[]
}

export function isTreeVerified(result: TreeVerification): boolean {
  return result.missing.length === 0 && result.extra.length === 0 && result.mismatched.length === 0;
}

/**
 * Compare a tree with expected digests. With `allowExtra`, unlisted files are ignored, which
 * a legacy inventory needs because it covers only preservable directories.
 */
export async function verifyTreeAgainstFiles(
  root: string,
  expected: ReadonlyArray<Pick<TreeFileDigest, 'path' | 'sha256'>>,
  options: { allowExtra?: boolean, exclude?: ReadonlySet<string> } = {}
): Promise<TreeVerification> {
  const exclude = options.exclude ?? new Set([PUBLICATION_MANIFEST_PATH]);
  const actualPaths = (await listTreeFiles(root)).filter(relative => !exclude.has(relative));
  const actual = new Set(actualPaths);
  const missing: string[] = [];
  const mismatched: string[] = [];
  for (const file of expected) {
    if (!actual.has(file.path)) {
      missing.push(file.path);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- sequential hashing bounds open descriptors
    const { sha256 } = await hashFile(path.join(root, ...file.path.split('/')));
    if (sha256 !== file.sha256) mismatched.push(file.path);
  }
  const listed = new Set(expected.map(file => file.path));
  const extra = options.allowExtra ? [] : actualPaths.filter(relative => !listed.has(relative));
  return { missing, extra, mismatched };
}

export async function readManifestFromTree(root: string): Promise<{ manifest: PublicationManifest, text: string, sha256: string }> {
  const text = await fs.readFile(path.join(root, ...PUBLICATION_MANIFEST_PATH.split('/')), 'utf8');
  return { manifest: parseManifest(text), text, sha256: sha256Hex(text) };
}
