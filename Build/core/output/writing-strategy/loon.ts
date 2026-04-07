import { appendSetElementsToArray } from 'foxts/append-set-elements-to-array';
import { BaseWriteStrategy } from './base';
import { noop } from 'foxts/noop';
import { withBannerArray } from '../../../lib/misc';
import { OUTPUT_LOON_DIR } from '../../../constants/dir';
import { RuleLineUtils } from '../../../utils/validation/validators';
import { smartConvertRule } from '../../../lib/misc';
import { cleanPolicy } from '../../../lib/policy-cleaner';

/**
 * Loon规则集输出策略
 */
export class LoonRuleSet extends BaseWriteStrategy {
  public readonly name = 'loon ruleset';

  readonly fileExtension = 'list' as const;


  protected result: string[] = [];

  constructor(
    public readonly type: '' | 'ip' | 'non_ip',
    public readonly outputDir = OUTPUT_LOON_DIR
  ) {
    super(outputDir);
  }

  withPadding = withBannerArray;

  writeDomain(domain: string): void {

    if (!RuleLineUtils.isSukkaWatermark(domain)) {
      this.result.push('DOMAIN,' + domain);
    }
  }

  writeDomainSuffix(domain: string): void {

    if (!RuleLineUtils.isSukkaWatermark(domain)) {
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


      if (RuleLineUtils.shouldSkipLine(trimmed)) {
        continue;
      }


      const converted = cleanPolicy(smartConvertRule(trimmed));
      this.result.push(converted);
    }
  }
}
