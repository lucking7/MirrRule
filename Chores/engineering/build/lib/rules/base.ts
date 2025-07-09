import type { Span } from '../../trace/index.js';
import { HostnameSmolTrie } from '../../../lib/trie.js';
import { merge as mergeCidr } from 'fast-cidr-tools';
import { createRetrieKeywordFilter as createKeywordFilter } from 'foxts/retrie';
import type { BaseWriteStrategy } from '../writing-strategy/base.js';

/**
 * 可能是 Promise 或普通值的类型
 */
export type MaybePromise<T> = T | Promise<T>;

/**
 * 规则文件输出基类
 * 负责管理各种规则数据并使用策略模式输出到不同格式
 */
export class FileOutput {
  protected strategies: BaseWriteStrategy[] = [];

  public domainTrie = new HostnameSmolTrie(null);
  public wildcardTrie = new HostnameSmolTrie(null);

  protected domainKeywords = new Set<string>();
  private whitelistKeywords = new Set<string>();

  protected userAgent = new Set<string>();
  protected processName = new Set<string>();
  protected processPath = new Set<string>();
  protected urlRegex = new Set<string>();
  protected ipcidr = new Set<string>();
  protected ipcidrNoResolve = new Set<string>();
  protected ipasn = new Set<string>();
  protected ipasnNoResolve = new Set<string>();
  protected ipcidr6 = new Set<string>();
  protected ipcidr6NoResolve = new Set<string>();
  protected geoip = new Set<string>();
  protected geoipNoResolve = new Set<string>();

  protected sourceIpOrCidr = new Set<string>();
  protected sourcePort = new Set<string>();
  protected destPort = new Set<string>();
  protected protocol = new Set<string>();

  protected otherRules: string[] = [];

  private pendingPromise: Promise<any> | null = null;

  protected title: string | null = null;
  protected description: string[] | readonly string[] | null = null;
  protected date = new Date();

  constructor(protected readonly span: Span, protected readonly id: string) {}

  withTitle(title: string) {
    this.title = title;
    return this;
  }

  withDescription(description: string[] | readonly string[]) {
    this.description = description;
    return this;
  }

  withDate(date: Date) {
    this.date = date;
    return this;
  }

  public withStrategies(strategies: BaseWriteStrategy[]) {
    this.strategies = strategies;
    return this;
  }

  withExtraStrategies(strategy: BaseWriteStrategy) {
    this.strategies.push(strategy);
    return this;
  }

  // 域名相关方法
  addDomain(domain: string) {
    this.domainTrie.add(domain, false);
    return this;
  }

  bulkAddDomain(domains: Array<string | null>) {
    for (const domain of domains) {
      if (domain !== null) {
        this.domainTrie.add(domain, false);
      }
    }
    return this;
  }

  addDomainSuffix(domain: string) {
    this.domainTrie.add(domain, true);
    return this;
  }

  bulkAddDomainSuffix(domains: string[]) {
    for (const domain of domains) {
      this.addDomainSuffix(domain);
    }
    return this;
  }

  addDomainKeyword(keyword: string) {
    this.domainKeywords.add(keyword);
    return this;
  }

  bulkAddDomainKeyword(keywords: string[]) {
    for (const keyword of keywords) {
      this.domainKeywords.add(keyword);
    }
    return this;
  }

  bulkAddDomainWildcard(domains: string[]) {
    for (const domain of domains) {
      this.wildcardTrie.add(domain);
    }
    return this;
  }

  // 白名单方法
  whitelistDomain = (domain: string) => {
    this.domainTrie.whitelist(domain);
    this.wildcardTrie.whitelist(domain);
    return this;
  };

  whitelistKeyword = (keyword: string) => {
    this.whitelistKeywords.add(keyword);
    return this;
  };

  // IP 相关方法
  static readonly ipToCidr = (ip: string, version: 4 | 6) => {
    if (ip.includes('/')) return ip;
    return version === 4 ? ip + '/32' : ip + '/128';
  };

