import { ipversion } from 'ip-cidr-tools/ip';
import { merge } from 'ip-cidr-tools/merge';
import { exclude } from 'ip-cidr-tools/exclude';
import { contains } from 'ip-cidr-tools/overlap';
import { FileOutput } from './base.js';
import type { WritingStrategy } from '../writing-strategy/base.js';
import type { Span } from '../../trace/index.js';
import cliProgress from 'cli-progress';

interface IPListOutputOptions {
  enableCIDRMerge?: boolean;
  showProgress?: boolean;
  excludeCIDRs?: string[];
}

/**
 * IP 规则集输出类
 * 专门处理 IP-CIDR、GEOIP、IP-ASN 规则
 * 自动进行 CIDR 归并优化
 */
export class IPListOutput extends FileOutput {
  private readonly ipv4Set = new Set<string>();
  private readonly ipv6Set = new Set<string>();
  private readonly geoipSet = new Set<string>();
  private readonly asnSet = new Set<string>();
  private readonly options: IPListOutputOptions;

  constructor(
    span: Span,
    name: string,
    description: string,
    strategy: WritingStrategy,
    options: IPListOutputOptions = {}
  ) {
    super(span, name, description, strategy);
    this.options = {
      enableCIDRMerge: true,
      showProgress: true,
      ...options,
    };
  }

  /**
   * 添加 IP-CIDR 规则
   */
  addCIDR(cidr: string): this {
    const version = ipversion(cidr);
    if (version === 4) {
      this.ipv4Set.add(cidr);
    } else if (version === 6) {
      this.ipv6Set.add(cidr);
    } else {
      console.warn(`⚠️ 无效的 CIDR: ${cidr}`);
    }
    return this;
  }

  /**
   * 批量添加 IP-CIDR 规则
   */
  addCIDRs(cidrs: string[]): this {
    cidrs.forEach(cidr => this.addCIDR(cidr));
    return this;
  }

  /**
   * 添加 GEOIP 规则
   */
  addGeoIP(country: string): this {
    this.geoipSet.add(country.toUpperCase());
    return this;
  }

  /**
   * 添加 IP-ASN 规则
   */
  addASN(asn: string | number): this {
    const asnStr = asn.toString();
    // 确保 ASN 格式正确
    if (/^\d+$/.test(asnStr)) {
      this.asnSet.add(asnStr);
    } else {
      console.warn(`⚠️ 无效的 ASN: ${asn}`);
    }
    return this;
  }

  /**
   * 执行 CIDR 归并优化
   */
  private optimizeCIDRs(): { ipv4: string[]; ipv6: string[] } {
    console.log(`🔧 开始优化 IP 规则...`);

    let progressBar: cliProgress.SingleBar | null = null;
    if (this.options.showProgress) {
      progressBar = new cliProgress.SingleBar({
        format: 'IP 优化进度 |{bar}| {percentage}% | {value}/{total}',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true,
      });
    }

    // IPv4 归并
    const ipv4Array = Array.from(this.ipv4Set);
    const totalSteps = 2; // IPv4 和 IPv6
    let currentStep = 0;

    if (progressBar) {
      progressBar.start(totalSteps, 0);
    }

    console.log(`  IPv4: ${ipv4Array.length} 个规则`);
    let mergedIPv4 = ipv4Array;

    if (this.options.enableCIDRMerge && ipv4Array.length > 0) {
      mergedIPv4 = merge(ipv4Array);

      // 排除指定的 CIDR
      if (this.options.excludeCIDRs) {
        for (const excludeCIDR of this.options.excludeCIDRs) {
          if (ipversion(excludeCIDR) === 4) {
            mergedIPv4 = mergedIPv4.flatMap(cidr => exclude(cidr, [excludeCIDR]));
          }
        }
      }

      console.log(
        `  IPv4 优化后: ${mergedIPv4.length} 个规则 (减少 ${ipv4Array.length - mergedIPv4.length})`
      );
    }

    currentStep++;
    if (progressBar) {
      progressBar.update(currentStep);
    }

    // IPv6 归并
    const ipv6Array = Array.from(this.ipv6Set);
    console.log(`  IPv6: ${ipv6Array.length} 个规则`);
    let mergedIPv6 = ipv6Array;

    if (this.options.enableCIDRMerge && ipv6Array.length > 0) {
      mergedIPv6 = merge(ipv6Array);

      // 排除指定的 CIDR
      if (this.options.excludeCIDRs) {
        for (const excludeCIDR of this.options.excludeCIDRs) {
          if (ipversion(excludeCIDR) === 6) {
            mergedIPv6 = mergedIPv6.flatMap(cidr => exclude(cidr, [excludeCIDR]));
          }
        }
      }

      console.log(
        `  IPv6 优化后: ${mergedIPv6.length} 个规则 (减少 ${ipv6Array.length - mergedIPv6.length})`
      );
    }

    currentStep++;
    if (progressBar) {
      progressBar.update(currentStep);
      progressBar.stop();
    }

    return {
      ipv4: mergedIPv4.sort(),
      ipv6: mergedIPv6.sort(),
    };
  }

  /**
   * 写入文件前的处理
   */
  protected override preprocess(): void {
    // 清空现有规则
    this.ruleGroups = {};

    // 优化 IP-CIDR 规则
    const { ipv4, ipv6 } = this.optimizeCIDRs();

    // 添加优化后的 IP-CIDR 规则
    ipv4.forEach(cidr => this.addRule('IP-CIDR', cidr));
    ipv6.forEach(cidr => this.addRule('IP-CIDR6', cidr));

    // 添加 GEOIP 规则
    const geoips = Array.from(this.geoipSet).sort();
    geoips.forEach(country => this.addRule('GEOIP', country));

    // 添加 IP-ASN 规则
    const asns = Array.from(this.asnSet).sort((a, b) => Number(a) - Number(b));
    asns.forEach(asn => this.addRule('IP-ASN', asn));

    console.log(`✅ IP 规则优化完成:`);
    console.log(`  - IP-CIDR: ${ipv4.length + ipv6.length} 个`);
    console.log(`  - GEOIP: ${geoips.length} 个`);
    console.log(`  - IP-ASN: ${asns.length} 个`);
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    ipv4Count: number;
    ipv6Count: number;
    geoipCount: number;
    asnCount: number;
    totalCount: number;
  } {
    return {
      ipv4Count: this.ipv4Set.size,
      ipv6Count: this.ipv6Set.size,
      geoipCount: this.geoipSet.size,
      asnCount: this.asnSet.size,
      totalCount: this.ipv4Set.size + this.ipv6Set.size + this.geoipSet.size + this.asnSet.size,
    };
  }

  /**
   * 检查是否包含指定 IP
   */
  containsIP(ip: string): boolean {
    const version = ipversion(ip);
    const cidrs = version === 4 ? this.ipv4Set : version === 6 ? this.ipv6Set : [];

    for (const cidr of cidrs) {
      if (contains(cidr, ip)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 合并另一个 IP 列表
   */
  merge(other: IPListOutput): this {
    // 合并 IPv4
    other.ipv4Set.forEach(cidr => this.ipv4Set.add(cidr));

    // 合并 IPv6
    other.ipv6Set.forEach(cidr => this.ipv6Set.add(cidr));

    // 合并 GEOIP
    other.geoipSet.forEach(country => this.geoipSet.add(country));

    // 合并 ASN
    other.asnSet.forEach(asn => this.asnSet.add(asn));

    return this;
  }
}
