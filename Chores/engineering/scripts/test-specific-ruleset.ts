#!/usr/bin/env tsx

/**
 * 测试特定规则集的分类
 */

import { RulesetClassifier } from '../build/lib/ruleset-classifier.js';
import picocolors from 'picocolors';

async function main() {
  const testFile = process.argv[2] || 'Surge/Rulesets/domestic/cn-max_bm7.list';

  console.log(picocolors.bold(picocolors.cyan(`🔍 测试规则集分类: ${testFile}\n`)));

  try {
    const result = await RulesetClassifier.classifyFile(testFile);

    console.log(`📁 文件: ${testFile}`);
    console.log(`🏷️  类型: ${picocolors.bold(result.type)}`);
    console.log(`📊 置信度: ${picocolors.yellow((result.confidence * 100).toFixed(1) + '%')}`);
    console.log('\n📈 统计信息:');
    console.log(
      `  - 纯域名行: ${result.stats.domains} (${(
        (result.stats.domains / result.stats.total) *
        100
      ).toFixed(1)}%)`
    );
    console.log(
      `  - IP规则: ${result.stats.ips} (${((result.stats.ips / result.stats.total) * 100).toFixed(
        1
      )}%)`
    );
    console.log(
      `  - 其他规则: ${result.stats.other} (${(
        (result.stats.other / result.stats.total) *
        100
      ).toFixed(1)}%)`
    );
    console.log(`  - 总计: ${result.stats.total}`);

    console.log('\n💡 说明:');
    if (result.type === 'mixed') {
      console.log(
        '  这是一个混合规则集，因为它包含了带前缀的规则（如 DOMAIN-SUFFIX, USER-AGENT 等）'
      );
    } else if (result.type === 'domain') {
      console.log('  这是一个纯域名规则集（DOMAIN-SET 格式），每行只有域名或 .域名');
    } else if (result.type === 'ip') {
      console.log('  这是一个纯 IP 规则集，主要包含 IP-CIDR、GEOIP 等规则');
    }
  } catch (error) {
    console.error(picocolors.red('错误:'), error);
    process.exit(1);
  }
}

main();
