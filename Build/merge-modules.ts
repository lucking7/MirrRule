#!/usr/bin/env node
/**
 * 模块合并命令行工具（重构版）
 * 使用统一CLI框架重构，展示框架使用方法
 */

import path from 'node:path';
import { createCLI, registerGlobalErrorHandlers } from './utils/cli';
import { mergeModules } from './lib/module-merger';

// CommonJS 中的 __dirname 直接可用
// const __dirname = __dirname; // 不需要重新定义

// 注册全局错误处理器
registerGlobalErrorHandlers();

// 创建CLI应用
const cli = createCLI(
  {
    name: 'merge-modules',
    description: '合并模块配置文件',
    version: '2.0.0',
    options: [
      {
        name: 'config',
        alias: 'c',
        type: 'string',
        description: '配置文件路径',
        defaultValue: path.join(__dirname, 'lib/module-merger/configs/merge-config.yaml')
      },
      {
        name: 'dry-run',
        alias: 'd',
        type: 'boolean',
        description: '仅显示将要执行的操作，不实际执行',
        defaultValue: false
      }
    ]
  },
  async ({ logger, args }) => {
    try {
      const configPath = args.config as string;
      const dryRun = args['dry-run'] as boolean;

      logger.info(`使用配置文件: ${configPath}`);

      if (dryRun) {
        logger.warn('DRY RUN 模式：不会实际执行合并操作');
      }

      // 执行合并
      const startTime = Date.now();
      const result = await mergeModules(configPath);
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      // 显示成功信息
      logger.success(`所有模块合并完成！耗时 ${duration}s`);

      return 0; // 成功退出码
    } catch (error) {
      logger.error('模块合并失败');
      if (error instanceof Error) {
        logger.error(error.message);
      }
      return 1; // 失败退出码
    }
  }
);

// 覆盖示例方法，提供更具体的使用示例
cli.getExamples = () => [
  'merge-modules',
  'merge-modules --config custom-config.yaml',
  'merge-modules --dry-run',
  'merge-modules --verbose'
];

// 运行CLI (ES模块检查)
if (import.meta.url === `file://${process.argv[1]}`) {
  cli.run();
}

export { cli };
