import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import picocolors from 'picocolors';

/**
 * 下载任务接口
 */
export interface DownloadTask {
  url: string;
  dest: string;
  retries?: number;
  timeout?: number;
}

/**
 * 下载结果接口
 */
export interface DownloadResult {
  url: string;
  dest: string;
  success: boolean;
  error?: Error | undefined;
  attempts: number;
  duration: number;
}

/**
 * 并发下载器配置
 */
export interface ConcurrentDownloaderConfig {
  /** 最大并发数 (默认: 5) */
  maxConcurrency?: number;
  /** 最大重试次数 (默认: 3) */
  maxRetries?: number;
  /** 超时时间(毫秒) (默认: 30000) */
  timeout?: number;
  /** 重试延迟(毫秒) (默认: 1000) */
  retryDelay?: number;
  /** 指数退避乘数 (默认: 2) */
  backoffMultiplier?: number;
  /** 用户代理 (默认: script-hub/1.0.0) */
  userAgent?: string;
}

/**
 * 下载错误类
 */
export class DownloadError extends Error {
  constructor(
    message: string,
    public readonly url: string,
    public readonly statusCode?: number,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}

/**
 * 并发下载器
 * 支持并发控制、失败重试、指数退避等高级功能
 */
export class ConcurrentDownloader extends EventEmitter {
  private readonly config: Required<ConcurrentDownloaderConfig>;
  private activeDownloads = 0;
  private queue: Array<{
    task: DownloadTask;
    resolve: (result: DownloadResult) => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(config: ConcurrentDownloaderConfig = {}) {
    super();
    this.config = {
      maxConcurrency: config.maxConcurrency ?? 5,
      maxRetries: config.maxRetries ?? 3,
      timeout: config.timeout ?? 30000,
      retryDelay: config.retryDelay ?? 1000,
      backoffMultiplier: config.backoffMultiplier ?? 2,
      userAgent: config.userAgent ?? 'script-hub/1.0.0',
    };
  }

  /**
   * 下载单个文件
   */
  async download(task: DownloadTask): Promise<DownloadResult> {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.processQueue();
    });
  }

  /**
   * 批量下载文件
   */
  async downloadBatch(tasks: DownloadTask[]): Promise<DownloadResult[]> {
    const promises = tasks.map(task => this.download(task));
    return Promise.all(promises);
  }

  /**
   * 批量下载文件（带进度）
   */
  async downloadBatchWithProgress(tasks: DownloadTask[]): Promise<{
    results: DownloadResult[];
    stats: {
      total: number;
      successful: number;
      failed: number;
      totalDuration: number;
    };
  }> {
    const startTime = Date.now();
    const total = tasks.length;
    let completed = 0;
    let successful = 0;

    this.on('download:complete', (result: DownloadResult) => {
      completed++;
      if (result.success) successful++;

      const progress = ((completed / total) * 100).toFixed(1);
      const status = result.success ? picocolors.green('✓') : picocolors.red('✗');

      console.log(
        `[${progress}%] ${status} ${result.url} (${result.attempts} attempts, ${result.duration}ms)`
      );
    });

    const results = await this.downloadBatch(tasks);
    const totalDuration = Date.now() - startTime;

    this.removeAllListeners('download:complete');

    return {
      results,
      stats: {
        total,
        successful,
        failed: total - successful,
        totalDuration,
      },
    };
  }

  /**
   * 处理下载队列
   */
  private processQueue(): void {
    while (this.activeDownloads < this.config.maxConcurrency && this.queue.length > 0) {
      const item = this.queue.shift();
      if (item) {
        this.activeDownloads++;
        this.performDownload(item.task)
          .then(result => {
            item.resolve(result);
            this.emit('download:complete', result);
          })
          .catch(error => {
            item.reject(error);
            this.emit('download:error', error);
          })
          .finally(() => {
            this.activeDownloads--;
            this.processQueue();
          });
      }
    }
  }

  /**
   * 执行下载任务
   */
  private async performDownload(task: DownloadTask): Promise<DownloadResult> {
    const startTime = Date.now();
    const maxRetries = task.retries ?? this.config.maxRetries;
    const timeout = task.timeout ?? this.config.timeout;

    let lastError: Error | undefined;
    let attempts = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      attempts++;

      try {
        await this.downloadFile(task.url, task.dest, timeout);

        return {
          url: task.url,
          dest: task.dest,
          success: true,
          attempts,
          duration: Date.now() - startTime,
        };
      } catch (error) {
        lastError = error as Error;

        // 不重试的错误类型
        if (this.shouldNotRetry(error)) {
          break;
        }

        // 如果还有重试机会，等待后重试
        if (attempt < maxRetries) {
          const delay = this.config.retryDelay * Math.pow(this.config.backoffMultiplier, attempt);
          this.emit('download:retry', { task, attempt: attempt + 1, delay, error });
          await this.sleep(delay);
        }
      }
    }

    // 所有重试都失败
    return {
      url: task.url,
      dest: task.dest,
      success: false,
      error: lastError,
      attempts,
      duration: Date.now() - startTime,
    };
  }

  /**
   * 下载文件的核心实现
   */
  private async downloadFile(url: string, dest: string, timeout: number): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': this.config.userAgent,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new DownloadError(`HTTP error! status: ${response.status}`, url, response.status);
      }

      // 确保目标目录存在
      const dir = path.dirname(dest);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const buffer = await response.arrayBuffer();
      await fs.promises.writeFile(dest, Buffer.from(buffer));
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new DownloadError(`Download timeout after ${timeout}ms`, url, undefined, error);
        }
        throw new DownloadError(`Download failed: ${error.message}`, url, undefined, error);
      }
      throw error;
    }
  }

  /**
   * 判断是否应该重试
   */
  private shouldNotRetry(error: unknown): boolean {
    if (error instanceof DownloadError) {
      // 客户端错误通常不应重试
      if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
        // 但 429 (Too Many Requests) 和 408 (Request Timeout) 应该重试
        return error.statusCode !== 429 && error.statusCode !== 408;
      }
    }
    return false;
  }

  /**
   * 睡眠指定毫秒数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取当前配置
   */
  getConfig(): Readonly<Required<ConcurrentDownloaderConfig>> {
    return { ...this.config };
  }

  /**
   * 获取当前状态
   */
  getStatus(): {
    activeDownloads: number;
    queueLength: number;
  } {
    return {
      activeDownloads: this.activeDownloads,
      queueLength: this.queue.length,
    };
  }
}

/**
 * 创建默认的下载器实例
 */
export function createDownloader(config?: ConcurrentDownloaderConfig): ConcurrentDownloader {
  return new ConcurrentDownloader(config);
}
