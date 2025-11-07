/**
 * 插件转换模块入口
 * 导出所有公共 API
 */

export type * from './types';
export * from './script-hub-client';
export * from './script-extractor';
export * from './script-mirror';
export * from './plugin-list';
export * from './plugin-downloader';

import fs from 'node:fs/promises';
import path from 'node:path';
import picocolors from 'picocolors';
import { getPluginList, getPluginStats } from './plugin-list';
import { convertPluginsBatchFromRemote, waitForScriptHub } from './script-hub-client';
import {
  extractScriptUrls,
  filterUnmirroredScripts,
  replaceScriptUrls,
  getScriptStats,
} from './script-extractor';
import { mirrorScripts, printMirrorSummary } from './script-mirror';
import type { ConversionResult } from './types';

// CommonJS 中的 __dirname 直接可用

/**
 * 输出目录
 */
const OUTPUT_DIR = path.join(__dirname, '../../../public/Modules');

/**
 * 确保输出目录存在
 */
async function ensureOutputDirectory(): Promise<void> {
  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
  } catch {
    // 忽略
  }
}

/**
 * 从 sgmodule 内容中提取模块名称
 *
 * @param content - sgmodule 文件内容
 * @param fallbackName - 如果提取失败使用的备用名称
 * @returns 清理后的模块名称
 */
