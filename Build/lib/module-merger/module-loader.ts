import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fetch } from 'undici';

import type { LoadedModule, ModuleLoadError, ModuleSource } from './types';

const AVAILABLE_PARALLELISM =
  typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : os.cpus().length;
const DEFAULT_CONCURRENCY = Math.max(2, Math.min(8, AVAILABLE_PARALLELISM));

export class ModuleLoader {
  constructor(
    private readonly searchDirs: string[],
    private readonly concurrency: number = DEFAULT_CONCURRENCY
  ) {}

  async loadAll(sources: ModuleSource[]): Promise<{ loaded: LoadedModule[], failures: ModuleLoadError[] }> {
    if (!sources.length) {
      return { loaded: [], failures: [] };
    }

    const queue = [...sources];
    const loaded: LoadedModule[] = [];
    const failures: ModuleLoadError[] = [];
    const workerCount = Math.min(this.concurrency, sources.length);
    const workers = Array.from(
      { length: workerCount },
      () => this.runWorker(queue, loaded, failures)
    );

    await Promise.all(workers);
    return { loaded, failures };
  }

  private async runWorker(
    queue: ModuleSource[],
    loaded: LoadedModule[],
    failures: ModuleLoadError[]
  ): Promise<void> {
    while (queue.length) {
      const source = queue.shift();
      if (!source) break;

      try {
        const module = await this.loadSource(source);
        loaded.push(module);
      } catch (error) {
        failures.push({
          header: source.header,
          url: source.url,
          reason: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  private async loadSource(source: ModuleSource): Promise<LoadedModule> {
    if (source.url.startsWith('http://') || source.url.startsWith('https://')) {
      const response = await fetch(source.url);
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
