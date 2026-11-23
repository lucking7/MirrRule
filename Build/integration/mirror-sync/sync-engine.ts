import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import path from 'node:path';
import picocolors from 'picocolors';
import { parse } from 'yaml';
import { hasActiveSectionEntry, hasActiveSurgeEntry, isNonHtmlText } from '../../lib/downloaded-text';
import { fetchLatestRelease, downloadAsset, downloadRawFile } from './github-api';
import type { GitHubAsset, GitHubRelease } from './github-api';
import { getErrorMessage } from '../../lib/misc';
import { writeFileAtomic } from '../../lib/atomic-file';

export enum FileType {
  PLUGIN = 'plugin',
  SGMODULE = 'sgmodule',
  SNIPPET = 'snippet',
  STOVERRIDE = 'stoverride',
  UNKNOWN = 'unknown'
}

/**
 * 无 Release 的上游：按固定分支读取指定文件。
 * 每个路径都是必需来源，缺失即同步失败，不回退为空。
 */
interface MirrorBranchFiles {
  ref: string,
  paths: string[]
}

export interface MirrorRepository {
  repo: string,
  outputDir: string,
  allowedTypes: FileType[],
  assetNamePattern?: RegExp,
  branchFiles?: MirrorBranchFiles,
  postProcess?: (filePath: string, content: string) => string | Promise<string>
}

export interface MirrorGroup {
  name: string,
  repositories: MirrorRepository[]
}

type ArtifactPublicationStatus = 'new' | 'updated' | 'unchanged';

interface ArtifactPublication {
  outputPath: string,
  buffer: Buffer,
  postProcess?: MirrorRepository['postProcess']
}

export interface SyncResult {
  total: number,
  succeeded: number,
  failed: PipelineFailure[],
  skipped: number,
  updatedFiles: string[],
  newFiles: string[]
}

interface PipelineFailure {
  asset: string,
  error: string,
  required: boolean
}

export interface PipelineResult {
  total: number,
  succeeded: number,
  failed: PipelineFailure[],
  skipped: number
}

export function createPipelineResult(): PipelineResult {
  return { total: 0, succeeded: 0, failed: [], skipped: 0 };
}

function createSyncResult(): SyncResult {
  return {
    ...createPipelineResult(),
    updatedFiles: [],
    newFiles: []
  };
}

export function hasRequiredFailures(result: PipelineResult): boolean {
  return result.failed.some(failure => failure.required);
}

export async function shouldUpdateFile(filePath: string, newBuffer: Buffer): Promise<boolean> {
  try {
    const existingBuffer = await fs.readFile(filePath);
    return !existingBuffer.equals(newBuffer);
  } catch {
    return true;
  }
}

function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

function extensionToFileType(extension: string): FileType {
  const ext = extension.toLowerCase();

  switch (ext) {
    case 'plugin':
      return FileType.PLUGIN;
    case 'sgmodule':
      return FileType.SGMODULE;
    case 'snippet':
      return FileType.SNIPPET;
    case 'stoverride':
      return FileType.STOVERRIDE;
    default:
      return FileType.UNKNOWN;
  }
}

function getOutputDirectory(baseDir: string, fileType: FileType): string | null {
  switch (fileType) {
    case FileType.PLUGIN:
      return path.join(baseDir, 'plugin');
    case FileType.SGMODULE:
      return path.join(baseDir, 'sgmodule');
    case FileType.SNIPPET:
      return path.join(baseDir, 'snippet');
    case FileType.STOVERRIDE:
      return path.join(baseDir, 'stoverride');
    default:
      return null;
  }
}

interface ClassifiedAsset {
  asset: GitHubAsset,
  outputPath: string | null,
  shouldProcess: boolean
}

function classifyAsset(
  asset: GitHubAsset,
  baseDir: string,
  allowedTypes: FileType[] = [FileType.PLUGIN, FileType.SGMODULE, FileType.SNIPPET, FileType.STOVERRIDE],
  assetNamePattern?: RegExp
): ClassifiedAsset {
  const extension = getFileExtension(asset.name);
  const fileType = extensionToFileType(extension);

  if (assetNamePattern) assetNamePattern.lastIndex = 0;
  const shouldProcess =
    allowedTypes.includes(fileType) &&
    (assetNamePattern ? assetNamePattern.test(asset.name) : true);

  let outputPath: string | null = null;
  if (shouldProcess) {
    const outputDir = getOutputDirectory(baseDir, fileType);
    if (outputDir) {
      outputPath = path.join(outputDir, asset.name);
    }
  }

  return {
    asset,
    outputPath,
    shouldProcess
  };
}

function classifyAssets(
  assets: GitHubAsset[],
  baseDir: string,
  allowedTypes?: FileType[],
  assetNamePattern?: RegExp
): ClassifiedAsset[] {
  return assets.map(asset => classifyAsset(asset, baseDir, allowedTypes, assetNamePattern));
}

