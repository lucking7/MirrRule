/**
 * 域名去重工具
 * 用于处理规则列表中的域名去重和子域名合并
 */

import { HostnameTrie } from './lib/trie.js';
import { createKeywordFilter } from './lib/keyword-filter.js';
import { normalizeDomain, getParentDomains } from './lib/utils.js';
import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';

interface DedupeOptions {
  /**
   * 是否合并子域名（例如：如果有 example.com，则删除 sub.example.com）
   */
  mergeSubdomains?: boolean;

  /**
   * 是否应用关键词过滤（删除被关键词覆盖的域名）
   */
  applyKeywordFilter?: boolean;

  /**
   * 关键词列表（用于过滤）
   */
  keywords?: string[];

  /**
   * 是否标准化域名（转小写、去除 www 等）
   */
  normalizeDomains?: boolean;

  /**
   * 白名单域名（不会被去重或合并）
   */
  whitelist?: string[];
}

/**
 * 对域名列表进行去重
 */
export function dedupeDomains(domains: string[], options: DedupeOptions = {}): string[] {
  const {
    mergeSubdomains = true,
    applyKeywordFilter = false,
    keywords = [],
    normalizeDomains = true,
    whitelist = [],
  } = options;

  // 第一步：标准化域名
  let processedDomains = domains;
  if (normalizeDomains) {
    processedDomains = processedDomains.map(normalizeDomain);
  }

  // 第二步：基本去重
  processedDomains = [...new Set(processedDomains)];

  // 第三步：创建白名单集合
  const whitelistSet = new Set(whitelist.map(d => (normalizeDomains ? normalizeDomain(d) : d)));

  // 第四步：子域名合并
  if (mergeSubdomains) {
    const trie = new HostnameTrie();

    // 添加所有域名到 Trie
    processedDomains.forEach(domain => {
      if (!whitelistSet.has(domain)) {
        trie.add(domain);
      }
    });

    // 获取去重后的域名
    const deduped = trie.dump();

    // 添加回白名单域名
    processedDomains = [...deduped, ...processedDomains.filter(d => whitelistSet.has(d))];
  }

  // 第五步：关键词过滤
  if (applyKeywordFilter && keywords.length > 0) {
    const filter = createKeywordFilter(keywords);
    processedDomains = processedDomains.filter(domain => {
      // 白名单域名不过滤
      if (whitelistSet.has(domain)) {
        return true;
      }
      // 检查域名是否被关键词覆盖
      return !filter.matches(domain);
    });
  }

  // 第六步：排序
  processedDomains.sort();

  return processedDomains;
}

/**
 * 对文件中的域名进行去重
 */
export async function dedupeDomainsInFile(
  inputFile: string,
  outputFile: string,
  options: DedupeOptions = {}
): Promise<{
  originalCount: number;
  deduplicatedCount: number;
  removedCount: number;
}> {
  // 读取文件
  const content = await readFile(inputFile, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  // 分离域名和非域名行（注释等）
  const domains: string[] = [];
  const nonDomainLines: { line: string; index: number }[] = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed.startsWith('!') || trimmed === '') {
      nonDomainLines.push({ line, index });
    } else {
      // 提取域名（可能有 DOMAIN, DOMAIN-SUFFIX 等前缀）
      const match = trimmed.match(/^(?:DOMAIN(?:-SUFFIX)?|HOST(?:-SUFFIX)?),?(.+)$/i);
      if (match) {
        domains.push(match[1].trim());
      } else {
        domains.push(trimmed);
      }
    }
  });

  const originalCount = domains.length;

  // 去重
  const deduplicatedDomains = dedupeDomains(domains, options);
  const deduplicatedCount = deduplicatedDomains.length;

  // 重建文件内容
  let outputLines: string[] = [];
  let domainIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const nonDomainLine = nonDomainLines.find(ndl => ndl.index === i);
    if (nonDomainLine) {
      outputLines.push(nonDomainLine.line);
    } else if (domainIndex < deduplicatedDomains.length) {
      // 保持原有格式
      const originalLine = lines[i];
      const match = originalLine.match(/^((?:DOMAIN(?:-SUFFIX)?|HOST(?:-SUFFIX)?),?)(.+)$/i);
      if (match) {
        outputLines.push(`${match[1]}${deduplicatedDomains[domainIndex]}`);
      } else {
        outputLines.push(deduplicatedDomains[domainIndex]);
      }
      domainIndex++;
    }
  }

  // 写入文件
  await writeFile(outputFile, outputLines.join('\n'), 'utf-8');

  return {
    originalCount,
    deduplicatedCount,
    removedCount: originalCount - deduplicatedCount,
  };
}

/**
 * CLI 入口
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: tsx tools-dedupe-src.ts <input-file> <output-file> [options]');
    console.error('Options:');
    console.error('  --no-merge-subdomains    不合并子域名');
    console.error('  --keywords <file>        关键词文件路径');
    console.error('  --whitelist <file>       白名单文件路径');
    process.exit(1);
  }

  const [inputFile, outputFile] = args;
  const options: DedupeOptions = {
    mergeSubdomains: !args.includes('--no-merge-subdomains'),
    normalizeDomains: true,
  };

  // 解析选项
  const keywordsIndex = args.indexOf('--keywords');
  if (keywordsIndex !== -1 && args[keywordsIndex + 1]) {
    const keywordsFile = args[keywordsIndex + 1];
    const keywordsContent = await readFile(keywordsFile, 'utf-8');
    options.keywords = keywordsContent.split('\n').filter(k => k.trim());
    options.applyKeywordFilter = true;
  }

  const whitelistIndex = args.indexOf('--whitelist');
  if (whitelistIndex !== -1 && args[whitelistIndex + 1]) {
    const whitelistFile = args[whitelistIndex + 1];
    const whitelistContent = await readFile(whitelistFile, 'utf-8');
    options.whitelist = whitelistContent.split('\n').filter(w => w.trim());
  }

  // 执行去重
  console.log(`去重文件: ${inputFile} -> ${outputFile}`);
  const result = await dedupeDomainsInFile(inputFile, outputFile, options);

  console.log(`原始域名数: ${result.originalCount}`);
  console.log(`去重后域名数: ${result.deduplicatedCount}`);
  console.log(`删除域名数: ${result.removedCount}`);
  console.log(`去重率: ${((result.removedCount / result.originalCount) * 100).toFixed(2)}%`);
}
