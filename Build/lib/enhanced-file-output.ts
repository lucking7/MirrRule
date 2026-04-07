import process from 'node:process';
import type { Span } from '../trace';
import { FileOutput } from './rules/base';
import { createStrategiesForTargets, normalizeTargets } from './platform-config';
import type { SupportedPlatform } from './platform-config';
import type { FileConfig, RuleGroup, SpecialRuleConfig } from './rule-source-types';
import { cleanPolicy } from './policy-cleaner';
import { smartConvertRule } from './misc';
import { RuleLineUtils } from '../utils/validation/validators';

const RULE_TYPE_MAP: Record<string, string> = {
  DOMAIN: 'domain',
  'DOMAIN-SUFFIX': 'domain-suffix',
  'DOMAIN-KEYWORD': 'domain-keyword',
  'DOMAIN-WILDCARD': 'domain-wildcard',
  'IP-CIDR': 'ip-cidr',
  'IP-CIDR6': 'ip-cidr6',
  'IP-ASN': 'ip-asn',
  'USER-AGENT': 'user-agent',
  'PROCESS-NAME': 'process-name',
  'URL-REGEX': 'url-regex',
};

type EnhancedFileConfig = FileConfig & {
  validate?: boolean;
};

export class EnhancedFileOutput extends FileOutput {
  private readonly stats = {
    inputDomains: 0,
    inputCIDRs: 0,
    inputOthers: 0,
  };

  private readonly config: {
    keepComments: boolean;
    keepEmptyLines: boolean;
    keepInlineComments: boolean;
    formatConversion: boolean;
    applyNoResolve: boolean;
    validate: boolean;
    dedup: boolean;
    sort: boolean;
  };

  constructor(
    span: Span,
    id: string,
    _ruleType: 'domainset' | 'non_ip' | 'ip' | 'mixed' | '',
    targets: SupportedPlatform[] = ['surge'],
    private readonly defaultPolicy: string | null = null,
    config?: Partial<EnhancedFileConfig>,
    outputBaseDir = 'public'
  ) {
    super(span, id);

    this.config = {
      keepComments: config?.keepComments ?? false,
      keepEmptyLines: config?.keepEmptyLines ?? false,
      keepInlineComments: config?.keepInlineComments ?? false,
      formatConversion: config?.formatConversion ?? true,
      applyNoResolve: config?.applyNoResolve ?? false,
      validate: config?.validate ?? false,
      dedup: config?.dedup ?? true,
      sort: config?.sort ?? true,
    };

    this.strategies = createStrategiesForTargets(targets, outputBaseDir);
  }

  /**
   * 智能添加规则 - 自动分发到 Trie/Set（自动去重+懒惰合并）
   */
  public addRawRule(rule: string): this {
    let trimmed = rule.trim();

    if (!trimmed) {
      if (this.config.keepEmptyLines) {
        this.otherRules.push('');
      }
      return this;
    }

    if (RuleLineUtils.shouldSkipLine(trimmed)) {
      if (this.config.keepComments && RuleLineUtils.isComment(trimmed)) {
        this.otherRules.push(trimmed);
      }
      return this;
    }

    if (!this.config.keepInlineComments) {
      trimmed = RuleLineUtils.removeInlineComment(trimmed);
    }

    let normalizedRule = trimmed;
    if (this.config.formatConversion) {
      normalizedRule = smartConvertRule(trimmed);
    }

    if (this.config.validate && !RuleLineUtils.isValidRule(normalizedRule)) {
      return this;
    }

    if (this.config.applyNoResolve) {
      normalizedRule = this.applyNoResolveParameter(normalizedRule);
    }

    const processedRule =
      this.defaultPolicy === null ? cleanPolicy(normalizedRule) : normalizedRule;

    const ruleType = this.detectRuleType(processedRule);

    switch (ruleType) {
      case 'domain': {
        const domain = this.extractDomain(processedRule);

        if (domain && !RuleLineUtils.isSukkaWatermark(domain)) {
          this.domainTrie.add(domain, false);
          if (process.env.DEBUG) this.stats.inputDomains++;
        }
        break;
      }

      case 'domain-suffix': {
        const suffix = this.extractDomain(processedRule);

        if (suffix && !RuleLineUtils.isSukkaWatermark(suffix)) {
          const lineFromDot = suffix.startsWith('.');
          this.domainTrie.add(
            lineFromDot ? suffix.slice(1) : suffix,
            true,
            null,
            lineFromDot ? 1 : 0
          );
          if (process.env.DEBUG) this.stats.inputDomains++;
        }
        break;
      }

      case 'domain-keyword': {
        const keyword = processedRule.split(',')[1]?.trim();
        if (keyword) {
          this.domainKeywords.add(keyword);
        }
        break;
      }

      case 'domain-wildcard': {
        const wildcard = this.extractDomain(processedRule);
        if (wildcard) {
          this.wildcardTrie.add(wildcard);
        }
        break;
      }

      case 'ip-cidr': {
        const cidr = processedRule.split(',')[1]?.trim();
        if (cidr) {
          const noResolve = processedRule.includes('no-resolve');
          (noResolve ? this.ipcidrNoResolve : this.ipcidr).add(cidr);
          if (process.env.DEBUG) this.stats.inputCIDRs++;
        }
        break;
      }

      case 'ip-cidr6': {
        const cidr6 = processedRule.split(',')[1]?.trim();
        if (cidr6) {
          const noResolve = processedRule.includes('no-resolve');
          (noResolve ? this.ipcidr6NoResolve : this.ipcidr6).add(cidr6);
          if (process.env.DEBUG) this.stats.inputCIDRs++;
        }
        break;
      }

      case 'ip-asn': {
        const asn = processedRule.split(',')[1]?.trim();
        if (asn) {
          const noResolve = processedRule.includes('no-resolve');
          (noResolve ? this.ipasnNoResolve : this.ipasn).add(asn);
        }
        break;
      }

      case 'user-agent': {
        const ua = processedRule.split(',')[1]?.trim();
        if (ua) {
          this.userAgent.add(ua);
        }
        break;
      }

      case 'process-name': {
        const proc = processedRule.split(',')[1]?.trim();
        if (proc) {
          if (proc.includes('/') || proc.includes('\\')) {
            this.processPath.add(proc);
          } else {
            this.processName.add(proc);
          }
        }
        break;
      }

      case 'url-regex': {
        const regex = processedRule.split(',').slice(1).join(',');
        if (regex) {
          this.urlRegex.add(regex);
        }
        break;
      }

      default:
        this.otherRules.push(processedRule);
        if (process.env.DEBUG) this.stats.inputOthers++;
    }

    return this;
  }

