import { appendSetElementsToArray } from 'foxts/append-set-elements-to-array';
import { BaseWriteStrategy } from './base';
import { appendArrayInPlace } from 'foxts/append-array-in-place';
import { noop } from 'foxts/noop';
import { isProbablyIpv4 } from 'foxts/is-probably-ip';
import picocolors from 'picocolors';
import { normalizeDomain } from '../../../utils/domain/normalize-domain';
import { OUTPUT_MODULES_DIR, OUTPUT_SURGE_DIR } from '../../../constants/dir';
import { withBannerArray, withIdentityContent } from '../../../lib/misc';
import { MARKER_DOMAIN } from '../../../constants/description';
import { CrossPlatformRuleParser } from '../../parsers';
import { DomainValidator, IPValidator, RuleValidator } from '../../../utils/validation/validators';

export class SurgeDomainSet extends BaseWriteStrategy {
  public readonly name = 'surge domainset';

  // readonly type = 'domainset';
  readonly fileExtension = 'conf';
  type = 'domainset';

  // 移除签名行,保持结果数组为空
  protected result: string[] = [];

  constructor(outputDir = OUTPUT_SURGE_DIR) {
    super(outputDir);
  }

  withPadding = withBannerArray;

  writeDomain(domain: string): void {
    // 🔧 过滤 Sukka 规则集水印
    if (!RuleValidator.isSukkaWatermark(domain)) {
      this.result.push(domain);
    }
  }

  writeDomainSuffix(domain: string): void {
    // 🔧 过滤 Sukka 规则集水印
    if (!RuleValidator.isSukkaWatermark(domain)) {
      this.result.push('.' + domain);
    }
  }

  writeDomainKeywords = noop;
  writeDomainWildcard = noop;
  writeUserAgents = noop;
  writeProcessNames = noop;
  writeProcessPaths = noop;
  writeUrlRegexes = noop;
  writeIpCidrs = noop;
  writeIpCidr6s = noop;
  writeGeoip = noop;
  writeIpAsns = noop;
  writeSourceIpCidrs = noop;
  writeSourcePorts = noop;
  writeDestinationPorts = noop;
  writeProtocols = noop;
  writeOtherRules = noop;
}

export class SurgeRuleSet extends BaseWriteStrategy {
  public readonly name: string = 'surge ruleset';

  readonly fileExtension = 'list'; // 修改为 .list 扩展名

  // 移除签名行,保持结果数组为空
  protected result: string[] = [];

  constructor(
    /** 🔧 规则类型参数 - 设为空字符串以避免创建子目录 */
    public readonly type: '' | 'ip' | 'non_ip' | (string & {}),
    public readonly outputDir = OUTPUT_SURGE_DIR
  ) {
    super(outputDir);
  }

  withPadding = withBannerArray;

  writeDomain(domain: string): void {
    // 🔧 过滤 Sukka 规则集水印
    if (!RuleValidator.isSukkaWatermark(domain)) {
      // 生成无策略的纯RULE-SET格式
      this.result.push(BaseWriteStrategy.normalizeSurgeRule(`DOMAIN,${domain}`));
    }
  }

