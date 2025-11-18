/**
 * 统一CLI框架
 * 提供标准化的命令行应用基础设施
 *
 * @module cli/cli-framework
 */

import process from 'node:process';
import { Logger, LogLevel } from './logger';
import type { LoggerConfig } from './logger';
import { ArgumentParser } from './argument-parser';
import type { ArgumentOption, ParsedArguments } from './argument-parser';

/**
 * CLI配置选项
 */
/* eslint-disable @stylistic/member-delimiter-style -- keep TS interface style aligned with rest of codebase */
export interface CLIConfig {
  /** 命令名称 */
  name: string;
  /** 命令描述 */
  description?: string;
  /** 版本号 */
  version?: string;
  /** 日志配置 */
  logger?: LoggerConfig;
  /** 参数选项 */
  options?: ArgumentOption[];
}
/* eslint-enable @stylistic/member-delimiter-style */

/**
 * CLI执行上下文
 */
export interface CLIContext {
  /** 日志器实例 */
  logger: Logger;
  /** 解析后的参数 */
  args: ParsedArguments;
  /** 原始参数数组 */
  rawArgs: string[];
}

/**
 * CLI命令抽象基类
 * 提供标准化的错误处理、日志输出、参数解析等功能
 */
export abstract class CLIFramework {
  protected logger: Logger;
  protected parser: ArgumentParser;
  protected config: Required<Omit<CLIConfig, 'logger' | 'options'>>;

  constructor(config: CLIConfig) {
    this.config = {
      name: config.name,
      description: config.description ?? '',
      version: config.version ?? '1.0.0',
    };

    this.logger = new Logger(config.logger);
    this.parser = new ArgumentParser();

    // 注册基础参数
    this.parser
      .option({
        name: 'help',
        alias: 'h',
        type: 'boolean',
        description: '显示帮助信息',
        defaultValue: false,
      })
      .option({
        name: 'version',
        alias: 'v',
        type: 'boolean',
        description: '显示版本信息',
        defaultValue: false,
      })
      .option({
        name: 'verbose',
        type: 'boolean',
        description: '显示详细日志',
        defaultValue: false,
      });

    // 注册自定义参数
    if (config.options) {
      this.parser.options(config.options);
    }
  }

  /**
   * 命令执行入口（抽象方法）
   * 子类必须实现此方法
   *
   * @param context - CLI执行上下文
   * @returns 退出码（0表示成功，非0表示失败）
   */
  protected abstract execute(context: CLIContext): Promise<number>;

  /**
   * 运行CLI命令
   * 处理参数解析、错误处理、进程退出等标准流程
   *
   * @param argv - 命令行参数（默认使用 process.argv.slice(2)）
   */
  async run(argv: string[] = process.argv.slice(2)): Promise<void> {
    try {
      // 解析参数
      const args = this.parser.parse(argv);

      // 处理帮助信息
      if (args.help) {
        this.showHelp();
        process.exit(0);
      }

      // 处理版本信息
      if (args.version) {
        this.showVersion();
        process.exit(0);
      }

      // 调整日志级别
      if (args.verbose) {
        this.logger = new Logger({
          minLevel: LogLevel.DEBUG,
          timestamp: true,
        });
      }

      // 显示标题
      this.showTitle();

      // 创建执行上下文
      const context: CLIContext = {
        logger: this.logger,
        args,
        rawArgs: argv,
      };

      // 执行命令
      const exitCode = await this.execute(context);

      // 退出进程
      process.exit(exitCode);
    } catch (error) {
      // 统一错误处理
      this.handleError(error);
      process.exit(1);
    }
  }

  /**
   * 显示帮助信息
   */
  protected showHelp(): void {
    console.log(`
${this.config.name} - ${this.config.description}

Usage:
  ${this.config.name} [options]

${this.parser.help()}

Examples:
${this.getExamples()
  .map(ex => `  ${ex}`)
  .join('\n')}
`);
  }

  /**
   * 显示版本信息
   */
  protected showVersion(): void {
    console.log(`${this.config.name} v${this.config.version}`);
  }

  /**
   * 显示标题
   */
  protected showTitle(): void {
    this.logger.title(`${this.config.name} - ${this.config.description}`);
  }

  /**
   * 获取使用示例（子类可覆盖）
   * @returns 示例字符串数组
   */
  protected getExamples(): string[] {
    return [`${this.config.name} --help`, `${this.config.name} --version`];
  }

  /**
   * 统一错误处理
   * @param error - 错误对象
   */
  protected handleError(error: unknown): void {
    if (error instanceof Error) {
      this.logger.error(`执行失败: ${error.message}`);

      if (error.stack && process.env.DEBUG) {
        this.logger.debug('错误堆栈:');
        console.error(error.stack);
      }
    } else {
      this.logger.error(`未知错误: ${String(error)}`);
    }
  }

  /**
   * 确保目录存在
   * @param dirPath - 目录路径
   */
  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- utility method does not rely on instance state
  protected async ensureDir(dirPath: string): Promise<void> {
    const fs = await import('node:fs/promises');
    await fs.mkdir(dirPath, { recursive: true });
  }

  /**
   * 生成元数据文件
   * @param filePath - 文件路径
   * @param data - 元数据对象
   */
  protected async writeMetadata(filePath: string, data: Record<string, unknown>): Promise<void> {
    const fs = await import('node:fs/promises');
    const metadata = {
      version: this.config.version,
      generatedAt: new Date().toISOString(),
      ...data,
    };

    await fs.writeFile(filePath, JSON.stringify(metadata, null, 2), 'utf-8');

    this.logger.progress(`元数据已保存: ${filePath}`);
  }

  /**
   * 显示统计信息
   * @param title - 统计标题
   * @param stats - 统计数据
   */
  protected showStats(title: string, stats: Record<string, string | number>): void {
    this.logger.stats(title, stats);
  }

  /**
   * 显示成功信息并返回成功退出码
   * @param message - 成功信息
   * @returns 成功退出码 (0)
   */
  protected success(message: string): number {
    this.logger.success(message);
    return 0;
  }

  /**
   * 显示失败信息并返回失败退出码
   * @param message - 失败信息
   * @returns 失败退出码 (1)
   */
  protected failure(message: string): number {
    this.logger.error(message);
    return 1;
  }
}

/**
 * 快速创建CLI应用的工厂函数
 *
 * @param config - CLI配置
 * @param execute - 执行函数
 * @returns CLI实例
 *
 * @example
 * ```typescript
 * const cli = createCLI({
 *   name: 'my-cli',
 *   description: 'My CLI tool',
 *   options: [
 *     { name: 'input', alias: 'i', type: 'string', required: true }
 *   ]
 * }, async ({ logger, args }) => {
 *   logger.info(`Processing: ${args.input}`);
 *   return 0;
 * });
 *
 * cli.run();
 * ```
 */
export function createCLI(
  config: CLIConfig,
  execute: (context: CLIContext) => Promise<number>
): CLIFramework {
  return new (class extends CLIFramework {
    // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- delegates execution to provided callback without using instance state
    protected async execute(context: CLIContext): Promise<number> {
      return execute(context);
    }
  })(config);
}

/**
 * 注册全局未处理错误和拒绝的处理器
 * 应在应用入口调用一次
 */
export function registerGlobalErrorHandlers(): void {
  const logger = new Logger();

  process.on('uncaughtException', error => {
    logger.error('未捕获的异常:');
    console.error(error);
    process.exit(1);
  });

  process.on('unhandledRejection', reason => {
    logger.error('未处理的Promise拒绝:');
    console.error(reason);
    process.exit(1);
  });
}
