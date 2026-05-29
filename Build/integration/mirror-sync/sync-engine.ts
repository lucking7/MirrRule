import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import picocolors from 'picocolors';
import { fetchLatestRelease, downloadAsset } from './github-api';
import type { GitHubAsset } from './github-api';
import { getErrorMessage } from '../../lib/misc';

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
  postProcess?: (filePath: string, content: string) => string | Promise<string>
}

export interface MirrorGroup {
  name: string,
  repositories: MirrorRepository[],
  extraDownloads?: Array<{
    url: string,
    outputPath: string
  }>
}

export interface FileChecksum {
  filePath: string,
  checksum: string,
  size: number
}

export interface SyncResult {
  hasChanges: boolean,
  updatedFiles: string[],
  newFiles: string[],
  failedFiles: Array<{
    file: string,
    error: string
  }>
}

export function calculateBufferChecksum(buffer: Buffer): string {
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

export function isValidFileSize(size: number, minSize = 10, maxSize = 100 * 1024 * 1024): boolean {
  return size >= minSize && size <= maxSize;
}

export function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

export function extensionToFileType(extension: string): FileType {
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

export function getOutputDirectory(baseDir: string, fileType: FileType): string | null {
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

export interface ClassifiedAsset {
  asset: GitHubAsset,
  fileType: FileType,
  outputPath: string | null,
  shouldProcess: boolean
}

export function classifyAsset(
  asset: GitHubAsset,
  baseDir: string,
  allowedTypes: FileType[] = [FileType.PLUGIN, FileType.SGMODULE, FileType.SNIPPET, FileType.STOVERRIDE]
): ClassifiedAsset {
  const extension = getFileExtension(asset.name);
  const fileType = extensionToFileType(extension);

  const shouldProcess = allowedTypes.includes(fileType);

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

export function classifyAssets(
  assets: GitHubAsset[],
  baseDir: string,
  allowedTypes?: FileType[]
): ClassifiedAsset[] {
  return assets.map(asset => classifyAsset(asset, baseDir, allowedTypes));
}

export function filterProcessableAssets(
  classifiedAssets: ClassifiedAsset[]
): ClassifiedAsset[] {
  return classifiedAssets.filter(c => c.shouldProcess && c.outputPath !== null);
}

export interface FileTypeStats {
  total: number,
  byType: Record<string, number>,
  processable: number,
  skipped: number
}

export function getFileTypeStats(classifiedAssets: ClassifiedAsset[]): FileTypeStats {
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

async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch {
    // ignore
  }
}

export async function syncRepository(
  repository: MirrorRepository
): Promise<SyncResult> {
  const result: SyncResult = {
    hasChanges: false,
    updatedFiles: [],
    newFiles: [],
    failedFiles: []
  };

  console.log(picocolors.cyan(`\n[Sync] Processing repository: ${repository.repo}`));

  const releaseResult = await fetchLatestRelease(repository.repo);

  if ('error' in releaseResult) {
    const error = releaseResult.error;
    console.log(picocolors.red(`[Sync] ✗ Failed to fetch release: ${error.message}`));

    result.failedFiles.push({
      file: repository.repo,
      error: error.message
    });

    return result;
  }

  const release = releaseResult;
  console.log(picocolors.gray(`[Sync] Release: ${release.tag_name} (${release.assets.length} assets)`));

  const classified = classifyAssets(
    release.assets,
    repository.outputDir,
    repository.allowedTypes
  );

  const stats = getFileTypeStats(classified);
  console.log(picocolors.gray(
    `[Sync] Files: ${stats.processable} processable, ${stats.skipped} skipped`
  ));

  const processable = filterProcessableAssets(classified);

  for (const item of processable) {
    const { asset, outputPath } = item;

    if (!outputPath) continue;

    console.log(picocolors.gray(`[Sync] Processing: ${asset.name} (${asset.size} bytes)`));

    try {
      const downloadResult = await downloadAsset(asset.url);

      if ('error' in downloadResult) {
        console.log(picocolors.red(`[Sync] ✗ Download failed: ${downloadResult.error.message}`));
        result.failedFiles.push({
          file: asset.name,
          error: downloadResult.error.message
        });
        continue;
      }

      const buffer = downloadResult;

      if (!isValidFileSize(buffer.length)) {
        console.log(picocolors.yellow(`[Sync] Invalid file size: ${buffer.length} bytes`));
        result.failedFiles.push({
          file: asset.name,
          error: `Invalid file size: ${buffer.length} bytes`
        });
        continue;
      }

      const fileExisted = await fs.access(outputPath).then(() => true).catch(() => false);
      const needsUpdate = await shouldUpdateFile(outputPath, buffer);

      if (!needsUpdate) {
        console.log(picocolors.gray(`[Sync] ○ No changes: ${asset.name}`));
        continue;
      }

      await ensureDirectory(path.dirname(outputPath));

      let content = buffer.toString('utf-8');
      if (repository.postProcess) {
        try {
          content = await repository.postProcess(outputPath, content);
        } catch (error) {
          console.log(picocolors.yellow(
            `[Sync] Post-process failed: ${getErrorMessage(error)}`
          ));
        }
      }

      await fs.writeFile(outputPath, content, 'utf-8');

      const isNew = !fileExisted;
      if (isNew) {
        result.newFiles.push(asset.name);
        console.log(picocolors.green(`[Sync] ✓ Added: ${asset.name}`));
      } else {
        result.updatedFiles.push(asset.name);
        console.log(picocolors.green(`[Sync] ✓ Updated: ${asset.name}`));
      }

      result.hasChanges = true;
    } catch (error) {
      console.log(picocolors.red(
        `[Sync] ✗ Error processing ${asset.name}: ${getErrorMessage(error)}`
      ));
      result.failedFiles.push({
        file: asset.name,
        error: getErrorMessage(error)
      });
    }
  }

  return result;
}

export async function downloadExtraFile(
  url: string,
  outputPath: string
): Promise<boolean> {
  console.log(picocolors.cyan(`[Extra] Downloading: ${url}`));

  try {
    const response = await fetch(url);

    if (!response.ok) {
      console.log(picocolors.red(`[Extra] ✗ HTTP ${response.status}: ${response.statusText}`));
      return false;
    }

    const content = await response.text();

    await ensureDirectory(path.dirname(outputPath));
    await fs.writeFile(outputPath, content, 'utf-8');

    console.log(picocolors.green(`[Extra] ✓ Downloaded: ${path.basename(outputPath)}`));
    return true;
  } catch (error) {
    console.log(picocolors.red(
      `[Extra] ✗ Error: ${getErrorMessage(error)}`
    ));
    return false;
  }
}

export function mergeSyncResults(results: SyncResult[]): SyncResult {
  const merged: SyncResult = {
    hasChanges: false,
    updatedFiles: [],
    newFiles: [],
    failedFiles: []
  };

  for (const result of results) {
    if (result.hasChanges) {
      merged.hasChanges = true;
    }
    merged.updatedFiles.push(...result.updatedFiles);
    merged.newFiles.push(...result.newFiles);
    merged.failedFiles.push(...result.failedFiles);
  }

  return merged;
}

export function printSyncSummary(result: SyncResult): void {
  console.log(picocolors.cyan('\n[Sync] Summary:'));
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
