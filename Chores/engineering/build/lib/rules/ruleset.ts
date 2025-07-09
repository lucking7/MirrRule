import type { Span } from '../../trace/index.js';
import { FileOutput } from './base.js';
import type { BaseWriteStrategy } from '../writing-strategy/base.js';
import { SurgeRuleset } from '../writing-strategy/surge.js';

export class RulesetOutput extends FileOutput {
  strategies: BaseWriteStrategy[] = [new SurgeRuleset()];

  constructor(id: string) {
    // 创建一个临时的 span
    const dummySpan = {
      traceChild: () => ({
        stop: () => {},
        traceChildAsync: async (name: string, fn: Function) => await fn(dummySpan),
      }),
      stop: () => {},
      traceChildAsync: async (name: string, fn: Function) => await fn(dummySpan),
    } as any;

    super(dummySpan, id);
  }

  // 获取规则统计信息
  public getStatistics() {
    const stats = {
      domains: 0,
      ips: 0,
      other: 0,
      total: 0,
    };

    // 统计域名规则 - 使用 dump 方法计算大小
    const domainTrieSize = this.domainTrie.dump().length;
    const wildcardTrieSize = this.wildcardTrie.dump().length;

    stats.domains += domainTrieSize;
    stats.domains += this['domainKeywords'].size; // 访问受保护的属性
    stats.domains += wildcardTrieSize;

    // 统计 IP 规则
    stats.ips += this['ipcidr'].size;
    stats.ips += this['ipcidr6'].size;
    stats.ips += this['ipcidrNoResolve'].size;
    stats.ips += this['ipcidr6NoResolve'].size;
    stats.ips += this['ipasn'].size;

    // 统计其他规则
    stats.other += this['userAgent'].size;
    stats.other += this['processName'].size;
    stats.other += this['urlRegex'].size;
    stats.other += this['sourceIpOrCidr'].size;
    stats.other += this['sourcePort'].size;
    stats.other += this['destPort'].size;
    stats.other += this['protocol'].size;
    stats.other += this['otherRules'].length;

    stats.total = stats.domains + stats.ips + stats.other;

    return stats;
  }
}
