/**
 * 规则源处理器 - 协调规则下载、解析、去重、输出的完整流程
 *
 * 职责：
 * 1. 下载规则文件（利用 fetch-assets）
 * 2. 解析规则（利用 CrossPlatformRuleParser）
 * 3. 去重和优化（利用 Trie 数据结构）
 * 4. 多平台输出（利用 writing-strategy）
 */

import type { Span } from '../trace';
import { fetchAssets } from '../utils/network/fetch-assets';
import { EnhancedFileOutput } from './enhanced-file-output';
import type { RuleGroup, SpecialRuleConfig, FileConfig } from './rule-source-types';
import path from 'node:path';
import fs from 'node:fs';

interface ProcessorStats {
  filesProcessed: number,
  rulesMerged: number,
  processingTime: number,
  errors: Array<{ file: string, error: string }>
}

export class RuleSourceProcessor {
  constructor(
    private readonly span: Span,
    private readonly outputDir = 'public'
  ) {}

  /**
   * 处理规则组 - 下载并生成多平台输出
   */
  async processRuleGroups(groups: RuleGroup[]): Promise<ProcessorStats> {
    const startTime = Date.now();
    const stats: ProcessorStats = {
      filesProcessed: 0,
      rulesMerged: 0,
      processingTime: 0,
      errors: []
    };

    for (const group of groups) {
      try {
        await this.span.traceChildAsync(`process group: ${group.name}`, async (groupSpan) => {
          console.log(`📦 处理规则组: ${group.name}`);

          if (!group.files || group.files.length === 0) {
            console.log('  ⏭\uFE0F  跳过（无文件）');
            return;
          }

          for (const fileConfig of group.files) {
            try {
              // 下载规则文件
              const rules = await groupSpan.traceChild('download').traceAsyncFn(() => fetchAssets(fileConfig.url, fileConfig.fallbackUrls || null, true));

              // 确定输出路径
              const outputPath = path.join(this.outputDir, fileConfig.path);

              // 创建增强输出器
              const output = new EnhancedFileOutput(
                groupSpan,
                path.basename(fileConfig.path, '.list'),
                'mixed',
                (group.targets as any) || ['surge'],
                group.defaultPolicy === undefined ? null : group.defaultPolicy
              );

              // 添加规则
              output.addRules(rules);

              // 输出文件
              await output.done();

              stats.filesProcessed++;
              stats.rulesMerged += rules.length;
              console.log(`  ✅ ${fileConfig.path}: ${rules.length} 条规则`);
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : String(error);
              stats.errors.push({
                file: fileConfig.path,
                error: errorMsg
              });
              console.error(`  ❌ ${fileConfig.path}: ${errorMsg}`);
            }
          }
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        stats.errors.push({
          file: group.name,
          error: errorMsg
        });
        console.error(`❌ 规则组 ${group.name} 失败: ${errorMsg}`);
      }
    }

    stats.processingTime = Date.now() - startTime;
    return stats;
  }

  /**
   * 处理特殊规则 - 合并多个源并生成多平台输出
   */
  async processSpecialRules(rules: SpecialRuleConfig[]): Promise<ProcessorStats> {
    const startTime = Date.now();
    const stats: ProcessorStats = {
      filesProcessed: 0,
      rulesMerged: 0,
      processingTime: 0,
      errors: []
    };

    for (const ruleConfig of rules) {
      try {
        await this.span.traceChildAsync(`process special: ${ruleConfig.name}`, async (ruleSpan) => {
          console.log(`🔄 处理特殊规则: ${ruleConfig.name}`);

          // 下载所有源文件
          const allRules: string[] = [];
          for (const sourceUrl of ruleConfig.sourceFiles) {
            try {
              const rules = await ruleSpan.traceChild('download').traceAsyncFn(() => fetchAssets(sourceUrl, null, true));
              allRules.push(...rules);
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : String(error);
              console.error(`  ⚠\uFE0F  源文件失败: ${sourceUrl} (${errorMsg})`);
            }
          }

          if (allRules.length === 0) {
            console.log('  ⏭\uFE0F  跳过（无有效规则）');
            return;
          }

          // 创建增强输出器
          const output = new EnhancedFileOutput(
            ruleSpan,
            ruleConfig.name,
            'mixed',
            (ruleConfig.targets as any) || ['surge'],
            ruleConfig.defaultPolicy === undefined ? null : ruleConfig.defaultPolicy
          );

          // 添加规则（会自动去重）
          output.addRules(allRules);

          // 输出文件
          await output.done();

          stats.filesProcessed++;
          stats.rulesMerged += allRules.length;
          console.log(`  ✅ ${ruleConfig.targetFile}: 合并 ${allRules.length} 条规则`);

          // 删除源文件（如果配置了）
          if (ruleConfig.deleteSourceFiles) {
            for (const sourceUrl of ruleConfig.sourceFiles) {
              try {
                const sourcePath = path.join(this.outputDir, path.basename(sourceUrl));
                if (fs.existsSync(sourcePath)) {
                  fs.unlinkSync(sourcePath);
                }
              } catch {
                // 忽略删除失败
              }
            }
          }
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        stats.errors.push({
          file: ruleConfig.targetFile,
          error: errorMsg
        });
        console.error(`❌ 特殊规则 ${ruleConfig.name} 失败: ${errorMsg}`);
      }
    }

    stats.processingTime = Date.now() - startTime;
    return stats;
  }
}
