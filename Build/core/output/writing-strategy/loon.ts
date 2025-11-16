/**
 * Loon输出策略
 * 完整实现 BaseWriteStrategy，支持生成Loon代理客户端兼容的规则文件格式
 *
 * 参考：Surge-master-4 的简洁实现
 */

import { appendSetElementsToArray } from 'foxts/append-set-elements-to-array';
import { BaseWriteStrategy } from './base';
import { noop } from 'foxts/noop';
import { withBannerArray } from '../../../lib/misc';
import { OUTPUT_LOON_DIR } from '../../../constants/dir';
import { MARKER_DOMAIN } from '../../../constants/description';
import { CrossPlatformRuleParser } from '../../parsers';
import { ProxyPlatform } from '../../../constants/rule-formats';
import { RuleValidator } from '../../../utils/validation/validators';

/**
 * Loon规则集输出策略
 * 生成完整的 Loon 规则格式（带 DOMAIN, DOMAIN-SUFFIX 等前缀）
 */
export class LoonRuleSet extends BaseWriteStrategy {
  public readonly name = 'loon ruleset';

  readonly fileExtension = 'list' as const;

  // 🔧 移除 MARKER_DOMAIN 水印初始化
  protected result: string[] = [];

  constructor(
    /** 🔧 规则类型参数 - 设为空字符串以避免创建子目录 */
    public readonly type: '' | 'ip' | 'non_ip',
    public readonly outputDir = OUTPUT_LOON_DIR
  ) {
    super(outputDir);
  }

  withPadding = withBannerArray;

  writeDomain(domain: string): void {
    // 🔧 过滤 Sukka 规则集水印
    if (!RuleValidator.isSukkaWatermark(domain)) {
      this.result.push('DOMAIN,' + domain);
    }
  }

  writeDomainSuffix(domain: string): void {
    // 🔧 过滤 Sukka 规则集水印
    if (!RuleValidator.isSukkaWatermark(domain)) {
      this.result.push('DOMAIN-SUFFIX,' + domain);
    }
  }

  writeDomainKeywords(keyword: Set<string>): void {
    appendSetElementsToArray(this.result, keyword, i => `DOMAIN-KEYWORD,${i}`);
  }

  writeDomainWildcard = noop; // Loon 不支持 DOMAIN-WILDCARD

  writeUserAgents(userAgent: Set<string>): void {
    appendSetElementsToArray(this.result, userAgent, i => `USER-AGENT,${i}`);
  }

  writeProcessNames = noop; // Loon 不支持 PROCESS-NAME

  writeProcessPaths(processPath: Set<string>): void {
    appendSetElementsToArray(this.result, processPath, i => `PROCESS-PATH,${i}`);
  }

  writeUrlRegexes(urlRegex: Set<string>): void {
    appendSetElementsToArray(this.result, urlRegex, i => `URL-REGEX,${i}`);
  }

  writeIpCidrs(ipCidr: string[], noResolve: boolean): void {
    for (let i = 0, len = ipCidr.length; i < len; i++) {
      this.result.push(`IP-CIDR,${ipCidr[i]}${noResolve ? ',no-resolve' : ''}`);
    }
  }

  writeIpCidr6s(ipCidr6: string[], noResolve: boolean): void {
    for (let i = 0, len = ipCidr6.length; i < len; i++) {
      this.result.push(`IP-CIDR6,${ipCidr6[i]}${noResolve ? ',no-resolve' : ''}`);
    }
  }

  writeGeoip(geoip: Set<string>, noResolve: boolean): void {
    appendSetElementsToArray(
      this.result,
      geoip,
      i => `GEOIP,${i}${noResolve ? ',no-resolve' : ''}`
    );
  }

  writeIpAsns(asns: Set<string>, noResolve: boolean): void {
    appendSetElementsToArray(
      this.result,
      asns,
      i => `IP-ASN,${i}${noResolve ? ',no-resolve' : ''}`
    );
  }

  writeSourceIpCidrs = noop; // Loon 不支持 SRC-IP-CIDR

  writeSourcePorts(sourcePorts: Set<string>): void {
    appendSetElementsToArray(this.result, sourcePorts, i => `SRC-PORT,${i}`);
  }

  writeDestinationPorts(destPorts: Set<string>): void {
    appendSetElementsToArray(this.result, destPorts, i => `DEST-PORT,${i}`);
  }

  writeProtocols(protocols: Set<string>): void {
    appendSetElementsToArray(this.result, protocols, i => `PROTOCOL,${i}`);
  }

  /**
   * 处理其他规则（包括逻辑规则 AND/OR/NOT）
   * 将 Surge 格式的规则转换为 Loon 格式
   */
  writeOtherRules(rules: string[]): void {
    for (const rule of rules) {
      const trimmed = rule.trim();

      // 🔧 使用 RuleValidator 统一过滤注释、空行和水印
      if (RuleValidator.shouldSkipLine(trimmed)) {
        continue;
      }

      // 🔧 使用 CrossPlatformRuleParser 将 Surge 格式转换为 Loon 格式
      const converted = CrossPlatformRuleParser.smartConvert(trimmed, ProxyPlatform.LOON);
      this.result.push(converted);
    }
  }
}
