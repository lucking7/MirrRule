import { appendSetElementsToArray } from 'foxts/append-set-elements-to-array';
import { BaseWriteStrategy } from './base';
import { appendArrayInPlace } from 'foxts/append-array-in-place';
import { OUTPUT_SURGE_DIR } from '../../../constants/dir';
import { withBannerArray } from '../../../lib/misc';
import { DomainValidator, IPValidator, RuleLineUtils } from '../../../utils/validation/validators';
import { smartConvertRule } from '../../../lib/misc';
import { cleanPolicy } from '../../../lib/policy-cleaner';

export class SurgeRuleSet extends BaseWriteStrategy {
  public readonly name: string = 'surge ruleset';

  readonly fileExtension = 'list'; // 修改为 .list 扩展名

  // 移除签名行,保持结果数组为空
  protected result: string[] = [];

  constructor(
    public readonly type: '' | 'ip' | 'non_ip' | (string & {}),
    public readonly outputDir = OUTPUT_SURGE_DIR,
    private readonly stripPolicy: boolean = false
  ) {
    super(outputDir);
  }

  withPadding = withBannerArray;

  writeDomain(domain: string): void {
    if (!RuleLineUtils.isSukkaWatermark(domain)) {
      // 生成无策略的纯RULE-SET格式
      this.result.push(BaseWriteStrategy.normalizeSurgeRule(`DOMAIN,${domain}`));
    }
  }

  writeDomainSuffix(domain: string): void {
    if (!RuleLineUtils.isSukkaWatermark(domain)) {
      // 生成无策略的纯RULE-SET格式
      this.result.push(BaseWriteStrategy.normalizeSurgeRule(`DOMAIN-SUFFIX,${domain}`));
    }
  }

  writeDomainKeywords(keyword: Set<string>): void {
    appendSetElementsToArray(this.result, keyword, i => `DOMAIN-KEYWORD,${i}`);
  }

  writeDomainWildcard(wildcard: string): void {
    this.result.push(`DOMAIN-WILDCARD,${wildcard}`);
  }

  writeUserAgents(userAgent: Set<string>): void {
    appendSetElementsToArray(this.result, userAgent, i => `USER-AGENT,${i}`);
  }

  writeProcessNames(processName: Set<string>): void {
    appendSetElementsToArray(this.result, processName, i => `PROCESS-NAME,${i}`);
  }

  writeProcessPaths(processPath: Set<string>): void {
    appendSetElementsToArray(this.result, processPath, i => `PROCESS-NAME,${i}`);
  }

  writeUrlRegexes(urlRegex: Set<string>): void {
    appendSetElementsToArray(this.result, urlRegex, i => `URL-REGEX,${i}`);
  }

  writeIpCidrs(ipCidr: string[], noResolve: boolean): void {
    this.writeCidrRules(this.result, ipCidr, 'IP-CIDR', noResolve);
  }

  writeIpCidr6s(ipCidr6: string[], noResolve: boolean): void {
    this.writeCidrRules(this.result, ipCidr6, 'IP-CIDR6', noResolve);
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
      this.result.push(`SRC-IP,${sourceIpCidr[i]}`);
    }
  }

  writeSourcePorts(port: Set<string>): void {
    appendSetElementsToArray(this.result, port, i => `SRC-PORT,${i}`);
  }

  writeDestinationPorts(port: Set<string>): void {
    appendSetElementsToArray(this.result, port, i => `DEST-PORT,${i}`);
  }

  writeProtocols(protocol: Set<string>): void {
    appendSetElementsToArray(this.result, protocol, i => `PROTOCOL,${i}`);
  }

  writeOtherRules(rule: string[]): void {
    if (this.stripPolicy) {
      const convertedRules = rule.map(r => cleanPolicy(smartConvertRule(r)));
      appendArrayInPlace(this.result, convertedRules);
    } else {
      // 智能处理所有规则类型，不依赖预分类
      rule.forEach(r => this.processRuleIntelligently(r));
    }
  }

  /**
   * 智能处理任意规则 - 忽略类型分类，直接判断和转换
   */
  private processRuleIntelligently(rule: string): void {
    const trimmed = BaseWriteStrategy.normalizeSurgeRule(rule);
    if (!trimmed || trimmed.startsWith('#')) {
      this.result.push(trimmed);
      return;
    }

    // 解析规则结构
    const parts = trimmed.split(',');
    if (parts.length < 2) {
      this.intelligentRuleIdentification(trimmed);
      return;
    }

    const ruleType = parts[0].trim().toUpperCase();
    const value = parts[1].trim();

    // 智能处理各种规则类型（不使用noop）
    switch (ruleType) {
      case 'DOMAIN':
        this.result.push(`DOMAIN,${value}`);
        break;
      case 'DOMAIN-SUFFIX':
        this.result.push(`DOMAIN-SUFFIX,${value}`);
        break;
      case 'DOMAIN-KEYWORD':
        this.result.push(`DOMAIN-KEYWORD,${value}`);
        break;
      case 'DOMAIN-WILDCARD':
        this.result.push(`DOMAIN-WILDCARD,${value}`);
        break;
      case 'USER-AGENT':
        this.result.push(`USER-AGENT,${value}`);
        break;
      case 'PROCESS-NAME':
        this.result.push(`PROCESS-NAME,${value}`);
        break;
      case 'URL-REGEX':
        this.result.push(`URL-REGEX,${value}`);
        break;
      case 'IP-CIDR':
        // 智能处理IP规则参数
        const ipParams = parts.slice(2).join(',');
        this.result.push(`IP-CIDR,${value}${ipParams ? ',' + ipParams : ''}`);
        break;
      case 'IP-CIDR6':
        const ip6Params = parts.slice(2).join(',');
        this.result.push(`IP-CIDR6,${value}${ip6Params ? ',' + ip6Params : ''}`);
        break;
      case 'GEOIP':
        const geoParams = parts.slice(2).join(',');
        this.result.push(`GEOIP,${value}${geoParams ? ',' + geoParams : ''}`);
        break;
      case 'IP-ASN':
        const asnParams = parts.slice(2).join(',');
        this.result.push(`IP-ASN,${value}${asnParams ? ',' + asnParams : ''}`);
        break;
      default:
        // 未知规则类型，尝试智能识别
        this.intelligentRuleIdentification(trimmed);
    }
  }

  /**
   * 智能规则识别 - 无类型前缀的规则
   * 重构：使用共享验证器替代内联正则表达式
   */
  private intelligentRuleIdentification(rule: string): void {
    // 纯域名识别
    if (DomainValidator.isDomainLike(rule)) {
      this.result.push(`DOMAIN,${rule}`);
      return;
    }

    // 域名后缀识别 (.example.com)
    if (DomainValidator.isDomainSuffix(rule)) {
      this.result.push(`DOMAIN-SUFFIX,${rule.substring(1)}`);
      return;
    }

    // IP CIDR识别
    const ipType = IPValidator.getIpType(rule);
    if (ipType === 'ipv4') {
      this.result.push(`IP-CIDR,${rule}`);
      return;
    }
    if (ipType === 'ipv6') {
      this.result.push(`IP-CIDR6,${rule}`);
      return;
    }

    // 其他未识别规则，保持原样
    this.result.push(rule);
  }
}
