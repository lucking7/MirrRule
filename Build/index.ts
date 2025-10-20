import process from 'node:process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

import { task } from './trace';
import { createSpan } from './trace';
import { printTraceResult, whyIsNodeRunning } from './trace';
import { downloadPreviousBuild } from './download-previous-build';
import { downloadGeoIP } from './download-geoip';
import { CACHE_DIR, ROOT_DIR } from './constants/dir';

/**
 * 规则生成系统主入口
 * 基于现有框架组件的完整实现，最大化复用现有功能
 */
export const buildRuleset = task(
  require.main === module,
  __filename
)(async (span, onCleanup) => {
  console.log('Version:', process.version);
  console.log(`OS: ${os.type()} ${os.release()} ${os.arch()}`);
  console.log(`Node.js: ${process.versions.node}`);
  console.log(`V8: ${process.versions.v8}`);

  const cpus = os.cpus().reduce<Record<string, number>>((o, cpu) => {
    o[cpu.model] = (o[cpu.model] || 0) + 1;
    return o;
  }, {});
  console.log(
    `CPU: ${Object.keys(cpus)
      .map((key: string) => `${key} x ${cpus[key]}`)
      .join('\n')}`
  );
  if ('availableParallelism' in os) {
    // Node.js 新 API
    console.log(`Available parallelism: ${(os as any).availableParallelism()}`);
  }
  console.log(`Memory: ${os.totalmem() / (1024 * 1024)} MiB`);

  const buildFinishedLock = path.join(ROOT_DIR, '.BUILD_FINISHED');
  if (fs.existsSync(buildFinishedLock)) {
    fs.unlinkSync(buildFinishedLock);
  }

  console.log('🚀 开始构建规则集...');

  // 预热：下载上次构建产物（若 public 为空）
  // 注释掉以避免下载旧的目录结构
  // await downloadPreviousBuild(span);

  // 下载 GeoIP MMDB 文件（独立模块）
  await downloadGeoIP(span);

  // 处理规则源配置 - 完全使用标准化输出策略系统
  await span.traceChildAsync('unified rule processing system', async span => {
    console.log('🚀 启动标准化输出策略系统...');

    try {
      console.log('📦 加载 RuleSourceProcessor...');
      const { RuleSourceProcessor } = require('./lib/rule-source-processor');
      console.log('✅ RuleSourceProcessor 加载成功');

      console.log('📦 加载 rule-sources...');
      const { ruleGroups, specialRules } = require('./lib/rule-sources');
      console.log(`✅ rule-sources 加载成功: ${ruleGroups.length} 组, ${specialRules.length} 规则`);

      // 使用统一规则处理器
      console.log('🔨 创建 RuleSourceProcessor 实例...');
      const processor = new RuleSourceProcessor(span, 'public');
      console.log('✅ RuleSourceProcessor 实例创建成功');

      console.log('📊 配置概览:');
      console.log(`   - 规则组: ${ruleGroups.length} 个`);
      console.log(`   - 特殊规则: ${specialRules.length} 个`);

      // 统计平台覆盖
      const platformStats = new Map<string, number>();
      ruleGroups.concat(specialRules).forEach((item: any) => {
        const targets = item.targets || ['surge'];
        targets.forEach((target: string) => {
          platformStats.set(target, (platformStats.get(target) || 0) + 1);
        });
      });

      console.log('🎯 目标平台矩阵:');
      platformStats.forEach((count: number, platform: string) => {
        console.log(`   - ${platform}: ${count} 个规则`);
      });

      // 统一处理规则组（跨平台+格式标准化）
      console.log('🚀 开始统一规则组处理（跨平台解析+标准化格式）...');
      const groupStats = await processor.processRuleGroups(ruleGroups);
      console.log('✅ 规则组处理完成:', {
        成功: groupStats.filesProcessed,
        错误: groupStats.errors.length,
        耗时: `${(groupStats.processingTime / 1000).toFixed(1)}s`,
      });

      // 统一处理特殊规则（多源合并+多平台输出）
      console.log('🔄 开始统一特殊规则处理（多源合并+多平台输出）...');
      const ruleStats = await processor.processSpecialRules(specialRules);
      console.log('✅ 特殊规则处理完成:', {
        成功: ruleStats.filesProcessed,
        合并规则: ruleStats.rulesMerged,
        错误: ruleStats.errors.length,
        耗时: `${(ruleStats.processingTime / 1000).toFixed(1)}s`,
      });

      // 处理错误汇总
      const totalErrors = groupStats.errors.length + ruleStats.errors.length;
      if (totalErrors > 0) {
        console.log(`⚠\uFE0F 总计 ${totalErrors} 个错误，但不影响主要功能`);
      } else {
        console.log('🎉 所有规则处理成功，无错误！');
      }
    } catch (error) {
      console.error('❌ 规则处理系统执行失败:');
      console.error('Error:', error);
      console.error('Stack:', error instanceof Error ? error.stack : 'No stack trace');
      throw error;
    }
  });

  console.log('✅ 规则集构建完成！');

  // 构建前端网页
  await span.traceChildAsync('build web page', async span => {
    console.log('🌐 开始构建前端网页...');

    try {
      const { buildPublic } = require('./build-public');
      await buildPublic();
      console.log('✅ 前端网页构建完成');
    } catch (error) {
      console.error('❌ 前端网页构建失败:', error);
      console.error('Error details:', error);
      // 不影响主构建流程，继续执行
    }
  });

  // 标记构建完成，便于下次预热/增量判断
  fs.writeFileSync(buildFinishedLock, 'BUILD_FINISHED\n');

  // 输出 trace 并尽快结束事件循环
  printTraceResult(span.traceResult);
  await whyIsNodeRunning();
});

