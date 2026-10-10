import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { writeFileAtomic } from './atomic-file';
import { BootstrapArtifactUnavailableError, LEGACY_INVENTORY_FILE, parseLegacyInventory } from './publication-bootstrap';
import type { GitHubClient } from './publication-github';
import { assertRepository, isNotFound } from './publication-github';
import type { PublicationManifest } from './publication-manifest';
import { isTreeVerified, readManifestFromTree, sha256Hex, verifyTreeAgainstFiles } from './publication-manifest';
import type { AcceptedReceipt } from './publication-receipt';

interface BaselineFile {
  path: string,
  sha256: string
}

/** Verified evidence for an accepted baseline tree, written once per job and reused by later steps. */
export interface ResolvedBaseline {
  receiptId: number,
  kind: AcceptedReceipt['payload']['kind'],
  deployCommit: string,
  sourceCommit: string,
  candidateId: string,
  /** Manifest generation time; null for legacy bootstrap baselines. */
  generatedAt: string | null,
  /** Receipt the baseline's own manifest was staged against; null for bootstrap baselines. */
  parentReceiptId: number | null,
  /** Files of the baseline tree that later candidates may preserve, with verified digests. */
  files: BaselineFile[]
}

export class BaselineTreeMismatchError extends Error {
  // eslint-disable-next-line sukka/unicorn/custom-error-definition -- structured publication fields precede the message
  constructor(receiptId: number, detail: string) {
    super(`Accepted baseline tree for receipt ${receiptId} does not match its evidence: ${detail}`);
    this.name = 'BaselineTreeMismatchError';
  }
}

export type ArtifactExtractor = (zipPath: string, directory: string) => Promise<void>;

const unzipExtractor: ArtifactExtractor = (zipPath, directory) => new Promise((resolve, reject) => {
  execFile('unzip', ['-o', '-q', zipPath, '-d', directory], error => {
    if (error) reject(new Error(`unzip failed: ${error.message}`));
    else resolve();
  });
});

interface ArtifactRecord {
  id: number,
  expired: boolean,
  digest?: string | null,
  archive_download_url: string
}

function summarize(items: readonly string[]): string {
  return items.slice(0, 10).join(', ') + (items.length > 10 ? ` (+${items.length - 10} more)` : '');
}

export async function resolveBaselineEvidence(options: {
  client: GitHubClient,
  repository: string,
  receipt: AcceptedReceipt,
  treeDir: string,
  extract?: ArtifactExtractor
}): Promise<ResolvedBaseline> {
  const { receipt } = options;
  const { payload } = receipt;
  if (payload.kind === 'manifest') {
    let read: { manifest: PublicationManifest, sha256: string };
    try {
      read = await readManifestFromTree(options.treeDir);
    } catch (error) {
      throw new BaselineTreeMismatchError(receipt.id, `manifest unreadable: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (read.sha256 !== payload.manifestSha256) throw new BaselineTreeMismatchError(receipt.id, `manifest sha256 ${read.sha256} != ${payload.manifestSha256}`);
    if (read.manifest.candidateId !== payload.candidateId) throw new BaselineTreeMismatchError(receipt.id, 'candidate id differs');
    const result = await verifyTreeAgainstFiles(options.treeDir, read.manifest.files);
    if (!isTreeVerified(result)) {
      throw new BaselineTreeMismatchError(receipt.id, `missing ${summarize(result.missing)}; extra ${summarize(result.extra)}; changed ${summarize(result.mismatched)}`);
    }
    return {
      receiptId: receipt.id,
      kind: payload.kind,
      deployCommit: payload.deployCommit,
      sourceCommit: payload.sourceCommit,
      candidateId: payload.candidateId,
      generatedAt: read.manifest.generatedAt,
      parentReceiptId: read.manifest.baselineReceiptId,
      files: read.manifest.files.map(file => ({ path: file.path, sha256: file.sha256 })),
    };
  }

  const repository = assertRepository(options.repository);
  let artifact: ArtifactRecord;
  try {
    artifact = (await options.client.request<ArtifactRecord>('GET', `/repos/${repository}/actions/artifacts/${payload.bootstrapArtifactId}`)).data;
  } catch (error) {
    if (isNotFound(error)) throw new BootstrapArtifactUnavailableError(`artifact ${payload.bootstrapArtifactId} not found`);
    throw error;
  }
  if (artifact.expired) throw new BootstrapArtifactUnavailableError(`artifact ${payload.bootstrapArtifactId} expired`);
  if (artifact.digest && artifact.digest !== payload.bootstrapArtifactDigest) {
    throw new BootstrapArtifactUnavailableError(`artifact digest ${artifact.digest} != receipt ${payload.bootstrapArtifactDigest}`);
  }
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-bootstrap-'));
  try {
    const archive = await options.client.download(artifact.archive_download_url);
    const archiveDigest = `sha256:${sha256Hex(archive)}`;
    if (archiveDigest !== payload.bootstrapArtifactDigest) {
      throw new BootstrapArtifactUnavailableError(`downloaded archive digest ${archiveDigest} != receipt ${payload.bootstrapArtifactDigest}`);
    }
    const zipPath = path.join(work, 'artifact.zip');
    await fs.writeFile(zipPath, archive);
    const extracted = path.join(work, 'extracted');
    await fs.mkdir(extracted);
    await (options.extract ?? unzipExtractor)(zipPath, extracted);
    const text = await fs.readFile(path.join(extracted, LEGACY_INVENTORY_FILE), 'utf8');
    if (sha256Hex(text) !== payload.manifestSha256) throw new BootstrapArtifactUnavailableError('inventory digest does not match the receipt');
    const inventory = parseLegacyInventory(text);
    if (inventory.revision !== payload.deployCommit) throw new BootstrapArtifactUnavailableError(`inventory revision ${inventory.revision} != receipt ${payload.deployCommit}`);
    const result = await verifyTreeAgainstFiles(options.treeDir, inventory.files, { allowExtra: true });
    if (!isTreeVerified(result)) {
      throw new BaselineTreeMismatchError(receipt.id, `missing ${summarize(result.missing)}; changed ${summarize(result.mismatched)}`);
    }
    return {
      receiptId: receipt.id,
      kind: payload.kind,
      deployCommit: payload.deployCommit,
      sourceCommit: payload.sourceCommit,
      candidateId: payload.candidateId,
      generatedAt: null,
      parentReceiptId: null,
      files: inventory.files.map(file => ({ path: file.path, sha256: file.sha256 })),
    };
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

export async function writeBaselineEvidence(file: string, baseline: ResolvedBaseline): Promise<void> {
  await writeFileAtomic(file, `${JSON.stringify(baseline, null, 2)}\n`);
}

export async function readBaselineEvidence(file: string): Promise<ResolvedBaseline> {
  const value = JSON.parse(await fs.readFile(file, 'utf8')) as ResolvedBaseline;
  if (typeof value.receiptId !== 'number' || typeof value.deployCommit !== 'string' || !Array.isArray(value.files)) {
    throw new TypeError(`Invalid baseline evidence file: ${file}`);
  }
  return { ...value, parentReceiptId: value.parentReceiptId ?? null };
}