function extractModuleName(content: string, fallbackName: string): string {
  // 按行分割，查找 #!name 行（支持等号前后有空格）
  const lines = content.split(/\r?\n/);
  const nameLine = lines.find(line => /^#!name\s*=/.test(line.trim()));

  if (nameLine) {
    // 提取 = 后面的内容
    const equalIndex = nameLine.indexOf('=');
    if (equalIndex !== -1) {
      const moduleName = nameLine.slice(Math.max(0, equalIndex + 1)).trim();

      // 如果提取的名称为空，使用备用名称
      if (!moduleName) {
        return fallbackName;
      }

      // 清理文件名中的非法字符
      // 保留中文、英文、数字、空格、连字符、下划线、点号
      const cleanName = moduleName
        .replaceAll(/["*/:<>?\\|]/g, '') // 移除文件系统非法字符
        .replaceAll(/\s+/g, ' ') // 合并多个空格
        .trim();

      return cleanName || fallbackName;
    }
  }

  return fallbackName;
}

/**
 * 转换并镜像所有插件
 *
 * 新流程（v2.1 - 远程转换 + 代理支持）：
 * 1. 获取插件列表
 * 2. 用 Script-Hub 直接从远程 URL 转换（kelee.one 自动使用代理）
 * 3. 提取并镜像脚本文件
 *
 * 优势：
 * - 避免本地文件路径问题（GitHub Actions 环境）
 * - 支持代理访问 kelee.one 等受保护的域名
 * - 完全参考 Mirrored-main 项目的成功实践
 * - 添加重试机制和详细错误日志
 *
 * @param waitForService - 是否等待 Script-Hub 服务就绪
 * @returns 转换结果数组
 */
export async function convertAndMirrorPlugins(waitForService = false): Promise<ConversionResult[]> {
  console.log(picocolors.cyan('\n🔄 Plugin Converter & Mirror (v2.1 - Remote + Proxy)\n'));

  // 等待 Script-Hub 服务（如果需要）
  if (waitForService) {
    const isReady = await waitForScriptHub();
    if (!isReady) {
      console.log(picocolors.red('\n❌ Script-Hub service not available'));
      return [];
    }
  }

  // 1. 获取插件列表
  console.log(picocolors.cyan('\n[Step 1/3] Fetching plugin list...\n'));
  const pluginsResult = await getPluginList();

  if ('error' in pluginsResult) {
    console.log(picocolors.red(`❌ Failed to get plugin list: ${pluginsResult.error}`));
    return [];
  }

  const plugins = pluginsResult;
  const stats = getPluginStats(plugins);

  console.log(picocolors.green(`✓ Found ${stats.total} plugins`));
  console.log(picocolors.gray(`  - .plugin: ${stats.byExtension.plugin}`));
  console.log(picocolors.gray(`  - .lpx: ${stats.byExtension.lpx}`));

  // 2. 转换插件 (从远程 URL，支持代理)
  console.log(picocolors.cyan('\n[Step 2/3] Converting plugins to sgmodule...\n'));
  await ensureOutputDirectory();

  const conversionResults = await convertPluginsBatchFromRemote(plugins);

  const results: ConversionResult[] = [];
  const allScripts: string[] = [];

  for (const { pluginName, content } of conversionResults) {
    if (typeof content === 'string') {
      // 提取脚本
      const scripts = extractScriptUrls(content);

      // 从内容中提取模块名称
      const moduleName = extractModuleName(content, pluginName);
      const fileName = `${moduleName}.sgmodule`;

      // 保存 sgmodule 文件
      const outputPath = path.join(OUTPUT_DIR, fileName);
      await fs.writeFile(outputPath, content, 'utf-8');

      console.log(picocolors.gray(`  ✓ ${pluginName} → ${fileName}`));

      results.push({
        pluginName,
        success: true,
        outputPath,
        scripts,
      });

      allScripts.push(content);
    } else {
      results.push({
        pluginName,
        success: false,
        scripts: [],
        error: content.error,
      });
    }
  }

  const successCount = results.filter(r => r.success).length;
  console.log(picocolors.green(`\n✓ Converted ${successCount}/${plugins.length} plugins`));

  // 3. 提取所有脚本
  console.log(picocolors.cyan('\n[Step 3/3] Extracting JavaScript URLs...\n'));

  const allScriptInfos = allScripts.flatMap(content => extractScriptUrls(content));
  const uniqueScripts = Array.from(new Map(allScriptInfos.map(s => [s.originalUrl, s])).values());

  const scriptStats = getScriptStats(uniqueScripts);
  console.log(picocolors.green(`✓ Found ${scriptStats.total} unique scripts`));
  console.log(picocolors.gray(`  - Already mirrored: ${scriptStats.mirrored}`));
  console.log(picocolors.gray(`  - Need to mirror: ${scriptStats.needMirror}`));

  // 镜像脚本
  if (scriptStats.needMirror > 0) {
    console.log(picocolors.cyan('\n[Mirror] Mirroring JavaScript files...\n'));

    const toMirror = filterUnmirroredScripts(uniqueScripts);
    const mirrorResult = await mirrorScripts(toMirror);

    printMirrorSummary(mirrorResult);

    // 更新 sgmodule 文件中的 URL
    if (mirrorResult.mirrored > 0) {
      console.log(picocolors.cyan('\n[Update] Updating sgmodule files with mirror URLs...\n'));

      for (const result of results) {
        if (!result.success || !result.outputPath) continue;

        const content = await fs.readFile(result.outputPath, 'utf-8');
        const updated = replaceScriptUrls(content, result.scripts);

        if (updated !== content) {
          await fs.writeFile(result.outputPath, updated, 'utf-8');
          console.log(picocolors.green(`✓ Updated: ${result.pluginName}.sgmodule`));
        }
      }
    }
  } else {
    console.log(picocolors.gray('\n[Mirror] No scripts to mirror - skipping\n'));
  }

  console.log(picocolors.green('\n🎉 Plugin conversion complete!\n'));
  console.log(picocolors.cyan('Summary:'));
  console.log(picocolors.gray(`  - Total plugins: ${plugins.length}`));
  console.log(picocolors.gray(`  - Converted: ${successCount}/${plugins.length} plugins`));
  console.log(picocolors.gray(`  - Scripts mirrored: ${scriptStats.needMirror} files`));

  return results;
}

/**
 * 打印转换结果摘要
 */
export function printConversionSummary(results: ConversionResult[]): void {
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(picocolors.cyan('\n[Conversion] Summary:'));
  console.log(picocolors.green(`  ✓ Successful: ${successful.length}`));
  console.log(picocolors.red(`  ✗ Failed: ${failed.length}`));

  if (failed.length > 0) {
    console.log(picocolors.red('\n[Conversion] Failed plugins:'));
    for (const result of failed) {
      console.log(picocolors.red(`  - ${result.pluginName}: ${result.error}`));
    }
  }
}