  writeDomainSuffix(domain: string): void {
    // 🔧 过滤 Sukka 规则集水印
    if (!RuleValidator.isSukkaWatermark(domain)) {
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
    // 智能处理所有规则类型，不依赖预分类
    rule.forEach(r => this.processRuleIntelligently(r));
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
      // 🔧 修复: 纯域名/IP 等无前缀规则,使用智能识别添加前缀
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

export class SurgeMitmSgmodule extends BaseWriteStrategy {
  public readonly name = 'surge sgmodule';

  // readonly type = 'domainset';
  readonly fileExtension = 'sgmodule';
  readonly type = '';

  private readonly rules = new Set<string>();

  protected get result() {
    if (this.rules.size === 0) {
      return null;
    }

    return [
      '#!name=[Sukka] Surge Reject MITM',
      `#!desc=为 URL Regex 规则组启用 MITM (size: ${this.rules.size})`,
      '',
      '[MITM]',
      'hostname = %APPEND% ' + Array.from(this.rules).join(', '),
    ];
  }

  withPadding = withIdentityContent;

  constructor(moduleName: string, outputDir = OUTPUT_MODULES_DIR) {
    super(outputDir);
    this.withFilename(moduleName);
  }

  writeDomain = noop;

  writeDomainSuffix = noop;

  writeDomainKeywords = noop;
  writeDomainWildcard = noop;
  writeUserAgents = noop;
  writeProcessNames = noop;
  writeProcessPaths = noop;
  writeUrlRegexes(urlRegexes: Set<string>): void {
    const urlRegexResults: Array<{ origin: string; processed: string[] }> = [];

    const parsedFailures: Array<[original: string, processed: string]> = [];
    const parsed: Array<[original: string, domain: string]> = [];

    for (let urlRegex of urlRegexes) {
      if (urlRegex.startsWith('http://') || urlRegex.startsWith('^http://')) {
        continue;
      }
      if (urlRegex.startsWith('^https?://')) {
        urlRegex = urlRegex.slice(10);
      }
      if (urlRegex.startsWith('^https://')) {
        urlRegex = urlRegex.slice(9);
      }

      const potentialHostname = urlRegex
        .slice(0, urlRegex.indexOf('/'))
        // pre process regex
        .replaceAll(String.raw`\.`, '.')
        .replaceAll('.+', '*')
        .replaceAll(/([a-z])\?/g, '($1|)')
        // convert regex to surge hostlist syntax
        .replaceAll('([a-z])', '?')
        .replaceAll(String.raw`\d`, '?')
        .replaceAll(/\*+/g, '*');

      let processed: string[] = [potentialHostname];

      const matches = [...potentialHostname.matchAll(/\((?:([^()|]+)\|)+([^()|]*)\)/g)];

      if (matches.length > 0) {
        const replaceVariant = (
          combinations: string[],
          fullMatch: string,
          options: string[]
        ): string[] => {
          const newCombinations: string[] = [];

          combinations.forEach(combination => {
            options.forEach(option => {
              newCombinations.push(combination.replace(fullMatch, option));
            });
          });

          return newCombinations;
        };

        for (let i = 0; i < matches.length; i++) {
          const match = matches[i];
          const [_, ...options] = match;

          processed = replaceVariant(processed, _, options);
        }
      }

      urlRegexResults.push({
        origin: potentialHostname,
        processed,
      });
    }

    for (const i of urlRegexResults) {
      for (const processed of i.processed) {
        if (normalizeDomain(processed.replaceAll('*', 'a').replaceAll('?', 'b'))) {
          parsed.push([i.origin, processed]);
        } else if (!isProbablyIpv4(processed)) {
          parsedFailures.push([i.origin, processed]);
        }
      }
    }

    if (parsedFailures.length > 0) {
      console.error(picocolors.bold('Parsed Failed'));
      console.table(parsedFailures);
    }

    for (let i = 0, len = parsed.length; i < len; i++) {
      this.rules.add(parsed[i][1]);
    }
  }

  writeIpCidrs = noop;
  writeIpCidr6s = noop;
  writeGeoip = noop;
  writeIpAsns = noop;
  writeSourceIpCidrs = noop;
  writeSourcePorts = noop;
  writeDestinationPorts = noop;
  writeProtocols = noop;
  writeOtherRules = noop;
}

/**
 * Surge RULE-SET Payload 输出策略
 * 严格遵循RULE-SET格式规范：规则类型,匹配值[,允许的参数]
 * 不包含策略组，仅保留no-resolve和extended-matching参数
 */
export class SurgeRuleSetPayload extends BaseWriteStrategy {
  public readonly name: string = 'surge ruleset payload';

  readonly fileExtension = 'conf';

  // 移除签名行,保持结果数组为空
  protected result: string[] = [];

  constructor(
    /** Surge RULE-SET payload 类型 */
    public readonly type: 'ip' | 'non_ip' | (string & {}),
    public readonly outputDir = OUTPUT_SURGE_DIR
  ) {
    super(outputDir);
  }

  withPadding = withBannerArray;

  /**
   * 处理输入行，转换为RULE-SET payload格式
   * 重构：使用共享验证器检查注释和空行
   */
  protected processLine(line: string): void {
    const trimmed = line.trim();

    // 使用共享验证器检查注释和空行
    if (RuleValidator.shouldSkipLine(trimmed)) {
      if (trimmed) {
        this.result.push(trimmed);
      }
      return;
    }

    // 转换为RULE-SET payload格式
    const converted = CrossPlatformRuleParser.smartConvertToRuleSet(trimmed);

    if (converted && converted !== trimmed) {
      this.result.push(converted);
    } else if (converted) {
      this.result.push(converted);
    }
  }

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
    // 对其他规则也应用RULE-SET格式转换
    const convertedRules = rule.map(r => CrossPlatformRuleParser.smartConvertToRuleSet(r));
    appendArrayInPlace(this.result, convertedRules);
  }
}