  /**
   * 检测规则类型
   */
  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- helper for rule classification does not depend on instance state
  private detectRuleType(rule: string): string {
    const comma = rule.indexOf(',');
    if (comma === -1) return 'other';
    const type = rule.slice(0, comma).toUpperCase().trim();
    return RULE_TYPE_MAP[type] || 'other';
  }

  /**
   * 提取域名部分
   */
  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- helper for extracting domain segment does not depend on instance state
  private extractDomain(rule: string): string {
    const parts = rule.split(',');
    return parts[1]?.trim() || '';
  }

  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- pure transformation helper does not depend on instance state
  private applyNoResolveParameter(rule: string): string {
    const trimmed = rule.trim();
    const upperRule = trimmed.toUpperCase();

    const isIpRule =
      upperRule.startsWith('IP-CIDR,') ||
      upperRule.startsWith('IP-CIDR6,') ||
      upperRule.startsWith('GEOIP,') ||
      upperRule.startsWith('IP-ASN,') ||
      upperRule.startsWith('SRC-IP-CIDR,');

    if (!isIpRule) {
      return rule;
    }

    if (upperRule.includes('NO-RESOLVE')) {
      return rule;
    }

    return `${trimmed},no-resolve`;
  }

  /**
   * 批量添加规则（支持多种格式）
   */
  public addRules(rules: string[]): this {
    rules.forEach(rule => this.addRawRule(rule));
    return this;
  }

  /**
   * 完成添加 - 输出统计信息（DEBUG 模式）
   */
  async done() {
    await super.done();

    if (process.env.DEBUG) {
      const outputDomains = this.countTrieNodes();
      const outputCIDRs =
        this.ipcidr.size +
        this.ipcidrNoResolve.size +
        this.ipcidr6.size +
        this.ipcidr6NoResolve.size;

      console.log(`[${this.id}] Stats: ${this.stats.inputDomains} domains, ${this.stats.inputCIDRs} CIDRs, ${this.stats.inputOthers} others -> ~${outputDomains} domains, ${outputCIDRs} CIDRs`);
    }

    return this;
  }

  /**
   * 估算 Trie 节点数（近似输出规则数）
   */
  private countTrieNodes(): number {
    let count = 0;
    try {
      this.domainTrie.dump(() => count++);
    } catch {
      // Trie 可能为空
    }
    return count;
  }

  /**
   * 从配置创建增强输出器
   */
  static fromConfig(
    this: void,
    span: Span,
    config: RuleGroup | SpecialRuleConfig
  ): EnhancedFileOutput {
    const effectiveTargets = normalizeTargets('targets' in config ? config.targets : undefined);

    const defaultPolicy =
      'defaultPolicy' in config
        ? (config.defaultPolicy === undefined
          ? null
          : config.defaultPolicy)
        : null;

    return new EnhancedFileOutput(span, config.name, 'mixed', effectiveTargets, defaultPolicy);
  }
}
