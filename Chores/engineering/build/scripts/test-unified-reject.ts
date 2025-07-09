#!/usr/bin/env node

import { buildRejectDomainSet } from './build-reject-domainset.js';
import { createSpan } from '../trace/index.js';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import picocolors from 'picocolors';

async function testUnifiedReject() {
  console.log(picocolors.bold(picocolors.cyan('🧪 测试统一的 Reject 规则构建...')));

  const rootSpan = createSpan('test-unified-reject');

  try {
    // 备份原文件（如果存在）
    const outputPath = path.resolve('..', '..', 'Surge', 'Rulesets', 'reject', 'block.list');
    const backupPath = outputPath + '.backup';

    if (
      await fs
        .access(outputPath)
        .then(() => true)
        .catch(() => false)
    ) {
      await fs.copyFile(outputPath, backupPath);
      console.log(picocolors.gray(`✅ 已备份原文件到: ${backupPath}`));
    }

    // 执行构建
    await buildRejectDomainSet(rootSpan);

    // 检查输出文件
    const content = await fs.readFile(outputPath, 'utf-8');
    const lines = content.split('\n');
    const headers = lines.filter(line => line.startsWith('#'));
    const rules = lines.filter(line => line && !line.startsWith('#'));

    console.log('\n📊 构建结果分析:');
    console.log(`  - 头部行数: ${headers.length}`);
    console.log(`  - 规则行数: ${rules.length}`);

    // 检查是否包含各种数据源的标记
    const hasAdGuard = headers.some(h => h.includes('AdGuard'));
    const hasConnersHua = headers.some(h => h.includes('ConnersHua'));
    const hasTGTwilight = headers.some(h => h.includes('TG-Twilight'));

    console.log('\n✅ 数据源验证:');
    console.log(`  - AdGuard Filters: ${hasAdGuard ? '✓' : '✗'}`);
    console.log(`  - ConnersHua RuleGo: ${hasConnersHua ? '✓' : '✗'}`);
    console.log(`  - TG-Twilight: ${hasTGTwilight ? '✓' : '✗'}`);

    // 统计规则类型
    const domainRules = rules.filter(r => r.startsWith('DOMAIN,'));
    const domainSuffixRules = rules.filter(r => r.startsWith('DOMAIN-SUFFIX,'));

    console.log('\n📈 规则类型统计:');
    console.log(`  - DOMAIN 规则: ${domainRules.length}`);
    console.log(`  - DOMAIN-SUFFIX 规则: ${domainSuffixRules.length}`);

    // 检查一些已知的广告域名
    const knownAdDomains = [
      'doubleclick.net',
      'googlesyndication.com',
      'googletagmanager.com',
      'google-analytics.com',
      'facebook.com/tr',
    ];

    console.log('\n🎯 已知广告域名检测:');
    for (const domain of knownAdDomains) {
      const found = rules.some(r => r.includes(domain));
      console.log(`  - ${domain}: ${found ? '✓' : '✗'}`);
    }

    console.log(picocolors.green('\n✅ 测试完成！'));
  } catch (error) {
    console.error(picocolors.red('❌ 测试失败:'), error);
    process.exit(1);
  } finally {
    rootSpan.stop();
  }
}

// 执行测试
testUnifiedReject();
