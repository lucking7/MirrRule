/**
 * 统一日志工具
 */

import picocolors from 'picocolors';

/**
 * 日志级别枚举
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  SUCCESS = 2,
  WARN = 3,
  ERROR = 4
}

/**
 * 日志配置
 */
export interface LoggerConfig {
  /** 最小日志级别 */
  minLevel?: LogLevel,
  /** 是否启用时间戳 */
  timestamp?: boolean,
  /** 日志前缀 */
  prefix?: string
}

/**
 * 统一日志器类
 * 提供标准化的命令行输出格式和样式
 */
export class Logger {
  private readonly config: Required<LoggerConfig>;

  constructor(config: LoggerConfig = {}) {
    this.config = {
      minLevel: config.minLevel ?? LogLevel.INFO,
      timestamp: config.timestamp ?? false,
      prefix: config.prefix ?? ''
    };
  }

  /**
   * 获取时间戳字符串
   */
  private getTimestamp(): string {
    if (!this.config.timestamp) {
      return '';
    }
    const now = new Date();
    return picocolors.gray(`[${now.toISOString()}] `);
  }

  /**
   * 获取前缀字符串
   */
  private getPrefix(): string {
    return this.config.prefix ? `${this.config.prefix} ` : '';
  }

  /**
   * 输出调试信息
   * @param message - 消息内容
   * @param args - 附加参数
   */
  debug(message: string, ...args: unknown[]): void {
    if (this.config.minLevel <= LogLevel.DEBUG) {
      console.log(
        this.getTimestamp() + this.getPrefix() + picocolors.gray(`[DEBUG] ${message}`),
        ...args
      );
    }
  }

  /**
   * 输出信息日志
   * @param message - 消息内容
   * @param args - 附加参数
   */
  info(message: string, ...args: unknown[]): void {
    if (this.config.minLevel <= LogLevel.INFO) {
      console.log(
        this.getTimestamp() + this.getPrefix() + picocolors.blue(`ℹ\uFE0F  ${message}`),
        ...args
      );
    }
  }

  /**
   * 输出成功信息
   * @param message - 消息内容
   * @param args - 附加参数
   */
  success(message: string, ...args: unknown[]): void {
    if (this.config.minLevel <= LogLevel.SUCCESS) {
      console.log(
        this.getTimestamp() + this.getPrefix() + picocolors.green(`[OK] ${message}`),
        ...args
      );
    }
  }

  /**
   * 输出警告信息
   * @param message - 消息内容
   * @param args - 附加参数
   */
  warn(message: string, ...args: unknown[]): void {
    if (this.config.minLevel <= LogLevel.WARN) {
      console.log(
        this.getTimestamp() + this.getPrefix() + picocolors.yellow(`[WARN] ${message}`),
        ...args
      );
    }
  }

  /**
   * 输出错误信息
   * @param message - 消息内容
   * @param args - 附加参数
   */
  error(message: string, ...args: unknown[]): void {
    if (this.config.minLevel <= LogLevel.ERROR) {
      console.error(
        this.getTimestamp() + this.getPrefix() + picocolors.red(`[ERROR] ${message}`),
        ...args
      );
    }
  }

  /**
   * 输出标题
   * @param message - 标题内容
   */
  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- Logger title formatting does not depend on instance state
  title(message: string): void {
    console.log(picocolors.cyan(`\n${message}\n`));
  }

  /**
   * 输出分隔线
   */
  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- Divider output does not use instance state, kept as instance method for API consistency
  divider(): void {
    console.log(picocolors.gray('─'.repeat(50)));
  }

  /**
   * 输出进度信息（灰色，无前缀）
   * @param message - 进度信息
   * @param args - 附加参数
   */
  progress(message: string, ...args: unknown[]): void {
    console.log(this.getTimestamp() + picocolors.gray(`  ${message}`), ...args);
  }

  /**
   * 输出统计表格
   * @param title - 表格标题
   * @param data - 统计数据
   */
  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- Stats table rendering does not use instance state, kept as instance method for a consistent Logger API
  stats(title: string, data: Record<string, string | number>): void {
    console.log(picocolors.cyan(`\n${title}:`));
    for (const [key, value] of Object.entries(data)) {
      console.log(picocolors.gray(`  • ${key}: ${value}`));
    }
  }

  /**
   * 创建带缩进的子日志器
   * @param indent - 缩进字符串
   * @returns 新的日志器实例
   */
  createChild(indent = '  '): Logger {
    return new Logger({
      ...this.config,
      prefix: this.config.prefix + indent
    });
  }
}

/**
 * 默认日志器实例
 */
export const logger = new Logger();

/**
 * Extract error message from unknown error type
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
