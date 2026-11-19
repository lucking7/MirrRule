#!/usr/bin/env node
/**
 * 插件转换命令行工具
 */

import process from 'node:process';
import path from 'node:path';
import { convertAndMirrorPlugins, printConversionSummary } from './integration/plugin-converter';
import type { CatalogAttempt } from './integration/plugin-converter/plugin-list';
import { writeFileAtomic } from './lib/atomic-file';
import { getErrorMessage, registerGlobalErrorHandlers } from './lib/misc';
import {
  PluginCatalogUnavailableError,
  RequiredPluginOutputError,
  UPSTREAM_UNAVAILABLE_EXIT_CODE,
  verifyRequiredPluginOutputs,
} from './integration/plugin-converter/readiness';

async function writeReportFile(reportPath: string | undefined, payload: unknown): Promise<void> {
  if (!reportPath) return;
  await writeFileAtomic(reportPath, JSON.stringify(payload, null, 2));
}

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
  const reportPath = process.env.PLUGIN_CONVERSION_REPORT;
  const catalog: CatalogAttempt[] = [];
  let results;
  try {
    results = await convertAndMirrorPlugins(waitForService, true, attempt => catalog.push(attempt));
  } catch (error) {
    if (error instanceof PluginCatalogUnavailableError) {
      await writeReportFile(reportPath, {
        schemaVersion: 1, generatedAt: new Date().toISOString(), status: 'catalog-unavailable', catalog,
      });
    }
    throw error;
  }
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    catalog,
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
      upstreamUnavailable: result.upstreamUnavailable,
    })),
  };
  await writeReportFile(reportPath, report);

  if (results.length === 0) {
    console.error('没有插件被转换');
    process.exit(1);
  }

  printConversionSummary(results);

  const failedCount = results.filter(r => r.status !== 'ready').length;
  const successCount = results.length - failedCount;

  console.log(`转换统计: 总数=${results.length} 成功=${successCount} 失败=${failedCount} 耗时=${duration}s`);

  if (requiredConfig) {
    let requiredReady: number;
    try {
      requiredReady = await verifyRequiredPluginOutputs(results, requiredConfig);
    } catch (error) {
      // 只有必需模块全部因插件或脚本下载失败（网络错误或 HTTP 5xx）而未就绪时才算上游不可用。
      if (!(error instanceof RequiredPluginOutputError) || !error.upstreamUnavailable) throw error;
      console.error(`上游不可用，必需模块的插件或脚本无法下载: ${getErrorMessage(error)}`);
      process.exit(UPSTREAM_UNAVAILABLE_EXIT_CODE);
    }
    report.required = { config: requiredConfig, ready: requiredReady };
    await writeReportFile(reportPath, report);
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
    process.exit(error instanceof PluginCatalogUnavailableError ? UPSTREAM_UNAVAILABLE_EXIT_CODE : 1);
  });
}
