import { splitLogicalFields } from './logical-fields';
import type { Span } from '../../../trace';
import { compareAndWriteFile } from '../../../lib/create-file';
import { smartConvertRule } from '../../../lib/misc';
import { cleanPolicy } from '../../../lib/policy-cleaner';
import type { CanonicalRuleType, RulePlatform } from '../rule-support-matrix';
import { MALFORMED_RULE_POLICY, RULE_SUPPORT_MATRIX } from '../rule-support-matrix';
import { RuleLineUtils } from '../../../utils/validation/validators';

export interface RuleDropSummary {
  unsupported: Partial<Record<CanonicalRuleType, number>>;
  malformed: number;
  unknown: Record<string, number>;
}

/** Conversion losses that the drop summary does not cover: dropped values and ignored modifiers. */
export interface RuleConversionLosses {
  /** Keyed by `TYPE:value`, for values of a supported type that the platform cannot express. */
  droppedValues: Record<string, number>;
  /** Modifiers such as no-resolve that the platform output cannot carry. */
  ignoredModifiers: Record<string, number>;
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

  public abstract readonly type: 'domainset' | 'non_ip' | 'ip' | (string & {});

  abstract readonly fileExtension:
    | 'conf'
    | 'txt'
    | 'json'
    | 'sgmodule'
    | 'list'; /* | (string & {}) */

  constructor(public readonly outputDir: string) {}

  private readonly dropSummary: RuleDropSummary = { unsupported: {}, malformed: 0, unknown: {} };
  private readonly losses: RuleConversionLosses = { droppedValues: {}, ignoredModifiers: {} };

  protected recordDroppedValue(type: string, value: string, count = 1): void {
    const key = `${type}:${value}`;
    this.losses.droppedValues[key] = (this.losses.droppedValues[key] ?? 0) + count;
  }

  protected recordIgnoredModifier(modifier: string, count = 1): void {
    if (count > 0) this.losses.ignoredModifiers[modifier] = (this.losses.ignoredModifiers[modifier] ?? 0) + count;
  }

  public get conversionLosses(): RuleConversionLosses {
    return {
      droppedValues: { ...this.losses.droppedValues },
      ignoredModifiers: { ...this.losses.ignoredModifiers },
    };
  }

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

  protected abstract result: string[];

  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- platform hook, overridden by writers that require validation
  validateForPublication(): void { return undefined; }

  // Other platforms have no equivalent of Surge RULE-SET extended domain matching.
  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- platform hook, only Surge changes domain matcher behavior
  setExtendedDomainMatching(_enabled: boolean): void { return undefined; }

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
  writeOtherRules(rules: string[]): void {
    for (const rule of rules) {
      const trimmed = rule.trim();
      if (RuleLineUtils.shouldSkipLine(trimmed)) continue;
      const type = this.accountOtherRule(trimmed);
      if (type === 'skip' || type === 'unknown' || !this.accepts(type)) continue;
      const converted = cleanPolicy(smartConvertRule(trimmed));
      const supported = type === 'AND' || type === 'OR' || type === 'NOT'
        ? this.convertSupportedLogicalRule(converted) : converted;
      if (supported !== null) this.result.push(supported);
    }
  }

  /** A failed child rejects its whole expression; deleting it would change matching semantics. */
  protected convertSupportedLogicalRule(rule: string, stripPolicy = true, depth = 0): string | null {
    const fields = splitLogicalFields(rule);
    if (fields === null || fields.length < 2 || depth > 64) {
      this.accountOtherRule('INVALID');
      return null;
    }
    const type = fields[0].toUpperCase();
    if (type === 'AND' || type === 'OR' || type === 'NOT') {
      const expression = fields[1];
      const children = expression.startsWith('(') && expression.endsWith(')')
        ? splitLogicalFields(expression.slice(1, -1)) : null;
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
        const value = this.convertSupportedLogicalRule(child.slice(1, -1), stripPolicy, depth + 1);
        if (value === null) return null;
        converted.push(`(${value})`);
      }
      return `${type},(${converted.join(',')})${fields.length > 2 ? ',' + fields.slice(2).join(',') : ''}`;
    }
    const canonicalType = ({ 'SRC-IP': 'SRC-IP-CIDR', 'SRC-IP-CIDR6': 'SRC-IP-CIDR', 'DST-PORT': 'DEST-PORT', NETWORK: 'PROTOCOL' } as Record<string, string>)[type] ?? type;
    const accounted = this.accountOtherRule(`${canonicalType},${fields.slice(1).join(',')}`);
    if (accounted === 'skip' || accounted === 'unknown' || !this.accepts(accounted)) return null;
    const outputType = this.platform === 'surge'
      ? ({ 'PROCESS-PATH': 'PROCESS-NAME', 'SRC-IP-CIDR': 'SRC-IP' } as Record<string, string>)[canonicalType] ?? canonicalType
      : canonicalType;
    const modifiers = stripPolicy
      ? cleanPolicy(`${outputType},placeholder,${fields.slice(2).join(',')}`).split(',').slice(2)
      : fields.slice(2);
    return `${outputType},${fields[1]}${modifiers.length ? ',' + modifiers.join(',') : ''}`;
  }

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
  ): Promise<void> {
    this.validateForPublication();
    for (const message of this.getRuleDropMessages()) console.warn(message);

    return compareAndWriteFile(
      span,
      this.render(title, description, date),
      filePath
    );
  }

  /** Final file lines, including the platform banner, without writing them. */
  public render(title: string, description: string[] | readonly string[], date: Date): string[] {
    return this.withPadding(title, description, date, this.result);
  }

  public get content() {
    return this.result;
  }
}
