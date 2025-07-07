import tldts from 'tldts';
import { isProbablyIpv4, isProbablyIpv6 } from '../utils/ip-check.js';
import { normalizeTldtsOpt } from '../constants/tldts-options.js';

/**
 * AdGuard 过滤器解析结果类型
 */
export enum ParseType {
  WhiteIncludeSubdomain = 0,
  WhiteAbsolute = -1,
  BlackAbsolute = 1,
  BlackIncludeSubdomain = 2,
  BlackIP = 20,
  BlackWildcard = 30,
  BlackKeyword = 40,
  WhiteKeyword = 50,
  Null = 1000,
}

/**
 * AdGuard 过滤器解析结果
 */
export interface ParseResult {
  whiteDomains: Set<string>;
  whiteDomainSuffixes: Set<string>;
  blackDomains: Set<string>;
  blackDomainSuffixes: Set<string>;
  blackIPs: string[];
  blackWildcard: Set<string>;
  whiteKeyword: Set<string>;
  blackKeyword: Set<string>;
}

/**
 * 解析单行 AdGuard 过滤器规则
 * 使用严格的 TLD 验证（只接受 ICANN TLD）
 */
export function parseAdGuardRule(line: string): [string, ParseType] {
  const trimmed = line.trim();

  // 跳过空行和注释
  if (!trimmed || trimmed.startsWith('!') || trimmed.startsWith('#')) {
    return ['', ParseType.Null];
  }

  // 基本语法检查
  if (!trimmed.includes('.') || trimmed.includes('$') || trimmed.includes('/')) {
    return ['', ParseType.Null];
  }

  let domain = trimmed;
  let isWhitelist = false;
  let includeSubdomain = false;

  // 处理白名单规则 @@
  if (domain.startsWith('@@')) {
    isWhitelist = true;
    domain = domain.substring(2);
  }

  // 处理 || 前缀（包含子域名）
  if (domain.startsWith('||')) {
    includeSubdomain = true;
    domain = domain.substring(2);
  } else if (domain.startsWith('|')) {
    domain = domain.substring(1);
  }

  // 处理 ^ 后缀
  if (domain.endsWith('^')) {
    domain = domain.substring(0, domain.length - 1);
  }

  // IP 检查
  if (isProbablyIpv4(domain) || isProbablyIpv6(domain)) {
    if (isWhitelist) {
      return ['', ParseType.Null]; // 不支持白名单 IP
    }
    return [domain, ParseType.BlackIP];
  }

  // 使用允许私有域名的配置来正确识别私有后缀
  const parsed = tldts.parse(domain, {
    allowIcannDomains: true,
    allowPrivateDomains: true, // 需要启用以正确识别私有后缀
    detectIp: false,
    validateHostname: true,
  });

  // AdGuard 过滤器的严格验证：必须是 ICANN 认证的 TLD（不接受私有后缀）
  if (!parsed.publicSuffix || !parsed.hostname) {
    return ['', ParseType.Null];
  }

  // 如果是私有后缀，过滤掉
  if (parsed.isPrivate) {
    return ['', ParseType.Null];
  }

  // 必须是 ICANN TLD
  if (!parsed.isIcann) {
    return ['', ParseType.Null];
  }

  // 必须有有效的域名
  if (!parsed.domain) {
    return ['', ParseType.Null];
  }

  // 处理通配符域名
  if (domain.includes('*')) {
    if (isWhitelist) {
      return ['', ParseType.Null]; // 不支持通配符白名单
    }
    return [domain, ParseType.BlackWildcard];
  }

  // 处理关键词规则（以 - 开头）
  if (domain.startsWith('-')) {
    return [domain, isWhitelist ? ParseType.WhiteKeyword : ParseType.BlackKeyword];
  }

  // 返回结果
  if (isWhitelist) {
    return [domain, includeSubdomain ? ParseType.WhiteIncludeSubdomain : ParseType.WhiteAbsolute];
  } else {
    return [domain, includeSubdomain ? ParseType.BlackIncludeSubdomain : ParseType.BlackAbsolute];
  }
}

/**
 * 解析整个 AdGuard 过滤器文件
 */
export function parseAdGuardFilter(content: string): ParseResult {
  const lines = content.split('\n');
  const result: ParseResult = {
    whiteDomains: new Set(),
    whiteDomainSuffixes: new Set(),
    blackDomains: new Set(),
    blackDomainSuffixes: new Set(),
    blackIPs: [],
    blackWildcard: new Set(),
    whiteKeyword: new Set(),
    blackKeyword: new Set(),
  };

  for (const line of lines) {
    const [domain, type] = parseAdGuardRule(line);

    if (type === ParseType.Null || !domain) {
      continue;
    }

    switch (type) {
      case ParseType.WhiteIncludeSubdomain:
        result.whiteDomainSuffixes.add(domain);
        break;
      case ParseType.WhiteAbsolute:
        result.whiteDomains.add(domain);
        break;
      case ParseType.BlackIncludeSubdomain:
        result.blackDomainSuffixes.add(domain);
        break;
      case ParseType.BlackAbsolute:
        result.blackDomains.add(domain);
        break;
      case ParseType.BlackIP:
        result.blackIPs.push(domain);
        break;
      case ParseType.BlackWildcard:
        result.blackWildcard.add(domain);
        break;
      case ParseType.BlackKeyword:
        result.blackKeyword.add(domain);
        break;
      case ParseType.WhiteKeyword:
        result.whiteKeyword.add(domain);
        break;
    }
  }

  return result;
}

/**
 * 从 URL 下载并解析 AdGuard 过滤器
 */
export async function fetchAndParseAdGuardFilter(url: string): Promise<ParseResult> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch AdGuard filter from ${url}: ${response.statusText}`);
  }

  const content = await response.text();
  return parseAdGuardFilter(content);
}
