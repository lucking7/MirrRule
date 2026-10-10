import process from 'node:process';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Hash } from 'node:crypto';
import type { Span } from '../trace';
import { HostnameSmolTrie } from '../utils/data-structures/trie';
import { nullthrow } from 'foxts/guard';
import { createRetrieKeywordFilter as createKeywordFilter } from 'foxts/retrie';
import type { BaseWriteStrategy, RuleConversionLosses, RuleDropSummary } from '../core/output/writing-strategy/base';
import type { RulePlatform } from '../core/output/rule-support-matrix';
import { compareAndWriteFile } from './create-file';
import { createStrategiesForTargets, createVariantStrategy, normalizeTargets } from './platform-config';
import type { SupportedPlatform } from './platform-config';
import type { RuleProcessingOptions } from './rule-source-types';
import { classifyRuleLine, hasDomainMatcherSubRule, resolveRuleOutputTarget, RULE_OUTPUT_VARIANTS } from './rule-output-variants';
import type { RuleOutputSlot, RuleOutputVariant } from './rule-output-variants';
import { countEffectiveConditions, sha256Hex } from './output-audit';
import type { RuleOutputFileAudit, RulesetOutputAudit, RulesetStageCounts } from './output-audit';
import { cleanPolicy } from './policy-cleaner';
import { smartConvertRule } from './misc';
import { RuleLineUtils } from '../utils/validation/validators';
import { merge as mergeCidr } from 'fast-cidr-tools';

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
  'PROCESS-PATH': 'process-path',
  'URL-REGEX': 'url-regex',
  GEOIP: 'geoip',
  'SRC-IP': 'source-ip-cidr',
  'SRC-IP-CIDR': 'source-ip-cidr',
  'SRC-IP-CIDR6': 'source-ip-cidr',
  'SRC-PORT': 'source-port',
  'DEST-PORT': 'destination-port',
  'DST-PORT': 'destination-port',
  PROTOCOL: 'protocol',
  NETWORK: 'protocol',
};

/** One platform's merged writer plus the three mutually exclusive variant writers. */
interface PlatformOutputs {
  platform: SupportedPlatform;
  merged: BaseWriteStrategy;
  variants: Record<RuleOutputVariant, BaseWriteStrategy>;
  routed: Record<RuleOutputVariant, number>;
  /** Surge RULE-SET extended matching cannot be expressed by DOMAIN-SET. */
  domainVariant: RuleOutputVariant;
  /** Logical rules kept in non_ip instead of ip to preserve Surge extended matching. */
  reroutedFromIp: number;
}

const EXTENDED_MATCHER_TYPES: ReadonlySet<string> = new Set([
  'DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'DOMAIN-WILDCARD', 'URL-REGEX',
]);

function getDomainVariant(outputs: PlatformOutputs): RuleOutputVariant {
  return outputs.domainVariant;
}

interface StagedOutput {
  audit: RuleOutputFileAudit;
  filePath: string;
  lines: string[] | null;
}

/**
 * Normalizes rules, owns canonical state, and delegates platform output to writing strategies.
 */
export class EnhancedFileOutput {
  private readonly targets: SupportedPlatform[];
  private readonly strategies: BaseWriteStrategy[];
  private readonly platformOutputs: PlatformOutputs[];
  private readonly span: Span;

  private readonly domainTrie = new HostnameSmolTrie(null);
  private readonly wildcardTrie = new HostnameSmolTrie(null);
  private readonly domainKeywords = new Set<string>();
  private readonly userAgent = new Set<string>();
  private readonly processName = new Set<string>();
  private readonly processPath = new Set<string>();
  private readonly urlRegex = new Set<string>();
  private readonly ipcidr = new Set<string>();
  private readonly ipcidrNoResolve = new Set<string>();
  private readonly ipasn = new Set<string>();
  private readonly ipasnNoResolve = new Set<string>();
  private readonly ipcidr6 = new Set<string>();
  private readonly ipcidr6NoResolve = new Set<string>();
  private readonly geoip = new Set<string>();
  private readonly groipNoResolve = new Set<string>();
  private readonly sourceIpOrCidr = new Set<string>();
  private readonly sourcePort = new Set<string>();
  private readonly destPort = new Set<string>();
  private readonly protocol = new Set<string>();
  private readonly otherRules: string[] = [];