  bulkAddAnyCIDR(cidrs: string[], noResolve = false) {
    const list4 = noResolve ? this.ipcidrNoResolve : this.ipcidr;
    const list6 = noResolve ? this.ipcidr6NoResolve : this.ipcidr6;

    for (const cidr of cidrs) {
      if (cidr.includes(':')) {
        list6.add(FileOutput.ipToCidr(cidr, 6));
      } else {
        list4.add(FileOutput.ipToCidr(cidr, 4));
      }
    }
    return this;
  }

  bulkAddIPASN(asns: string[]) {
    for (const asn of asns) {
      this.ipasn.add(asn);
    }
    return this;
  }

  // 异步操作处理
  private async addFromDomainsetPromise(
    source: MaybePromise<AsyncIterable<string> | Iterable<string> | string[]>
  ) {
    for await (const line of await source) {
      if (line[0] === '.') {
        this.addDomainSuffix(line.substring(1));
      } else {
        this.domainTrie.add(line, false);
      }
    }
  }

  addFromDomainset(source: MaybePromise<AsyncIterable<string> | Iterable<string> | string[]>) {
    if (this.pendingPromise) {
      this.pendingPromise = this.pendingPromise.then(() => this.addFromDomainsetPromise(source));
      return this;
    }
    this.pendingPromise = this.addFromDomainsetPromise(source);
    return this;
  }

  private async addFromRulesetPromise(
    source: MaybePromise<AsyncIterable<string> | Iterable<string> | string[]>
  ) {
    for await (const line of await source) {
      const splitted = line.split(',');
      const type = splitted[0];
      const value = splitted[1];
      const arg = splitted[2];

      switch (type) {
        case 'DOMAIN':
          this.domainTrie.add(value, false);
          break;
        case 'DOMAIN-SUFFIX':
          this.addDomainSuffix(value);
          break;
        case 'DOMAIN-KEYWORD':
          this.addDomainKeyword(value);
          break;
        case 'DOMAIN-WILDCARD':
          this.wildcardTrie.add(value);
          break;
        case 'USER-AGENT':
          this.userAgent.add(value);
          break;
        case 'PROCESS-NAME':
          if (value.includes('/') || value.includes('\\')) {
            this.processPath.add(value);
          } else {
            this.processName.add(value);
          }
          break;
        case 'URL-REGEX':
          this.urlRegex.add(splitted.slice(1).join(','));
          break;
        case 'IP-CIDR':
          (arg === 'no-resolve' ? this.ipcidrNoResolve : this.ipcidr).add(value);
          break;
        case 'IP-CIDR6':
          (arg === 'no-resolve' ? this.ipcidr6NoResolve : this.ipcidr6).add(value);
          break;
        case 'IP-ASN':
          (arg === 'no-resolve' ? this.ipasnNoResolve : this.ipasn).add(value);
          break;
        case 'GEOIP':
          (arg === 'no-resolve' ? this.geoipNoResolve : this.geoip).add(value);
          break;
        case 'SRC-IP':
          this.sourceIpOrCidr.add(value);
          break;
        case 'SRC-PORT':
          this.sourcePort.add(value);
          break;
        case 'DEST-PORT':
          this.destPort.add(value);
          break;
        case 'PROTOCOL':
          this.protocol.add(value.toUpperCase());
          break;
        default:
          this.otherRules.push(line);
          break;
      }
    }
  }

  addFromRuleset(source: MaybePromise<AsyncIterable<string> | Iterable<string>>) {
    if (this.pendingPromise) {
      this.pendingPromise = this.pendingPromise.then(() => this.addFromRulesetPromise(source));
      return this;
    }
    this.pendingPromise = this.addFromRulesetPromise(source);
    return this;
  }

  async done() {
    await this.pendingPromise;
    this.pendingPromise = null;
    return this;
  }

  // 写入策略方法
  private strategiesWritten = false;

