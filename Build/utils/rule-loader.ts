/**
 * 规则加载器 - 支持从 URL、本地文件、TS 模块、sing-box JSON 加载规则
 */

import fs from 'node:fs';
import path from 'node:path';
import picocolors from 'picocolors';
import { fetchAssets } from './network/fetch-assets';
import { $$fetch, defaultRequestInit } from './network/fetch-retry';

/**
 * 规则源类型
 */
type RuleSource =
  | string // URL 或本地文件路径
  | (() => string[]) // 函数（同步）
  | (() => Promise<string[]>); // 函数（异步）

interface LoadRulesOptions {
  throwOnError?: boolean;
}

/**
 * 判断是否为 URL
 */
function isUrl(source: string): boolean {
  return source.startsWith('http://') || source.startsWith('https://');
}

/**
 * 判断是否为本地文件
 */
function isLocalFile(source: string): boolean {
  return fs.existsSync(source);
}

/**
 * 从本地文件加载规则
 */
async function loadFromLocalFile(filePath: string): Promise<string[]> {
  const content = await fs.promises.readFile(filePath, 'utf-8');
  const rules: string[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length > 0) {
      rules.push(trimmed);
    }
  }
  return rules;
}

/**
 * sing-box rule-set JSON 格式 (version 1 & 2)
 * @see https://sing-box.sagernet.org/configuration/rule-set/source-format/
 */
interface SingboxRuleSet {
  version?: number;
  rules: Array<{
    domain?: string[];
    domain_suffix?: string[];
    domain_keyword?: string[];
    domain_regex?: string | string[];
    ip_cidr?: string[];
    // 其他字段暂不处理
  }>;
}

/**
 * 判断是否为 sing-box JSON URL
 */
function isSingboxJsonUrl(url: string): boolean {
  return url.endsWith('.json') && (
    url.includes('meta-rules-dat') ||
    url.includes('sing-box') ||
    url.includes('geosite') ||
    url.includes('geoip')
  );
}

/**
 * 从 sing-box JSON 格式加载规则并转换为 Surge 格式
 */
async function loadFromSingboxJson(
  url: string,
  options: LoadRulesOptions = {}
): Promise<string[]> {
  console.log(picocolors.gray(`[rule-loader] Loading sing-box JSON: ${url}`));

  try {
    const response = await $$fetch(url, defaultRequestInit);
    const json: SingboxRuleSet = await response.json() as SingboxRuleSet;

    const rules: string[] = [];

    for (const rule of json.rules) {
      // domain -> DOMAIN
      if (rule.domain) {
        for (const d of rule.domain) {
          rules.push(`DOMAIN,${d}`);
        }
      }

      // domain_suffix -> DOMAIN-SUFFIX
      if (rule.domain_suffix) {
        for (const d of rule.domain_suffix) {
          rules.push(`DOMAIN-SUFFIX,${d}`);
        }
      }

      // domain_keyword -> DOMAIN-KEYWORD
      if (rule.domain_keyword) {
        for (const k of rule.domain_keyword) {
          rules.push(`DOMAIN-KEYWORD,${k}`);
        }
      }

      // domain_regex -> 跳过（复杂度高，收益低）

      // ip_cidr -> IP-CIDR / IP-CIDR6
      if (rule.ip_cidr) {
        for (const cidr of rule.ip_cidr) {
          if (cidr.includes(':')) {
            rules.push(`IP-CIDR6,${cidr},no-resolve`);
          } else {
            rules.push(`IP-CIDR,${cidr},no-resolve`);
          }
        }
      }
    }

    console.log(picocolors.green(`[rule-loader] Loaded ${rules.length} rules from sing-box JSON`));
    return rules;
  } catch (error) {
    console.error(picocolors.red(`[rule-loader] Failed to load sing-box JSON: ${url}`), error);
    if (options.throwOnError) {
      throw error;
    }
    return [];
  }
}

/**
 * 从 TS 模块加载规则
 * 支持导出 getAllRules() 函数或 rules 数组
 */
async function loadFromTsModule(
  modulePath: string,
  options: LoadRulesOptions = {}
): Promise<string[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- runtime TS modules are loaded through @swc-node/register
    const module = require(modulePath);

    // 优先使用 getAllRules 函数
    if (typeof module.getAllRules === 'function') {
      const result = module.getAllRules();
      return Array.isArray(result) ? result : await result;
    }

    // 其次检查 rules 数组
    if (Array.isArray(module.rules)) {
      return module.rules;
    }

    // 检查 default 导出
    if (module.default) {
      if (typeof module.default.getAllRules === 'function') {
        const result = module.default.getAllRules();
        return Array.isArray(result) ? result : await result;
      }
      if (Array.isArray(module.default.rules)) {
        return module.default.rules;
      }
      if (Array.isArray(module.default)) {
        return module.default;
      }
    }

    console.warn(
      picocolors.yellow(`[rule-loader] Module ${modulePath} has no getAllRules() or rules export`)
    );
    return [];
  } catch (error) {
    console.error(
      picocolors.red(`[rule-loader] Failed to load TS module: ${modulePath}`),
      error
    );
    if (options.throwOnError) {
      throw error;
    }
    return [];
  }
}

/**
 * 加载规则（自动检测源类型）
 *
 * @param source - URL、本地文件路径、或返回规则的函数
 * @returns 规则数组
 */
export async function loadRules(
  source: RuleSource,
  options: LoadRulesOptions = {}
): Promise<string[]> {
  // 函数类型
  if (typeof source === 'function') {
    return source();
  }

  // 字符串类型（URL 或文件路径）
  if (typeof source === 'string') {
    // URL
    if (isUrl(source)) {
      // sing-box JSON 格式
      if (isSingboxJsonUrl(source)) {
        return loadFromSingboxJson(source, options);
      }
      // 普通文本格式
      return fetchAssets(source, null, true);
    }

    // TS 模块
    if (source.endsWith('.ts')) {
      return loadFromTsModule(source, options);
    }

    // 本地文件
    if (isLocalFile(source)) {
      console.log(picocolors.gray(`[rule-loader] Loading local file: ${source}`));
      return loadFromLocalFile(source);
    }

    // 可能是相对路径，尝试解析
    const absolutePath = path.resolve(source);
    if (isLocalFile(absolutePath)) {
      console.log(picocolors.gray(`[rule-loader] Loading local file: ${absolutePath}`));
      return loadFromLocalFile(absolutePath);
    }

    // 都不是，当作 URL 处理
    console.warn(
      picocolors.yellow(`[rule-loader] Source not found locally, treating as URL: ${source}`)
    );
    return fetchAssets(source, null, true);
  }

  console.warn(picocolors.yellow(`[rule-loader] Unknown source type: ${typeof source}`));
  return [];
}

/**
 * 批量加载规则
 *
 * @param sources - 规则源数组
 * @returns 合并的规则数组
 */
export async function loadMultipleRules(sources: RuleSource[]): Promise<string[]> {
  const results = await Promise.all(sources.map(source => loadRules(source)));
  return results.flat();
}
