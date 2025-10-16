/**
 * 脚本提取模块
 * 从 sgmodule 文件中提取 JavaScript 脚本 URL
 */

import path from 'node:path';
import type { ScriptInfo } from './types';

/**
 * 镜像配置
 */
const MIRROR_CONFIG = {
  rawBase: 'https://github.com/bunizao/Surge-master-3/raw/main/public/Scripts',
  keyPattern: 'github.com/bunizao/Surge-master-3'
} as const;

/**
 * 正则表达式：匹配 script-path
 */
const SCRIPT_PATH_REGEX = /script-path\s*=\s*(https?:\/\/[^\s",]+\.js[^\s",]*)/gi;

/**
 * 从 sgmodule 内容中提取所有脚本 URL
 *
 * @param content - sgmodule 文件内容
 * @returns 脚本信息数组
 */
export function extractScriptUrls(content: string): ScriptInfo[] {
  const scripts: ScriptInfo[] = [];
  const seen = new Set<string>();

  // 重置正则表达式的 lastIndex
  SCRIPT_PATH_REGEX.lastIndex = 0;

  let match;
  while ((match = SCRIPT_PATH_REGEX.exec(content)) !== null) {
    const url = match[1];

    // 去重
    if (seen.has(url)) {
      continue;
    }
    seen.add(url);

    // 检查是否已经是镜像 URL
    const isMirrored = url.includes(MIRROR_CONFIG.keyPattern);

    // 提取文件名
    const filename = extractFilename(url);

    scripts.push({
      originalUrl: url,
      filename,
      isMirrored,
      mirrorUrl: isMirrored ? undefined : buildMirrorUrl(filename)
    });
  }

  return scripts;
}

/**
 * 从 URL 中提取文件名
 *
 * @param url - 脚本 URL
 * @returns 文件名
 */
export function extractFilename(url: string): string {
  // 移除查询参数和锚点
  const urlWithoutQuery = url.split(/[#?]/)[0];

  // 提取文件名
  let filename = path.basename(urlWithoutQuery);

  // 确保以 .js 结尾
  if (!filename.endsWith('.js')) {
    filename += '.js';
  }

  return filename;
}

/**
 * 构建镜像 URL
 *
 * @param filename - 文件名
 * @returns 镜像 URL
 */
export function buildMirrorUrl(filename: string): string {
  return `${MIRROR_CONFIG.rawBase}/${filename}`;
}

/**
 * 过滤出需要镜像的脚本
 *
 * @param scripts - 脚本信息数组
 * @returns 需要镜像的脚本
 */
export function filterUnmirroredScripts(scripts: ScriptInfo[]): ScriptInfo[] {
  return scripts.filter(script => !script.isMirrored);
}

/**
 * 替换 sgmodule 内容中的脚本 URL 为镜像 URL
 *
 * @param content - sgmodule 内容
 * @param scripts - 脚本信息数组
 * @returns 替换后的内容
 */
export function replaceScriptUrls(content: string, scripts: ScriptInfo[]): string {
  let result = content;

  for (const script of scripts) {
    if (script.isMirrored || !script.mirrorUrl) {
      continue;
    }

    // 使用精确匹配替换
    // 需要转义特殊字符
    const escapedUrl = script.originalUrl.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
    const regex = new RegExp(escapedUrl, 'g');

    result = result.replace(regex, script.mirrorUrl);
  }

  return result;
}

/**
 * 批量提取多个 sgmodule 文件的脚本
 *
 * @param contents - sgmodule 内容数组
 * @returns 所有脚本信息（去重）
 */
export function extractScriptsFromMultiple(contents: string[]): ScriptInfo[] {
  const allScripts: ScriptInfo[] = [];
  const seen = new Set<string>();

  for (const content of contents) {
    const scripts = extractScriptUrls(content);

    for (const script of scripts) {
      if (!seen.has(script.originalUrl)) {
        seen.add(script.originalUrl);
        allScripts.push(script);
      }
    }
  }

  return allScripts;
}

/**
 * 获取脚本统计信息
 */
export interface ScriptStats {
  total: number,
  mirrored: number,
  needMirror: number
}

export function getScriptStats(scripts: ScriptInfo[]): ScriptStats {
  return {
    total: scripts.length,
    mirrored: scripts.filter(s => s.isMirrored).length,
    needMirror: scripts.filter(s => !s.isMirrored).length
  };
}
