/**
 * 通用工具函数集合
 * 这个文件将被拆分成更小的 tools- 模块
 */

import { readFile, writeFile, access, mkdir } from 'fs/promises';
import { constants } from 'fs';
import { dirname, resolve } from 'path';
import { createHash } from 'crypto';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

/**
 * 确保目录存在
 */
export async function ensureDir(dir: string): Promise<void> {
  try {
    await access(dir, constants.F_OK);
  } catch {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * 安全写入文件（创建目录如果不存在）
 */
export async function safeWriteFile(filePath: string, content: string): Promise<void> {
  await ensureDir(dirname(filePath));
  await writeFile(filePath, content, 'utf-8');
}

/**
 * 批量读取文件
 */
export async function readFiles(filePaths: string[]): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  await Promise.all(
    filePaths.map(async filePath => {
      try {
        const content = await readFile(filePath, 'utf-8');
        results.set(filePath, content);
      } catch (error) {
        console.error(`Failed to read ${filePath}:`, error);
      }
    })
  );

  return results;
}

/**
 * 计算字符串哈希
 */
export function calculateHash(
  content: string,
  algorithm: 'md5' | 'sha1' | 'sha256' = 'sha256'
): string {
  return createHash(algorithm).update(content).digest('hex');
}

/**
 * 去重数组
 */
export function dedupe<T>(array: T[]): T[] {
  return [...new Set(array)];
}

/**
 * 域名标准化
 */
export function normalizeDomain(domain: string): string {
  return domain
    .toLowerCase()
    .trim()
    .replace(/^www\./, '');
}

/**
 * 提取域名的所有父域
 */
export function getParentDomains(domain: string): string[] {
  const parts = domain.split('.');
  const parents: string[] = [];

  for (let i = 1; i < parts.length - 1; i++) {
    parents.push(parts.slice(i).join('.'));
  }

  return parents;
}

/**
 * 批量处理任务，支持并发控制
 */
export async function batchProcess<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  concurrency: number = 10
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
  }

  return results;
}

/**
 * 流式处理大文件
 */
export async function processFileByLine(
  filePath: string,
  processor: (line: string, lineNumber: number) => void | Promise<void>
): Promise<void> {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    await processor(lines[i], i + 1);
  }
}

/**
 * 深度合并对象
 */
export function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const output = { ...target };

  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      output[key] = deepMerge(output[key] || ({} as any), source[key] as any);
    } else {
      output[key] = source[key] as any;
    }
  }

  return output;
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * 创建进度报告器
 */
export function createProgressReporter(total: number, label: string = 'Progress') {
  let processed = 0;
  const startTime = Date.now();

  return {
    update(count: number = 1) {
      processed += count;
      const progress = (processed / total) * 100;
      const elapsed = Date.now() - startTime;
      const rate = processed / (elapsed / 1000);

      console.log(
        `[${label}] ${processed}/${total} (${progress.toFixed(1)}%) - ${rate.toFixed(1)} items/s`
      );
    },

    finish() {
      const elapsed = (Date.now() - startTime) / 1000;
      console.log(`[${label}] Completed ${total} items in ${elapsed.toFixed(1)}s`);
    },
  };
}