  private title: string | null = null;
  private description: string[] | null = null;
  private readonly date = new Date();
  private strategiesWritten = false;
  private extendedDomainMatching = false;

  private readonly stats = {
    inputDomains: 0,
    inputCIDRs: 0,
    inputOthers: 0,
  };

  private readonly stageCounts: Omit<RulesetStageCounts, 'canonicalCount'> = {
    inputLines: 0,
    filtered: { emptyLines: 0, commentsOrMarkers: 0, excludedRuleType: 0, sourcePolicy: 0, invalid: 0 },
  };

  private readonly rawInputHash: Hash = createHash('sha256');
  private publicationAudit: RulesetOutputAudit | null = null;

  private readonly config: {
    keepComments: boolean;
    keepEmptyLines: boolean;
    keepInlineComments: boolean;
    formatConversion: boolean;
    applyNoResolve: boolean;
    validate: boolean;
    sourcePolicies: readonly string[] | undefined;
    excludedRuleTypes: ReadonlySet<string>;
  };

  constructor(
    span: Span,
    private readonly id: string,
    targets: SupportedPlatform[] = ['surge'],
    private readonly defaultPolicy: string | null = null,
    config?: RuleProcessingOptions,
    private readonly outputBaseDir = 'public'
  ) {
    this.span = span.traceChild('RuleOutput#' + id);

    this.config = {
      keepComments: config?.keepComments ?? false,
      keepEmptyLines: config?.keepEmptyLines ?? false,
      keepInlineComments: config?.keepInlineComments ?? false,
      formatConversion: config?.formatConversion ?? true,
      applyNoResolve: config?.applyNoResolve ?? false,
      validate: config?.validate ?? false,
      sourcePolicies: config?.sourcePolicies?.map(policy => policy.trim().toLowerCase()),
      excludedRuleTypes: new Set(config?.excludedRuleTypes?.map(type => type.trim().toUpperCase())),
    };

    this.targets = normalizeTargets(targets);
    this.strategies = createStrategiesForTargets(this.targets, outputBaseDir);
    this.platformOutputs = this.targets.map((platform, index) => ({
      platform,
      merged: this.strategies[index],
      variants: {
        domainset: createVariantStrategy(platform, 'domainset', outputBaseDir),
        non_ip: createVariantStrategy(platform, 'non_ip', outputBaseDir),
        ip: createVariantStrategy(platform, 'ip', outputBaseDir),
      },
      routed: { domainset: 0, non_ip: 0, ip: 0 },
      domainVariant: 'domainset',
      reroutedFromIp: 0,
    }));
  }

