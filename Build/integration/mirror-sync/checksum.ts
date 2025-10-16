/**
 * 文件校验和计算模块
 * 使用 SHA256 进行文件去重和变更检测
 */

import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { FileChecksum } from './types';

/**
 * 计算 Buffer 的 SHA256 校验和
 *
 * @param buffer - 文件内容 Buffer
 * @returns SHA256 哈希值（十六进制字符串）
 */
export function calculateBufferChecksum(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * 计算文件的 SHA256 校验和
 *
 * @param filePath - 文件路径
 * @returns 文件校验和信息
 */
export async function calculateFileChecksum(filePath: string): Promise<FileChecksum | null> {
  try {
    const buffer = await fs.readFile(filePath);
    const checksum = calculateBufferChecksum(buffer);

    return {
      filePath,
      checksum,
      size: buffer.length
    };
  } catch {
    // 文件不存在或无法读取
    return null;
  }
}

/**
 * 比较两个校验和是否相同
 *
 * @param checksum1 - 第一个校验和
 * @param checksum2 - 第二个校验和
 * @returns 是否相同
 */
export function compareChecksums(checksum1: string, checksum2: string): boolean {
  return checksum1 === checksum2;
}

/**
 * 检查文件是否需要更新
 *
 * @param filePath - 文件路径
 * @param newBuffer - 新文件内容
 * @returns 是否需要更新
 */
export async function shouldUpdateFile(
  filePath: string,
  newBuffer: Buffer
): Promise<boolean> {
  const existingChecksum = await calculateFileChecksum(filePath);

  // 文件不存在，需要创建
  if (!existingChecksum) {
    return true;
  }

  // 计算新内容的校验和
  const newChecksum = calculateBufferChecksum(newBuffer);

  // 比较校验和
  return !compareChecksums(existingChecksum.checksum, newChecksum);
}

/**
 * 批量计算文件校验和
 *
 * @param filePaths - 文件路径数组
 * @returns 校验和信息数组
 */
export async function calculateMultipleChecksums(
  filePaths: string[]
): Promise<FileChecksum[]> {
  const results = await Promise.all(
    filePaths.map(path => calculateFileChecksum(path))
  );

  // 过滤掉 null 值（文件不存在的情况）
  return results.filter((r): r is FileChecksum => r !== null);
}

/**
 * 验证文件大小是否合理
 *
 * @param size - 文件大小（字节）
 * @param minSize - 最小大小（默认 10 字节）
 * @param maxSize - 最大大小（默认 100MB）
 * @returns 是否合理
 */
export function isValidFileSize(
  size: number,
  minSize = 10,
  maxSize = 100 * 1024 * 1024
): boolean {
  return size >= minSize && size <= maxSize;
}

/**
 * 校验和缓存（用于避免重复计算）
 */
export class ChecksumCache {
  private readonly cache = new Map<string, FileChecksum>();

  /**
   * 获取缓存的校验和
   */
  get(filePath: string): FileChecksum | undefined {
    return this.cache.get(filePath);
  }

  /**
   * 设置校验和缓存
   */
  set(checksum: FileChecksum): void {
    this.cache.set(checksum.filePath, checksum);
  }

  /**
   * 获取或计算校验和
   */
  async getOrCalculate(filePath: string): Promise<FileChecksum | null> {
    const cached = this.get(filePath);
    if (cached) {
      return cached;
    }

    const checksum = await calculateFileChecksum(filePath);
    if (checksum) {
      this.set(checksum);
    }

    return checksum;
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存大小
   */
  size(): number {
    return this.cache.size;
  }
}
