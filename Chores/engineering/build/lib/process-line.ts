/**
 * 行处理器
 * 用于流式处理大文件，逐行解析和转换
 */

import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';

export type LineProcessor = (
  line: string,
  lineNumber: number
) => string | null | Promise<string | null>;

export interface ProcessLineOptions {
  /**
   * 编码格式
   */
  encoding?: BufferEncoding;

  /**
   * 是否跳过空行
   */
  skipEmptyLines?: boolean;

  /**
   * 是否跳过注释行
   */
  skipComments?: boolean;

  /**
   * 注释前缀
   */
  commentPrefixes?: string[];

  /**
   * 批处理大小（批量处理行以提高性能）
   */
  batchSize?: number;

  /**
   * 进度回调
   */
  onProgress?: (processedLines: number, totalBytes: number) => void;
}

/**
 * 创建行处理转换流
 */
export function createLineTransform(
  processor: LineProcessor,
  options: ProcessLineOptions = {}
): Transform {
  const {
    skipEmptyLines = true,
    skipComments = true,
    commentPrefixes = ['#', '!', '//'],
    batchSize = 1,
  } = options;

  let lineNumber = 0;
  let buffer: string[] = [];

  return new Transform({
    objectMode: true,

    async transform(chunk: string, encoding, callback) {
      try {
        lineNumber++;

        // 跳过空行
        if (skipEmptyLines && !chunk.trim()) {
          callback();
          return;
        }

        // 跳过注释行
        if (skipComments) {
          const trimmed = chunk.trim();
          if (commentPrefixes.some(prefix => trimmed.startsWith(prefix))) {
            callback();
            return;
          }
        }

        // 处理行
        const result = await processor(chunk, lineNumber);

        if (result !== null) {
          buffer.push(result);

          // 批量输出
          if (buffer.length >= batchSize) {
            this.push(buffer.join('\n') + '\n');
            buffer = [];
          }
        }

        callback();
      } catch (error) {
        callback(error as Error);
      }
    },

    flush(callback) {
      // 输出剩余的缓冲区内容
      if (buffer.length > 0) {
        this.push(buffer.join('\n') + '\n');
      }
      callback();
    },
  });
}

/**
 * 处理文件的每一行
 */
export async function processFileLines(
  inputPath: string,
  processor: LineProcessor,
  options: ProcessLineOptions = {}
): Promise<{ processedLines: number; outputLines: number }> {
  const { encoding = 'utf-8', onProgress } = options;

  let processedLines = 0;
  let outputLines = 0;
  let totalBytes = 0;

  const inputStream = createReadStream(inputPath, { encoding });
  const lineStream = createInterface({
    input: inputStream,
    crlfDelay: Infinity,
  });

  const results: string[] = [];

  // 监听进度
  if (onProgress) {
    inputStream.on('data', chunk => {
      totalBytes += chunk.length;
    });
  }

  for await (const line of lineStream) {
    processedLines++;

    // 跳过空行
    if (options.skipEmptyLines && !line.trim()) {
      continue;
    }

    // 跳过注释行
    if (options.skipComments) {
      const trimmed = line.trim();
      const commentPrefixes = options.commentPrefixes || ['#', '!', '//'];
      if (commentPrefixes.some(prefix => trimmed.startsWith(prefix))) {
        continue;
      }
    }

    // 处理行
    const result = await processor(line, processedLines);
    if (result !== null) {
      results.push(result);
      outputLines++;
    }

    // 报告进度
    if (onProgress && processedLines % 1000 === 0) {
      onProgress(processedLines, totalBytes);
    }
  }

  // 最终进度
  if (onProgress) {
    onProgress(processedLines, totalBytes);
  }

  return { processedLines, outputLines };
}

/**
 * 创建规则行处理器
 */
export function createRuleLineProcessor(
  transform: (rule: string, type: string) => string | null
): LineProcessor {
  return (line: string, lineNumber: number) => {
    const trimmed = line.trim();

    // 保留注释和空行
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
      return line;
    }

    // 解析规则类型
    const match = trimmed.match(
      /^(DOMAIN|DOMAIN-SUFFIX|DOMAIN-KEYWORD|IP-CIDR|IP-CIDR6|URL-REGEX|USER-AGENT),(.+)$/i
    );
    if (!match) {
      return line; // 不是标准规则格式，保持原样
    }

    const [, type, value] = match;
    const transformed = transform(value.trim(), type.toUpperCase());

    if (transformed === null) {
      return null; // 删除这行
    }

    return `${type.toUpperCase()},${transformed}`;
  };
}

/**
 * 批量处理行
 */
export async function batchProcessLines(
  lines: string[],
  processor: LineProcessor,
  options: { concurrency?: number } = {}
): Promise<string[]> {
  const { concurrency = 100 } = options;
  const results: (string | null)[] = [];

  // 分批处理
  for (let i = 0; i < lines.length; i += concurrency) {
    const batch = lines.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((line, index) => processor(line, i + index + 1))
    );
    results.push(...batchResults);
  }

  // 过滤掉 null 值
  return results.filter((result): result is string => result !== null);
}

/**
 * 创建流式行读取器
 */
export function createLineReader(
  inputPath: string,
  options: { encoding?: BufferEncoding } = {}
): AsyncIterable<string> {
  const { encoding = 'utf-8' } = options;

  const stream = createReadStream(inputPath, { encoding });
  const rl = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  return rl;
}

/**
 * 统计文件行数
 */
export async function countLines(
  inputPath: string,
  options: ProcessLineOptions = {}
): Promise<{ totalLines: number; nonEmptyLines: number; commentLines: number }> {
  let totalLines = 0;
  let nonEmptyLines = 0;
  let commentLines = 0;

  const {
    skipEmptyLines = false,
    skipComments = false,
    commentPrefixes = ['#', '!', '//'],
  } = options;

  const reader = createLineReader(inputPath);

  for await (const line of reader) {
    totalLines++;

    const trimmed = line.trim();
    if (trimmed) {
      nonEmptyLines++;

      if (commentPrefixes.some(prefix => trimmed.startsWith(prefix))) {
        commentLines++;
      }
    }
  }

  return { totalLines, nonEmptyLines, commentLines };
}
