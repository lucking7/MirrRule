#!/usr/bin/env node

import { RuleProcessor } from './rule-processor.js';
import { RuleConverter } from './rule-converter.js';
import { RuleMerger } from './rule-merger.js';
import { ruleGroups, specialRules, config } from './rule-sources.js';
import { initializeDirectoryStructure } from './utils.js';
import { GeoIPProcessor } from './rule-geoip-processor.js';
import { RejectOptimizer } from './reject-optimizer.js';
import path from 'node:path';
import { RuleFormat } from './rule-types.js';
import { createDownloader, DownloadTask } from './concurrent-downloader.js';
import picocolors from 'picocolors';

async function main() {
  try {
    console.log('Starting rule processing...');

    // 初始化目录结构
    initializeDirectoryStructure(config.repoPath, ruleGroups, specialRules);

    const options = {
      enableNoResolve: false,
      enablePreMatching: false,
      enableExtended: false,
    };

    // 创建规则处理器
    const converter = new RuleConverter('Surge' as RuleFormat);
    converter.setOptions(options);

    const merger = new RuleMerger(config.repoPath, converter);
    const processor = new RuleProcessor(config.repoPath, converter, merger);

    // 创建GeoIP处理器
    const geoipProcessor = new GeoIPProcessor(config.repoPath);

    // 1. 首先收集所有需要下载的任务
    console.log(picocolors.cyan('\n=== 收集下载任务 ==='));
    const downloadTasks: DownloadTask[] = [];

    // 收集所有下载任务
    for (const group of ruleGroups) {
      for (const rule of group.files) {
        if (rule.url) {
          const filePath = path.join(config.repoPath, rule.path);
          downloadTasks.push({
            url: rule.url,
            dest: filePath,
          });
        }
      }
    }

    console.log(`总共需要下载 ${downloadTasks.length} 个文件`);

    // 2. 使用并发下载器批量下载所有文件
    if (downloadTasks.length > 0) {
      console.log(picocolors.cyan('\n=== 开始并发下载 ==='));

      const downloader = createDownloader({
        maxConcurrency: 10, // 提高并发数
        maxRetries: 3,
        timeout: 30000,
        retryDelay: 1000,
        backoffMultiplier: 2,
      });

      // 监听重试事件
      downloader.on('download:retry', ({ task, attempt, delay, error }: any) => {
        console.log(
          picocolors.yellow(
            `[重试 ${attempt}] ${task.url} - 等待 ${delay}ms - 错误: ${error.message}`
          )
        );
      });

      const startTime = Date.now();
      const { results, stats } = await downloader.downloadBatchWithProgress(downloadTasks);

      console.log(picocolors.cyan('\n=== 下载统计 ==='));
      console.log(`总文件数: ${stats.total}`);
      console.log(`成功: ${picocolors.green(stats.successful.toString())}`);
      console.log(`失败: ${picocolors.red(stats.failed.toString())}`);
      console.log(`总耗时: ${(stats.totalDuration / 1000).toFixed(2)}s`);
      console.log(`平均速度: ${(stats.total / (stats.totalDuration / 1000)).toFixed(2)} 文件/秒`);

      // 处理失败的下载
      const failedDownloads = results.filter(r => !r.success);
      if (failedDownloads.length > 0) {
        console.error(picocolors.red('\n下载失败的文件:'));
        for (const failed of failedDownloads) {
          console.error(`- ${failed.url}: ${failed.error?.message}`);
        }
        // 继续处理成功下载的文件，而不是退出
      }
    }

    // 3. 处理已下载的文件（非下载操作）
    console.log(picocolors.cyan('\n=== 处理规则文件 ==='));

    // 使用并发处理规则文件
    const processingTasks: Promise<void>[] = [];

    for (const group of ruleGroups) {
      console.log(`\n处理规则组: ${group.name}`);

      // 收集组内的处理任务
      const groupTasks = group.files.map(async rule => {
        const fileExt = path.extname(rule.path).toLowerCase();

        try {
          if (fileExt === '.mmdb') {
            // GeoIP 文件不需要文本处理，但需要更新
            await geoipProcessor.process(rule);
          } else {
            // 处理规则文件（不再包括下载）
            // 创建一个新的规则副本，不包含 url 以避免重复下载
            const ruleWithoutUrl = { ...rule };
            delete ruleWithoutUrl.url;
            await processor.process(ruleWithoutUrl);
          }
          console.log(picocolors.green(`✓ ${rule.path}`));
        } catch (error) {
          console.error(picocolors.red(`✗ ${rule.path}: ${error}`));
        }
      });

      // 并发执行组内的所有任务
      processingTasks.push(...groupTasks);
    }

    // 等待所有处理任务完成
    await Promise.all(processingTasks);

    // 4. 处理特殊规则（合并操作等）
    console.log(picocolors.cyan('\n=== 处理特殊规则 ==='));

    // 特殊规则通常有依赖关系，所以串行处理
    await processor.processSpecialRules(specialRules);

    // 5. 优化 Reject 规则集
    console.log(picocolors.cyan('\n=== 优化 Reject 规则 ==='));
    const rejectOptimizer = new RejectOptimizer();

    // 设置白名单（参考 Surge-master-2 的 PREDEFINED_WHITELIST）
    const whitelistDomains = [
      // 常见的合法域名
      'google.com',
      'youtube.com',
      'facebook.com',
      'twitter.com',
      'instagram.com',
      'linkedin.com',
      'github.com',
      'stackoverflow.com',
      'wikipedia.org',
      'amazon.com',
      'apple.com',
      'microsoft.com',
      // 添加更多白名单域名...
    ];

    await rejectOptimizer.optimizeRejectRules(config.repoPath, {
      enableTldValidation: false, // reject 规则作为 RulesetOutput，不进行 TLD 验证
      enableDomainMerge: true,
      enableWhitelist: true,
      whitelistDomains,
    });

    console.log(picocolors.green('\n✅ 规则处理完成！'));
  } catch (error) {
    console.error('Rule processing failed:', error);
    process.exit(1);
  }
}

// 执行主函数
main();
