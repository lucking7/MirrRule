// 工具函数
import fs from 'node:fs';
import path from 'node:path';
import { RuleStats, RuleGroup, SpecialRuleConfig } from './rule-types.js';
import { RuleConverter } from './rule-converter.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * 检查字符串是否为URL
 * @param str - 要检查的字符串
 * @returns 是否为URL
 */
export function isUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 直接从URL获取内容
 * @param url - 要获取内容的URL
 * @returns 获取的内容或null(如果失败)
 */
export async function fetchContent(url: string): Promise<string | null> {
  try {
    console.log(`直接获取URL内容: ${url}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'script-hub/1.0.0',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP错误！状态: ${response.status}, URL: ${url}`);
    }

    return await response.text();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`获取URL内容失败: ${url} - ${errorMessage}`);
    return null;
  }
}

/**
 * 下载文件
 * @param url - 下载URL
 * @param dest - 目标路径
 * @returns 下载是否成功
 */
export async function downloadFile(url: string, dest: string): Promise<boolean> {
  try {
    console.log(`Downloading ${url} to ${dest}`);

    // 使用原生 fetch API (Node.js 18+)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'script-hub/1.0.0',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP错误！状态: ${response.status}, URL: ${url}`);
    }

    const buffer = await response.arrayBuffer();
    await fs.promises.writeFile(dest, Buffer.from(buffer));
    console.log(`Downloaded: ${url}`);
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Download failed: ${url} - ${errorMessage}`);
    return false;
  }
}

/**
 * 确保目录存在
 * @param dirPath - 目录路径
 */
export function ensureDirectoryExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`Created directory: ${dirPath}`);
  }
}

/**
 * 获取规则统计信息
 * @param content - 规则内容
 * @returns - 规则统计
 */
export function getRuleStats(content: string | Buffer): RuleStats {
  const contentStr = Buffer.isBuffer(content) ? content.toString('utf-8') : String(content);

  const stats: RuleStats = {
    total: 0,
    // 域名类规则统计
    domain: 0,
    domainSuffix: 0,
    domainKeyword: 0,
    domainSet: 0,

    // IP 类规则统计
    ipCidr: 0,
    ipCidr6: 0,
    ipAsn: 0,
    ipSuffix: 0,

    // GEO 类规则统计
    geoip: 0,
    geosite: 0,

    // 进程类规则统计
    processName: 0,
    processPath: 0,

    // 端口类规则统计
    destPort: 0,
    srcPort: 0,

    // 协议类规则统计
    protocol: 0,
    network: 0,

    // HTTP 类规则统计
    ruleSet: 0,
    urlRegex: 0,
    userAgent: 0,
    header: 0,

    // 其他规则统计
    other: 0,
  };

  const lines = contentStr
    .split('\n')
    .filter(
      line =>
        line.trim() && !line.startsWith('#') && !line.startsWith(';') && !line.startsWith('//')
    );
  stats.total = lines.length;

  lines.forEach(line => {
    const type = line.split(',')[0]?.trim().toUpperCase();
    switch (type) {
      // 域名类规则
      case 'DOMAIN':
        stats.domain++;
        break;
      case 'DOMAIN-SUFFIX':
        stats.domainSuffix++;
        break;
      case 'DOMAIN-KEYWORD':
        stats.domainKeyword++;
        break;
      case 'DOMAIN-SET':
        stats.domainSet++;
        break;

      // IP 类规则
      case 'IP-CIDR':
        stats.ipCidr++;
        break;
      case 'IP-CIDR6':
        stats.ipCidr6++;
        break;
      case 'IP-ASN':
        stats.ipAsn++;
        break;

      // GEO 类规则
      case 'GEOIP':
        stats.geoip++;
        break;
      case 'GEOSITE':
        stats.geosite++;
        break;

      // 进程类规则
      case 'PROCESS-NAME':
        stats.processName++;
        break;
      case 'PROCESS-PATH':
        stats.processPath++;
        break;

      // 端口类规则
      case 'DEST-PORT':
      case 'DST-PORT':
        stats.destPort++;
        break;
      case 'SRC-PORT':
        stats.srcPort++;
        break;

      // 协议类规则
      case 'PROTOCOL':
        stats.protocol++;
        break;
      case 'NETWORK':
        stats.network++;
        break;

      // HTTP 类规则
      case 'RULE-SET':
        stats.ruleSet++;
        break;
      case 'URL-REGEX':
        stats.urlRegex++;
        break;
      case 'USER-AGENT':
        stats.userAgent++;
        break;
      case 'HEADER':
        stats.header++;
        break;

      default:
        stats.other++;
    }
  });

  return stats;
}

/**
 * Clean and sort rules
 * @param content - The content to clean and sort
 * @param converter - The rule converter
 * @param cleanup - Whether to perform cleanup and sorting
 * @param keepInlineComments - Whether to keep inline comments (default: true)
 * @returns - Cleaned and sorted content
 */
export function cleanAndSort(
  content: string,
  converter: RuleConverter,
  cleanup: boolean = false,
  keepInlineComments: boolean = true
): string {
  // 始终对每一行应用转换器，由转换器根据 cleanup 参数处理注释
  const convertedLines = content.split('\n').map(line => converter.convert(line, cleanup));

  if (!cleanup) {
    // 如果不清理，我们只对转换后的内容去重（保留注释）
    return dedupRules(convertedLines.join('\n'));
  }

  // 如果清理，则过滤空行、去重并排序
  let processedLines = convertedLines.map(line => line.trim()).filter(line => line); // 过滤掉因移除注释而产生的空行

  if (!keepInlineComments) {
    // 如果不保留行内注释，则移除行内注释部分
    // 注意：这里的实现很简单，可能不适用于所有注释类型
    processedLines = processedLines.map(line => {
      const commentIndex = line.indexOf('//');
      return commentIndex >= 0 ? line.substring(0, commentIndex).trim() : line;
    });
  }

  // 去重并排序
  return [...new Set(processedLines)].sort().join('\n');
}

export function dedupRules(content: string): string {
  const lines = content.split('\n');
  const uniqueLines = new Set();
  return lines
    .filter(line => {
      if (!line.trim() || line.startsWith('#') || line.startsWith(';') || line.startsWith('//'))
        return true;
      if (uniqueLines.has(line)) return false;
      uniqueLines.add(line);
      return true;
    })
    .join('\n');
}

/**
 * 验证规则
 * @param rule - 规则
 * @returns - 是否有效
 */
export function validateRule(rule: string): boolean {
  const validRuleTypes = [
    'DOMAIN',
    'DOMAIN-SUFFIX',
    'DOMAIN-KEYWORD',
    'IP-CIDR',
    'IP-CIDR6',
    'GEOIP',
    'URL-REGEX',
    'USER-AGENT',
    'IP-ASN',
    'AND',
    'OR',
    'NOT',
  ];

  const type = rule.split(',')[0]?.trim().toUpperCase();
  return validRuleTypes.includes(type);
}

/**
 * 初始化目录结构
 * @param repoPath - 仓库路径
 * @param ruleGroups - 规则组
 * @param specialRules - 特殊规则
 */
export function initializeDirectoryStructure(
  repoPath: string,
  ruleGroups: RuleGroup[],
  specialRules: SpecialRuleConfig[]
): void {
  // 从常规规则组收集目录
  const groupDirs = ruleGroups.flatMap(group => group.files.map(file => path.dirname(file.path)));

  // 从特殊规则收集目录
  const specialDirs = specialRules.map(rule => path.dirname(rule.targetFile));

  // 合并所有目录并去重
  const allDirs = [...new Set([...groupDirs, ...specialDirs])];

  // 创建目录
  for (const dir of allDirs) {
    const fullPath = path.join(repoPath, dir);
    ensureDirectoryExists(fullPath);
  }
}

/**
 * 生成无解析版本
 * @param content - 规则内容
 * @returns - 无解析版本
 */
export function generateNoResolveVersion(content: string): string {
  return content
    .split('\n')
    .map(line => {
      // 跳过注释行和空行
      if (!line.trim() || line.startsWith('#') || line.startsWith(';') || line.startsWith('//')) {
        return line;
      }

      const parts = line.split(',');
      const ruleType = parts[0]?.trim().toUpperCase();

      // 已经有no-resolve参数的规则不再添加
      if (line.includes(',no-resolve')) {
        return line;
      }

      // 对所有IP-CIDR和IP-CIDR6规则添加no-resolve参数
      if (
        ruleType === 'IP-CIDR' ||
        ruleType === 'IP-CIDR6' ||
        ruleType === 'IP-ASN' ||
        ruleType === 'GEOIP'
      ) {
        return `${line},no-resolve`;
      }

      // 对带有策略的规则也添加no-resolve参数
      if (line.includes(',PROXY') || line.includes(',DIRECT') || line.includes(',REJECT')) {
        // 检查规则是否需要添加no-resolve（针对IP类规则，其他类型不需要）
        if (
          ruleType === 'DOMAIN' ||
          ruleType === 'DOMAIN-SUFFIX' ||
          ruleType === 'DOMAIN-KEYWORD'
        ) {
          // 域名类规则不需要添加no-resolve
          return line;
        }
        return `${line},no-resolve`;
      }

      return line;
    })
    .join('\n');
}

/**
 * 从规则内容中移除所有的no-resolve参数
 * @param content 规则内容
 * @returns 移除no-resolve参数后的规则内容
 */
export function removeNoResolveFromRules(content: string): string {
  return content
    .split('\n')
    .map(line => {
      // Skip comment lines
      if (!line.trim() || line.startsWith('#') || line.startsWith(';')) {
        return line;
      }
      // Remove no-resolve
      if (line.includes(',no-resolve')) {
        return line.replace(',no-resolve', '');
      }
      return line;
    })
    .join('\n');
}

export interface HeaderInfo {
  title?: string | undefined;
  description?: string | undefined;
  url?: string | undefined;
}

/**
 * 添加规则文件头部注释
 * @param content - 规则内容
 * @param info - 头部信息
 * @param sourceUrls - 源文件URLs（用于合并规则）
 */
export function addRuleHeader(
  content: string | Buffer,
  info?: HeaderInfo,
  sourceUrls?: string[]
): string {
  const contentStr = Buffer.isBuffer(content) ? content.toString('utf-8') : String(content);

  const stats = getRuleStats(contentStr);
  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  // 收集所有有效的 URLs 并去重
  const sources = [
    ...new Set(
      [
        info?.url, // 单个规则的 URL
        ...(sourceUrls || []), // 合并规则的源文件 URLs
      ].filter(Boolean)
    ),
  ];

  const headers = [
    '',
    info?.title && `// ${info.title}`,
    `// Last updated: ${timestamp}`,

    // 域名类规则
    stats.domain > 0 && `// DOMAIN: ${stats.domain}`,
    stats.domainSuffix > 0 && `// DOMAIN-SUFFIX: ${stats.domainSuffix}`,
    stats.domainKeyword > 0 && `// DOMAIN-KEYWORD: ${stats.domainKeyword}`,
    stats.domainSet > 0 && `// DOMAIN-SET: ${stats.domainSet}`,

    // IP 类规则
    stats.ipCidr > 0 && `// IP-CIDR: ${stats.ipCidr}`,
    stats.ipCidr6 > 0 && `// IP-CIDR6: ${stats.ipCidr6}`,
    stats.ipAsn > 0 && `// IP-ASN: ${stats.ipAsn}`,

    // GEO 类规则
    stats.geoip > 0 && `// GEOIP: ${stats.geoip}`,
    stats.geosite > 0 && `// GEOSITE: ${stats.geosite}`,

    // 进程类规则
    stats.processName > 0 && `// PROCESS-NAME: ${stats.processName}`,
    stats.processPath > 0 && `// PROCESS-PATH: ${stats.processPath}`,

    // 端口类规则
    //stats.destPort > 0 && `// DEST-PORT: ${stats.destPort}`,
    //stats.srcPort > 0 && `// SRC-PORT: ${stats.srcPort}`,
    // 协议类规则
    //stats.protocol > 0 && `// PROTOCOL: ${stats.protocol}`,
    //stats.network > 0 && `// NETWORK: ${stats.network}`,

    // HTTP 类规则
    stats.ruleSet > 0 && `// RULE-SET: ${stats.ruleSet}`,
    stats.urlRegex > 0 && `// URL-REGEX: ${stats.urlRegex}`,
    stats.userAgent > 0 && `// USER-AGENT: ${stats.userAgent}`,
    stats.header > 0 && `// HEADER: ${stats.header}`,

    stats.other > 0 && `// OTHER: ${stats.other}`,
    `// Total: ${stats.total}`,

    // 只有在有 description 时才添加
    info?.description && `// ${info.description}`,
    // 只有在有 sources 时才添加数据来源部分
    sources.length > 0 && ['// Data sources:', ...sources.map(source => `//  - ${source}`)],
    '',
    '',
    contentStr,
  ]
    .flat()
    .filter(Boolean);

  return headers.join('\n');
}
