import { appendSetElementsToArray } from 'foxts/append-set-elements-to-array';
import { BaseWriteStrategy } from './base';
import { noop } from 'foxts/noop';
import { notSupported, withBannerArray } from '../../../lib/misc';
import { fastIpVersion } from 'foxts/fast-ip-version';
import { OUTPUT_CLASH_DIR } from '../../../constants/dir';
import { appendArrayInPlace } from 'foxts/append-array-in-place';
import { MARKER_DOMAIN } from '../../../constants/description';
import { RuleValidator } from '../../../utils/validation/validators';

export class ClashDomainSet extends BaseWriteStrategy {
  public readonly name = 'clash domainset';

  // readonly type = 'domainset';
  readonly fileExtension = 'txt';
  readonly type = 'domainset';

  protected result: string[] = [MARKER_DOMAIN];

  constructor(public readonly outputDir = OUTPUT_CLASH_DIR) {
    super(outputDir);
  }

  withPadding = withBannerArray;

  writeDomain(domain: string): void {
    this.result.push(domain);
  }

  writeDomainSuffix(domain: string): void {
    this.result.push('+.' + domain);
  }

  // 移除noop限制，改为智能兼容处理
  writeDomainKeywords(keyword: Set<string>): void {
    // Clash支持DOMAIN-KEYWORD
    appendSetElementsToArray(this.result, keyword, i => `DOMAIN-KEYWORD,${i}`);
  }

  writeDomainWildcard(wildcard: string): void {
    // Clash不支持DOMAIN-WILDCARD，转换为DOMAIN-KEYWORD
    console.warn('⚠️ Clash不支持DOMAIN-WILDCARD，转换为DOMAIN-KEYWORD');
    this.result.push(`DOMAIN-KEYWORD,${wildcard.replace('*', '')}`);
  }

  writeUserAgents = noop; // Clash确实不支持USER-AGENT
  writeProcessNames = noop; // Clash确实不支持PROCESS-NAME
  writeProcessPaths = noop; // Clash确实不支持PROCESS-PATH
  writeUrlRegexes = noop; // Clash确实不支持URL-REGEX

  // Clash Domain Set不支持IP规则，但记录警告
  writeIpCidrs = noop;
  writeIpCidr6s = noop;
  writeGeoip = noop;
  writeIpAsns = noop;
  writeSourceIpCidrs = noop;
  writeSourcePorts = noop;
  writeDestinationPorts = noop;
  writeProtocols = noop;

  writeOtherRules(rule: string[]): void {
    // 智能处理混合规则
    rule.forEach(r => this.processClashRuleIntelligently(r));
  }

  /**
   * Clash智能规则处理 - 自动转换或兼容处理
   * 重构：使用共享验证器检查注释和空行
   */
  private processClashRuleIntelligently(rule: string): void {
    const trimmed = rule.trim();
    if (RuleValidator.shouldSkipLine(trimmed)) {
      this.result.push(trimmed);
      return;
    }

    const parts = trimmed.split(',');
    if (parts.length < 2) {
      this.result.push(trimmed);
      return;
    }

    const ruleType = parts[0].trim().toUpperCase();
    const value = parts[1].trim();

    switch (ruleType) {
      case 'DOMAIN':
        this.result.push(value); // Clash域名集格式
        break;
      case 'DOMAIN-SUFFIX':
        this.result.push(value); // Clash域名集格式
        break;
      case 'USER-AGENT':
      case 'PROCESS-NAME':
      case 'URL-REGEX':
        // Clash不支持，添加注释说明
        this.result.push(`# ${ruleType},${value} (Clash不支持)`);
        break;
      case 'IP-CIDR':
      case 'IP-CIDR6':
      case 'GEOIP':
        // IP规则不属于域名集，添加注释
        this.result.push(`# ${trimmed} (应放在IP规则集中)`);
        break;
      default:
        // 其他规则保持原样
        this.result.push(trimmed);
    }
  }
}

export class ClashIPSet extends BaseWriteStrategy {
  public readonly name = 'clash ipcidr';

  // readonly type = 'domainset';
  readonly fileExtension = 'txt';
  readonly type = 'ip';

  protected result: string[] = [];

  constructor(public readonly outputDir = OUTPUT_CLASH_DIR) {
    super(outputDir);
  }

  withPadding = withBannerArray;

  writeDomain = notSupported('writeDomain');
  writeDomainSuffix = notSupported('writeDomainSuffix');
  writeDomainKeywords = notSupported('writeDomainKeywords');
  writeDomainWildcard = notSupported('writeDomainWildcards');
  writeUserAgents = notSupported('writeUserAgents');
  writeProcessNames = notSupported('writeProcessNames');
  writeProcessPaths = notSupported('writeProcessPaths');
  writeUrlRegexes = notSupported('writeUrlRegexes');
  writeIpCidrs(ipCidr: string[]): void {
    appendArrayInPlace(this.result, ipCidr);
  }