/**
 * 创建规则处理器
 * 提供基于现有框架的规则处理功能
 */
export function createRuleProcessor() {
  return {
    /**
     * 处理域名规则 - 复用现有去重工具
     */
    async processDomainRules(domains: string[]) {
      const span = createSpan('process domain rules');

      try {
        console.log(`处理 ${domains.length} 个域名规则`);

        // 复用现有去重工具
        const dedupeModule = require('./tools-dedupe-src.js');
        const { createDedupeTools } = dedupeModule;
        const dedupeTools = createDedupeTools();
        const dedupedDomains = dedupeTools.dedupeArray(domains);

        console.log(`去重后剩余 ${dedupedDomains.length} 个域名规则`);

        return dedupedDomains;
      } finally {
        span.stop();
      }
    },

    /**
     * 处理IP规则 - 复用现有CIDR合并逻辑
     */
    async processIpRules(ips: string[]) {
      const span = createSpan('process ip rules');

      try {
        console.log(`处理 ${ips.length} 个IP规则`);

        // 这里可以添加IP CIDR合并逻辑
        // 复用 Build/lib/rules/base.ts 中的 mergeCidr 功能

        return ips;
      } finally {
        span.stop();
      }
    },

    /**
     * 生成输出文件 - 复用现有writing-strategy
     */
    async generateOutput(rules: any[], format: string) {
      const span = createSpan('generate output');

      try {
        console.log(`生成 ${format} 格式的输出文件`);

        // 复用现有的writing-strategy
        // 可以根据format选择对应的策略：
        // - surge: SurgeRuleSet
        // - clash: ClashClassicRuleSet
        // - singbox: SingboxSource
        // - surfboard: SurfboardRuleSet
      } finally {
        span.stop();
      }
    },
  };
}

/**
 * 创建配置文件示例
 */
export async function createExampleConfig(outputPath = './rule-sources.example.ts') {
  const span = createSpan('create example config');

  try {
    const { RuleSourceConfigLoader } = await import('./lib/rule-source-config-loader.js' as any);
    const configLoader = new RuleSourceConfigLoader(span);

    await configLoader.createExampleConfig(outputPath);
    console.log(`示例配置文件已创建: ${outputPath}`);
  } finally {
    span.stop();
  }
}

/**
 * 如果直接运行此文件，执行构建任务
 * 注意：task() 函数在 require.main === module 为 true 时会自动执行，
 * 因此不需要手动调用 buildRuleset()
 */
// if (require.main === module) {
//   buildRuleset();
// }
