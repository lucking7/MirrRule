#!/usr/bin/env node
/**
 * 插件转换命令行工具（重构版）
 * 使用统一CLI框架重构，展示类继承使用方法
 */

import process from 'node:process';
import { CLIFramework, registerGlobalErrorHandlers } from './utils/cli';
import type { CLIContext } from './utils/cli';
import { convertAndMirrorPlugins, printConversionSummary } from './integration/plugin-converter';

/**
 * 插件转换CLI命令类
 */
class PluginConversionCLI extends CLIFramework {
  constructor() {
    super({
      name: 'convert-plugins',
      description: '插件转换工具 - 支持多平台插件格式转换',
      version: '2.0.0',
      options: [
        {
          name: 'wait-service',
          alias: 'w',
          type: 'boolean',
          description: '等待Script-Hub服务就绪',
          defaultValue: false,
        },
        {
          name: 'platform',
          alias: 'p',
          type: 'string',
          description: '目标平台',
          choices: ['surge', 'loon', 'quantumultx', 'shadowrocket', 'all'],
          defaultValue: 'all',
        },
        {
          name: 'timeout',
          alias: 't',
          type: 'number',
          description: '转换超时时间（秒）',
          defaultValue: 300,
        },
      ],
    });
  }

  /**
   * 执行插件转换
   */
  protected async execute(context: CLIContext): Promise<number> {
    const { logger, args } = context;

    const waitForService = args['wait-service'] as boolean;
    const platform = args.platform as string;
    const timeout = args.timeout as number;

    // 显示配置信息
    logger.info('转换配置:');
    logger.progress(`目标平台: ${platform}`);
    logger.progress(`超时时间: ${timeout}s`);

    if (waitForService) {
      logger.progress('等待Script-Hub服务就绪');
    }

    try {
      // 执行转换
      logger.divider();
      logger.info('开始转换插件...');

      const startTime = Date.now();
      const results = await convertAndMirrorPlugins(waitForService);
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.divider();

      // 检查结果
      if (results.length === 0) {
        return this.failure('没有插件被转换');
      }

      // 打印转换摘要
      printConversionSummary(results);

      // 统计失败数量
      const failedCount = results.filter(r => !r.success).length;
      const successCount = results.length - failedCount;

      // 显示统计信息
      this.showStats('转换统计', {
        总数: results.length,
        成功: successCount,
        失败: failedCount,
        耗时: `${duration}s`,
      });

      // 根据结果返回退出码
      if (failedCount > 0) {
        logger.warn(`转换完成，但有 ${failedCount} 个插件转换失败`);
        return 1;
      }

      return this.success('所有插件转换成功');
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`转换失败: ${error.message}`);
      }
      return 1;
    }
  }

  /**
   * 提供使用示例
   */
  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- this hook only formats static usage examples and does not depend on instance state
  protected getExamples(): string[] {
    return [
      'convert-plugins',
      'convert-plugins --wait-service',
      'convert-plugins --platform surge',
      'convert-plugins --timeout 600 --verbose',
    ];
  }
}

// 注册全局错误处理器
registerGlobalErrorHandlers();

// 运行CLI (ES模块检查)
if (require.main === module) {
  const cli = new PluginConversionCLI();
  cli.run();
}

export { PluginConversionCLI };
