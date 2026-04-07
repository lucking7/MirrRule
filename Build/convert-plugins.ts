#!/usr/bin/env node
/**
 * 插件转换命令行工具
 */

import process from 'node:process';
import { convertAndMirrorPlugins, printConversionSummary } from './integration/plugin-converter';

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});

async function main() {
  const args = new Set(process.argv.slice(2));
  const waitForService = args.has('--wait-service') || args.has('-w');

  console.log('开始转换插件...');
  if (waitForService) {
    console.log('等待Script-Hub服务就绪');
  }

  const startTime = Date.now();
  const results = await convertAndMirrorPlugins(waitForService);
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  if (results.length === 0) {
    console.error('没有插件被转换');
    process.exit(1);
  }

  printConversionSummary(results);

  const failedCount = results.filter(r => !r.success).length;
  const successCount = results.length - failedCount;

  console.log(`转换统计: 总数=${results.length} 成功=${successCount} 失败=${failedCount} 耗时=${duration}s`);

  if (failedCount > 0) {
    console.warn(`转换完成，但有 ${failedCount} 个插件转换失败`);
    process.exit(1);
  }

  console.log('所有插件转换成功');
}

if (require.main === module) {
  main();
}
