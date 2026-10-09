import { appendSetElementsToArray } from 'foxts/append-set-elements-to-array';
import { BaseWriteStrategy } from './base';
import { withBannerArray } from '../../../lib/misc';
import { fastIpVersion } from 'foxts/fast-ip-version';
import { cleanPolicy } from '../../../lib/policy-cleaner';
import { OUTPUT_CLASH_DIR } from '../../../constants/dir';

export class ClashClassicRuleSet extends BaseWriteStrategy {
  public readonly platform = 'clash' as const;
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

  writeUserAgents(userAgent: Set<string>): void {
    this.accepts('USER-AGENT', userAgent.size);
  }

  writeProcessNames(processName: Set<string>): void {
    appendSetElementsToArray(this.result, processName, i => `PROCESS-NAME,${i}`);
  }

  writeProcessPaths(processPath: Set<string>): void {
    appendSetElementsToArray(this.result, processPath, i => `PROCESS-PATH,${i}`);
  }

  writeUrlRegexes(urlRegex: Set<string>): void {
    this.accepts('URL-REGEX', urlRegex.size);
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

  writeOtherRules(rules: string[]): void {
    for (const rule of rules) {
      const type = rule.slice(0, rule.indexOf(',')).trim().toUpperCase();
      if (type !== 'AND' && type !== 'OR' && type !== 'NOT') {
        super.writeOtherRules([rule]);
        continue;
      }
      const converted = this.convertLogicalRule(cleanPolicy(rule));
      if (converted !== null) this.result.push(converted);
    }
  }

  private convertLogicalRule(rule: string, depth = 0): string | null {
    const fields = splitLogicalFields(rule);
    if (fields === null || depth > 64 || fields.length < 2) {
      this.accountOtherRule('INVALID');
      return null;
    }
    const type = fields[0].toUpperCase();
    if (type === 'AND' || type === 'OR' || type === 'NOT') {
      const expression = fields[1];
      if (!expression.startsWith('(') || !expression.endsWith(')')) {
        this.accountOtherRule('INVALID');
        return null;
      }
      const children = splitLogicalFields(expression.slice(1, -1));
      if (!children?.length || (type === 'NOT' && children.length !== 1)) {
        this.accountOtherRule('INVALID');
        return null;
      }
      const converted: string[] = [];
      for (const child of children) {
        if (!child.startsWith('(') || !child.endsWith(')')) {
          this.accountOtherRule('INVALID');
          return null;
        }
        const value = this.convertLogicalRule(child.slice(1, -1), depth + 1);
        // Reject the entire expression: removing a predicate changes its meaning.
        if (value === null) return null;
        converted.push(`(${value})`);
      }
      return `${type},(${converted.join(',')})`;
    }

    const canonicalType = ({ NETWORK: 'PROTOCOL', 'DST-PORT': 'DEST-PORT', 'SRC-IP': 'SRC-IP-CIDR', 'SRC-IP-CIDR6': 'SRC-IP-CIDR' } as Record<string, string>)[type] ?? type;
    const accounted = this.accountOtherRule(`${canonicalType},${fields.slice(1).join(',')}`);
    if (accounted === 'skip' || accounted === 'unknown' || !this.accepts(accounted)) return null;
    const value = fields[1];
    if (canonicalType === 'PROTOCOL') {
      if (value.toUpperCase() !== 'UDP' && value.toUpperCase() !== 'TCP') {
        this.accountOtherRule('INVALID');
        return null;
      }
      return `NETWORK,${value.toUpperCase()}`;
    }
    if (canonicalType === 'DEST-PORT') return `DST-PORT,${value}`;
    if (canonicalType === 'SRC-IP-CIDR') {
      const version = fastIpVersion(value.split('/')[0]);
      if (version !== 4 && version !== 6) {
        this.accountOtherRule('INVALID');
        return null;
      }
      return `${version === 6 ? 'SRC-IP-CIDR6' : 'SRC-IP-CIDR'},${value.includes('/') ? value : value + (version === 6 ? '/128' : '/32')}`;
    }
    return cleanPolicy(`${type},${fields.slice(1).join(',')}`);
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
}

/** Split logical syntax without interpreting commas inside child expressions or quoted values. */
function splitLogicalFields(value: string): string[] | null {
  const fields: string[] = [];
  let start = 0;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < value.length; i++) {
    const character = value[i];
    if (escaped) { escaped = false; continue; }
    if (character === '\\') { escaped = true; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (character === '(') depth++;
    if (character === ')' && --depth < 0) return null;
    if (character === ',' && depth === 0) {
      fields.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (depth !== 0 || quoted || escaped) return null;
  fields.push(value.slice(start).trim());
  return fields.every(field => field.length > 0) ? fields : null;
}
