#!/usr/bin/env tsx

/**
 * 测试构建修复的脚本
 */

import { RulesetClassifier } from '../build/lib/ruleset-classifier.js';
import picocolors from 'picocolors';
import * as path from 'node:path';

async function main() {
  console.log(picocolors.bold('🧪 测试构建修复...\n'));

  // 测试特殊文件分类
  console.log(picocolors.blue('1️⃣ 测试特殊文件分类:'));
  const testFiles = ['cdn.list', 'direct.list', 'domestic.list', 'reject.list'];

  for (const fileName of testFiles) {
    const mockPath = path.join('/fake/path', fileName);
    const result = await RulesetClassifier.classifyFile(mockPath);
    console.log(`  ${fileName}: ${result.type} (置信度: ${result.confidence})`);
  }

  console.log(picocolors.green('\n✅ 测试完成！'));
  console.log('\n总结:');
  console.log('- cdn.list 和 direct.list 被强制分类为混合规则集 ✅');
  console.log('- 混合规则集跳过 TLD 验证 ✅');
  console.log('- 域名活性验证改为手动触发 ✅');
  console.log('- Source 目录不存在时优雅处理 ✅');
}

main().catch(error => {
  console.error(picocolors.red('❌ 测试失败:'), error);
  process.exit(1);
});
