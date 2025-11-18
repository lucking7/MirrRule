/**
 * QuantumultX输出策略
 * 完整实现 BaseWriteStrategy，支持生成QuantumultX代理客户端兼容的规则文件格式
 *
 * 参考：Surge-master-4 的简洁实现
 */

import { appendSetElementsToArray } from 'foxts/append-set-elements-to-array';
import { BaseWriteStrategy } from './base';
import { noop } from 'foxts/noop';
import { withBannerArray } from '../../../lib/misc';
import { OUTPUT_QUANTUMULT_X_DIR } from '../../../constants/dir';
import { MARKER_DOMAIN } from '../../../constants/description';
import { RuleValidator } from '../../../utils/validation/validators';

/**
 * QuantumultX规则集输出策略
 * 生成完整的 QuantumultX 规则格式（带 host, host-suffix 等前缀和 REJECT 策略）
 */
export class QuantumultXRuleSet extends BaseWriteStrategy {
  public readonly name = 'quantumultx ruleset';

  readonly fileExtension = 'list' as const;

  // 🔧 移除 MARKER_DOMAIN 水印初始化
  protected result: string[] = [];

  constructor(
    /** 🔧 规则类型参数 - 设为空字符串以避免创建子目录 */
    public readonly type: '' | 'ip' | 'non_ip',
    public readonly outputDir = OUTPUT_QUANTUMULT_X_DIR
  ) {
    super(outputDir);
  }

  withPadding = withBannerArray;

  writeDomain(domain: string): void {
    // 🔧 过滤 Sukka 规则集水印
    if (!RuleValidator.isSukkaWatermark(domain)) {
      this.result.push('host, ' + domain + ', REJECT');
    }
  }

  writeDomainSuffix(domain: string): void {
    // 🔧 过滤 Sukka 规则集水印
    if (!RuleValidator.isSukkaWatermark(domain)) {
      this.result.push('host-suffix, ' + domain + ', REJECT');
    }
  }

  writeDomainKeywords(keyword: Set<string>): void {
    appendSetElementsToArray(this.result, keyword, i => `host-keyword, ${i}, REJECT`);
  }

  writeDomainWildcard(wildcard: string): void {
    this.result.push(`host-wildcard, ${wildcard}, REJECT`);
  }

  writeUserAgents(userAgent: Set<string>): void {
    appendSetElementsToArray(this.result, userAgent, i => `user-agent, ${i}, REJECT`);
  }

  writeProcessNames = noop; // QuantumultX 不支持 PROCESS-NAME
  writeProcessPaths = noop; // QuantumultX 不支持 PROCESS-PATH
  writeUrlRegexes = noop; // QuantumultX URL 规则放在 rewrite 部分

  writeIpCidrs(ipCidr: string[], noResolve: boolean): void {
    for (let i = 0, len = ipCidr.length; i < len; i++) {
      this.result.push(`ip-cidr, ${ipCidr[i]}, REJECT`);
    }
  }

  writeIpCidr6s(ipCidr6: string[], noResolve: boolean): void {
    for (let i = 0, len = ipCidr6.length; i < len; i++) {
      this.result.push(`ip6-cidr, ${ipCidr6[i]}, REJECT`);
    }
  }

  writeGeoip(geoip: Set<string>, noResolve: boolean): void {
    appendSetElementsToArray(this.result, geoip, i => `geoip, ${i}, REJECT`);
  }

  writeIpAsns(asns: Set<string>, noResolve: boolean): void {
    appendSetElementsToArray(this.result, asns, i => `ip-asn, ${i}, REJECT`);
  }

  writeSourceIpCidrs = noop; // QuantumultX 不支持 SRC-IP-CIDR
  writeSourcePorts = noop; // QuantumultX 不支持 SRC-PORT
  writeDestinationPorts = noop; // QuantumultX 不支持 DEST-PORT
  writeProtocols = noop; // QuantumultX 不支持 PROTOCOL

  writeOtherRules = noop;
}