function filterProcessableAssets(
  classifiedAssets: ClassifiedAsset[]
): ClassifiedAsset[] {
  return classifiedAssets.filter(c => c.shouldProcess && c.outputPath !== null);
}

interface FileTypeStats {
  processable: number,
  skipped: number
}

function getFileTypeStats(classifiedAssets: ClassifiedAsset[]): FileTypeStats {
  const stats: FileTypeStats = {
    processable: 0,
    skipped: 0
  };

  for (const classified of classifiedAssets) {
    if (classified.shouldProcess) {
      stats.processable++;
    } else {
      stats.skipped++;
    }
  }

  return stats;
}

const LOON_SECTIONS = new Set(['general', 'host', 'rule', 'rewrite', 'script', 'mitm', 'map local']);

function validateArtifactContent(outputPath: string, buffer: Buffer): void {
  if (buffer.length < 10 || buffer.length > 100 * 1024 * 1024) {
    throw new Error(`Invalid release asset size: ${buffer.length} bytes`);
  }
  if (!isNonHtmlText(buffer)) throw new Error('Release asset is not valid non-HTML text');
  const content = buffer.toString('utf8');
  const type = extensionToFileType(getFileExtension(outputPath));
  if (type === FileType.SGMODULE) {
    if (!hasActiveSurgeEntry(content)) throw new Error('Surge module has no active supported functional entries');
  } else if (type === FileType.PLUGIN) {
    if (!hasActiveSectionEntry(content, LOON_SECTIONS)) throw new Error('Loon plugin has no active supported entries');
  } else if (type === FileType.SNIPPET) {
    // QX release snippets use commented section markers and standalone actions.
    if (!content.split(/\r?\n/).some(line => /^(?:[a-z][\w-]*\s*,|[\w-]+\s*=|\S+\s+url\s+)/i.test(line.trim()))) {
      throw new Error('Quantumult X snippet has no supported entries');
    }
  } else if (type === FileType.STOVERRIDE) {
    const value: unknown = parse(content);
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length === 0) {
      throw new Error('Stash override must be a nonempty YAML mapping');
    }
  }
}

async function publishArtifactAtomic(
  publication: ArtifactPublication
): Promise<ArtifactPublicationStatus> {
  let content = publication.buffer;
  validateArtifactContent(publication.outputPath, content);

  if (publication.postProcess) {
    content = Buffer.from(await publication.postProcess(
      publication.outputPath,
      content.toString('utf8')
    ));
    validateArtifactContent(publication.outputPath, content);
  }

  const existed = await fs.access(publication.outputPath).then(() => true).catch(() => false);
  if (!(await shouldUpdateFile(publication.outputPath, content))) {
    return 'unchanged';
  }

  await writeFileAtomic(publication.outputPath, content);

  return existed ? 'updated' : 'new';
}

const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com';

/** Raw URL of a branch file; also used by the source inventory. */
export function getBranchFileUrl(repo: string, ref: string, filePath: string): string {
  return `${GITHUB_RAW_BASE}/${repo}/${ref}/${filePath}`;
}

function createBranchRelease(repo: string, branchFiles: MirrorBranchFiles): GitHubRelease {
  return {
    tag_name: branchFiles.ref,
    name: branchFiles.ref,
    html_url: `https://github.com/${repo}/tree/${branchFiles.ref}`,
    assets: branchFiles.paths.map(filePath => {
      const url = getBranchFileUrl(repo, branchFiles.ref, filePath);
      return { name: path.posix.basename(filePath), url, size: 0, browser_download_url: url };
    })
  };
}

