import { BaseWriteStrategy } from './base';
import { appendArrayInPlace } from 'foxts/append-array-in-place';
import { withIdentityContent } from '../../../lib/misc';
import stringify from 'json-stringify-pretty-compact';
import { OUTPUT_SINGBOX_DIR } from '../../../constants/dir';
import { RuleLineUtils } from '../../../utils/validation/validators';

interface SingboxHeadlessRule {
  domain: string[];
  domain_suffix: string[];
  domain_keyword?: string[];
  domain_regex?: string[];
  source_ip_cidr?: string[];
  ip_cidr?: string[];
  source_port?: number[];
  source_port_range?: string[];
  port?: number[];
  port_range?: string[];
  process_name?: string[];
  process_path?: string[];
  network?: string[];
}

interface SingboxSourceFormat {
  version: 2 | (number & {});
  rules: SingboxHeadlessRule[];
}

export class SingboxSource extends BaseWriteStrategy {
  public readonly platform = 'singbox' as const;
  public readonly name = 'singbox';

  readonly fileExtension = 'json';

  static readonly jsonToLines = (json: unknown): string[] => stringify(json).split('\n');

  private readonly singbox: SingboxHeadlessRule = {

    domain: [],
    domain_suffix: [],
  };

  protected get result() {
    return SingboxSource.jsonToLines({
      version: 2,
      rules: [this.singbox],
    });
  }

  constructor(
    public type: '' | 'domainset' | 'non_ip' | 'ip' /* | (string & {}) */,
    public readonly outputDir = OUTPUT_SINGBOX_DIR
  ) {
    super(outputDir);
  }

  withPadding = withIdentityContent;

  writeDomain(domain: string): void {

    if (!RuleLineUtils.isSukkaWatermark(domain)) {
      this.singbox.domain.push(domain);
    }
  }

  writeDomainSuffix(domain: string): void {

    if (!RuleLineUtils.isSukkaWatermark(domain)) {
      this.singbox.domain_suffix.push(domain);
    }
  }

  writeDomainKeywords(keyword: Set<string>): void {
    appendArrayInPlace((this.singbox.domain_keyword ??= []), Array.from(keyword));
  }

  writeDomainWildcard(wildcard: string): void {
    this.singbox.domain_regex ??= [];
    this.singbox.domain_regex.push(SingboxSource.domainWildCardToRegex(wildcard));
  }

  writeUserAgents(userAgent: Set<string>): void {
    this.accepts('USER-AGENT', userAgent.size);
  }

  writeProcessNames(processName: Set<string>): void {
    this.accepts('PROCESS-NAME', processName.size);
  }
  // writeProcessNames(processName: Set<string>): void {
  //   appendArrayInPlace(
  //     this.singbox.process_name ??= [],
  //     Array.from(processName)
  //   );
  // }

  writeProcessPaths(processPath: Set<string>): void {
    this.accepts('PROCESS-PATH', processPath.size);
  }
  // writeProcessPaths(processPath: Set<string>): void {
  //   appendArrayInPlace(
  //     this.singbox.process_path ??= [],
  //     Array.from(processPath)
  //   );
  // }

  writeUrlRegexes(urlRegex: Set<string>): void {
    this.accepts('URL-REGEX', urlRegex.size);
  }

  writeIpCidrs(ipCidr: string[]): void {
    appendArrayInPlace((this.singbox.ip_cidr ??= []), ipCidr);
  }

  writeIpCidr6s(ipCidr6: string[]): void {
    appendArrayInPlace((this.singbox.ip_cidr ??= []), ipCidr6);
  }

  writeGeoip(geoip: Set<string>): void {
    this.accepts('GEOIP', geoip.size);
  }

  writeIpAsns(asns: Set<string>): void {
    this.accepts('IP-ASN', asns.size);
  }

  writeSourceIpCidrs(sourceIpCidr: string[]): void {
    this.accepts('SRC-IP-CIDR', sourceIpCidr.length);
  }

  writeSourcePorts(sourcePort: Set<string>): void {
    this.accepts('SRC-PORT', sourcePort.size);
  }

  writeDestinationPorts(destinationPort: Set<string>): void {
    this.accepts('DEST-PORT', destinationPort.size);
  }

  writeProtocols(protocol: Set<string>): void {
    this.accepts('PROTOCOL', protocol.size);
  }
  // writeProtocols(protocol: Set<string>): void {
  //   this.singbox.network ??= [];
  //   // protocol has already be normalized and will only be uppercase
  //   if (protocol.has('UDP')) {
  //     this.singbox.network.push('udp');
  //   }
  //   if (protocol.has('TCP')) {
  //     this.singbox.network.push('tcp');
  //   }
  // }

  writeOtherRules(rule: string[]): void {
    // sing-box智能处理混合规则
    rule.forEach(r => this.processSingboxRuleIntelligently(r));
  }

  /**
   * sing-box智能规则处理
   * 重构：使用共享验证器替代内联正则表达式
   */
  private processSingboxRuleIntelligently(rule: string): void {
    const trimmed = rule.trim();
    // 使用共享验证器检查是否应跳过
    if (RuleLineUtils.shouldSkipLine(trimmed)) {
      return; // sing-box不输出注释
    }
    const accountedType = this.accountOtherRule(trimmed);
    if (accountedType === 'skip' || accountedType === 'unknown' || !this.accepts(accountedType)) return;

    const parts = trimmed.split(',');

    const ruleType = parts[0].trim().toUpperCase();
    const value = parts[1].trim();

    switch (ruleType) {
      case 'DOMAIN':

        if (!RuleLineUtils.isSukkaWatermark(value)) {
          this.singbox.domain.push(value);
        }
        break;
      case 'DOMAIN-SUFFIX':

        if (!RuleLineUtils.isSukkaWatermark(value)) {
          this.singbox.domain_suffix.push(value);
        }
        break;
      case 'DOMAIN-KEYWORD':
        (this.singbox.domain_keyword ??= []).push(value);
        break;
      case 'IP-CIDR':
      case 'IP-CIDR6':
        (this.singbox.ip_cidr ??= []).push(value);
        break;
      default:
        // All supported other-rule forms are handled above.
    }
  }
}