  /**
   * 智能添加规则 - 自动分发到 Trie/Set（自动去重+懒惰合并）
   */
  public addRawRule(rule: string): this {
    this.stageCounts.inputLines++;
    this.rawInputHash.update(rule).update('\n');
    let trimmed = RuleLineUtils.stripYamlListPrefix(rule.trim());

    if (!trimmed) {
      this.stageCounts.filtered.emptyLines++;
      if (this.config.keepEmptyLines) {
        this.otherRules.push('');
      }
      return this;
    }

    if (RuleLineUtils.shouldSkipLine(trimmed)) {
      this.stageCounts.filtered.commentsOrMarkers++;
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

    if (this.hasExcludedRuleType(normalizedRule)) {
      this.stageCounts.filtered.excludedRuleType++;
      return this;
    }

    if (this.config.sourcePolicies !== undefined) {
      const sourcePolicy = normalizedRule.split(',').at(2)?.trim().toLowerCase();
      if (sourcePolicy === undefined || !this.config.sourcePolicies.includes(sourcePolicy)) {
        this.stageCounts.filtered.sourcePolicy++;
        return this;
      }
    }

    if (this.config.validate && !RuleLineUtils.isValidRule(normalizedRule)) {
      this.stageCounts.filtered.invalid++;
      return this;
    }

    if (this.config.applyNoResolve) {
      normalizedRule = this.applyNoResolveParameter(normalizedRule);
    }

    const processedRule =
      this.defaultPolicy === null ? cleanPolicy(normalizedRule) : normalizedRule;

    const ruleType = this.detectRuleType(processedRule);

    // Surge applies this parameter to every domain rule in the external RULE-SET.
    if (ruleType.startsWith('domain') && processedRule.split(',').slice(2).some(
      parameter => parameter.trim().toLowerCase() === 'extended-matching'
    )) this.extendedDomainMatching = true;

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
          const noResolve = processedRule.toLowerCase().includes('no-resolve');
          (noResolve ? this.ipcidrNoResolve : this.ipcidr).add(cidr);
          if (process.env.DEBUG) this.stats.inputCIDRs++;
        }
        break;
      }

      case 'ip-cidr6': {
        const cidr6 = processedRule.split(',')[1]?.trim();
        if (cidr6) {
          const noResolve = processedRule.toLowerCase().includes('no-resolve');
          (noResolve ? this.ipcidr6NoResolve : this.ipcidr6).add(cidr6);
          if (process.env.DEBUG) this.stats.inputCIDRs++;
        }
        break;
      }

