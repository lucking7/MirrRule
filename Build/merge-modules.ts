#!/usr/bin/env node
/**
 * 模块合并命令行工具
 */

import process from 'node:process';
import path from 'node:path';
import { mergeModules } from './lib/module-merger';
import { getErrorMessage, registerGlobalErrorHandlers } from './lib/misc';

registerGlobalErrorHandlers();

function parseArgs(argv: string[]) {
  let config = path.join(__dirname, 'lib/module-merger/configs/pro-merge-config.yaml');
  let dryRun = false;
  let only: string[] = [];
  let enable: string[] = [];
  let disable: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--config' || arg === '-c') {
      config = argv[++i];
    } else if (arg === '--dry-run' || arg === '-d') {
      dryRun = true;
    } else if (arg === '--only') {
      only = argv[++i]?.split(',') ?? [];
    } else if (arg === '--enable') {
      enable = argv[++i]?.split(',') ?? [];
    } else if (arg === '--disable') {
      disable = argv[++i]?.split(',') ?? [];
    }
  }

  return { config, dryRun, only, enable, disable };
}

async function main() {
  const { config: configPath, dryRun, only, enable, disable } = parseArgs(process.argv.slice(2));

  console.log(`使用配置文件: ${configPath}`);
  if (dryRun) {
    console.warn('DRY RUN 模式：不会实际执行合并操作');
  }

  const startTime = Date.now();
  await mergeModules(configPath, { dryRun, only, enable, disable });
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`所有模块合并完成！耗时 ${duration}s`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('模块合并失败:', getErrorMessage(error));
    process.exit(1);
  });
}
