/**
 * 规则集分类器
 * 用于判定规则集的类型：纯域名、纯IP、混合规则集
 */

import { readFileByLine } from './fetch-text-by-line.js';
import { processLine } from './process-line.js';
import picocolors from 'picocolors';

export enum RulesetType {
  DOMAIN = 'domain', // 纯域名规则集
  IP = 'ip', // 纯IP规则集
  MIXED = 'mixed', // 混合规则集
  UNKNOWN = 'unknown', // 未知类型
}

export interface RulesetClassification {
  type: RulesetType;
  stats: {
    domains: number;
    ips: number;
    other: number;
    total: number;
  };
  confidence: number; // 置信度 0-1
}

export class RulesetClassifier {
  /**
   * 分析规则集文件，判定其类型
   */
  static async classifyFile(filePath: string): Promise<RulesetClassification> {
    const stats = {
      domains: 0,
      ips: 0,
      other: 0,
      total: 0,
    };

    try {
      const source = readFileByLine(filePath);

      for await (const line of source) {
        if (!line || line.startsWith('#') || line.startsWith('//')) {
          continue;
        }

        const processed = processLine(line);
        if (!processed) continue;

        stats.total++;

        // 判定规则类型
        const upperLine = line.toUpperCase();
        const trimmedLine = line.trim();

        // IP 规则（IP-CIDR, IP-CIDR6, GEOIP, IP-ASN）
        if (
          upperLine.startsWith('IP-CIDR') ||
          upperLine.startsWith('GEOIP') ||
          upperLine.startsWith('IP-ASN')
        ) {
          stats.ips++;
        }
        // 混合规则集中的域名规则（DOMAIN, DOMAIN-SUFFIX, DOMAIN-KEYWORD 等）
        else if (
          upperLine.startsWith('DOMAIN') ||
          upperLine.startsWith('HOST') ||
          upperLine.startsWith('URL-REGEX')
        ) {
          // 这些是混合规则集格式，不是纯域名
          stats.other++;
        }
        // 纯域名规则集格式（DOMAIN-SET）：每行只有域名或 .域名
        else if (
          /^[a-zA-Z0-9\-\.]+\.[a-zA-Z]{2,}$/.test(trimmedLine) || // 纯域名
          /^\.[a-zA-Z0-9\-\.]+\.[a-zA-Z]{2,}$/.test(trimmedLine) || // .开头的域名
          /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(trimmedLine) || // IPv4
          /^[a-fA-F0-9:]+$/.test(trimmedLine) // IPv6
        ) {
          stats.domains++;
        }
        // 其他规则
        else if (
          upperLine.includes('USER-AGENT') ||
          upperLine.includes('PROCESS-NAME') ||
          upperLine.includes('DEST-PORT') ||
          upperLine.includes('SRC-IP') ||
          upperLine.includes('PROTOCOL')
        ) {
          stats.other++;
        }
        // 尝试通过内容判断
        else if (typeof processed === 'object' && processed !== null && 'type' in processed) {
          const processedObj = processed as any;
          if (
            processedObj.type === 'domainTrieAdd' ||
            processedObj.type === 'wildcardTrieAdd' ||
            processedObj.type === 'domainKeywordsAdd'
          ) {
            stats.domains++;
          } else if (
            processedObj.type === 'ipcidrAdd' ||
            processedObj.type === 'ipcidr6Add' ||
            processedObj.type === 'ipasnAdd'
          ) {
            stats.ips++;
          } else {
            stats.other++;
          }
        } else {
          stats.other++;
        }
      }
    } catch (error) {
      console.error(picocolors.red(`分析规则集失败: ${filePath}`), error);
      return {
        type: RulesetType.UNKNOWN,
        stats,
        confidence: 0,
      };
    }

    // 判定规则集类型
    return this.determineType(stats);
  }

