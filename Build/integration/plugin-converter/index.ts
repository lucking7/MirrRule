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
export * from './local-converter';
export * from './plugin-mirror';

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
import { convertPluginsLocallyBatch } from './local-converter';
import { mirrorPluginsBatch } from './plugin-mirror';
import type { ConversionResult } from './types';

// CommonJS 中的 __dirname 直接可用

/**
 * 输出目录
 */
const OUTPUT_DIR = path.join(__dirname, '../../../public/Modules/Converted');

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
 * @param waitForService - 是否等待 Script-Hub 服务就绪
 * @param useLocalFallback - Script-Hub 失败时是否使用本地转换备用
 * @returns 转换结果数组
 */
export async function convertAndMirrorPlugins(
  waitForService = false,
  useLocalFallback = true
): Promise<ConversionResult[]> {
  console.log(picocolors.cyan('\nPlugin Converter & Mirror (v2.2 - Hybrid + Local Fallback)\n'));

  // 等待 Script-Hub 服务（如果需要）
  if (waitForService) {
    const isReady = await waitForScriptHub();
    if (!isReady) {
      console.log(picocolors.red('\n[ERROR] Script-Hub service not available'));
      return [];
    }
  }

  // 1. 获取插件列表
  console.log(picocolors.cyan('\n[Step 1/3] Fetching plugin list...\n'));
  const pluginsResult = await getPluginList();

  if ('error' in pluginsResult) {
    console.log(picocolors.red(`[ERROR] Failed to get plugin list: ${pluginsResult.error}`));
    return [];
  }

  const plugins = pluginsResult;
  const stats = getPluginStats(plugins);

  console.log(picocolors.green(`✓ Found ${stats.total} plugins`));
  console.log(picocolors.gray(`  - .plugin: ${stats.byExtension.plugin}`));
  console.log(picocolors.gray(`  - .lpx: ${stats.byExtension.lpx}`));

  // 分离 useLocalOnly 插件
  const localOnlyPlugins = plugins.filter(p => p.useLocalOnly);
  const remotePlugins = plugins.filter(p => !p.useLocalOnly);

  if (localOnlyPlugins.length > 0) {
    console.log(
      picocolors.cyan(
        `\n[Local Only] ${localOnlyPlugins.length} plugins marked for local conversion only`
      )
    );
    localOnlyPlugins.forEach(p => console.log(picocolors.gray(`  - ${p.name}`)));
  }

  // 2. 转换插件
  console.log(picocolors.cyan('\n[Step 2/4] Converting plugins to sgmodule...\n'));
  await ensureOutputDirectory();

  const conversionResults: Array<{ pluginName: string; content: string | { error: string } }> = [];

  // 2a. 本地转换 (useLocalOnly 插件)
  if (localOnlyPlugins.length > 0) {
    console.log(
      picocolors.cyan(
        `\n[Local Only] Converting ${localOnlyPlugins.length} plugins with local converter...\n`
      )
    );

    // 先镜像插件文件
    await mirrorPluginsBatch(localOnlyPlugins);

    // 本地转换
    const localResults = await convertPluginsLocallyBatch(localOnlyPlugins);
    conversionResults.push(...localResults);
  }

  // 2b. Script-Hub 转换 (其他插件)
  if (remotePlugins.length > 0) {
    console.log(
      picocolors.cyan(
        `\n[Script-Hub] Converting ${remotePlugins.length} plugins with Script-Hub...\n`
      )
    );
    const remoteResults = await convertPluginsBatchFromRemote(remotePlugins);
    conversionResults.push(...remoteResults);
  }

  // 2c. 检查失败的插件，使用本地转换器重试
  if (useLocalFallback && remotePlugins.length > 0) {
    const failedPlugins: typeof remotePlugins = [];

    for (const result of conversionResults) {
      if (typeof result.content === 'string') {
        continue;
      }

      const matched = remotePlugins.find(p => p.name === result.pluginName);
      if (matched) {
        failedPlugins.push(matched);
      }
    }

    if (failedPlugins.length > 0) {
      console.log(
        picocolors.yellow(
          `\n[Fallback] ${failedPlugins.length} plugins failed, using local converter...\n`
        )
      );

      // 先镜像失败的插件
      await mirrorPluginsBatch(failedPlugins);

      // 本地转换
      const localResults = await convertPluginsLocallyBatch(failedPlugins);

      // 替换失败的结果
      for (const localResult of localResults) {
        const index = conversionResults.findIndex(r => r.pluginName === localResult.pluginName);
        if (index !== -1) {
          conversionResults[index] = localResult;
        }
      }
    }
  }

  // 3. 处理转换结果
  console.log(picocolors.cyan('\n[Step 3/4] Processing conversion results...\n'));

  const results: ConversionResult[] = [];
  const allScripts: string[] = [];

  for (const { pluginName, content } of conversionResults) {
    if (typeof content === 'string') {
      // 提取脚本
      const scripts = extractScriptUrls(content);

      // 从内容中提取模块名称
      const moduleName = extractModuleName(content, pluginName);
      const fileName = `${moduleName}.sgmodule`;

      // 保存 sgmodule 文件（主输出目录）
      const outputPath = path.join(OUTPUT_DIR, fileName);
      await fs.writeFile(outputPath, content, 'utf-8');

      // 统一日志输出
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

  // 4. 提取所有脚本
  console.log(picocolors.cyan('\n[Step 4/4] Extracting JavaScript URLs...\n'));

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

  console.log(picocolors.green('\nPlugin conversion complete!\n'));
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
