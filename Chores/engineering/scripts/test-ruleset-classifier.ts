#!/usr/bin/env tsx

/**
 * 测试规则集分类器
 * 用于验证 RulesetClassifier 是否能正确分类不同类型的规则集
 */

import { RulesetClassifier, RulesetType } from '../build/lib/ruleset-classifier.js';
import picocolors from 'picocolors';
import path from 'node:path';
import { promises as fs } from 'node:fs';

async function createTestFiles() {
  const testDir = path.resolve('.test-rulesets');

  // 创建测试目录
  await fs.mkdir(testDir, { recursive: true });

  // 创建纯域名规则集（DOMAIN-SET 格式）
  const domainRules = [
    '# Pure Domain Set (DOMAIN-SET format)',
    'example.com',
    'google.com',
    '.facebook.com', // 匹配 facebook.com 及所有子域
    'twitter.com',
    'apple.com',
    '.microsoft.com',
    'github.com',
    'youtube.com',
    'amazon.com',
    '192.168.1.1', // 也支持 IP 地址
  ].join('\n');

  await fs.writeFile(path.join(testDir, 'domain-only.list'), domainRules);

  // 创建混合域名规则集（传统 Surge 格式）
  const mixedDomainRules = [
    '# Mixed Domain Rules (Surge format)',
    'DOMAIN,example.com',
    'DOMAIN-SUFFIX,google.com',
    'DOMAIN-KEYWORD,facebook',
    'DOMAIN,apple.com',
    'DOMAIN-SUFFIX,microsoft.com',
  ].join('\n');

  await fs.writeFile(path.join(testDir, 'mixed-domain.list'), mixedDomainRules);

  // 创建纯IP规则集
  const ipRules = [
    '# IP Ruleset Test',
    'IP-CIDR,192.168.0.0/16',
    'IP-CIDR,10.0.0.0/8',
    'IP-CIDR6,2001:db8::/32',
    'IP-ASN,13335',
    'GEOIP,CN',
    'IP-CIDR,172.16.0.0/12',
    'IP-ASN,32934',
    'IP-CIDR6,fe80::/10',
  ].join('\n');

  await fs.writeFile(path.join(testDir, 'ip-only.list'), ipRules);

  // 创建混合规则集
  const mixedRules = [
    '# Mixed Ruleset Test',
    'DOMAIN,example.com',
    'IP-CIDR,192.168.1.0/24',
    'DOMAIN-SUFFIX,google.com',
    'USER-AGENT,Mozilla*',
    'IP-CIDR6,2001:db8::/32',
    'DOMAIN-KEYWORD,facebook',
    'PROCESS-NAME,telegram',
    'DEST-PORT,443',
    'IP-ASN,13335',
    'URL-REGEX,^https?://ads\\.',
  ].join('\n');

  await fs.writeFile(path.join(testDir, 'mixed.list'), mixedRules);

  // 创建边界情况（94%域名，接近阈值）
  const boundaryRules = [];
  for (let i = 0; i < 94; i++) {
    boundaryRules.push(`DOMAIN,example${i}.com`);
  }
  for (let i = 0; i < 6; i++) {
    boundaryRules.push(`IP-CIDR,192.168.${i}.0/24`);
  }

  await fs.writeFile(path.join(testDir, 'boundary.list'), boundaryRules.join('\n'));

  return testDir;
}

async function testSingleFile(filePath: string) {
  const filename = path.basename(filePath);
  console.log(picocolors.cyan(`\n测试文件: ${filename}`));

  const result = await RulesetClassifier.classifyFile(filePath);

  console.log(`类型: ${picocolors.bold(result.type)}`);
  console.log(`置信度: ${picocolors.yellow((result.confidence * 100).toFixed(1) + '%')}`);
  console.log('统计信息:');
  console.log(`  - 域名规则: ${result.stats.domains}`);
  console.log(`  - IP规则: ${result.stats.ips}`);
  console.log(`  - 其他规则: ${result.stats.other}`);
  console.log(`  - 总计: ${result.stats.total}`);

  // 验证分类结果
  const expected =
    filename === 'domain-only.list'
      ? RulesetType.DOMAIN
      : filename === 'ip-only.list'
      ? RulesetType.IP
      : RulesetType.MIXED; // 其他都应该是混合规则集

  if (result.type === expected) {
    console.log(picocolors.green('✅ 分类正确'));
  } else {
    console.log(picocolors.red(`❌ 分类错误，期望: ${expected}`));
  }
}

async function main() {
  console.log(picocolors.bold(picocolors.blue('🧪 规则集分类器测试')));

  try {
    // 创建测试文件
    console.log('\n创建测试文件...');
    const testDir = await createTestFiles();

    // 测试单个文件
    console.log(picocolors.yellow('\n=== 单文件测试 ==='));
    const testFiles = await fs.readdir(testDir);

    for (const file of testFiles) {
      if (file.endsWith('.list')) {
        await testSingleFile(path.join(testDir, file));
      }
    }

    // 测试目录批量分析
    console.log(picocolors.yellow('\n\n=== 目录批量分析测试 ==='));
    await RulesetClassifier.classifyDirectory(testDir);

    // 测试真实规则集
    const realRulesetDir = path.resolve('Surge/Rulesets');
    if (
      await fs
        .access(realRulesetDir)
        .then(() => true)
        .catch(() => false)
    ) {
      console.log(picocolors.yellow('\n\n=== 真实规则集分析 ==='));
      console.log(`分析目录: ${realRulesetDir}`);
      await RulesetClassifier.classifyDirectory(realRulesetDir);
    }

    // 清理测试文件
    console.log('\n清理测试文件...');
    await fs.rm(testDir, { recursive: true, force: true });

    console.log(picocolors.green('\n✅ 测试完成！'));
  } catch (error) {
    console.error(picocolors.red('\n❌ 测试失败:'), error);
    process.exit(1);
  }
}

main();
