/**
 * 脚本镜像模块
 * 下载外部 JavaScript 文件并保存到本地
 */

import fs from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import path from 'node:path';
import picocolors from 'picocolors';
import { $$fetch, defaultRequestInit } from '../../utils/network/fetch-retry';
import { UA_SURGE_MAC } from '../../constants/user-agents';
import type { ScriptInfo, MirrorResult } from './types';
import { getErrorMessage } from '../../lib/misc';
import { buildClassifiedProxyUrlCandidates } from '../../utils/network/proxy';
import type { DownloadSource } from '../../utils/network/proxy';
import { updatePluginMetadata } from './provenance';
import { writeFileAtomic } from '../../lib/atomic-file';

// CommonJS 中的 __dirname 直接可用

/**
 * 脚本输出目录
 */
const SCRIPT_OUTPUT_DIR = path.join(__dirname, '../../../public/Scripts');

/**
 * 最小文件大小（字节）
 */
const MIN_FILE_SIZE = 10;
const MIRROR_BASE_URL = 'https://nrrule.pages.dev/Scripts';

interface FetchResponse {
  ok: boolean,
  status: number,
  statusText: string,
  arrayBuffer: () => Promise<ArrayBuffer>
}

type FetchFunction = (
  url: string,
  init?: Parameters<typeof $$fetch>[1]
) => Promise<FetchResponse>;

export interface MirrorOptions {
  outputDirectory?: string,
  fetchFn?: FetchFunction;
  metadataPath?: string
}

export interface ScriptMirrorResult extends MirrorResult {
  urlMap: Record<string, string>;
  degradedUrls: string[];
  provenance: Record<string, { source: DownloadSource; bytes: number; sha256: string }>
}

interface ScriptDownloadResult {
  status: 'mirrored' | 'unchanged' | 'failed-cached' | 'failed';
  provenance?: { source: DownloadSource; bytes: number; sha256: string }
}

/**
 * 确保输出目录存在
 */
async function ensureOutputDirectory(outputDirectory: string): Promise<void> {
  try {
    await fs.mkdir(outputDirectory, { recursive: true });
  } catch {
    // 忽略已存在的错误
  }
}

/**
 * 检查文件是否已存在
 *
 * @param filename - 文件名
 * @returns 是否存在
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 下载单个脚本
 *
 * @param script - 脚本信息
 * @returns 是否成功
 */
function canonicalizeUrl(url: string): string {
  const canonical = new URL(url);
  canonical.hash = '';
  return canonical.toString();
}

function getMirrorFilename(script: ScriptInfo): string {
  const canonicalUrl = canonicalizeUrl(script.originalUrl);
  const hash = createHash('sha256').update(canonicalUrl).digest('hex').slice(0, 12);
  const basename = script.filename
    .replaceAll(/[^\w.-]/g, '-')
    .replaceAll(/-+/g, '-') || 'script.js';
  return `${hash}-${basename}`;
}

async function readExisting(filePath: string): Promise<Buffer | undefined> {
  try {
    return await fs.readFile(filePath);
  } catch {
    return undefined;
  }
}

async function downloadScript(
  script: ScriptInfo,
  outputDirectory: string,
  fetchFn: FetchFunction
): Promise<ScriptDownloadResult> {
  const filename = getMirrorFilename(script);
  const filePath = path.join(outputDirectory, filename);
  const existing = await readExisting(filePath);

  console.log(picocolors.gray(`[Mirror] ${filename}`));
  console.log(picocolors.gray(`  From: ${script.originalUrl}`));

  for (const candidate of buildClassifiedProxyUrlCandidates(script.originalUrl, { preferDirect: true })) {
    try {
      const response = await fetchFn(candidate.url, {
        ...defaultRequestInit,
        headers: {
          'User-Agent': UA_SURGE_MAC,
          Accept: '*/*'
        }
      });

      if (!response.ok) {
        console.log(picocolors.red(`[Mirror] ✗ ${candidate.source} HTTP ${response.status}: ${response.statusText}`));
        continue;
      }

      const content = Buffer.from(await response.arrayBuffer());

      // 验证文件大小
      if (content.byteLength < MIN_FILE_SIZE) {
        console.log(picocolors.yellow(`[Mirror] File too small: ${content.length} bytes`));
        continue;
      }

      const digest = createHash('sha256').update(content).digest('hex');
      const provenance = { source: candidate.source, bytes: content.length, sha256: digest };
      console.log(picocolors.green(`[Mirror] ✓ asset=${filename} source=${candidate.source} bytes=${content.length} sha256=${digest}`));

      if (existing?.equals(content)) {
        console.log(picocolors.gray(`[Mirror] ○ Unchanged: ${filename}`));
        return { status: 'unchanged', provenance };
      }

      await writeFileAtomic(filePath, content);

      return { status: 'mirrored', provenance };
    } catch (error) {
      const errorMsg = candidate.source === 'proxy' ? 'Proxy request failed' : getErrorMessage(error);
      console.log(picocolors.red(`[Mirror] ✗ ${candidate.source}: ${errorMsg}`));
    }
  }
  return { status: existing ? 'failed-cached' : 'failed' };
}

