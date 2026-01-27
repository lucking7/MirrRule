#!/usr/bin/env node
/**
 * 模块合并命令行工具
 */

import path from 'node:path';
import { createCLI, registerGlobalErrorHandlers } from './utils/cli';
import { mergeModules } from './lib/module-merger';

registerGlobalErrorHandlers();

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
        defaultValue: path.join(__dirname, 'lib/module-merger/configs/pro-merge-config.yaml'),
      },
      {
        name: 'dry-run',
        alias: 'd',
        type: 'boolean',
        description: '仅显示将要执行的操作，不实际执行',
        defaultValue: false,
      },
      {
        name: 'only',
        type: 'array',
        description: '仅合并指定 key 的模块（逗号分隔，优先级最高）',
      },
      {
        name: 'enable',
        type: 'array',
        description: '额外启用的模块 key 列表（逗号分隔）',
      },
      {
        name: 'disable',
        type: 'array',
        description: '额外禁用的模块 key 列表（逗号分隔）',
      },
    ],
  },
  async ({ logger, args }) => {
    try {
      const configPath = args.config as string;
      const dryRun = args['dry-run'] as boolean;
      const only = (args.only as string[] | undefined) ?? [];
      const enable = (args.enable as string[] | undefined) ?? [];
      const disable = (args.disable as string[] | undefined) ?? [];

      logger.info(`使用配置文件: ${configPath}`);

      if (dryRun) {
        logger.warn('DRY RUN 模式：不会实际执行合并操作');
      }

      const startTime = Date.now();
      await mergeModules(configPath, { dryRun, only, enable, disable });
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.success(`所有模块合并完成！耗时 ${duration}s`);

      return 0;
    } catch (error) {
      logger.error('模块合并失败');
      if (error instanceof Error) {
        logger.error(error.message);
      }
      return 1;
    }
  }
);

(cli as any).getExamples = () => [
  'merge-modules',
  'merge-modules --config custom-config.yaml',
  'merge-modules --dry-run',
  'merge-modules --only gaode,youku',
  'merge-modules --enable wechat,weibo',
  'merge-modules --disable tiktok',
  'merge-modules --verbose',
];

if (require.main === module) {
  cli.run();
}

export { cli };