  /**
   * 根据统计信息判定规则集类型
   */
  private static determineType(stats: RulesetClassification['stats']): RulesetClassification {
    if (stats.total === 0) {
      return {
        type: RulesetType.UNKNOWN,
        stats,
        confidence: 0,
      };
    }

    const domainRatio = stats.domains / stats.total;
    const ipRatio = stats.ips / stats.total;
    const otherRatio = stats.other / stats.total;

    let type: RulesetType;
    let confidence: number;

    // 如果有任何"其他"类型的规则（DOMAIN-SUFFIX, USER-AGENT等），就是混合规则集
    if (stats.other > 0) {
      type = RulesetType.MIXED;
      confidence = Math.min(otherRatio + 0.5, 1); // 其他规则越多，置信度越高
    }
    // 纯域名规则集（95%以上是纯域名行，且没有其他类型）
    else if (domainRatio >= 0.95 && stats.other === 0) {
      type = RulesetType.DOMAIN;
      confidence = domainRatio;
    }
    // 纯IP规则集（95%以上是IP规则，且没有其他类型）
    else if (ipRatio >= 0.95 && stats.other === 0) {
      type = RulesetType.IP;
      confidence = ipRatio;
    }
    // 默认为混合规则集
    else {
      type = RulesetType.MIXED;
      const maxRatio = Math.max(domainRatio, ipRatio);
      confidence = 0.8; // 默认置信度
    }

    return {
      type,
      stats,
      confidence,
    };
  }

  /**
   * 批量分析目录下的所有规则集（递归）
   */
  static async classifyDirectory(
    dir: string,
    recursive: boolean = true
  ): Promise<Map<string, RulesetClassification>> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    const results = new Map<string, RulesetClassification>();

    async function scanDirectory(currentDir: string, baseDir: string) {
      try {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);

          if (entry.isDirectory() && recursive) {
            // 递归扫描子目录
            await scanDirectory(fullPath, baseDir);
          } else if (
            entry.isFile() &&
            (entry.name.endsWith('.list') ||
              entry.name.endsWith('.conf') ||
              entry.name.endsWith('.txt'))
          ) {
            // 使用相对路径作为键
            const relativePath = path.relative(baseDir, fullPath);
            const classification = await RulesetClassifier.classifyFile(fullPath);
            results.set(relativePath, classification);
          }
        }
      } catch (error) {
        console.error(picocolors.red(`扫描目录失败: ${currentDir}`), error);
      }
    }

    try {
      console.log(picocolors.blue(`开始递归分析目录: ${dir}`));
      await scanDirectory(dir, dir);
      console.log(picocolors.gray(`找到 ${results.size} 个规则集文件`));

      // 打印分析结果
      this.printClassificationSummary(results);
    } catch (error) {
      console.error(picocolors.red('分析目录失败:'), error);
    }

    return results;
  }

  /**
   * 打印分类结果摘要
   */
  private static printClassificationSummary(results: Map<string, RulesetClassification>) {
    const summary = {
      [RulesetType.DOMAIN]: [] as string[],
      [RulesetType.IP]: [] as string[],
      [RulesetType.MIXED]: [] as string[],
      [RulesetType.UNKNOWN]: [] as string[],
    };

    results.forEach((classification, filename) => {
      summary[classification.type].push(filename);
    });

    console.log(picocolors.yellow('\n📊 规则集分类结果:'));

    if (summary[RulesetType.DOMAIN].length > 0) {
      console.log(
        picocolors.green(
          `\n🌐 纯域名规则集 (DOMAIN-SET格式) (${summary[RulesetType.DOMAIN].length}个):`
        )
      );
      summary[RulesetType.DOMAIN].sort().forEach(f => console.log(`  - ${f}`));
    }

    if (summary[RulesetType.IP].length > 0) {
      console.log(picocolors.cyan(`\n🔢 纯IP规则集 (${summary[RulesetType.IP].length}个):`));
      summary[RulesetType.IP].sort().forEach(f => console.log(`  - ${f}`));
    }

    if (summary[RulesetType.MIXED].length > 0) {
      console.log(picocolors.magenta(`\n🔀 混合规则集 (${summary[RulesetType.MIXED].length}个):`));
      summary[RulesetType.MIXED].sort().forEach(f => console.log(`  - ${f}`));
    }

    if (summary[RulesetType.UNKNOWN].length > 0) {
      console.log(picocolors.red(`\n❓ 未知类型 (${summary[RulesetType.UNKNOWN].length}个):`));
      summary[RulesetType.UNKNOWN].sort().forEach(f => console.log(`  - ${f}`));
    }
  }
}
