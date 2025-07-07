#!/usr/bin/env tsx

import { HostnameSmolTrie } from '../lib/trie.js';
import picocolors from 'picocolors';

console.log(picocolors.bold('🧪 测试优化逻辑\n'));

// 模拟文件内容
const testLines = [
  '# 注释行',
  '',
  'DOMAIN-SUFFIX,cn',
  'DOMAIN-SUFFIX,baidu.cn',
  'DOMAIN-SUFFIX,test.cn',
  'IP-CIDR,1.0.0.0/8',
  'IP-CIDR,2.0.0.0/8',
  'IP-CIDR6,2001::/32',
  'DOMAIN-KEYWORD,test',
  'USER-AGENT,test*',
];

// 分析文件
const analysis = {
  ipv4Cidrs: [] as string[],
  ipv6Cidrs: [] as string[],
  domains: [] as Array<{ domain: string; isSuffix: boolean }>,
  otherLines: [] as string[],
};

for (const line of testLines) {
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

console.log('原始分析:');
console.log('- 域名数:', analysis.domains.length);
console.log('- IPv4数:', analysis.ipv4Cidrs.length);
console.log('- IPv6数:', analysis.ipv6Cidrs.length);
console.log('- 其他行:', analysis.otherLines.length);
console.log(
  '- 原始规则总数:',
  analysis.domains.length + analysis.ipv4Cidrs.length + analysis.ipv6Cidrs.length
);

// 优化域名
const trie = new HostnameSmolTrie();
for (const { domain, isSuffix } of analysis.domains) {
  trie.add(domain, isSuffix);
}

const optimizedDomains: Array<{ domain: string; isSuffix: boolean }> = [];
trie.dump((domain: string, isIncludeSubdomain: boolean) => {
  optimizedDomains.push({ domain, isSuffix: isIncludeSubdomain });
});

console.log('\n优化后:');
console.log('- 域名数:', optimizedDomains.length);
console.log('- 域名详情:', optimizedDomains);

// 重建文件内容（模拟优化脚本的逻辑）
const newLines: string[] = [];
let rulesInserted = false;

for (const line of analysis.otherLines) {
  const trimmed = line.trim();

  // 在第一个非注释行之前插入规则
  if (!rulesInserted && trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('//')) {
    // 插入优化后的域名
    for (const { domain, isSuffix } of optimizedDomains) {
      if (isSuffix) {
        newLines.push(`DOMAIN-SUFFIX,${domain}`);
      } else {
        newLines.push(`DOMAIN,${domain}`);
      }
    }

    // 插入优化后的 IP
    for (const cidr of analysis.ipv4Cidrs) {
      newLines.push(`IP-CIDR,${cidr}`);
    }
    for (const cidr of analysis.ipv6Cidrs) {
      newLines.push(`IP-CIDR6,${cidr}`);
    }

    rulesInserted = true;
  }

  newLines.push(line);
}

// 如果没有插入（文件只有注释），在末尾添加
if (!rulesInserted) {
  for (const { domain, isSuffix } of optimizedDomains) {
    if (isSuffix) {
      newLines.push(`DOMAIN-SUFFIX,${domain}`);
    } else {
      newLines.push(`DOMAIN,${domain}`);
    }
  }

  for (const cidr of analysis.ipv4Cidrs) {
    newLines.push(`IP-CIDR,${cidr}`);
  }
  for (const cidr of analysis.ipv6Cidrs) {
    newLines.push(`IP-CIDR6,${cidr}`);
  }
}

console.log('\n重建后的文件:');
newLines.forEach((line, i) => {
  console.log(`${i + 1}: ${line}`);
});

// 重新统计规则数
let finalDomainCount = 0;
let finalIpCount = 0;
let finalOtherCount = 0;

for (const line of newLines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
    continue;
  }

  if (trimmed.startsWith('DOMAIN,') || trimmed.startsWith('DOMAIN-SUFFIX,')) {
    finalDomainCount++;
  } else if (trimmed.startsWith('IP-CIDR,') || trimmed.startsWith('IP-CIDR6,')) {
    finalIpCount++;
  } else {
    finalOtherCount++;
  }
}

console.log('\n最终统计:');
console.log('- 域名规则:', finalDomainCount);
console.log('- IP规则:', finalIpCount);
console.log('- 其他规则:', finalOtherCount);
console.log('- 总规则数:', finalDomainCount + finalIpCount + finalOtherCount);
console.log(
  '- 优化前总规则数:',
  analysis.domains.length + analysis.ipv4Cidrs.length + analysis.ipv6Cidrs.length
);
console.log(
  '- 变化:',
  finalDomainCount +
    finalIpCount +
    finalOtherCount -
    (analysis.domains.length + analysis.ipv4Cidrs.length + analysis.ipv6Cidrs.length)
);
