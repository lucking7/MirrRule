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
import type { RuleGroup, SpecialRuleConfig } from './rule-source-types';
import { applyDefaultConfig } from './rule-sources';
import path from 'node:path';
import fs from 'node:fs';

interface ProcessorStats {
  filesProcessed: number;
  rulesMerged: number;
  processingTime: number;
  errors: Array<{ file: string; error: string }>;
}

export class RuleSourceProcessor {
  constructor(private readonly span: Span, private readonly outputDir = 'public') {}

  /**
   * 处理规则组 - 下载并生成多平台输出
   */
  async processRuleGroups(groups: RuleGroup[]): Promise<ProcessorStats> {
    const startTime = Date.now();
    const stats: ProcessorStats = {
      filesProcessed: 0,
      rulesMerged: 0,
      processingTime: 0,
      errors: [],
    };

    for (const group of groups) {
      try {
        await this.span.traceChildAsync(`process group: ${group.name}`, async groupSpan => {
          console.log(`📦 处理规则组: ${group.name}`);

          if (!group.files || group.files.length === 0) {
            console.log('  ⏭\uFE0F  跳过（无文件）');
            return;
          }

          for (const fileConfig of group.files) {
            try {
              // 下载规则文件
              const rules = await groupSpan
                .traceChild('download')
                .traceAsyncFn(() =>
                  fetchAssets(fileConfig.url, fileConfig.fallbackUrls || null, true)
                );

              // 🔧 应用默认配置
              const mergedConfig = applyDefaultConfig(fileConfig);

              // 🔧 提取文件名（不带扩展名）作为 ID,并转换为小写
              const fileExt = path.extname(fileConfig.path);
              const fileName = path.basename(fileConfig.path, fileExt).toLowerCase();

              // 🔧 创建增强输出器 - 传递完整配置
              // 🔧 ruleType 设为空字符串，取消规则分类，避免创建子目录
              const output = new EnhancedFileOutput(
                groupSpan,
                fileName, // 使用不带扩展名的文件名
                '', // 🔧 空字符串，不创建基于规则类型的子目录
                (group.targets as any) || ['surge'],
                group.defaultPolicy === undefined ? null : group.defaultPolicy,
                mergedConfig // 🔧 传递合并后的配置参数
              );

              // 设置标题和描述
              output
                .withTitle(fileConfig.title || group.name)
                .withDescription([
                  fileConfig.description || group.description || `Rules for ${group.name}`,
                  `Source: ${fileConfig.url}`,
                ]);

              // 添加规则
              output.addRules(rules);

              // 输出文件
              await output.write();

              stats.filesProcessed++;
              stats.rulesMerged += rules.length;
              console.log(`  ✅ ${fileConfig.path}: ${rules.length} 条规则`);
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : String(error);
              stats.errors.push({
                file: fileConfig.path,
                error: errorMsg,
              });
              console.error(`  ❌ ${fileConfig.path}: ${errorMsg}`);
            }
          }
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        stats.errors.push({
          file: group.name,
          error: errorMsg,
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
      errors: [],
    };

    for (const ruleConfig of rules) {
      try {
        await this.span.traceChildAsync(`process special: ${ruleConfig.name}`, async ruleSpan => {
          console.log(`🔄 处理特殊规则: ${ruleConfig.name}`);

          // 下载所有源文件
          const allRules: string[] = [];
          for (const sourceUrl of ruleConfig.sourceFiles) {
            try {
              const rules = await ruleSpan
                .traceChild('download')
                .traceAsyncFn(() => fetchAssets(sourceUrl, null, true));
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

          // 🔧 应用默认配置
          const mergedConfig = applyDefaultConfig(ruleConfig);

          // 🔧 从 targetFile 提取文件名(不含扩展名和路径)
          // 例如: 'List/reject.list' → 'reject'
          const fileName = ruleConfig.targetFile
            ? path.basename(ruleConfig.targetFile, path.extname(ruleConfig.targetFile))
            : ruleConfig.name.toLowerCase();

          // 🔧 创建增强输出器 - 使用 targetFile 中的文件名
          // 🔧 ruleType 设为空字符串，取消规则分类，避免创建子目录
          const output = new EnhancedFileOutput(
            ruleSpan,
            fileName,
            '', // 🔧 空字符串，不创建基于规则类型的子目录
            (ruleConfig.targets as any) || ['surge'],
            ruleConfig.defaultPolicy === undefined ? null : ruleConfig.defaultPolicy,
            mergedConfig // 🔧 传递合并后的配置参数
          );

          // 设置标题和描述
          output
            .withTitle(ruleConfig.name)
            .withDescription([
              ruleConfig.description || `Rules for ${ruleConfig.name}`,
              `Merged from ${ruleConfig.sourceFiles.length} sources`,
            ]);

          // 添加规则（会自动去重）
          output.addRules(allRules);

          // 输出文件
          await output.write();

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
          error: errorMsg,
        });
        console.error(`❌ 特殊规则 ${ruleConfig.name} 失败: ${errorMsg}`);
      }
    }

    stats.processingTime = Date.now() - startTime;
    return stats;
  }
}
