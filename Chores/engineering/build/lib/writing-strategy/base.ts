import type { Span } from '../../trace/index.js';

/**
 * 基础写入策略接口
 * 定义了所有规则集输出格式需要实现的方法
 */
export interface BaseWriteStrategy {
  /** 写入单个域名 */
  writeDomain(domain: string): void;

  /** 写入域名后缀 */
  writeDomainSuffix(domain: string): void;

  /** 写入域名关键词 */
  writeDomainKeywords(keywords: Set<string>): void;

  /** 写入域名通配符 */
  writeDomainWildcard(wildcard: string): void;

  /** 写入 User-Agent */
  writeUserAgents(userAgents: Set<string>): void;

  /** 写入进程名 */
  writeProcessNames(processNames: Set<string>): void;

  /** 写入进程路径 */
  writeProcessPaths(processPaths: Set<string>): void;

  /** 写入源 IP/CIDR */
  writeSourceIpCidrs(cidrs: string[]): void;

  /** 写入源端口 */
  writeSourcePorts(ports: Set<string>): void;

  /** 写入目标端口 */
  writeDestinationPorts(ports: Set<string>): void;

  /** 写入协议 */
  writeProtocols(protocols: Set<string>): void;

  /** 写入其他规则 */
  writeOtherRules(rules: string[]): void;

  /** 写入 URL 正则 */
  writeUrlRegexes(regexes: Set<string>): void;

  /** 写入 IPv4 CIDR */
  writeIpCidrs(cidrs: string[], noResolve: boolean): void;

  /** 写入 IPv6 CIDR */
  writeIpCidr6s(cidrs: string[], noResolve: boolean): void;

  /** 写入 IP ASN */
  writeIpAsns(asns: Set<string>, noResolve: boolean): void;

  /** 写入 GeoIP */
  writeGeoip(geoips: Set<string>, noResolve: boolean): void;

  /** 获取输出路径 */
  getOutputPath(id: string): string;

  /** 写入到文件 */
  write(
    span: Span,
    id: string,
    title: string | null,
    description: string[] | readonly string[] | null,
    date: Date
  ): Promise<void>;
}

/**
 * 添加文件头部注释
 */
export function withBannerArray(
  title: string | null,
  description: string[] | readonly string[] | null,
  date: Date,
  content: string[]
): string[] {
  const banner: string[] = [];

  if (title) {
    banner.push(`# ${title}`);
  }

  if (description && description.length > 0) {
    if (banner.length > 0) banner.push('#');
    for (const line of description) {
      banner.push(line ? `# ${line}` : '#');
    }
  }

  if (banner.length > 0) {
    banner.push('#');
    banner.push(`# Last Updated: ${date.toISOString()}`);
    banner.push('');
  }

  return [...banner, ...content];
}
