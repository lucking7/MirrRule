/**
 * 通用构建功能
 * 提供自动扫描、批量处理、元数据提取等功能
 */

import { readdir, readFile, stat } from 'fs/promises';
import { join, extname, basename, dirname } from 'path';
import { glob } from 'glob';
import { safeWriteFile, createProgressReporter } from './utils.js';

export interface FileMetadata {
  /**
   * 文件路径
   */
  path: string;

  /**
   * 文件名（不含扩展名）
   */
  name: string;

  /**
   * 文件扩展名
   */
  extension: string;

  /**
   * 文件大小（字节）
   */
  size: number;

  /**
   * 文件标题（从内容中提取）
   */
  title?: string;

  /**
   * 文件描述（从内容中提取）
   */
  description?: string;

  /**
   * 最后修改时间
   */
  lastModified: Date;
}

export interface BuildOptions {
  /**
   * 源文件目录
   */
  sourceDir: string;

  /**
   * 输出目录
   */
  outputDir: string;

  /**
   * 要处理的文件扩展名
   */
  extensions?: string[];

  /**
   * 文件过滤器
   */
  filter?: (file: FileMetadata) => boolean | Promise<boolean>;

  /**
   * 并发数
   */
  concurrency?: number;

  /**
   * 是否显示进度
   */
  showProgress?: boolean;
}

/**
 * 从文件内容中提取元数据
 */
export function extractMetadataFromContent(content: string): {
  title?: string;
  description?: string;
} {
  const metadata: { title?: string; description?: string } = {};
  const lines = content.split('\n');

  // 查找标题（第一个 # 开头的行或第一个非空非注释行）
  for (const line of lines) {
    const trimmed = line.trim();

    // Markdown 标题
    if (trimmed.startsWith('# ')) {
      metadata.title = trimmed.substring(2).trim();
      break;
    }

    // 注释中的标题
    const titleMatch = trimmed.match(/^(?:#|\/\/|\/\*)\s*(?:Title|标题|Name|名称)[:：]\s*(.+)$/i);
    if (titleMatch) {
      metadata.title = titleMatch[1].trim();
      break;
    }

    // 第一个非空非注释行作为标题
    if (
      trimmed &&
      !trimmed.startsWith('#') &&
      !trimmed.startsWith('//') &&
      !trimmed.startsWith('!')
    ) {
      metadata.title = trimmed.substring(0, 50); // 限制长度
      break;
    }
  }

  // 查找描述
  for (const line of lines) {
    const trimmed = line.trim();

    // 注释中的描述
    const descMatch = trimmed.match(
      /^(?:#|\/\/|\/\*)\s*(?:Description|描述|Desc|说明)[:：]\s*(.+)$/i
    );
    if (descMatch) {
      metadata.description = descMatch[1].trim();
      break;
    }
  }

  return metadata;
}

/**
 * 扫描目录获取文件列表
 */
export async function scanDirectory(
  dir: string,
  extensions?: string[],
  recursive: boolean = true
): Promise<FileMetadata[]> {
  const files: FileMetadata[] = [];

  // 使用 glob 扫描文件
  const pattern = recursive ? '**/*' : '*';
  const globPattern =
    extensions && extensions.length > 0
      ? `${dir}/${pattern}.{${extensions.join(',')}}`
      : `${dir}/${pattern}`;

  const filePaths = await glob(globPattern, {
    nodir: true,
    absolute: true,
  });

  // 获取文件元数据
  for (const filePath of filePaths) {
    try {
      const stats = await stat(filePath);
      const content = await readFile(filePath, 'utf-8');
      const { title, description } = extractMetadataFromContent(content);

      files.push({
        path: filePath,
        name: basename(filePath, extname(filePath)),
        extension: extname(filePath).substring(1),
        size: stats.size,
        ...(title && { title }),
        ...(description && { description }),
        lastModified: stats.mtime,
      });
    } catch (error) {
      console.error(`Failed to process ${filePath}:`, error);
    }
  }

  return files;
}

/**
 * 批量处理文件
 */
export async function batchProcessFiles<T>(
  files: FileMetadata[],
  processor: (file: FileMetadata, content: string) => Promise<T>,
  options: {
    concurrency?: number;
    showProgress?: boolean;
  } = {}
): Promise<Map<string, T>> {
  const { concurrency = 10, showProgress = true } = options;
  const results = new Map<string, T>();

  const progress = showProgress ? createProgressReporter(files.length, 'Processing files') : null;

  // 分批处理
  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);

    await Promise.all(
      batch.map(async file => {
        try {
          const content = await readFile(file.path, 'utf-8');
          const result = await processor(file, content);
          results.set(file.path, result);
        } catch (error) {
          console.error(`Failed to process ${file.path}:`, error);
        } finally {
          progress?.update();
        }
      })
    );
  }

  progress?.finish();

  return results;
}

/**
 * 通用构建流程
 */
export async function runBuild<T>(
  options: BuildOptions,
  processor: (file: FileMetadata, content: string) => Promise<{ output: string; data?: T }>
): Promise<{
  processed: number;
  failed: number;
  results: Map<string, T>;
}> {
  const {
    sourceDir,
    outputDir,
    extensions,
    filter,
    concurrency = 10,
    showProgress = true,
  } = options;

  console.log(`Scanning ${sourceDir}...`);

  // 扫描文件
  let files = await scanDirectory(sourceDir, extensions);

  // 应用过滤器
  if (filter) {
    const filteredFiles: FileMetadata[] = [];
    for (const file of files) {
      if (await filter(file)) {
        filteredFiles.push(file);
      }
    }
    files = filteredFiles;
  }

  console.log(`Found ${files.length} files to process`);

  // 处理文件
  const results = new Map<string, T>();
  let processed = 0;
  let failed = 0;

  const progress = showProgress ? createProgressReporter(files.length, 'Building') : null;

  // 分批处理
  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);

    await Promise.all(
      batch.map(async file => {
        try {
          const content = await readFile(file.path, 'utf-8');
          const { output, data } = await processor(file, content);

          // 计算输出路径
          const relativePath = file.path.substring(sourceDir.length + 1);
          const outputPath = join(outputDir, relativePath);

          // 写入输出文件
          await safeWriteFile(outputPath, output);

          if (data) {
            results.set(file.path, data);
          }

          processed++;
        } catch (error) {
          console.error(`Failed to process ${file.path}:`, error);
          failed++;
        } finally {
          progress?.update();
        }
      })
    );
  }

  progress?.finish();

  console.log(`Build completed: ${processed} processed, ${failed} failed`);

  return {
    processed,
    failed,
    results,
  };
}

/**
 * 创建文件映射表
 */
export async function createFileMap(
  dir: string,
  extensions?: string[]
): Promise<Map<string, FileMetadata>> {
  const files = await scanDirectory(dir, extensions);
  const map = new Map<string, FileMetadata>();

  for (const file of files) {
    map.set(file.name, file);
    map.set(file.path, file);
  }

  return map;
}

/**
 * 监听文件变化（简化版）
 */
export async function watchFiles(
  dir: string,
  onChange: (file: FileMetadata) => Promise<void>,
  extensions?: string[]
): Promise<void> {
  console.log(`Watching ${dir} for changes...`);

  // 这里可以使用 chokidar 或其他文件监听库
  // 为了简化，这里只提供接口定义
  throw new Error('File watching not implemented. Use chokidar or similar library.');
}
