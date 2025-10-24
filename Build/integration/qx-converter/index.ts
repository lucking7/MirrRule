/**
 * QuantumultX Rewrite 到 Surge Module 转换器
 * 支持从 URL 下载 QX rewrite 文件并转换为 Surge sgmodule 格式
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import picocolors from 'picocolors';
import { $$fetch } from '../../utils/network/fetch-retry';
import { shouldUpdateFile } from '../mirror-sync/checksum';

/**
 * QX Rewrite 规则类型
 */
interface QXRewriteRule {
  pattern: string;
  type: 'header-add' | 'header-del' | 'body' | 'script' | 'reject' | 'redirect';
  replacement?: string;
  scriptPath?: string;
  requiresBody?: boolean;
}

/**
 * 转换配置
 */
export interface QXConversionConfig {
  /** 源 URL */
  sourceUrl: string;
  /** 输出文件名 */
  outputFileName: string;
  /** 模块名称 */
  moduleName: string;
  /** 模块描述 */
  moduleDescription?: string;
  /** 输出目录 */
  outputDir: string;
}

/**
 * 解析 QX rewrite 文件
 */
function parseQXRewrite(content: string): {
  hostname: string[];
  rewrites: QXRewriteRule[];
  scripts: Array<{ pattern: string; scriptPath: string; type: string }>;
} {
  const lines = content.split('\n');
  const hostname: string[] = [];
  const rewrites: QXRewriteRule[] = [];
  const scripts: Array<{ pattern: string; scriptPath: string; type: string }> = [];

  let inHostnameSection = false;
  let inRewriteSection = false;
  let inScriptSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // 跳过注释和空行
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
      continue;
    }

    // 检测 section
    if (trimmed.toLowerCase() === '[mitm]') {
      inHostnameSection = true;
      inRewriteSection = false;
      inScriptSection = false;
      continue;
    }

    if (trimmed.toLowerCase() === '[rewrite_local]') {
      inRewriteSection = true;
      inHostnameSection = false;
      inScriptSection = false;
      continue;
    }

    if (trimmed.toLowerCase() === '[script]') {
      inScriptSection = true;
      inRewriteSection = false;
      inHostnameSection = false;
      continue;
    }

    // 解析 hostname
    if (inHostnameSection && trimmed.startsWith('hostname')) {
      const hostnameValue = trimmed.split('=')[1]?.trim();
      if (hostnameValue) {
        hostname.push(
          ...hostnameValue
            .split(',')
            .map(h => h.trim())
            .filter(Boolean)
        );
      }
      continue;
    }

    // 解析 rewrite 规则
    if (inRewriteSection) {
      // QX rewrite 格式: ^https?://example\.com url reject-200
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 3) {
        const [pattern, , action] = parts;
        rewrites.push({
          pattern,
          type: action.includes('reject') ? 'reject' : 'redirect',
          replacement: action
        });
      }
    }

    // 解析 script
    if (inScriptSection) {
      // QX script 格式: http-response ^https?://example\.com script-path=xxx.js, requires-body=true
      const match = trimmed.match(/^(http-\w+)\s+(.+?)\s+script-path=(.+?)(?:,|$)/);
      if (match) {
        const [, type, pattern, scriptPath] = match;
        scripts.push({
          pattern: pattern.trim(),
          scriptPath: scriptPath.trim(),
          type: type.trim()
        });
      }
    }
  }

  return { hostname, rewrites, scripts };
}

/**
 * 转换为 Surge Module 格式
 */
function convertToSurgeModule(
  parsed: ReturnType<typeof parseQXRewrite>,
  config: QXConversionConfig
): string {
  const lines: string[] = [];

  // 模块头部
  lines.push(`#!name=${config.moduleName}`);
  if (config.moduleDescription) {
    lines.push(`#!desc=${config.moduleDescription}`);
  }
  lines.push('');

  // URL Rewrite 部分
  if (parsed.rewrites.length > 0) {
    lines.push('[URL Rewrite]');
    for (const rewrite of parsed.rewrites) {
      if (rewrite.type === 'reject') {
        lines.push(`${rewrite.pattern} - reject`);
      } else if (rewrite.replacement) {
        lines.push(`${rewrite.pattern} ${rewrite.replacement}`);
      }
    }
    lines.push('');
  }

  // Script 部分
  if (parsed.scripts.length > 0) {
    lines.push('[Script]');
    for (const script of parsed.scripts) {
      const scriptType = script.type === 'http-response' ? 'http-response' : 'http-request';
      lines.push(
        `${config.moduleName}.${scriptType} = type=${scriptType}, pattern=${script.pattern}, script-path=${script.scriptPath}, requires-body=true`
      );
    }
    lines.push('');
  }

  // MITM 部分
  if (parsed.hostname.length > 0) {
    lines.push('[MITM]');
    lines.push(`hostname = %APPEND% ${parsed.hostname.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * 下载并转换 QX rewrite 文件
 */
export async function convertQXRewrite(config: QXConversionConfig): Promise<{
  success: boolean;
  outputPath?: string;
  error?: string;
}> {
  try {
    console.log(picocolors.cyan(`\n[QX Converter] Converting: ${config.moduleName}`));
    console.log(picocolors.gray(`  Source: ${config.sourceUrl}`));

    // 1. 下载源文件
    const response = await $$fetch(config.sourceUrl, {
      headers: {
        'User-Agent': 'Surge Mac/2985'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
    }

    const content = await response.text();

    // 2. 解析 QX rewrite
    const parsed = parseQXRewrite(content);

    // 3. 转换为 Surge Module
    const surgeModule = convertToSurgeModule(parsed, config);

    // 4. 确保输出目录存在
    await fs.mkdir(config.outputDir, { recursive: true });

    // 5. 检查是否需要更新
    const outputPath = path.join(config.outputDir, config.outputFileName);
    const needsUpdate = await shouldUpdateFile(outputPath, Buffer.from(surgeModule, 'utf-8'));

    if (!needsUpdate) {
      console.log(picocolors.gray(`  ○ No changes: ${config.outputFileName}`));
      return { success: true, outputPath };
    }

    // 6. 写入文件
    await fs.writeFile(outputPath, surgeModule, 'utf-8');

    console.log(picocolors.green(`  ✓ Converted: ${config.outputFileName}`));
    return { success: true, outputPath };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.log(picocolors.red(`  ✗ Failed: ${errorMsg}`));
    return { success: false, error: errorMsg };
  }
}

/**
 * 批量转换 QX rewrite 文件
 */
export async function convertQXRewrites(configs: QXConversionConfig[]): Promise<{
  success: number;
  failed: number;
  skipped: number;
}> {
  console.log(picocolors.cyan('\n🔄 QX Rewrite Converter\n'));
  console.log(picocolors.gray(`Total configs: ${configs.length}\n`));

  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (const config of configs) {
    const result = await convertQXRewrite(config);
    if (result.success) {
      success++;
    } else {
      failed++;
    }
  }

  console.log(picocolors.cyan('\n[QX Converter] Summary:'));
  console.log(picocolors.green(`  ✓ Success: ${success}`));
  console.log(picocolors.red(`  ✗ Failed: ${failed}`));

  return { success, failed, skipped };
}