  writeIpCidr6s(ipCidr6: string[]): void {
    appendArrayInPlace(this.result, ipCidr6);
  }

  writeGeoip = notSupported('writeGeoip');
  writeIpAsns = notSupported('writeIpAsns');
  writeSourceIpCidrs = notSupported('writeSourceIpCidrs');
  writeSourcePorts = notSupported('writeSourcePorts');
  writeDestinationPorts = noop;
  writeProtocols = noop;

  writeOtherRules(rule: string[]): void {
    // Clash规则集智能处理混合规则
    rule.forEach(r => this.processClashRuleSetIntelligently(r));
  }

  /**
   * ClashRuleSet智能处理混合规则
   * 重构：使用共享验证器检查注释和空行
   */
  private processClashRuleSetIntelligently(rule: string): void {
    const trimmed = rule.trim();
    if (RuleValidator.shouldSkipLine(trimmed)) {
      this.result.push(trimmed);
      return;
    }

    const parts = trimmed.split(',');
    if (parts.length < 2) {
      this.result.push(trimmed);
      return;
    }

    const ruleType = parts[0].trim().toUpperCase();
    const value = parts[1].trim();
    const params = parts.slice(2).join(',');

    switch (ruleType) {
      case 'DOMAIN':
      case 'DOMAIN-SUFFIX':
      case 'DOMAIN-KEYWORD':
      case 'IP-CIDR':
      case 'IP-CIDR6':
      case 'GEOIP':
        // Clash支持的规则类型
        this.result.push(`${ruleType},${value}${params ? ',' + params : ''}`);
        break;
      case 'USER-AGENT':
      case 'PROCESS-NAME':
      case 'URL-REGEX':
        // Clash不支持，添加注释
        this.result.push(`# ${trimmed} (Clash不支持)`);
        break;
      default:
        // 其他规则，尝试保持
        this.result.push(trimmed);
    }
  }
}

export class ClashClassicRuleSet extends BaseWriteStrategy {
  public readonly name: string = 'clash classic ruleset';

  readonly fileExtension = 'txt';

  protected result: string[] = [`DOMAIN,${MARKER_DOMAIN}`];

  constructor(
    /** 🔧 规则类型参数 - 设为空字符串以避免创建子目录 */
    public readonly type: '' | 'ip' | 'non_ip' /* | (string & {}) */,
    public readonly outputDir = OUTPUT_CLASH_DIR
  ) {
    super(outputDir);
  }

  withPadding = withBannerArray;

  writeDomain(domain: string): void {
    this.result.push('DOMAIN,' + domain);
  }

  writeDomainSuffix(domain: string): void {
    this.result.push('DOMAIN-SUFFIX,' + domain);
  }

  writeDomainKeywords(keyword: Set<string>): void {
    appendSetElementsToArray(this.result, keyword, i => `DOMAIN-KEYWORD,${i}`);
  }

  writeDomainWildcard(wildcard: string): void {
    this.result.push(`DOMAIN-WILDCARD,${wildcard}`);
  }

  writeUserAgents = noop; // Clash不支持USER-AGENT

  writeProcessNames(processName: Set<string>): void {
    appendSetElementsToArray(this.result, processName, i => `PROCESS-NAME,${i}`);
  }

  writeProcessPaths(processPath: Set<string>): void {
    appendSetElementsToArray(this.result, processPath, i => `PROCESS-PATH,${i}`);
  }

  writeUrlRegexes = noop; // Clash不支持URL-REGEX

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

  writeSourceIpCidrs(sourceIpCidr: string[]): void {
    for (let i = 0, len = sourceIpCidr.length; i < len; i++) {
      const value = sourceIpCidr[i];
      if (value.includes('/')) {
        this.result.push(`SRC-IP-CIDR,${value}`);
        continue;
      }
      const v = fastIpVersion(value);
      if (v === 4) {
        this.result.push(`SRC-IP-CIDR,${value}/32`);
        continue;
      }
      if (v === 6) {
        this.result.push(`SRC-IP-CIDR6,${value}/128`);
        continue;
      }
    }
  }

  writeSourcePorts(port: Set<string>): void {
    appendSetElementsToArray(this.result, port, i => `SRC-PORT,${i}`);
  }

  writeDestinationPorts(port: Set<string>): void {
    appendSetElementsToArray(this.result, port, i => `DST-PORT,${i}`);
  }

  writeProtocols(protocol: Set<string>): void {
    // Mihomo only matches UDP/TCP: https://wiki.metacubex.one/en/config/rules/#network

    // protocol has already be normalized and will only contain upppercase
    if (protocol.has('UDP')) {
      this.result.push('NETWORK,UDP');
    }
    if (protocol.has('TCP')) {
      this.result.push('NETWORK,TCP');
    }
  }

  writeOtherRules = noop;
}