      case 'ip-asn': {
        const asn = processedRule.split(',')[1]?.trim();
        if (asn) {
          const noResolve = processedRule.toLowerCase().includes('no-resolve');
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

      case 'process-path': {
        const proc = processedRule.split(',')[1]?.trim();
        if (proc) this.processPath.add(proc);
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

      case 'geoip': {
        const value = processedRule.split(',')[1]?.trim();
        if (value) {
          const noResolve = processedRule.toLowerCase().includes('no-resolve');
          (noResolve ? this.groipNoResolve : this.geoip).add(value);
        } else {
          this.otherRules.push(processedRule);
        }
        break;
      }

      case 'source-ip-cidr': {
        const value = processedRule.split(',')[1]?.trim();
        if (value) this.sourceIpOrCidr.add(value);
        else this.otherRules.push(processedRule);
        break;
      }

      case 'source-port': {
        const value = processedRule.split(',')[1]?.trim();
        if (value) this.sourcePort.add(value);
        else this.otherRules.push(processedRule);
        break;
      }

      case 'destination-port': {
        const value = processedRule.split(',')[1]?.trim();
        if (value) this.destPort.add(value);
        else this.otherRules.push(processedRule);
        break;
      }

      case 'protocol': {
        const value = processedRule.split(',')[1]?.trim();
        if (value) this.protocol.add(value.toUpperCase());
        else this.otherRules.push(processedRule);
        break;
      }

      default:
        this.otherRules.push(processedRule);
        if (process.env.DEBUG) this.stats.inputOthers++;
    }

    return this;
  }

  private hasExcludedRuleType(rule: string): boolean {
    if (this.config.excludedRuleTypes.size === 0) return false;
    const type = rule.split(',', 1)[0].trim().toUpperCase();
    if (this.config.excludedRuleTypes.has(type)) return true;
    if (type !== 'AND' && type !== 'OR' && type !== 'NOT') return false;

    // Drop the whole expression: removing a child could broaden AND or invert NOT.
    for (const child of rule.matchAll(/\(\s*([A-Z][A-Z0-9-]*)\s*,/gi)) {
      if (this.config.excludedRuleTypes.has(child[1].toUpperCase())) return true;
    }
    return false;
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
    await Promise.resolve(this);

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
   * Return the canonical, platform-independent ruleset size after normalization,
   * trie/set deduplication, and IPv4 CIDR merging. Platform support filtering is
   * intentionally not reflected in this logical count.
   */
  public getOutputSummary(): { id: string; platforms: SupportedPlatform[]; ruleCount: number } {
    let wildcardCount = 0;
    this.wildcardTrie.dump(() => wildcardCount++);

    const mergeCount = (values: Set<string>) => (
      values.size ? mergeCidr(Array.from(values), true).length : 0
    );
    const otherRuleCount = new Set(
      this.otherRules.filter(rule => {
        const trimmed = rule.trim();
        return trimmed.length > 0 && !RuleLineUtils.isComment(trimmed);
      })
    ).size;

    return {
      id: this.id,
      platforms: [...this.targets],
      ruleCount:
        this.countTrieNodes() +
        wildcardCount +
        this.domainKeywords.size +
        this.userAgent.size +
        this.processName.size +
        this.processPath.size +
        this.urlRegex.size +
        mergeCount(this.ipcidr) +
        mergeCount(this.ipcidrNoResolve) +
        this.ipcidr6.size +
        this.ipcidr6NoResolve.size +
        this.ipasn.size +
        this.ipasnNoResolve.size +
        this.geoip.size +
        this.groipNoResolve.size +
        this.sourceIpOrCidr.size +
        this.sourcePort.size +
        this.destPort.size +
        this.protocol.size +
        otherRuleCount,
    };
  }

  withTitle(title: string) {
    this.title = title;
    return this;
  }

  withDescription(description: string[] | readonly string[]) {
    this.description = description as string[];
    return this;
  }

  /** Write to the merged writer and to the one variant writer that owns this condition class. */
  private route(
    variantFor: RuleOutputVariant | ((outputs: PlatformOutputs) => RuleOutputVariant),
    count: number,
    write: (strategy: BaseWriteStrategy) => void
  ) {
    for (const outputs of this.platformOutputs) {
      const variant = typeof variantFor === 'function' ? variantFor(outputs) : variantFor;
      write(outputs.merged);
      write(outputs.variants[variant]);
      outputs.routed[variant] += count;
    }
  }

  private writeToStrategies() {
    if (this.strategiesWritten) {
      throw new Error('Strategies already written');
    }

    this.strategiesWritten = true;

    // DOMAIN-KEYWORD covers matching DOMAIN, DOMAIN-SUFFIX, and DOMAIN-WILDCARD rules.
    const kwfilter = createKeywordFilter(Array.from(this.domainKeywords));

    for (const outputs of this.platformOutputs) {
      // Surge DOMAIN-SET cannot carry RULE-SET extended matching, so those domains stay in non_ip.
      outputs.domainVariant = outputs.platform === 'surge' && this.extendedDomainMatching ? 'non_ip' : 'domainset';
      outputs.merged.setExtendedDomainMatching(this.extendedDomainMatching);
      for (const variant of RULE_OUTPUT_VARIANTS) {
        outputs.variants[variant].setExtendedDomainMatching(this.extendedDomainMatching);
      }
    }

    this.domainTrie.dumpWithoutDot((domain, includeAllSubdomain) => {
      if (kwfilter(domain)) {
        return;
      }

      if (RuleLineUtils.isSukkaWatermark(domain)) {
        return;
      }

      this.wildcardTrie.whitelist(domain, includeAllSubdomain);

      this.route(
        getDomainVariant,
        1,
        includeAllSubdomain
          ? strategy => strategy.writeDomainSuffix(domain)
          : strategy => strategy.writeDomain(domain)
      );
    }, true);

    // Write the keywords that cover the filtered domain rules.
    if (this.domainKeywords.size) {
      this.route('non_ip', this.domainKeywords.size, strategy => strategy.writeDomainKeywords(this.domainKeywords));
    }
    if (this.protocol.size) {
      this.route('non_ip', this.protocol.size, strategy => strategy.writeProtocols(this.protocol));
    }

    this.wildcardTrie.dumpWithoutDot(wildcard => {
      if (kwfilter(wildcard)) {
        return;
      }

      this.route('non_ip', 1, strategy => strategy.writeDomainWildcard(wildcard));
    }, true);

    const sourceIpOrCidr = Array.from(this.sourceIpOrCidr);

    if (this.userAgent.size) {
      this.route('non_ip', this.userAgent.size, strategy => strategy.writeUserAgents(this.userAgent));
    }
    if (this.processName.size) {
      this.route('non_ip', this.processName.size, strategy => strategy.writeProcessNames(this.processName));
    }
    if (this.processPath.size) {
      this.route('non_ip', this.processPath.size, strategy => strategy.writeProcessPaths(this.processPath));
    }
    // SRC-IP matches the client source address and never requires destination resolution.
    if (this.sourceIpOrCidr.size) {
      this.route('non_ip', sourceIpOrCidr.length, strategy => strategy.writeSourceIpCidrs(sourceIpOrCidr));
    }
    if (this.sourcePort.size) {
      this.route('non_ip', this.sourcePort.size, strategy => strategy.writeSourcePorts(this.sourcePort));
    }
    if (this.destPort.size) {
      this.route('non_ip', this.destPort.size, strategy => strategy.writeDestinationPorts(this.destPort));
    }
    if (this.otherRules.length) {
      // Logical expressions are classified whole; a destination-IP child sends the expression to ip.
      const otherRulesByVariant: Record<RuleOutputVariant, string[]> = { domainset: [], non_ip: [], ip: [] };
      // Surge applies the RULE-SET-wide extended matching to domain sub-rules as well. The
      // Surge non_ip file keeps that context through its flagged domain rules, while the ip
      // file has no top-level domain rule to carry it, so such logical rules stay in non_ip.
      const surgeOtherRulesByVariant: Record<RuleOutputVariant, string[]> = { domainset: [], non_ip: [], ip: [] };
      let surgeRerouted = 0;
      for (const rule of this.otherRules) {
        const variant = classifyRuleLine(rule);
        if (!variant) continue;
        otherRulesByVariant[variant].push(rule);
        if (variant === 'ip' && this.extendedDomainMatching && hasDomainMatcherSubRule(rule)) {
          surgeOtherRulesByVariant.non_ip.push(rule);
          surgeRerouted++;
        } else {
          surgeOtherRulesByVariant[variant].push(rule);
        }
      }
      for (const outputs of this.platformOutputs) {
        const isSurge = outputs.platform === 'surge';
        if (isSurge) outputs.reroutedFromIp = surgeRerouted;
        const byVariant = isSurge ? surgeOtherRulesByVariant : otherRulesByVariant;
        outputs.merged.writeOtherRules(this.otherRules);
        for (const variant of RULE_OUTPUT_VARIANTS) {
          const rules = byVariant[variant];
          if (rules.length === 0) continue;
          outputs.variants[variant].writeOtherRules(rules);
          outputs.routed[variant] += rules.length;
        }
      }
    }
    if (this.geoip.size) {
      this.route('ip', this.geoip.size, strategy => strategy.writeGeoip(this.geoip, false));
    }
    if (this.urlRegex.size) {
      this.route('non_ip', this.urlRegex.size, strategy => strategy.writeUrlRegexes(this.urlRegex));
    }

    let ipcidr: string[] | null = null;
    let ipcidrNoResolve: string[] | null = null;
    let ipcidr6: string[] | null = null;
    let ipcidr6NoResolve: string[] | null = null;

    if (this.ipcidr.size) {
      ipcidr = mergeCidr(Array.from(this.ipcidr), true);
    }
    if (this.ipcidrNoResolve.size) {
      ipcidrNoResolve = mergeCidr(Array.from(this.ipcidrNoResolve), true);
    }
    if (this.ipcidr6.size) {
      ipcidr6 = Array.from(this.ipcidr6);
    }
    if (this.ipcidr6NoResolve.size) {
      ipcidr6NoResolve = Array.from(this.ipcidr6NoResolve);
    }

    // no-resolve
    if (ipcidrNoResolve) {
      const values = ipcidrNoResolve;
      this.route('ip', values.length, strategy => strategy.writeIpCidrs(values, true));
    }
    if (ipcidr6NoResolve) {
      const values = ipcidr6NoResolve;
      this.route('ip', values.length, strategy => strategy.writeIpCidr6s(values, true));
    }
    if (this.ipasnNoResolve.size) {
      this.route('ip', this.ipasnNoResolve.size, strategy => strategy.writeIpAsns(this.ipasnNoResolve, true));
    }
    if (this.groipNoResolve.size) {
      this.route('ip', this.groipNoResolve.size, strategy => strategy.writeGeoip(this.groipNoResolve, true));
    }

    // triggers DNS resolution
    if (ipcidr?.length) {
      const values = ipcidr;
      this.route('ip', values.length, strategy => strategy.writeIpCidrs(values, false));
    }
    if (ipcidr6?.length) {
      const values = ipcidr6;
      this.route('ip', values.length, strategy => strategy.writeIpCidr6s(values, false));
    }
    if (this.ipasn.size) {
      this.route('ip', this.ipasn.size, strategy => strategy.writeIpAsns(this.ipasn, false));
    }
  }

  /**
   * Render every merged and variant file and decide variant presence before any
   * write, so a validation failure leaves the previous files untouched.
   */
  private stageOutputs(): StagedOutput[] {
    const title = nullthrow(this.title, 'Missing title');
    const descriptions = nullthrow(this.description, 'Missing description');
    const staged: StagedOutput[] = [];

    for (const outputs of this.platformOutputs) {
      outputs.merged.validateForPublication();
      for (const message of outputs.merged.getRuleDropMessages()) console.warn(message);
      staged.push(this.stageOutput(outputs, 'merged', outputs.merged, title, descriptions));
      for (const variant of RULE_OUTPUT_VARIANTS) {
        staged.push(this.stageOutput(outputs, variant, outputs.variants[variant], title, [
          ...descriptions,
          `Variant: ${variant}. Combine domainset, non_ip and ip for the conditions of the merged ruleset.`,
        ]));
      }
    }
    return staged;
  }

  private stageOutput(
    outputs: PlatformOutputs,
    slot: RuleOutputSlot,
    strategy: BaseWriteStrategy,
    title: string,
    descriptions: readonly string[]
  ): StagedOutput {
    const target = resolveRuleOutputTarget(outputs.platform, slot, this.id);
    const counts = countEffectiveConditions(target.format, strategy.content);
    const routedConditionCount = slot === 'merged'
      ? outputs.routed.domainset + outputs.routed.non_ip + outputs.routed.ip
      : outputs.routed[slot];

    let status: RuleOutputFileAudit['status'] = 'published';
    let reason: RuleOutputFileAudit['reason'];
    if (slot !== 'merged') {
      if (routedConditionCount === 0) {
        status = 'absent-empty';
        reason = slot === 'domainset' && outputs.domainVariant !== 'domainset' && outputs.routed.non_ip > 0
          ? 'extended-matching'
          : 'no-conditions';
      } else if (counts.effectiveConditionCount === 0) {
        status = 'absent-unsupported';
        reason = 'platform-unsupported';
      } else {
        strategy.validateForPublication();
      }
    }

    return {
      audit: {
        platform: outputs.platform,
        variant: slot,
        format: target.format,
        path: target.relativePath,
        status,
        ...(reason && { reason }),
        routedConditionCount,
        ...counts,
        bytes: null,
        sha256: null,
        drops: strategy.ruleDropSummary,
        losses: this.getConversionLosses(outputs.platform, target.format, strategy),
        ...(outputs.platform === 'surge' && slot === 'non_ip' && outputs.reroutedFromIp > 0 && {
          reroutedFromIp: { reason: 'extended-matching' as const, count: outputs.reroutedFromIp },
        }),
      },
      filePath: path.join(this.outputBaseDir, ...target.relativePath.split('/')),
      lines: status === 'published' ? strategy.render(title, descriptions, this.date) : null,
    };
  }

  /**
   * Writer losses plus the RULE-SET-wide extended matching that only Surge can carry:
   * other platforms ignore it for every domain matcher they publish.
   */
  private getConversionLosses(
    platform: SupportedPlatform,
    format: RuleOutputFileAudit['format'],
    strategy: BaseWriteStrategy
  ): RuleConversionLosses {
    const losses = strategy.conversionLosses;
    if (platform === 'surge' || !this.extendedDomainMatching) return losses;
    let ignored = 0;
    if (format === 'singbox-json-v2') {
      const parsed = JSON.parse(strategy.content.join('\n')) as { rules?: Array<Record<string, unknown>> };
      for (const rule of parsed.rules ?? []) {
        for (const key of ['domain', 'domain_suffix', 'domain_keyword', 'domain_regex']) {
          const values = rule[key];
          if (Array.isArray(values)) ignored += values.length;
        }
      }
    } else {
      for (const line of strategy.content) {
        const type = line.slice(0, line.indexOf(',')).trim().toUpperCase();
        if (EXTENDED_MATCHER_TYPES.has(type) || ((type === 'AND' || type === 'OR' || type === 'NOT') && hasDomainMatcherSubRule(line))) {
          ignored++;
        }
      }
    }
    if (ignored > 0) {
      losses.ignoredModifiers['extended-matching'] = (losses.ignoredModifiers['extended-matching'] ?? 0) + ignored;
    }
    return losses;
  }

  write(): Promise<RulesetOutputAudit> {
    return this.span.traceChildAsync('write all', async childSpan => {
      await childSpan.traceChildAsync('done', () => this.done());

      childSpan.traceChildSync('write to strategies', () => this.writeToStrategies());

      const staged = childSpan.traceChildSync('stage outputs', () => this.stageOutputs());

      await childSpan.traceChildAsync('output to disk', async childSpan => {
        const published: Array<StagedOutput & { lines: string[] }> = [];
        const absent: StagedOutput[] = [];
        for (const output of staged) {
          if (output.lines === null) absent.push(output);
          else published.push({ ...output, lines: output.lines });
        }
        await Promise.all(published.map(output => childSpan.traceChildAsync(
          'write ' + output.audit.path,
          writeSpan => compareAndWriteFile(writeSpan, output.lines, output.filePath)
        )));
        // A successful ruleset removes variants that are now legitimately absent.
        await Promise.all(absent.map(output => fs.rm(output.filePath, { force: true })));
        await Promise.all(published.map(async output => {
          const data = await fs.readFile(output.filePath);
          output.audit.bytes = data.length;
          output.audit.sha256 = sha256Hex(data);
        }));
      });

      this.publicationAudit = this.buildPublicationAudit(staged.map(output => output.audit));
      return this.publicationAudit;
    });
  }

  async compile(): Promise<string[][]> {
    await this.done();
    this.writeToStrategies();

    return this.strategies.map(strategy => strategy.content);
  }

  /** Writer content of one variant after compile() or write(). */
  public getVariantContent(platform: SupportedPlatform, variant: RuleOutputVariant): string[] {
    const outputs = nullthrow(
      this.platformOutputs.find(candidate => candidate.platform === platform),
      `Platform is not a target: ${platform}`
    );
    return outputs.variants[variant].content;
  }

  public getRuleDropSummaries(): Partial<Record<RulePlatform, RuleDropSummary>> {
    const summaries: Partial<Record<RulePlatform, RuleDropSummary>> = {};
    for (const strategy of [...this.strategies].sort((a, b) => a.platform.localeCompare(b.platform))) {
      summaries[strategy.platform] = strategy.ruleDropSummary;
    }
    return summaries;
  }

  /** Audit of the last successful write(); reading it does not recompile or recount drops. */
  public getPublicationAudit(): RulesetOutputAudit {
    return nullthrow(this.publicationAudit, `Ruleset has not been published: ${this.id}`);
  }

  private buildPublicationAudit(outputs: RuleOutputFileAudit[]): RulesetOutputAudit {
    const conditions = this.getCanonicalConditions();
    return {
      id: this.id,
      platforms: [...this.targets],
      stages: {
        inputLines: this.stageCounts.inputLines,
        filtered: { ...this.stageCounts.filtered },
        canonicalCount: this.getOutputSummary().ruleCount,
      },
      outputs,
      rawInputSha256: this.rawInputHash.copy().digest('hex'),
      semanticSha256: sha256Hex(conditions.join('\n')),
      conditions,
      contextSha256: sha256Hex(JSON.stringify({
        defaultPolicy: this.defaultPolicy,
        keepComments: this.config.keepComments,
        keepEmptyLines: this.config.keepEmptyLines,
        keepInlineComments: this.config.keepInlineComments,
        formatConversion: this.config.formatConversion,
        applyNoResolve: this.config.applyNoResolve,
        validate: this.config.validate,
        sourcePolicies: this.config.sourcePolicies ? [...this.config.sourcePolicies].sort() : null,
        excludedRuleTypes: [...this.config.excludedRuleTypes].sort(),
      })),
    };
  }

  /**
   * Platform-independent canonical conditions with their modifiers, sorted. These
   * are the entries counted by getOutputSummary().ruleCount.
   */
  public getCanonicalConditions(): string[] {
    const conditions = new Set<string>();
    const domainModifier = this.extendedDomainMatching ? ',extended-matching' : '';
    const add = (type: string, values: Iterable<string>, modifier = '') => {
      for (const value of values) conditions.add(`${type},${value}${modifier}`);
    };
    const merged = (values: Set<string>) => (values.size ? mergeCidr(Array.from(values), true) : []);

    this.domainTrie.dumpWithoutDot((domain, includeAllSubdomain) => {
      conditions.add(`${includeAllSubdomain ? 'DOMAIN-SUFFIX' : 'DOMAIN'},${domain}${domainModifier}`);
    });
    this.wildcardTrie.dumpWithoutDot(wildcard => {
      conditions.add(`DOMAIN-WILDCARD,${wildcard}${domainModifier}`);
    });
    add('DOMAIN-KEYWORD', this.domainKeywords, domainModifier);
    add('USER-AGENT', this.userAgent);
    add('PROCESS-NAME', this.processName);
    add('PROCESS-PATH', this.processPath);
    add('URL-REGEX', this.urlRegex);
    add('IP-CIDR', merged(this.ipcidr));
    add('IP-CIDR', merged(this.ipcidrNoResolve), ',no-resolve');
    add('IP-CIDR6', this.ipcidr6);
    add('IP-CIDR6', this.ipcidr6NoResolve, ',no-resolve');
    add('IP-ASN', this.ipasn);
    add('IP-ASN', this.ipasnNoResolve, ',no-resolve');
    add('GEOIP', this.geoip);
    add('GEOIP', this.groipNoResolve, ',no-resolve');
    add('SRC-IP-CIDR', this.sourceIpOrCidr);
    add('SRC-PORT', this.sourcePort);
    add('DEST-PORT', this.destPort);
    add('PROTOCOL', this.protocol);
    for (const rule of this.otherRules) {
      const trimmed = rule.trim();
      if (!trimmed || RuleLineUtils.isComment(trimmed)) continue;
      conditions.add(trimmed.split(',').map(part => part.trim()).join(','));
    }
    return [...conditions].sort();
  }
}
