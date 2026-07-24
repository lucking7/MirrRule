import type { Span } from '../../../trace';
import { compareAndWriteFile } from '../../../lib/create-file';
import type { CanonicalRuleType, RulePlatform } from '../rule-support-matrix';
import { MALFORMED_RULE_POLICY, RULE_SUPPORT_MATRIX } from '../rule-support-matrix';

export interface RuleDropSummary {
  unsupported: Partial<Record<CanonicalRuleType, number>>;
  malformed: number;
  unknown: Record<string, number>;
}

/**
 * The class is not about holding rule data, instead it determines how the
 * date is written to a file.
 */
export abstract class BaseWriteStrategy {
  public abstract readonly platform: RulePlatform;
  public abstract readonly name: string;

  /**
   * Normalize Surge rule format - standardize comma-separated format
   */
  protected static normalizeSurgeRule(rule: string): string {
    const trimmed = rule.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!') || !trimmed.includes(',')) {
      return trimmed;
    }
    return trimmed.split(',').map(part => part.trim()).join(',');
  }

  /**
   * Parse a rule string into components - shared across all writing strategies
   */
  protected static parseRuleString(rule: string): { ruleType: string; value: string; params: string } | null {
    const trimmed = rule.trim();
    const parts = trimmed.split(',');
    if (parts.length < 2) return null;
    return {
      ruleType: parts[0].trim().toUpperCase(),
      value: parts[1].trim(),
      params: parts.slice(2).join(','),
    };
  }

  /**
   * Write CIDR rules with optional no-resolve parameter
   */
  protected writeCidrRules(
    result: string[],
    cidrs: string[],
    ruleType: string,
    noResolve: boolean
  ): void {
    for (let i = 0, len = cidrs.length; i < len; i++) {
      result.push(`${ruleType},${cidrs[i]}${noResolve ? ',no-resolve' : ''}`);
    }
  }

  /**
   * Sometimes a ruleset will create extra files (e.g. reject-url-regex w/ mitm.sgmodule),
   * and doesn't share the same filename and id. This property is used to overwrite the filename.
   */
  public overwriteFilename: string | null = null;
  public withFilename(filename: string) {
    this.overwriteFilename = filename;
    return this;
  }

  public abstract readonly type: 'domainset' | 'non_ip' | 'ip' | (string & {});

  abstract readonly fileExtension:
    | 'conf'
    | 'txt'
    | 'json'
    | 'sgmodule'
    | 'list'; /* | (string & {}) */

  constructor(public readonly outputDir: string) {}

  private readonly dropSummary: RuleDropSummary = { unsupported: {}, malformed: 0, unknown: {} };

  protected accepts(type: CanonicalRuleType, count = 1): boolean {
    const support = RULE_SUPPORT_MATRIX[this.platform][type];
    if (support.status !== 'explicitly-unsupported') return true;
    this.dropSummary.unsupported[type] = (this.dropSummary.unsupported[type] ?? 0) + count;
    return false;
  }

  protected accountOtherRule(rule: string): 'skip' | 'unknown' | CanonicalRuleType {
    const trimmed = rule.trim();
    if (trimmed.startsWith('#') || trimmed.startsWith('!')) return 'skip';
    const comma = trimmed.indexOf(',');
    if (comma < 1 || !trimmed.slice(comma + 1).trim()) {
      this.dropSummary.malformed++;
      if (MALFORMED_RULE_POLICY.failBuild) throw new Error(`${this.platform}: malformed rule: ${rule}`);
      return 'skip';
    }
    const type = trimmed.slice(0, comma).trim().toUpperCase();
    if (type in RULE_SUPPORT_MATRIX[this.platform]) return type as CanonicalRuleType;
    this.dropSummary.unknown[type || '(empty)'] = (this.dropSummary.unknown[type || '(empty)'] ?? 0) + 1;
    return 'unknown';
  }

  public get ruleDropSummary(): RuleDropSummary {
    return {
      unsupported: { ...this.dropSummary.unsupported },
      malformed: this.dropSummary.malformed,
      unknown: { ...this.dropSummary.unknown },
    };
  }

  public getRuleDropMessages(): string[] {
    const messages: string[] = [];
    for (const type of Object.keys(this.dropSummary.unsupported).sort()) {
      const count = this.dropSummary.unsupported[type as CanonicalRuleType] ?? 0;
      messages.push(`${this.platform}: dropped ${count} rules of type ${type} (unsupported)`);
    }
    if (this.dropSummary.malformed) messages.push(`${this.platform}: dropped ${this.dropSummary.malformed} malformed rules`);
    for (const type of Object.keys(this.dropSummary.unknown).sort()) {
      messages.push(`${this.platform}: dropped ${this.dropSummary.unknown[type]} rules of type ${type} (unknown)`);
    }
    return messages;
  }

  protected abstract result: string[] | null;

  abstract writeDomain(domain: string): void;
  abstract writeDomainSuffix(domain: string): void;
  abstract writeDomainKeywords(keyword: Set<string>): void;
  abstract writeDomainWildcard(wildcard: string): void;
  abstract writeUserAgents(userAgent: Set<string>): void;
  abstract writeProcessNames(processName: Set<string>): void;
  abstract writeProcessPaths(processPath: Set<string>): void;
  abstract writeUrlRegexes(urlRegex: Set<string>): void;
  abstract writeIpCidrs(ipCidr: string[], noResolve: boolean): void;
  abstract writeIpCidr6s(ipCidr6: string[], noResolve: boolean): void;
  abstract writeGeoip(geoip: Set<string>, noResolve: boolean): void;
  abstract writeIpAsns(asns: Set<string>, noResolve: boolean): void;
  abstract writeSourceIpCidrs(sourceIpCidr: string[]): void;
  abstract writeSourcePorts(port: Set<string>): void;
  abstract writeDestinationPorts(port: Set<string>): void;
  abstract writeProtocols(protocol: Set<string>): void;
  abstract writeOtherRules(rule: string[]): void;

  protected abstract withPadding(
    title: string,
    description: string[] | readonly string[],
    date: Date,
    content: string[]
  ): string[];

  static readonly domainWildCardToRegex = (domain: string) => {
    let result = '^';
    for (let i = 0, len = domain.length; i < len; i++) {
      switch (domain[i]) {
        case '.':
          result += String.raw`\.`;
          break;
        case '*':
          result += String.raw`[\w.-]*?`;
          break;
        case '?':
          result += String.raw`[\w.-]`;
          break;
        default:
          result += domain[i];
      }
    }
    result += '$';
    return result;
  };

  public output(
    span: Span,
    title: string,
    description: string[] | readonly string[],
    date: Date,
    filePath: string
  ): void | Promise<void> {
    if (!this.result) {
      return;
    }

    for (const message of this.getRuleDropMessages()) console.warn(message);

    return compareAndWriteFile(
      span,
      this.withPadding(title, description, date, this.result),
      filePath
    );
  }

  public get content() {
    return this.result;
  }
}
