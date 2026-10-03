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
const SCRIPT_MIRROR_BASE_URL = new URL(`https://${SCRIPT_MIRROR_LOCATION}/`);
const SUPPORTED_FUNCTIONAL_SECTIONS = new Set([
  'general',
  'host',
  'rule',
  'url rewrite',
  'map local',
  'script',
  'panel',
  'mitm',
  'header rewrite',
  'body rewrite',
]);

/** Reject metadata and empty sections without discarding valid standalone actions. */
function hasActiveFunctionalEntry(content: string): boolean {
  let section: string | undefined;

  for (const line of content.split(/\r?\n/)) {
    const sectionMatch = line.trim().match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1].trim().toLowerCase();
      continue;
    }

    const trimmed = line.trim();
    if (!section || !SUPPORTED_FUNCTIONAL_SECTIONS.has(section) || !trimmed || /^[#;]/.test(trimmed)) {
      continue;
    }

    return true;
  }

  return false;
}

function isOwnedScriptMirrorUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.host === SCRIPT_MIRROR_BASE_URL.host
      && url.pathname.startsWith(SCRIPT_MIRROR_BASE_URL.pathname)
      && url.pathname.length > SCRIPT_MIRROR_BASE_URL.pathname.length;
  } catch {
    return false;
  }
}

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
  if (!hasActiveFunctionalEntry(converted)) return 'Converted module has no active supported functional entries';
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
    const isMirrored = isOwnedScriptMirrorUrl(url);

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
