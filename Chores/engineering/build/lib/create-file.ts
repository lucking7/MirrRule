import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import picocolors from 'picocolors';
import cliProgress from 'cli-progress';
import type { Span } from '../trace/index.js';

// 计算内容哈希
function calculateHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').substring(0, 16);
}

// 缓存元数据接口
interface FileMeta {
  path: string;
  hash: string;
  size: number;
  mtime: number;
}

// 缓存目录
const CACHE_DIR = path.join(process.cwd(), '.cache');
const META_FILE = path.join(CACHE_DIR, 'file-meta.json');

// 获取相对路径作为缓存键
function getCacheKey(filePath: string): string {
  // 如果是绝对路径，转换为相对于 cwd 的路径
  if (path.isAbsolute(filePath)) {
    return path.relative(process.cwd(), filePath);
  }
  return filePath;
}

// 加载缓存元数据
async function loadMeta(): Promise<Map<string, FileMeta>> {
  try {
    const content = await fs.readFile(META_FILE, 'utf-8');
    const entries = JSON.parse(content) as FileMeta[];
    return new Map(entries.map(e => [e.path, e]));
  } catch {
    return new Map();
  }
}

// 保存缓存元数据
async function saveMeta(meta: Map<string, FileMeta>): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const entries = Array.from(meta.values());
  await fs.writeFile(META_FILE, JSON.stringify(entries, null, 2));
}

// 创建文件（支持增量更新）
export async function createFile(
  span: Span,
  filePath: string,
  content: string | string[],
  options?: {
    overwrite?: boolean;
    encoding?: BufferEncoding;
  }
): Promise<boolean> {
  return span.traceChildAsync(`create ${path.basename(filePath)}`, async () => {
    const finalContent = Array.isArray(content) ? content.join('\n') : content;
    const contentHash = calculateHash(finalContent);
    const cacheKey = getCacheKey(filePath);

    // 加载元数据
    const meta = await loadMeta();
    const existingMeta = meta.get(cacheKey);

    // 检查是否需要更新
    if (existingMeta && existingMeta.hash === contentHash && !options?.overwrite) {
      console.log(picocolors.gray(`⏭️  跳过未更改: ${path.basename(filePath)}`));
      return false;
    }

    // 确保目录存在
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // 写入文件
    await fs.writeFile(filePath, finalContent, options?.encoding || 'utf-8');

    // 更新元数据
    meta.set(cacheKey, {
      path: cacheKey,
      hash: contentHash,
      size: Buffer.byteLength(finalContent),
      mtime: Date.now(),
    });

    await saveMeta(meta);

    console.log(picocolors.green(`✅ 已创建: ${path.basename(filePath)}`));
    return true;
  });
}

// 批量创建文件
export async function createFiles(
  span: Span,
  files: Array<{ path: string; content: string | string[] }>,
  options?: {
    overwrite?: boolean;
    encoding?: BufferEncoding;
    showProgress?: boolean;
  }
): Promise<number> {
  const showProgress = options?.showProgress ?? files.length > 10;
  let progressBar: cliProgress.SingleBar | null = null;

  if (showProgress) {
    progressBar = new cliProgress.SingleBar({
      format: '创建文件 |{bar}| {percentage}% | {value}/{total} | {filename}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
    });
    progressBar.start(files.length, 0, { filename: '' });
  }

  let created = 0;
  let processed = 0;

  await Promise.all(
    files.map(async ({ path: filePath, content }) => {
      const result = await createFile(span, filePath, content, options);
      if (result) created++;

      processed++;
      if (progressBar) {
        progressBar.update(processed, { filename: path.basename(filePath) });
      }
    })
  );

  if (progressBar) {
    progressBar.stop();
  }

  return created;
}

// 清理过期缓存
export async function cleanCache(
  span: Span,
  maxAge: number = 7 * 24 * 60 * 60 * 1000
): Promise<void> {
  return span.traceChildAsync('clean cache', async () => {
    const meta = await loadMeta();
    const now = Date.now();
    let removed = 0;

    for (const [filePath, fileMeta] of meta) {
      if (now - fileMeta.mtime > maxAge) {
        meta.delete(filePath);
        removed++;
      }
    }

    if (removed > 0) {
      await saveMeta(meta);
      console.log(picocolors.yellow(`🧹 清理过期缓存: ${removed} 条`));
    }
  });
}
