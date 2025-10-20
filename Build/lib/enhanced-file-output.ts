/**
 * 增强文件输出器 - 集成CrossPlatformRuleParser和writing-strategy
 * 统一普通规则组和特殊规则的处理路径
 */

import type { Span } from '../trace';
import { FileOutput } from './rules/base';
import { CrossPlatformRuleParser } from '../core/parsers';
import type { ParsedRule } from '../core/parsers';
import { ProxyPlatform } from '../constants/rule-formats';
import {
  createStrategiesForTargets,
  DEFAULT_PLATFORM_CONFIG,
  PLATFORM_POLICY_SUPPORT,
} from './platform-config';
import type { SupportedPlatform } from './platform-config';
import type { RuleGroup, FileConfig, SpecialRuleConfig } from './rule-source-types';
import { cleanPolicy } from '../core/parsers/policy-cleaner';
import { RuleValidator } from '../utils/validation/validators';

export class EnhancedFileOutput extends FileOutput {
  private readonly platformConfig = DEFAULT_PLATFORM_CONFIG;

  // 统计信息（DEBUG 模式）
  private readonly stats = {
    inputDomains: 0,
    inputCIDRs: 0,
    inputOthers: 0,
  };

  // 🔧 配置参数
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
    private readonly ruleType: 'domainset' | 'non_ip' | 'ip' | 'mixed', // 支持混合类型
    private readonly targets: SupportedPlatform[] = ['surge'],
    private readonly defaultPolicy: string | null = null, // 默认无策略
    config?: Partial<FileConfig> // 🔧 接受完整配置
  ) {
    super(span, id);

    // 🔧 应用配置（带默认值）
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

    // 根据配置的目标平台创建strategies
    this.strategies = createStrategiesForTargets(targets, ruleType);
  }

  /**
   * 智能添加规则 - 自动分发到 Trie/Set（自动去重+懒惰合并）
   */
  public addRawRule(rule: string): this {
    let trimmed = rule.trim();

    // 🔧 1. 空行处理
    if (!trimmed) {
      if (this.config.keepEmptyLines) {
        // 保留空行（直接添加到其他规则集合）
        this.otherRules.add('');
      }
      return this;
    }

    // 🔧 2. 注释处理 - 使用 RuleValidator (支持 #、!、//、; 四种格式)
    if (RuleValidator.isComment(trimmed)) {
      if (this.config.keepComments) {
        // 保留注释（直接添加到其他规则集合）
        this.otherRules.add(trimmed);
      }
      return this;
    }

    // 🔧 3. 行内注释处理 (仅支持 // 格式)
    if (!this.config.keepInlineComments) {
      trimmed = RuleValidator.removeInlineComment(trimmed);
    }

    // 🔧 4. 格式转换 - 智能平台检测和转换
    let normalizedRule = trimmed;
    if (this.config.formatConversion) {
      // 支持 QuantumultX (HOST, HOST-SUFFIX), Clash (+.domain), Domain-set (.domain), 纯文本等
      normalizedRule = CrossPlatformRuleParser.smartConvert(trimmed, ProxyPlatform.SURGE);
    }

    // 🔧 5. 规则验证
    if (this.config.validate) {
      if (!RuleValidator.isValidRule(normalizedRule)) {
        // 跳过无效规则
        return this;
      }
    }

    // 🔧 6. 应用 no-resolve 参数
    if (this.config.applyNoResolve) {
      normalizedRule = this.applyNoResolveParameter(normalizedRule);
    }

    // 🔧 7. 移除策略（如果需要）- 使用统一清理器
    const processedRule =
      this.defaultPolicy === null ? cleanPolicy(normalizedRule) : normalizedRule;

    // 🔑 智能分发到不同容器（自动去重）
    const ruleType = this.detectRuleType(processedRule);

    switch (ruleType) {
      case 'domain': {
        // DOMAIN,example.com → domainTrie（自动去重）
        const domain = this.extractDomain(processedRule);
        if (domain) {
          this.domainTrie.add(domain, false);
          if (process.env.DEBUG) this.stats.inputDomains++;
        }
        break;
      }

      case 'domain-suffix': {
        // DOMAIN-SUFFIX,example.com → domainTrie（自动去重+子域名优化）
        const suffix = this.extractDomain(processedRule);
        if (suffix) {
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
        // DOMAIN-KEYWORD,ads → Set（自动去重）
        const keyword = processedRule.split(',')[1]?.trim();
        if (keyword) {
          this.domainKeywords.add(keyword);
        }
        break;
      }

      case 'domain-wildcard': {
        // DOMAIN-WILDCARD,*.example.com → wildcardTrie（自动去重）
        const wildcard = this.extractDomain(processedRule);
        if (wildcard) {
          this.wildcardTrie.add(wildcard);
        }
        break;
      }

      case 'ip-cidr': {
        // IP-CIDR,192.168.1.0/24,no-resolve → Set（自动去重）
        const cidr = processedRule.split(',')[1]?.trim();
        if (cidr) {
          const noResolve = processedRule.includes('no-resolve');
          (noResolve ? this.ipcidrNoResolve : this.ipcidr).add(cidr);
          if (process.env.DEBUG) this.stats.inputCIDRs++;
        }
        break;
      }

      case 'ip-cidr6': {
        // IP-CIDR6,2001:db8::/32 → Set（自动去重）
        const cidr6 = processedRule.split(',')[1]?.trim();
        if (cidr6) {
          const noResolve = processedRule.includes('no-resolve');
          (noResolve ? this.ipcidr6NoResolve : this.ipcidr6).add(cidr6);
          if (process.env.DEBUG) this.stats.inputCIDRs++;
        }
        break;
      }

      case 'ip-asn': {
        // IP-ASN,4134 → Set（自动去重）
        const asn = processedRule.split(',')[1]?.trim();
        if (asn) {
          const noResolve = processedRule.includes('no-resolve');
          (noResolve ? this.ipasnNoResolve : this.ipasn).add(asn);
        }
        break;
      }

      case 'user-agent': {
        // USER-AGENT,*abc* → Set（自动去重）
        const ua = processedRule.split(',')[1]?.trim();
        if (ua) {
          this.userAgent.add(ua);
        }
        break;
      }

      case 'process-name': {
        // PROCESS-NAME,WeChat → Set（自动去重）
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
        // URL-REGEX,^https?://ad\. → Set（自动去重）
        const regex = processedRule.split(',').slice(1).join(',');
        if (regex) {
          this.urlRegex.add(regex);
        }
        break;
      }

      default:
        // 其他规则类型（GEOIP, PROTOCOL 等）
        this.otherRules.push(processedRule);
        if (process.env.DEBUG) this.stats.inputOthers++;
    }

    return this;
  }

  /**
   * 检测规则类型
   */
  private detectRuleType(rule: string): string {
    const parts = rule.split(',');
    if (parts.length === 0) return 'other';

    const type = parts[0].toUpperCase().trim();

    const typeMap: Record<string, string> = {
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

    return typeMap[type] || 'other';
  }

  /**
   * 提取域名部分
   */
  private extractDomain(rule: string): string {
    const parts = rule.split(',');
    return parts[1]?.trim() || '';
  }

  /**
   * 🔧 为 IP 规则自动添加 no-resolve 参数
   */
  private applyNoResolveParameter(rule: string): string {
    const trimmed = rule.trim();
    const upperRule = trimmed.toUpperCase();

    // 检测是否为 IP 类规则
    const isIpRule =
      upperRule.startsWith('IP-CIDR,') ||
      upperRule.startsWith('IP-CIDR6,') ||
      upperRule.startsWith('GEOIP,') ||
      upperRule.startsWith('IP-ASN,') ||
      upperRule.startsWith('SRC-IP-CIDR,');

    if (!isIpRule) {
      return rule;
    }

    // 检查是否已经包含 no-resolve 参数
    if (upperRule.includes('NO-RESOLVE')) {
      return rule;
    }

    // 添加 no-resolve 参数
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
      // 获取优化后的数量
      const outputDomains = this.countTrieNodes();
      const outputCIDRs =
        this.ipcidr.size +
        this.ipcidrNoResolve.size +
        this.ipcidr6.size +
        this.ipcidr6NoResolve.size;

      console.log(`📊 规则统计 [${this.id}]:`);
      console.log(`  域名: ${this.stats.inputDomains} 条输入`);
      console.log(`  CIDR: ${this.stats.inputCIDRs} 条输入`);
      console.log(`  其他: ${this.stats.inputOthers} 条`);
      console.log(`  ✅ 优化后: 域名 ~${outputDomains}, CIDR ${outputCIDRs}`);
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
   * 移除策略部分 - 已废弃，改用统一的 cleanPolicy 函数
   * @deprecated 使用 policy-cleaner 模块的 cleanPolicy 函数替代
   */

  /**
   * 从配置创建增强输出器
   */
  static fromConfig(span: Span, config: RuleGroup | SpecialRuleConfig): EnhancedFileOutput {
    const targets = ('targets' in config ? config.targets || ['surge'] : ['surge']) as any;
    const defaultPolicy =
      'defaultPolicy' in config
        ? config.defaultPolicy === undefined
          ? null
          : config.defaultPolicy
        : null;

    // 默认使用混合类型，让Strategy智能判断
    return new EnhancedFileOutput(span, config.name, 'mixed', targets, defaultPolicy);
  }
}
