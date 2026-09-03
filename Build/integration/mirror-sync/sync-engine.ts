import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import picocolors from 'picocolors';
import { fetchLatestRelease, downloadAsset } from './github-api';
import type { GitHubAsset } from './github-api';
import { getErrorMessage } from '../../lib/misc';
import { writeFileAtomic } from '../../lib/atomic-file';

export enum FileType {
  PLUGIN = 'plugin',
  SGMODULE = 'sgmodule',
  SNIPPET = 'snippet',
  STOVERRIDE = 'stoverride',
  UNKNOWN = 'unknown'
}

export interface MirrorRepository {
  repo: string,
  outputDir: string,
  allowedTypes: FileType[],
  assetNamePattern?: RegExp,
  postProcess?: (filePath: string, content: string) => string | Promise<string>
}

export interface MirrorGroup {
  name: string,
  repositories: MirrorRepository[]
}

interface FileChecksum {
  filePath: string,
  checksum: string,
  size: number
}

type ArtifactPublicationStatus = 'new' | 'updated' | 'unchanged';

interface ArtifactPublication {
  outputPath: string,
  buffer: Buffer,
  minSize?: number,
  maxSize?: number,
  postProcess?: MirrorRepository['postProcess']
}

export interface SyncResult {
  total: number,
  succeeded: number,
  failed: PipelineFailure[],
  skipped: number,
  hasChanges: boolean,
  updatedFiles: string[],
  newFiles: string[],
  failedFiles: Array<{
    file: string,
    error: string
  }>
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
    hasChanges: false,
    updatedFiles: [],
    newFiles: [],
    failedFiles: []
  };
}

export function hasRequiredFailures(result: PipelineResult): boolean {
  return result.failed.some(failure => failure.required);
}

function calculateBufferChecksum(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

async function calculateFileChecksum(filePath: string): Promise<FileChecksum | null> {
  try {
    const buffer = await fs.readFile(filePath);
    const checksum = calculateBufferChecksum(buffer);

    return {
      filePath,
      checksum,
      size: buffer.length
    };
  } catch {
    return null;
  }
}

export async function shouldUpdateFile(filePath: string, newBuffer: Buffer): Promise<boolean> {
  const existingChecksum = await calculateFileChecksum(filePath);

  if (!existingChecksum) {
    return true;
  }

  const newChecksum = calculateBufferChecksum(newBuffer);

  return existingChecksum.checksum !== newChecksum;
}

function isValidFileSize(size: number, minSize = 10, maxSize = 100 * 1024 * 1024): boolean {
  return size >= minSize && size <= maxSize;
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
  fileType: FileType,
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
    fileType,
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
  total: number,
  byType: Record<string, number>,
  processable: number,
  skipped: number
}

function getFileTypeStats(classifiedAssets: ClassifiedAsset[]): FileTypeStats {
  const stats: FileTypeStats = {
    total: classifiedAssets.length,
    byType: {},
    processable: 0,
    skipped: 0
  };

  for (const classified of classifiedAssets) {
    const typeName = classified.fileType;
    stats.byType[typeName] = (stats.byType[typeName] || 0) + 1;

    if (classified.shouldProcess) {
      stats.processable++;
    } else {
      stats.skipped++;
    }
  }

  return stats;
}

async function publishArtifactAtomic(
  publication: ArtifactPublication
): Promise<ArtifactPublicationStatus> {
  let content = publication.buffer;
  if (!isValidFileSize(
    content.length,
    publication.minSize,
    publication.maxSize
  )) {
    throw new Error(`Invalid file size: ${content.length} bytes`);
  }

  if (publication.postProcess) {
    content = Buffer.from(await publication.postProcess(
      publication.outputPath,
      content.toString('utf8')
    ));
  }

  if (!isValidFileSize(
    content.length,
    publication.minSize,
    publication.maxSize
  )) {
    throw new Error(`Invalid processed file size: ${content.length} bytes`);
  }

  const existed = await fs.access(publication.outputPath).then(() => true).catch(() => false);
  if (!(await shouldUpdateFile(publication.outputPath, content))) {
    return 'unchanged';
  }

  await writeFileAtomic(publication.outputPath, content);

  return existed ? 'updated' : 'new';
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

  const releaseResult = await (dependencies.fetchRelease ?? fetchLatestRelease)(repository.repo);

  if ('error' in releaseResult) {
    const error = releaseResult.error;
    console.log(picocolors.red(`[Sync] ✗ Failed to fetch release: ${error.message}`));

    result.failedFiles.push({
      file: repository.repo,
      error: error.message
    });
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
  if (repository.assetNamePattern && processable.length === 0) {
    const error = `No release assets matched ${repository.assetNamePattern}`;
    console.log(picocolors.red(`[Sync] ✗ ${error}`));
    result.total = 1;
    result.failedFiles.push({ file: repository.repo, error });
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
      const downloadResult = await (dependencies.download ?? downloadAsset)(asset.url);

      if ('error' in downloadResult) {
        console.log(picocolors.red(`[Sync] ✗ Download failed: ${downloadResult.error.message}`));
        result.failedFiles.push({
          file: asset.name,
          error: downloadResult.error.message
        });
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

      result.hasChanges = true;
      result.succeeded++;
    } catch (error) {
      console.log(picocolors.red(
        `[Sync] ✗ Error processing ${asset.name}: ${getErrorMessage(error)}`
      ));
      result.failedFiles.push({
        file: asset.name,
        error: getErrorMessage(error)
      });
      result.failed.push({ asset: asset.name, error: getErrorMessage(error), required: true });
    }
  }

  return result;
}

export function mergeSyncResults(results: SyncResult[]): SyncResult {
  const merged = createSyncResult();

  for (const result of results) {
    if (result.hasChanges) {
      merged.hasChanges = true;
    }
    merged.updatedFiles.push(...result.updatedFiles);
    merged.newFiles.push(...result.newFiles);
    merged.failedFiles.push(...result.failedFiles);
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
  console.log(picocolors.red(`  ✗ Failed files: ${result.failedFiles.length}`));

  if (result.failedFiles.length > 0) {
    console.log(picocolors.red('\n[Sync] Failed files:'));
    for (const failed of result.failedFiles) {
      console.log(picocolors.red(`  - ${failed.file}: ${failed.error}`));
    }
  }
}
