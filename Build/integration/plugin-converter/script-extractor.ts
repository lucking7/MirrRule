/**
 * 脚本提取模块
 * 从 sgmodule 文件中提取 JavaScript 脚本 URL
 */

import path from 'node:path';
import type { ScriptInfo } from './types';
import { SCRIPT_MIRROR_LOCATION } from './script-location';

/**
 * 正则表达式：匹配 script-path
 */
const SCRIPT_PATH_REGEX = /script-path\s*=\s*(https?:\/\/[^\s",]+\.js[^\s",]*)/gi;

/** Reject converters that silently remove source script dependencies. */
export function validateScriptPreservation(source: string, converted: string): string | undefined {
  if (converted.includes('[Loon v2:')) return 'Unsupported Loon v2 action in converted output';
  const activeSource = source.split('\n').filter(line => !/^\s*[#;]/.test(line)).join('\n');
  const expected = new Set(extractScriptUrls(activeSource).map(script => script.originalUrl));
  for (const match of activeSource.matchAll(/\bscript\(\s*["'](https?:\/\/[^"'\s]+)["']/g)) {
    expected.add(match[1]);
  }
  const actual = new Set(extractScriptUrls(converted).map(script => script.originalUrl));
  const missing = [...expected].filter(url => !actual.has(url));
  if (missing.length) return `Conversion dropped ${missing.length} source script dependencies`;
  return undefined;
}

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
    const isMirrored = url.includes(SCRIPT_MIRROR_LOCATION);

    // 提取文件名
    const filename = extractFilename(url);

    scripts.push({
      originalUrl: url,
      filename,
      isMirrored
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
function extractFilename(url: string): string {
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
 * 过滤出需要镜像的脚本
 *
 * @param scripts - 脚本信息数组
 * @returns 需要镜像的脚本
 */
export function filterUnmirroredScripts(scripts: ScriptInfo[]): ScriptInfo[] {
  return scripts.filter(script => !script.isMirrored);
}

/** Apply resolved mirror URLs without mutating script metadata. */
export function applyScriptMirrorMap(
  content: string,
  scripts: ScriptInfo[],
  urlMap: Readonly<Record<string, string>>
): string {
  let result = content;

  for (const script of scripts) {
    const mirrorUrl = urlMap[script.originalUrl];
    if (script.isMirrored || !mirrorUrl) {
      continue;
    }

    result = result.replaceAll(script.originalUrl, () => mirrorUrl);
  }

  return result;
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