  private writeToStrategies() {
    if (this.pendingPromise) {
      throw new Error('You should call done() before calling writeToStrategies()');
    }
    if (this.strategiesWritten) {
      throw new Error('Strategies already written');
    }

    this.strategiesWritten = true;

    // 创建关键词过滤器
    const kwfilter = createKeywordFilter(
      Array.from(this.domainKeywords).concat(Array.from(this.whitelistKeywords))
    );

    if (this.strategies.length === 0) {
      throw new Error('No strategies to write ' + this.id);
    }

    // 写入域名
    this.domainTrie.dumpWithoutDot((domain, includeAllSubdomain) => {
      if (kwfilter(domain)) {
        return;
      }

      this.wildcardTrie.whitelist(domain, includeAllSubdomain);

      for (const strategy of this.strategies) {
        if (includeAllSubdomain) {
          strategy.writeDomainSuffix(domain);
        } else {
          strategy.writeDomain(domain);
        }
      }
    }, true);

    // 写入域名关键词（排除白名单）
    const whiteKwfilter = createKeywordFilter(Array.from(this.whitelistKeywords));
    const filteredKeywords = Array.from(this.domainKeywords).filter(kw => !whiteKwfilter(kw));

    if (filteredKeywords.length > 0) {
      for (const strategy of this.strategies) {
        strategy.writeDomainKeywords(new Set(filteredKeywords));
      }
    }

    // 写入通配符域名
    this.wildcardTrie.dumpWithoutDot(wildcard => {
      if (kwfilter(wildcard)) {
        return;
      }

      for (const strategy of this.strategies) {
        strategy.writeDomainWildcard(wildcard);
      }
    }, true);

    // 写入其他规则类型
    for (const strategy of this.strategies) {
      if (this.userAgent.size) {
        strategy.writeUserAgents(this.userAgent);
      }
      if (this.processName.size) {
        strategy.writeProcessNames(this.processName);
      }
      if (this.processPath.size) {
        strategy.writeProcessPaths(this.processPath);
      }
      if (this.sourceIpOrCidr.size) {
        strategy.writeSourceIpCidrs(Array.from(this.sourceIpOrCidr));
      }
      if (this.sourcePort.size) {
        strategy.writeSourcePorts(this.sourcePort);
      }
      if (this.destPort.size) {
        strategy.writeDestinationPorts(this.destPort);
      }
      if (this.protocol.size) {
        strategy.writeProtocols(this.protocol);
      }
      if (this.otherRules.length) {
        strategy.writeOtherRules(this.otherRules);
      }
      if (this.urlRegex.size) {
        strategy.writeUrlRegexes(this.urlRegex);
      }
    }

    // 写入 IP 规则（使用 CIDR 合并优化）
    let ipcidr: string[] | null = null;
    let ipcidrNoResolve: string[] | null = null;
    let ipcidr6: string[] | null = null;
    let ipcidr6NoResolve: string[] | null = null;

    if (this.ipcidr.size) {
      ipcidr = mergeCidr(Array.from(this.ipcidr));
    }
    if (this.ipcidrNoResolve.size) {
      ipcidrNoResolve = mergeCidr(Array.from(this.ipcidrNoResolve));
    }
    if (this.ipcidr6.size) {
      ipcidr6 = Array.from(this.ipcidr6);
    }
    if (this.ipcidr6NoResolve.size) {
      ipcidr6NoResolve = Array.from(this.ipcidr6NoResolve);
    }

    for (const strategy of this.strategies) {
      // no-resolve 规则
      if (ipcidrNoResolve) {
        strategy.writeIpCidrs(ipcidrNoResolve, true);
      }
      if (ipcidr6NoResolve) {
        strategy.writeIpCidr6s(ipcidr6NoResolve, true);
      }
      if (this.ipasnNoResolve.size) {
        strategy.writeIpAsns(this.ipasnNoResolve, true);
      }
      if (this.geoipNoResolve.size) {
        strategy.writeGeoip(this.geoipNoResolve, true);
      }

      // 常规规则
      if (ipcidr) {
        strategy.writeIpCidrs(ipcidr, false);
      }
      if (ipcidr6) {
        strategy.writeIpCidr6s(ipcidr6, false);
      }
      if (this.ipasn.size) {
        strategy.writeIpAsns(this.ipasn, false);
      }
      if (this.geoip.size) {
        strategy.writeGeoip(this.geoip, false);
      }
    }
  }

  async write(): Promise<unknown> {
    return this.span.traceChildAsync('write all', async childSpan => {
      await this.done();

      this.writeToStrategies();

      // 写入所有策略
      const promises: Promise<void>[] = [];
      for (const strategy of this.strategies) {
        promises.push(strategy.write(childSpan, this.id, this.title, this.description, this.date));
      }

      return Promise.all(promises);
    });
  }
}
