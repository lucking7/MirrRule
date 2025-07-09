import { RulesetOutput } from '../lib/rules/ruleset.js';
import * as path from 'node:path';
import { readFileByLine } from '../lib/fetch-text-by-line.js';
import { Span } from '../trace/index.js';
import { promises as fs } from 'node:fs';
import picocolors from 'picocolors';
import { SingleBar } from 'cli-progress';

export async function buildMixedRuleset(parentSpan: Span) {
  const span = parentSpan.traceChild('build-mixed-ruleset');

  try {
    console.log(picocolors.blue('📦 构建混合规则集...'));

    // 扫描 Surge/Rulesets 目录
    const rulesetDir = path.resolve('Surge/Rulesets');
    const files = await fs.readdir(rulesetDir);
    const rulesetFiles = files.filter(f => f.endsWith('.conf') || f.endsWith('.list'));

    console.log(picocolors.gray(`找到 ${rulesetFiles.length} 个规则集文件`));

    // 创建进度条
    const progressBar = new SingleBar({
      format:
        '构建进度 |' +
        picocolors.cyan('{bar}') +
        '| {percentage}% | {current}/{total} | {filename}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
    });

    progressBar.start(rulesetFiles.length, 0, { filename: '' });

    // 并行处理所有规则集
    const results = await Promise.all(
      rulesetFiles.map(async (filename, index) => {
        const filePath = path.join(rulesetDir, filename);
        const outputName = path.basename(filename, path.extname(filename));

        try {
          // 创建规则集输出实例
          const ruleset = new RulesetOutput(outputName);

          // 读取源文件
          const source = readFileByLine(filePath);

          // 添加规则（自动去重 + 验证）
          await ruleset.addFromRuleset(source);

          // 写入输出（包含 CIDR 合并等优化）
          await ruleset.write();

          progressBar.update(index + 1, { filename });

          // 返回统计信息
          const stats = ruleset.getStatistics();
          return {
            name: outputName,
            success: true,
            stats,
          };
        } catch (error) {
          console.error(picocolors.red(`\n处理 ${filename} 失败:`), error);
          return {
            name: outputName,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      })
    );

    progressBar.stop();

    // 打印构建结果
    console.log(picocolors.green('\n✅ 混合规则集构建完成'));

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    if (successful.length > 0) {
      console.log(picocolors.gray(`成功: ${successful.length} 个`));

      // 打印统计信息
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

      console.log(picocolors.gray(`  - 域名规则: ${totalStats.domains} 条`));
      console.log(picocolors.gray(`  - IP 规则: ${totalStats.ips} 条`));
      console.log(picocolors.gray(`  - 其他规则: ${totalStats.other} 条`));
    }

    if (failed.length > 0) {
      console.log(picocolors.red(`失败: ${failed.length} 个`));
      failed.forEach(f => {
        console.log(picocolors.red(`  - ${f.name}: ${f.error}`));
      });
    }
  } finally {
    span.stop();
  }
}
