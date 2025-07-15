import { RulesetOutput } from '../lib/rules/ruleset.js';
import { DomainsetOutput } from '../lib/rules/domainset.js';
import * as path from 'node:path';
import { readFileByLine } from '../lib/fetch-text-by-line.js';
import { Span } from '../trace/index.js';
import { promises as fs } from 'node:fs';
import picocolors from 'picocolors';
import { SingleBar } from 'cli-progress';
import { RulesetClassifier, RulesetType } from '../lib/ruleset-classifier.js';

export async function buildMixedRuleset(parentSpan: Span) {
  const span = parentSpan.traceChild('build-mixed-ruleset');

  try {
    console.log(picocolors.blue('📦 构建规则集（含类型判定）...'));

    // 递归扫描 Surge/Rulesets 目录及所有子目录
    const rulesetDir = path.resolve('../../Surge/Rulesets');

    async function findRulesetFiles(dir: string): Promise<string[]> {
      const files: string[] = [];
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // 递归扫描子目录
          const subFiles = await findRulesetFiles(fullPath);
          files.push(...subFiles);
        } else if (
          entry.isFile() &&
          (entry.name.endsWith('.conf') || entry.name.endsWith('.list'))
        ) {
          files.push(fullPath);
        }
      }

      return files;
    }

    const rulesetFiles = await findRulesetFiles(rulesetDir);
    console.log(picocolors.gray(`递归扫描找到 ${rulesetFiles.length} 个规则集文件`));

    // 第一步：分析并分类所有规则集
    console.log(picocolors.yellow('\n🔍 步骤 1/2: 分析规则集类型...'));
    const classifications = await RulesetClassifier.classifyDirectory(rulesetDir);

    // 第二步：根据类型处理规则集
    console.log(picocolors.yellow('\n🏗️  步骤 2/2: 根据类型构建规则集...'));

    // 创建进度条
    const progressBar = new SingleBar({
      format:
        '构建进度 |' +
        picocolors.cyan('{bar}') +
        '| {percentage}% | {current}/{total} | {type} | {filename}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
    });

    progressBar.start(rulesetFiles.length, 0, { filename: '', type: '' });

    // 并行处理所有规则集（根据类型使用不同的处理器）
    const results = await Promise.all(
      rulesetFiles.map(async (filePath, index) => {
        const relativePath = path.relative(rulesetDir, filePath);
        const outputName = path.basename(filePath, path.extname(filePath));
        const classification = classifications.get(relativePath);

        if (!classification) {
          console.error(picocolors.red(`\n无法分类: ${relativePath}`));
          return {
            name: outputName,
            type: RulesetType.UNKNOWN,
            success: false,
            error: '无法确定规则集类型',
          };
        }

        try {
          let processor: RulesetOutput | DomainsetOutput;
          let stats: any;

          // 根据类型选择处理器
          switch (classification.type) {
            case RulesetType.DOMAIN:
              // 纯域名规则集 - 使用 DomainsetOutput（启用 tldts 规范化）
              processor = new DomainsetOutput(span, outputName);
              progressBar.update(index, { filename: relativePath, type: '🌐域名' });
              break;

            case RulesetType.IP:
              // 纯 IP 规则集 - 使用 IPListOutput（支持 CIDR 合并）
              // IPListOutput 需要更多参数，我们使用 RulesetOutput 代替
              processor = new RulesetOutput(outputName);
              progressBar.update(index, { filename: relativePath, type: '🔢IP' });
              break;

            case RulesetType.MIXED:
            default:
              // 混合规则集 - 使用 RulesetOutput（不进行域名规范化）
              processor = new RulesetOutput(outputName);
              progressBar.update(index, { filename: relativePath, type: '🔀混合' });
              break;
          }

          // 读取源文件
          const source = readFileByLine(filePath);

          // 根据处理器类型添加规则
          if (processor instanceof DomainsetOutput) {
            await processor.addFromDomainset(source);
            stats = {
              domains:
                processor['domainTrie'].dump().length +
                processor['wildcardTrie'].dump().length +
                processor['domainKeywords'].size,
              ips: 0,
              other: 0,
            };
          } else {
            await processor.addFromRuleset(source);
            stats = processor.getStatistics();
          }

          // 写入输出（包含各自的优化策略）
          await processor.write();

          progressBar.update(index + 1, { filename: relativePath, type: '' });

          // 返回统计信息
          return {
            name: outputName,
            type: classification.type,
            success: true,
            stats,
            confidence: classification.confidence,
          };
        } catch (error) {
          console.error(picocolors.red(`\n处理 ${relativePath} 失败:`), error);
          return {
            name: outputName,
            type: classification.type,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      })
    );

    progressBar.stop();

    // 打印构建结果
    console.log(picocolors.green('\n✅ 规则集构建完成'));

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    if (successful.length > 0) {
      console.log(picocolors.gray(`成功: ${successful.length} 个`));

      // 按类型统计
      const typeStats = {
        [RulesetType.DOMAIN]: successful.filter(r => r.type === RulesetType.DOMAIN).length,
        [RulesetType.IP]: successful.filter(r => r.type === RulesetType.IP).length,
        [RulesetType.MIXED]: successful.filter(r => r.type === RulesetType.MIXED).length,
      };

      console.log(picocolors.gray(`  - 纯域名规则集: ${typeStats[RulesetType.DOMAIN]} 个`));
      console.log(picocolors.gray(`  - 纯 IP 规则集: ${typeStats[RulesetType.IP]} 个`));
      console.log(picocolors.gray(`  - 混合规则集: ${typeStats[RulesetType.MIXED]} 个`));

      // 打印总体统计信息
      const totalStats = successful.reduce(
        (acc, r) => {
          const stats = r.stats;
          if (stats) {
            acc.domains += stats.domains || 0;
            acc.ips += stats.ips || 0;
            acc.other += stats.other || 0;
          }
          return acc;
        },
        { domains: 0, ips: 0, other: 0 }
      );

      console.log(picocolors.gray(`\n📊 规则统计:`));
      console.log(picocolors.gray(`  - 域名规则: ${totalStats.domains} 条`));
      console.log(picocolors.gray(`  - IP 规则: ${totalStats.ips} 条`));
      console.log(picocolors.gray(`  - 其他规则: ${totalStats.other} 条`));
    }

    if (failed.length > 0) {
      console.log(picocolors.red(`\n失败: ${failed.length} 个`));
      failed.forEach(f => {
        console.log(picocolors.red(`  - ${f.name}: ${f.error}`));
      });
    }
  } finally {
    span.stop();
  }
}
