import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fetch } from 'undici';

import type { LoadedModule, ModuleLoadError, ModuleSource } from './types';
import { getErrorMessage } from '../../utils/cli/logger';

const AVAILABLE_PARALLELISM =
  typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : os.cpus().length;
const DEFAULT_CONCURRENCY = Math.max(2, Math.min(8, AVAILABLE_PARALLELISM));

/** HTTP 请求超时时间 (ms) */
const HTTP_TIMEOUT = 30000;

/** HTTP 请求最大重试次数 */
const HTTP_MAX_RETRIES = 2;

interface IndexedLoadResult {
  index: number,
  loaded?: LoadedModule,
  failure?: ModuleLoadError
}

export class ModuleLoader {
  constructor(
    private readonly searchDirs: string[],
    private readonly concurrency: number = DEFAULT_CONCURRENCY
  ) {}

  async loadAll(sources: ModuleSource[]): Promise<{ loaded: LoadedModule[], failures: ModuleLoadError[] }> {
    if (!sources.length) {
      return { loaded: [], failures: [] };
    }

    const indexedQueue = sources.map((source, index) => ({ source, index }));
    const results: IndexedLoadResult[] = [];
    const workerCount = Math.min(this.concurrency, sources.length);
    const workers = Array.from(
      { length: workerCount },
      () => this.runWorker(indexedQueue, results)
    );

    await Promise.all(workers);

    // 按原始配置顺序排序，确保输出顺序稳定
    results.sort((a, b) => a.index - b.index);

    const loaded: LoadedModule[] = [];
    const failures: ModuleLoadError[] = [];

    for (const r of results) {
      if (r.loaded) loaded.push(r.loaded);
      if (r.failure) failures.push(r.failure);
    }

    return { loaded, failures };
  }

  private async runWorker(
    queue: Array<{ source: ModuleSource; index: number }>,
    results: IndexedLoadResult[]
  ): Promise<void> {
    while (queue.length) {
      const item = queue.shift();
      if (!item) break;

      try {
        const module = await this.loadSourceWithRetry(item.source);
        results.push({ index: item.index, loaded: module });
      } catch (error) {
        results.push({
          index: item.index,
          failure: {
            header: item.source.header,
            url: item.source.url,
            reason: getErrorMessage(error)
          }
        });
      }
    }
  }

  /**
   * 带重试的模块加载（仅对远程 HTTP 请求启用重试）
   */
  private async loadSourceWithRetry(source: ModuleSource): Promise<LoadedModule> {
    const isRemote = source.url.startsWith('http://') || source.url.startsWith('https://');

    // 本地文件不需要重试
    if (!isRemote) {
      return this.loadSource(source);
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= HTTP_MAX_RETRIES; attempt++) {
      try {
        return await this.loadSource(source);
      } catch (error) {
        lastError = error;
        if (attempt < HTTP_MAX_RETRIES) {
          const delay = 1000 * (attempt + 1);
          await new Promise<void>(resolve => { setTimeout(resolve, delay); });
        }
      }
    }
    throw lastError;
  }

  private async loadSource(source: ModuleSource): Promise<LoadedModule> {
    if (source.url.startsWith('http://') || source.url.startsWith('https://')) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), HTTP_TIMEOUT);

      try {
        const response = await fetch(source.url, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const content = await response.text();
        return {
          header: source.header,
          url: source.url,
          content,
          source: 'remote'
        };
      } finally {
        clearTimeout(timeoutId);
      }
    }

    const content = await this.readLocalFile(source.url);
    return {
      header: source.header,
      url: source.url,
      content,
      source: 'local'
    };
  }

  private async readLocalFile(raw: string): Promise<string> {
    const candidates = this.resolveLocalCandidates(raw);
    let lastError: unknown = null;

    for (const candidate of candidates) {
      try {
        return await fs.readFile(candidate, 'utf-8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          lastError = error;
          continue;
        }
        throw error;
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }

    throw new Error(`未找到本地文件: ${raw}`);
  }

  private resolveLocalCandidates(raw: string): string[] {
    const sanitized = raw.startsWith('file://') ? raw.slice('file://'.length) : raw;
    if (!sanitized) {
      return this.searchDirs.map(dir => path.resolve(dir));
    }

    if (sanitized.startsWith('~/')) {
      return [path.resolve(os.homedir(), sanitized.slice(2))];
    }

    if (path.isAbsolute(sanitized)) {
      return [sanitized];
    }

    const unique = new Set<string>();
    this.searchDirs.forEach(dir => {
      unique.add(path.resolve(dir, sanitized));
    });
    return Array.from(unique);
  }
}
