import { createSpan, printTraceResult } from './trace/index.js';
import { buildCommon } from './scripts/build-common.js';
import { buildMixedRuleset } from './scripts/build-mixed-ruleset.js';
import { validateAllRules } from './scripts/validate-all-rules.js';
import { optimizeAllRules } from './scripts/optimize-all-rules.js';
import picocolors from 'picocolors';
import process from 'node:process';

// 主构建函数
async function main() {
  console.log(picocolors.bold(picocolors.cyan('🚀 开始构建 Esdeath 规则集...')));
  const startTime = Date.now();

  // 创建根 span 用于性能追踪
  const rootSpan = createSpan('root');

  try {
    // 1. 预验证阶段
    console.log(picocolors.yellow('\n📋 步骤 1/5: 预验证规则...'));
    await validateAllRules(rootSpan);

    // 2. 构建阶段（并行执行）
    console.log(picocolors.yellow('\n🏗️  步骤 2/5: 构建规则集...'));
    await Promise.all([
      // 构建通用规则集（从 Source 目录）
      buildCommon(rootSpan),

      // 构建混合规则集（Surge/Rulesets 目录）
      buildMixedRuleset(rootSpan),
    ]);

    // 3. 优化阶段
    console.log(picocolors.yellow('\n⚡ 步骤 3/5: 优化规则...'));
    await optimizeAllRules(rootSpan);

    // 4. 后验证阶段
    console.log(picocolors.yellow('\n✅ 步骤 4/5: 验证输出...'));
    await validateAllRules(rootSpan, { postBuild: true });

    // 5. 生成报告
    console.log(picocolors.yellow('\n📊 步骤 5/5: 生成构建报告...'));

    // 停止性能追踪
    rootSpan.stop();

    // 打印性能分析结果
    console.log('\n📊 性能分析:');
    printTraceResult(rootSpan.traceResult);

    const duration = Date.now() - startTime;
    console.log(picocolors.bold(picocolors.green(`\n✅ 构建完成！耗时: ${duration}ms`)));
  } catch (error) {
    rootSpan.stop();
    console.error(picocolors.red('\n❌ 构建失败:'), error);
    process.exit(1);
  }
}

// 处理未捕获的异常
process.on('uncaughtException', error => {
  console.error(picocolors.red('未捕获的异常:'), error);
  process.exit(1);
});

process.on('unhandledRejection', reason => {
  console.error(picocolors.red('未处理的 Promise 拒绝:'), reason);
  process.exit(1);
});

// 执行主函数
main();
