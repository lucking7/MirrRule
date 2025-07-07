#!/usr/bin/env tsx

import fs from 'node:fs/promises';
import path from 'node:path';
import { HostnameSmolTrie } from '../lib/trie.js';
import picocolors from 'picocolors';
import { REPO_PATH } from '../sync/rule-sources.js';

console.log(picocolors.bold('🔍 分析 cn-max_bm7.list 优化问题\n'));

async function analyze() {
  const filePath = path.join(REPO_PATH, 'Surge/Rulesets/domestic/cn-max_bm7.list');
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split('\n');

  // 收集域名规则
  const domainSuffixes: string[] = [];
  const otherRules: string[] = [];
  let ipCidrCount = 0;
  let ipCidr6Count = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
      continue;
    }

    if (trimmed.startsWith('DOMAIN-SUFFIX,')) {
      const domain = trimmed.substring(14);
      domainSuffixes.push(domain);
    } else if (trimmed.startsWith('IP-CIDR,')) {
      ipCidrCount++;
    } else if (trimmed.startsWith('IP-CIDR6,')) {
      ipCidr6Count++;
    } else {
      otherRules.push(trimmed);
    }
  }

  console.log('原始统计:');
  console.log('- DOMAIN-SUFFIX 规则:', domainSuffixes.length);
  console.log('- IP-CIDR 规则:', ipCidrCount);
  console.log('- IP-CIDR6 规则:', ipCidr6Count);
  console.log('- 其他规则:', otherRules.length);
  console.log('- 总计:', domainSuffixes.length + ipCidrCount + ipCidr6Count + otherRules.length);

  // 分析域名
  console.log('\n域名分析:');

  // 查找顶级域名
  const tlds = domainSuffixes.filter(d => !d.includes('.'));
  console.log('\n顶级域名:', tlds);

  // 查找被顶级域名覆盖的子域名
  const coveredByCn = domainSuffixes.filter(d => d.endsWith('.cn') && d !== 'cn');
  console.log('\n被 .cn 覆盖的子域名数量:', coveredByCn.length);
  console.log('示例:', coveredByCn.slice(0, 5));

  // 使用 HostnameSmolTrie 优化
  console.log('\n' + picocolors.cyan('=== 使用 HostnameSmolTrie 优化 ==='));
  const trie = new HostnameSmolTrie();

  // 添加所有域名
  for (const domain of domainSuffixes) {
    trie.add(domain, true); // 全部作为后缀域名
  }

  // 获取优化后的结果
  const optimizedDomains: string[] = [];
  trie.dump((domain, isIncludeSubdomain) => {
    if (isIncludeSubdomain) {
      optimizedDomains.push(domain);
    }
  });

  console.log('\n优化前域名数:', domainSuffixes.length);
  console.log('优化后域名数:', optimizedDomains.length);
  console.log('减少数量:', domainSuffixes.length - optimizedDomains.length);

  // 分析新增的域名
  const originalSet = new Set(domainSuffixes);
  const newDomains = optimizedDomains.filter(d => !originalSet.has(d));

  if (newDomains.length > 0) {
    console.log('\n' + picocolors.red('⚠️  发现新增域名:'), newDomains.length);
    console.log('新增域名示例:', newDomains.slice(0, 10));
  }

  // 分析消失的域名
  const optimizedSet = new Set(optimizedDomains);
  const removedDomains = domainSuffixes.filter(d => !optimizedSet.has(d));

  if (removedDomains.length > 0) {
    console.log('\n' + picocolors.green('✅ 被优化掉的域名:'), removedDomains.length);
    console.log('示例:', removedDomains.slice(0, 10));
  }

  // 计算最终规则数
  const finalRuleCount = optimizedDomains.length + ipCidrCount + ipCidr6Count + otherRules.length;
  console.log('\n' + picocolors.bold('最终统计:'));
  console.log('- 优化后 DOMAIN-SUFFIX:', optimizedDomains.length);
  console.log('- IP-CIDR:', ipCidrCount);
  console.log('- IP-CIDR6:', ipCidr6Count);
  console.log('- 其他规则:', otherRules.length);
  console.log('- 总计:', finalRuleCount);
  console.log(
    '- 变化:',
    finalRuleCount - (domainSuffixes.length + ipCidrCount + ipCidr6Count + otherRules.length)
  );

  // 模拟优化脚本的逻辑
  console.log('\n' + picocolors.cyan('=== 模拟优化脚本逻辑 ==='));

  // 重新解析文件，按照优化脚本的方式
  const analysis = {
    ipv4Cidrs: [] as string[],
    ipv6Cidrs: [] as string[],
    domains: [] as Array<{ domain: string; isSuffix: boolean }>,
    otherLines: [] as string[],
    hasIp: false,
    hasDomain: false,
    ipCount: 0,
    domainCount: 0,
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
      analysis.otherLines.push(line);
      continue;
    }

    if (trimmed.startsWith('IP-CIDR,')) {
      const cidr = trimmed.substring(8).split(',')[0];
      analysis.ipv4Cidrs.push(cidr);
    } else if (trimmed.startsWith('IP-CIDR6,')) {
      const cidr = trimmed.substring(9).split(',')[0];
      analysis.ipv6Cidrs.push(cidr);
    } else if (trimmed.startsWith('DOMAIN,')) {
      const domain = trimmed.substring(7);
      analysis.domains.push({ domain, isSuffix: false });
    } else if (trimmed.startsWith('DOMAIN-SUFFIX,')) {
      const domain = trimmed.substring(14);
      analysis.domains.push({ domain, isSuffix: true });
    } else {
      analysis.otherLines.push(line);
    }
  }

  analysis.hasIp = analysis.ipv4Cidrs.length > 0 || analysis.ipv6Cidrs.length > 0;
  analysis.hasDomain = analysis.domains.length > 0;
  analysis.ipCount = analysis.ipv4Cidrs.length + analysis.ipv6Cidrs.length;
  analysis.domainCount = analysis.domains.length;

  console.log('\n按优化脚本方式统计:');
  console.log('- 域名规则数:', analysis.domainCount);
  console.log('- IP规则数:', analysis.ipCount);
  console.log('- 其他行数:', analysis.otherLines.length);
  console.log('- 原始总计:', analysis.domainCount + analysis.ipCount);

  // 模拟域名优化
  const trie2 = new HostnameSmolTrie();
  for (const { domain, isSuffix } of analysis.domains) {
    trie2.add(domain, isSuffix);
  }

  const optimizedDomains2: Array<{ domain: string; isSuffix: boolean }> = [];
  trie2.dump((domain: string, isIncludeSubdomain: boolean) => {
    optimizedDomains2.push({ domain, isSuffix: isIncludeSubdomain });
  });

  console.log('\n优化后:');
  console.log('- 域名规则数:', optimizedDomains2.length);
  console.log('- IP规则数:', analysis.ipCount, '(不变)');
  console.log('- 优化后总计:', optimizedDomains2.length + analysis.ipCount);
  console.log(
    '- 变化:',
    optimizedDomains2.length + analysis.ipCount - (analysis.domainCount + analysis.ipCount)
  );
}

analyze().catch(err => {
  console.error(picocolors.red('❌ 错误:'), err);
  process.exit(1);
});
