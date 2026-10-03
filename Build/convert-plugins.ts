#!/usr/bin/env node
/**
 * 插件转换命令行工具
 */

import process from 'node:process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { convertAndMirrorPlugins, printConversionSummary } from './integration/plugin-converter';
import { getErrorMessage, registerGlobalErrorHandlers } from './lib/misc';
import { verifyRequiredPluginOutputs } from './integration/plugin-converter/readiness';

registerGlobalErrorHandlers();

async function main() {
  const rawArgs = process.argv.slice(2);
  const args = new Set(rawArgs);
  const waitForService = args.has('--wait-service') || args.has('-w');
  const configIndex = rawArgs.indexOf('--required-config');
  const requiredConfig = configIndex < 0 ? undefined : rawArgs[configIndex + 1];
  if (configIndex >= 0 && (!requiredConfig || requiredConfig.startsWith('-'))) {
    throw new Error('--required-config requires a configuration path');
  }

  console.log('开始转换插件...');
  if (waitForService) {
    console.log('等待Script-Hub服务就绪');
  }

  const startTime = Date.now();
  const results = await convertAndMirrorPlugins(waitForService);
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  const reportPath = process.env.PLUGIN_CONVERSION_REPORT;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    total: results.length,
    ready: results.filter(result => result.status === 'ready').length,
    degraded: results.filter(result => result.status === 'degraded').length,
    failed: results.filter(result => result.status === 'failed').length,
    required: undefined as { config: string; ready: number } | undefined,
    results: results.map(result => ({
      pluginName: result.pluginName,
      sourceId: result.sourceId,
      file: result.outputPath ? path.basename(result.outputPath) : undefined,
      status: result.status,
      error: result.error,
    })),
  };
  async function writeReport() {
    if (!reportPath) return;
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  }
  await writeReport();

  if (results.length === 0) {
    console.error('没有插件被转换');
    process.exit(1);
  }

  printConversionSummary(results);

  const failedCount = results.filter(r => r.status !== 'ready').length;
  const successCount = results.length - failedCount;

  console.log(`转换统计: 总数=${results.length} 成功=${successCount} 失败=${failedCount} 耗时=${duration}s`);

  if (requiredConfig) {
    const requiredReady = await verifyRequiredPluginOutputs(results, requiredConfig);
    report.required = { config: requiredConfig, ready: requiredReady };
    await writeReport();
    console.log(`必需模块验收通过: ${requiredReady} 个模块全部来自本轮 ready 产物`);
    if (failedCount > 0) {
      console.warn(`::warning::${failedCount} 个非必需插件未通过，详见转换报告；未将其标为成功`);
    }
  } else if (failedCount > 0) {
    console.error(`转换完成，但有 ${failedCount} 个插件转换失败`);
    process.exit(1);
  }

  if (failedCount === 0) console.log('所有插件转换成功');
}

if (require.main === module) {
  main().catch((error) => {
    console.error('转换失败:', getErrorMessage(error));
    process.exit(1);
  });
}