export async function syncRepository(
  repository: MirrorRepository,
  dependencies: {
    fetchRelease?: typeof fetchLatestRelease,
    download?: typeof downloadAsset
  } = {}
): Promise<SyncResult> {
  const result = createSyncResult();

  console.log(picocolors.cyan(`\n[Sync] Processing repository: ${repository.repo}`));

  const releaseResult = repository.branchFiles
    ? createBranchRelease(repository.repo, repository.branchFiles)
    : await (dependencies.fetchRelease ?? fetchLatestRelease)(repository.repo);

  if ('error' in releaseResult) {
    const error = releaseResult.error;
    console.log(picocolors.red(`[Sync] ✗ Failed to fetch release: ${error.message}`));

    result.total = 1;
    result.failed.push({ asset: repository.repo, error: error.message, required: true });

    return result;
  }

  const release = releaseResult;
  console.log(picocolors.gray(`[Sync] Release: ${release.tag_name} (${release.assets.length} assets)`));

  const classified = classifyAssets(
    release.assets,
    repository.outputDir,
    repository.allowedTypes,
    repository.assetNamePattern
  );

  const stats = getFileTypeStats(classified);
  console.log(picocolors.gray(
    `[Sync] Files: ${stats.processable} processable, ${stats.skipped} skipped`
  ));

  const processable = filterProcessableAssets(classified);
  if (repository.branchFiles) {
    if (repository.branchFiles.paths.length === 0) {
      const error = 'Branch files configuration has no paths';
      console.log(picocolors.red(`[Sync] ✗ ${error}`));
      result.total = 1;
      result.failed.push({ asset: repository.repo, error, required: true });
      return result;
    }

    if (processable.length !== classified.length) {
      const rejected: string[] = [];
      for (const item of classified) {
        if (!processable.includes(item)) rejected.push(item.asset.name);
      }
      const error = `Branch files outside allowed types: ${rejected.join(', ')}`;
      console.log(picocolors.red(`[Sync] ✗ ${error}`));
      result.total = 1;
      result.failed.push({ asset: repository.repo, error, required: true });
      return result;
    }

    const seenOutputPaths = new Set<string>();
    const collidingOutputPaths = new Set<string>();
    for (const item of processable) {
      if (!item.outputPath) continue;
      if (seenOutputPaths.has(item.outputPath)) {
        collidingOutputPaths.add(item.outputPath);
      } else {
        seenOutputPaths.add(item.outputPath);
      }
    }

    if (collidingOutputPaths.size > 0) {
      const error = `Branch file output path collision: ${[...collidingOutputPaths].join(', ')}`;
      console.log(picocolors.red(`[Sync] ✗ ${error}`));
      result.total = 1;
      result.failed.push({ asset: repository.repo, error, required: true });
      return result;
    }
  }
  if (repository.assetNamePattern && processable.length === 0) {
    const error = `No release assets matched ${repository.assetNamePattern}`;
    console.log(picocolors.red(`[Sync] ✗ ${error}`));
    result.total = 1;
    result.failed.push({ asset: repository.repo, error, required: true });
    return result;
  }
  result.total = classified.length;
  result.skipped = stats.skipped;

  for (const item of processable) {
    const { asset, outputPath } = item;

    if (!outputPath) continue;

    console.log(picocolors.gray(`[Sync] Processing: ${asset.name} (${asset.size} bytes)`));

    try {
      const downloadResult = await (dependencies.download ?? (repository.branchFiles ? downloadRawFile : downloadAsset))(asset.url);

      if ('error' in downloadResult) {
        console.log(picocolors.red(`[Sync] ✗ Download failed: ${downloadResult.error.message}`));
        result.failed.push({ asset: asset.name, error: downloadResult.error.message, required: true });
        continue;
      }

      const status = await publishArtifactAtomic({
        outputPath,
        buffer: downloadResult,
        postProcess: repository.postProcess,
      });

      if (status === 'unchanged') {
        console.log(picocolors.gray(`[Sync] ○ No changes: ${asset.name}`));
        result.succeeded++;
        continue;
      }

      if (status === 'new') {
        result.newFiles.push(asset.name);
        console.log(picocolors.green(`[Sync] ✓ Added: ${asset.name}`));
      } else {
        result.updatedFiles.push(asset.name);
        console.log(picocolors.green(`[Sync] ✓ Updated: ${asset.name}`));
      }

      result.succeeded++;
    } catch (error) {
      console.log(picocolors.red(
        `[Sync] ✗ Error processing ${asset.name}: ${getErrorMessage(error)}`
      ));
      result.failed.push({ asset: asset.name, error: getErrorMessage(error), required: true });
    }
  }

  return result;
}

export function mergeSyncResults(results: SyncResult[]): SyncResult {
  const merged = createSyncResult();

  for (const result of results) {
    merged.updatedFiles.push(...result.updatedFiles);
    merged.newFiles.push(...result.newFiles);
    merged.total += result.total;
    merged.succeeded += result.succeeded;
    merged.failed.push(...result.failed);
    merged.skipped += result.skipped;
  }

  return merged;
}

export function printSyncSummary(result: SyncResult): void {
  console.log(picocolors.cyan('\n[Sync] Summary:'));
  console.log(picocolors.cyan(`  Total: ${result.total}`));
  console.log(picocolors.green(`  ✓ Succeeded: ${result.succeeded}`));
  console.log(picocolors.gray(`  ○ Skipped: ${result.skipped}`));
  console.log(picocolors.green(`  ✓ New files: ${result.newFiles.length}`));
  console.log(picocolors.blue(`  ↻ Updated files: ${result.updatedFiles.length}`));
  console.log(picocolors.red(`  ✗ Failed files: ${result.failed.length}`));

  if (result.failed.length > 0) {
    console.log(picocolors.red('\n[Sync] Failed files:'));
    for (const failed of result.failed) {
      console.log(picocolors.red(`  - ${failed.asset}: ${failed.error}`));
    }
  }
}
