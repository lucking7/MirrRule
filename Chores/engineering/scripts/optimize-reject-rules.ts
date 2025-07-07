import { HostnameSmolTrie } from '../lib/trie.js';
import { readFileByLine } from '../lib/fetch-text-by-line.js';
import path from 'node:path';
import fsp from 'node:fs/promises';

// Surge 规则目录
const SURGE_DIR = path.join(process.cwd(), 'Surge', 'Rulesets', 'reject');

async function optimizeRejectList(filePath: string, outputPath: string) {
  console.log(`\n🔄 正在优化: ${path.basename(filePath)}`);

  const trie = new HostnameSmolTrie();
  const otherRules: string[] = [];
  let originalCount = 0;

  // 读取并解析规则
  for await (const line of readFileByLine(filePath)) {
    originalCount++;

    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      otherRules.push(line);
      continue;
    }

    // 处理不同格式的域名规则
    if (trimmed.startsWith('.')) {
      // .example.com 格式
      trie.add(trimmed);
    } else if (!trimmed.includes(',') && !trimmed.includes(' ')) {
      // 纯域名格式
      trie.add(trimmed);
    } else {
      // 其他格式（如 IP-CIDR 等）
      otherRules.push(line);
    }
  }

  // 获取优化后的域名列表
  const optimizedDomains = trie.dump();

  // 生成优化后的内容
  const result: string[] = [];

  // 添加头部注释
  result.push('# Optimized by Trie Tree');
  result.push(`# Original: ${originalCount} lines`);
  result.push(`# Optimized: ${optimizedDomains.length + otherRules.length} lines`);
  result.push(
    `# Reduction: ${(
      (1 - (optimizedDomains.length + otherRules.length) / originalCount) *
      100
    ).toFixed(2)}%`
  );
  result.push('');

  // 添加其他规则（保持原始顺序）
  for (const rule of otherRules) {
    if (rule.trim() && !rule.startsWith('#')) {
      result.push(rule);
    }
  }

  // 添加优化后的域名
  for (const domain of optimizedDomains) {
    result.push(domain);
  }

  // 写入文件
  await fsp.writeFile(outputPath, result.join('\n'));

  console.log(`✅ 优化完成:`);
  console.log(`   - 原始规则数: ${originalCount}`);
  console.log(
    `   - 优化后规则数: ${
      optimizedDomains.length + otherRules.filter(r => r.trim() && !r.startsWith('#')).length
    }`
  );
  console.log(`   - 域名数: ${optimizedDomains.length}`);
  console.log(`   - 其他规则数: ${otherRules.filter(r => r.trim() && !r.startsWith('#')).length}`);
}

async function main() {
  console.log('🚀 开始优化 reject 规则集...\n');

  const files = [
    { input: 'reject-Loon.list', output: 'reject-Loon-optimized.list' },
    { input: 'reject-QX.list', output: 'reject-QX-optimized.list' },
    { input: 'block.list', output: 'block-optimized.list' },
  ];

  for (const file of files) {
    const inputPath = path.join(SURGE_DIR, file.input);
    const outputPath = path.join(SURGE_DIR, file.output);

    try {
      await optimizeRejectList(inputPath, outputPath);
    } catch (error) {
      console.error(`❌ 处理 ${file.input} 时出错:`, error);
    }
  }

  console.log('\n✨ 所有文件优化完成！');
}

// 运行脚本
main().catch(console.error);
