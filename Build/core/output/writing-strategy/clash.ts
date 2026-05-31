import { appendSetElementsToArray } from 'foxts/append-set-elements-to-array';
import { BaseWriteStrategy } from './base';
import { noop } from 'foxts/noop';
import { withBannerArray } from '../../../lib/misc';
import { fastIpVersion } from 'foxts/fast-ip-version';
import { OUTPUT_CLASH_DIR } from '../../../constants/dir';
import { RuleLineUtils } from '../../../utils/validation/validators';
import { smartConvertRule } from '../../../lib/misc';
import { cleanPolicy } from '../../../lib/policy-cleaner';

export class ClashClassicRuleSet extends BaseWriteStrategy {
  public readonly name: string = 'clash classic ruleset';

  readonly fileExtension = 'txt';

  protected result: string[] = [];

  constructor(
    public readonly type: '' | 'ip' | 'non_ip',
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

  /**
   * 处理其他规则（包括逻辑规则 AND/OR/NOT）
   * 将 Surge 格式的规则转换为 Clash 格式
   */
  writeOtherRules(rules: string[]): void {
    for (const rule of rules) {
      const trimmed = rule.trim();

      if (RuleLineUtils.shouldSkipLine(trimmed)) continue;
      const converted = cleanPolicy(smartConvertRule(trimmed));
      this.result.push(converted);
    }
  }
}
