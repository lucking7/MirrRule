import { BaseWriteStrategy } from './base';
import { OUTPUT_SURGE_DIR } from '../../../constants/dir';
import { withBannerArray } from '../../../lib/misc';
import { RuleLineUtils } from '../../../utils/validation/validators';

/**
 * Native Surge DOMAIN-SET writer: `example.com` matches only that host and
 * `.example.com` matches the apex and every subdomain, like DOMAIN-SUFFIX.
 * It accepts only standalone exact and suffix domains; any other condition is a
 * classification error because DOMAIN-SET cannot express it.
 */
export class SurgeDomainSet extends BaseWriteStrategy {
  public readonly platform = 'surge' as const;
  public readonly name = 'surge domainset';
  public readonly type = 'domainset';

  readonly fileExtension = 'list';

  protected result: string[] = [];

  constructor(public readonly outputDir = OUTPUT_SURGE_DIR) {
    super(outputDir);
  }

  withPadding = withBannerArray;

  writeDomain(domain: string): void {
    if (!RuleLineUtils.isSukkaWatermark(domain)) this.result.push(domain);
  }

  writeDomainSuffix(domain: string): void {
    if (!RuleLineUtils.isSukkaWatermark(domain)) this.result.push('.' + domain);
  }

  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- contract guard shared by all non-domain writers
  private reject(type: string): never {
    throw new Error(`surge domainset: ${type} cannot be expressed in DOMAIN-SET`);
  }

  writeDomainKeywords(): void { this.reject('DOMAIN-KEYWORD'); }
  writeDomainWildcard(): void { this.reject('DOMAIN-WILDCARD'); }
  writeUserAgents(): void { this.reject('USER-AGENT'); }
  writeProcessNames(): void { this.reject('PROCESS-NAME'); }
  writeProcessPaths(): void { this.reject('PROCESS-PATH'); }
  writeUrlRegexes(): void { this.reject('URL-REGEX'); }
  writeIpCidrs(): void { this.reject('IP-CIDR'); }
  writeIpCidr6s(): void { this.reject('IP-CIDR6'); }
  writeGeoip(): void { this.reject('GEOIP'); }
  writeIpAsns(): void { this.reject('IP-ASN'); }
  writeSourceIpCidrs(): void { this.reject('SRC-IP'); }
  writeSourcePorts(): void { this.reject('SRC-PORT'); }
  writeDestinationPorts(): void { this.reject('DEST-PORT'); }
  writeProtocols(): void { this.reject('PROTOCOL'); }
  writeOtherRules(rules: string[]): void {
    if (rules.some(rule => !RuleLineUtils.shouldSkipLine(rule.trim()))) this.reject('classical rule');
  }
}