/**
 * 批量镜像脚本
 *
 * @param scripts - 脚本信息数组
 * @param concurrency - 并发数
 * @returns 镜像结果
 */
export async function mirrorScripts(
  scripts: ScriptInfo[],
  concurrency = 5,
  options: MirrorOptions = {}
): Promise<ScriptMirrorResult> {
  const outputDirectory = options.outputDirectory ?? SCRIPT_OUTPUT_DIR;
  const fetchFn = options.fetchFn ?? $$fetch;
  await ensureOutputDirectory(outputDirectory);

  const result: ScriptMirrorResult = {
    total: scripts.length,
    mirrored: 0,
    skipped: 0,
    failed: 0,
    failedScripts: [],
    urlMap: {},
    degradedUrls: [],
    provenance: {}
  };

  console.log(picocolors.cyan(`\n[Mirror] Processing ${scripts.length} scripts...\n`));

  const toDownload: ScriptInfo[] = [];

  for (const script of scripts) {
    if (script.isMirrored) {
      result.skipped++;
      continue;
    }

    toDownload.push(script);
  }

  if (toDownload.length === 0) {
    console.log(picocolors.gray('[Mirror] No scripts to download\n'));
    return result;
  }

  console.log(picocolors.cyan(`[Mirror] Downloading ${toDownload.length} scripts...\n`));

  for (let i = 0; i < toDownload.length; i += concurrency) {
    const batch = toDownload.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(script => downloadScript(script, outputDirectory, fetchFn))
    );

    for (let j = 0; j < batch.length; j++) {
      const script = batch[j];
      const download = batchResults[j];
      const status = download.status;
      if (download.provenance) result.provenance[script.originalUrl] = download.provenance;
      if (status === 'mirrored') {
        result.mirrored++;
        result.urlMap[script.originalUrl] = `${MIRROR_BASE_URL}/${getMirrorFilename(script)}`;
      } else if (status === 'unchanged') {
        result.skipped++;
        result.urlMap[script.originalUrl] = `${MIRROR_BASE_URL}/${getMirrorFilename(script)}`;
      } else {
        result.failed++;
        result.failedScripts.push({
          url: script.originalUrl,
          error: 'Download failed'
        });
        if (status === 'failed-cached' && await fileExists(
          path.join(outputDirectory, getMirrorFilename(script))
        )) {
          result.urlMap[script.originalUrl] = `${MIRROR_BASE_URL}/${getMirrorFilename(script)}`;
          result.degradedUrls.push(script.originalUrl);
        }
      }
    }
  }

  const scriptDigests = Object.fromEntries(
    Object.entries(result.provenance).map(([url, provenance]) => [url, provenance.sha256])
  );
  if (Object.keys(scriptDigests).length > 0) {
    await updatePluginMetadata({ scripts: scriptDigests }, options.metadataPath);
  }

  return result;
}

/**
 * 打印镜像结果摘要
 */
export function printMirrorSummary(result: MirrorResult): void {
  console.log(picocolors.cyan('\n[Mirror] Summary:'));
  console.log(picocolors.gray(`  Total: ${result.total}`));
  console.log(picocolors.green(`  ✓ Mirrored: ${result.mirrored}`));
  console.log(picocolors.blue(`  ○ Skipped: ${result.skipped}`));
  console.log(picocolors.red(`  ✗ Failed: ${result.failed}`));

  if (result.failedScripts.length > 0) {
    console.log(picocolors.red('\n[Mirror] Failed scripts:'));
    for (const failed of result.failedScripts) {
      console.log(picocolors.red(`  - ${failed.url}`));
    }
  }
}

/**
 * 清理未使用的脚本文件
 *
 * @param usedFilenames - 正在使用的文件名集合
 * @returns 删除的文件数
 */
async function _cleanupUnusedScripts(usedFilenames: Set<string>): Promise<number> {
  try {
    const files = await fs.readdir(SCRIPT_OUTPUT_DIR);
    let deletedCount = 0;

    for (const file of files) {
      if (!file.endsWith('.js')) {
        continue;
      }

      if (!usedFilenames.has(file)) {
        const filePath = path.join(SCRIPT_OUTPUT_DIR, file);
        await fs.unlink(filePath);
        console.log(picocolors.yellow(`[Cleanup] Deleted unused: ${file}`));
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      console.log(picocolors.cyan(`\n[Cleanup] Deleted ${deletedCount} unused scripts\n`));
    }

    return deletedCount;
  } catch (error) {
    console.log(
      picocolors.red(`[Cleanup] Error: ${getErrorMessage(error)}`)
    );
    return 0;
  }
}
