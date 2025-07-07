#!/usr/bin/env tsx

/**
 * 演示增强的 TLD 验证功能
 * 展示如何区分 AdGuard 过滤器和本地规则的不同验证策略
 */

import { EnhancedTldValidator, RuleSource } from '../lib/enhanced-tld-validator.js';
import {
  parseAdGuardFilter,
  fetchAndParseAdGuardFilter,
} from '../lib/parse-filter/adguard-filter.js';
import picocolors from 'picocolors';
import fs from 'node:fs/promises';
import path from 'node:path';

// 测试域名列表
const testDomains = [
  // 正常域名
  'example.com',
  'google.com',
  'baidu.com',

  // 私有后缀域名
  'adtago.s3.amazonaws.com',
  'myapp.github.io',
  'test.vercel.app',

  // 非标准 TLD
  'example.tor',
  'test.onion',
  'internal.dn42',

  // ICP 备案 TLD
  'example.ren',
  'test.wang',

  // 特殊用途 TLD
  'myserver.local',
  'test.localhost',
];

// AdGuard 过滤器示例内容
const adguardFilterContent = `
! 这是一个 AdGuard 过滤器示例
||example.com^
||google.com^
||baidu.com^
||adtago.s3.amazonaws.com^
||myapp.github.io^
||test.vercel.app^
||example.tor^
||test.onion^
||internal.dn42^
||example.ren^
||test.wang^
||myserver.local^
||test.localhost^
`;

async function main() {
  console.log(picocolors.bold('🔍 增强 TLD 验证功能演示\n'));

  const validator = new EnhancedTldValidator();

  // 1. 测试 AdGuard 过滤器模式（严格）
  console.log(picocolors.yellow('📋 测试 1: AdGuard 过滤器（严格模式 - 只接受 ICANN TLD）'));
  console.log('='.repeat(60));

  const adguardResults = validator.validateBatch(testDomains, {
    source: RuleSource.AdGuardFilter,
  });

  for (const [domain, result] of adguardResults) {
    const status = result.valid ? '✅' : '❌';
    const info = result.valid
      ? `ICANN=${result.isIcann}, Private=${result.isPrivate}`
      : result.reason;
    console.log(`${status} ${domain.padEnd(30)} ${picocolors.gray(info || '')}`);
  }

  // 2. 测试本地文件模式（宽松）
  console.log(
    '\n' + picocolors.green('📁 测试 2: 本地规则文件（宽松模式 - 接受 ICANN 和私有后缀）')
  );
  console.log('='.repeat(60));

  const localResults = validator.validateBatch(testDomains, {
    source: RuleSource.LocalFile,
  });

  for (const [domain, result] of localResults) {
    const status = result.valid ? '✅' : '❌';
    const info = result.valid
      ? `ICANN=${result.isIcann}, Private=${result.isPrivate}`
      : result.reason;
    console.log(`${status} ${domain.padEnd(30)} ${picocolors.gray(info || '')}`);
  }

  // 3. 解析 AdGuard 过滤器内容
  console.log('\n' + picocolors.cyan('🎯 测试 3: 解析 AdGuard 过滤器内容'));
  console.log('='.repeat(60));

  const parseResult = parseAdGuardFilter(adguardFilterContent);

  console.log(`黑名单域名: ${parseResult.blackDomains.size}`);
  console.log(`黑名单域名后缀: ${parseResult.blackDomainSuffixes.size}`);
  console.log(`黑名单 IP: ${parseResult.blackIPs.length}`);

  // 显示被过滤的域名（因为使用了私有后缀）
  const filteredDomains = testDomains.filter(domain => {
    const result = validator.validate(domain, { source: RuleSource.AdGuardFilter });
    return !result.valid && result.isPrivate;
  });

  if (filteredDomains.length > 0) {
    console.log('\n' + picocolors.red('🚫 被 AdGuard 过滤器模式过滤的私有后缀域名:'));
    filteredDomains.forEach(domain => {
      console.log(`  - ${domain}`);
    });
  }

  // 4. 对比分析
  console.log('\n' + picocolors.magenta('📊 测试 4: 对比分析'));
  console.log('='.repeat(60));

  console.log('adtago.s3.amazonaws.com 的处理:');
  const adtagoDomain = 'adtago.s3.amazonaws.com';

  const adguardResult = validator.validate(adtagoDomain, { source: RuleSource.AdGuardFilter });
  const localResult = validator.validate(adtagoDomain, { source: RuleSource.LocalFile });

  console.log(
    `  AdGuard 过滤器: ${adguardResult.valid ? '✅ 有效' : '❌ 无效'} - ${
      adguardResult.reason || '通过验证'
    }`
  );
  console.log(
    `  本地规则文件: ${localResult.valid ? '✅ 有效' : '❌ 无效'} - ${
      localResult.reason || '通过验证'
    }`
  );
  console.log(`  Public Suffix: ${adguardResult.publicSuffix}`);
  console.log(`  是 ICANN TLD: ${adguardResult.isIcann}`);
  console.log(`  是私有后缀: ${adguardResult.isPrivate}`);

  // 5. 实际应用示例
  console.log('\n' + picocolors.blue('💡 测试 5: 实际应用示例'));
  console.log('='.repeat(60));

  try {
    // 模拟从 AdGuard 下载 CNAME 追踪器列表
    console.log('正在获取 AdGuard CNAME 追踪器列表...');
    const cnameTrackers = await fetchAndParseAdGuardFilter(
      'https://cdn.jsdelivr.net/gh/AdguardTeam/cname-trackers@master/data/combined_disguised_trackers_justdomains.txt'
    );

    console.log(
      `获取到 ${
        cnameTrackers.blackDomains.size + cnameTrackers.blackDomainSuffixes.size
      } 个追踪器域名`
    );

    // 随机选择几个域名进行验证
    const sampleDomains = Array.from(cnameTrackers.blackDomains).slice(0, 5);
    console.log('\n验证示例追踪器域名:');

    for (const domain of sampleDomains) {
      const result = validator.validate(domain, { source: RuleSource.AdGuardFilter });
      const status = result.valid ? '✅' : '❌';
      console.log(`${status} ${domain.padEnd(40)} ${picocolors.gray(result.reason || 'OK')}`);
    }
  } catch (error) {
    console.error('获取 AdGuard 过滤器失败:', error);
  }

  // 生成总结报告
  console.log('\n' + picocolors.bold('📈 验证报告总结'));
  console.log('='.repeat(60));

  validator.generateReport(adguardResults);
  console.log('\n对于 AdGuard 过滤器（严格模式）:');
  console.log('- 只接受 ICANN 认证的 TLD');
  console.log('- 私有后缀（如 s3.amazonaws.com）会被过滤');

  console.log('\n对于本地规则文件（宽松模式）:');
  console.log('- 接受 ICANN TLD 和私有后缀');
  console.log('- 只过滤非标准 TLD（如 .tor、.onion）');

  console.log('\n' + picocolors.green('✨ 这就是 Surge-master-2 的分级处理策略！'));
}

// 运行演示
main().catch(console.error);
