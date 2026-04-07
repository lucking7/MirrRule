/**
 * 规则加载器 - 支持从 URL、本地 TS 模块、sing-box JSON 加载规则
 */

import picocolors from 'picocolors';
import { fetchAssets } from './network/fetch-assets';
import { $$fetch, defaultRequestInit } from './network/fetch-retry';

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
      if (rule.domain) {
        for (const d of rule.domain) {
          rules.push(`DOMAIN,${d}`);
        }
      }

      if (rule.domain_suffix) {
        for (const d of rule.domain_suffix) {
          rules.push(`DOMAIN-SUFFIX,${d}`);
        }
      }

      if (rule.domain_keyword) {
        for (const k of rule.domain_keyword) {
          rules.push(`DOMAIN-KEYWORD,${k}`);
        }
      }

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

    if (typeof module.getAllRules === 'function') {
      const result = module.getAllRules();
      return Array.isArray(result) ? result : await result;
    }

    if (Array.isArray(module.rules)) {
      return module.rules;
    }

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
 * @param source - URL 或本地 .ts 模块路径
 * @returns 规则数组
 */
export async function loadRules(
  source: string,
  options: LoadRulesOptions = {}
): Promise<string[]> {
  if (isUrl(source)) {
    if (isSingboxJsonUrl(source)) {
      return loadFromSingboxJson(source, options);
    }
    return fetchAssets(source, null, true);
  }

  if (source.endsWith('.ts')) {
    return loadFromTsModule(source, options);
  }

  console.warn(
    picocolors.yellow(`[rule-loader] Unknown source type, treating as URL: ${source}`)
  );
  return fetchAssets(source, null, true);
}
