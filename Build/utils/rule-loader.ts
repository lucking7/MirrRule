/**
 * 规则加载器 - 支持从 URL、本地 TS 模块、sing-box JSON 加载规则
 */

import picocolors from 'picocolors';
import { castArray } from 'foxts/cast-array';
import { fetchAssets } from './network/fetch-assets';
import { $$fetch, defaultRequestInit } from './network/fetch-retry';
import { IPValidator } from './validation/validators';
import {
  isAnthropicIpDocsUrl,
  isGoogleIpRangesUrl,
  isRipestatAnnouncedPrefixesUrl,
  loadAnthropicDocsIpRules,
  loadGoogleOwnedIpRules,
  loadRipestatAsnRules,
} from '../lib/primary-ip-sources';

interface LoadRulesOptions {
  throwOnError?: boolean;
  allowEmpty?: boolean;
}

/**
 * 判断是否为 URL
 */
function isUrl(source: string): boolean {
  return source.startsWith('http://') || source.startsWith('https://');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// These matchers share an OR group; extra AND predicates must not be discarded.
const singboxMatchers: Readonly<Record<string, string>> = {
  domain: 'DOMAIN',
  domain_suffix: 'DOMAIN-SUFFIX',
  domain_keyword: 'DOMAIN-KEYWORD',
  ip_cidr: 'IP-CIDR',
};

function convertSingboxRules(json: unknown, allowEmpty: boolean): string[] {
  if (!isObject(json) || (json.version !== 1 && json.version !== 2) || !Array.isArray(json.rules)) {
    throw new Error('Expected a sing-box rule-set with version 1 or 2 and a rules array');
  }
  if (Object.keys(json).some(key => key !== 'version' && key !== 'rules')) {
    throw new Error('Unsupported sing-box rule-set fields');
  }

  const rules: string[] = [];
  for (const [index, rule] of json.rules.entries()) {
    if (!isObject(rule)) throw new Error(`Invalid sing-box rule at index ${index}`);
    const before = rules.length;
    for (const [field, value] of Object.entries(rule)) {
      if (field === 'type' && value === 'default') continue;
      if (field === 'invert' && value === false) continue;
      if (!Object.hasOwn(singboxMatchers, field)) {
        throw new Error(`Unsupported sing-box rule field ${field} at index ${index}`);
      }
      if (typeof value !== 'string' && !Array.isArray(value)) {
        throw new TypeError(`Invalid sing-box ${field} value at index ${index}`);
      }
      for (const item of castArray(value)) {
        if (typeof item !== 'string' || !item.trim() || /[,\r\n]/.test(item)) {
          throw new Error(`Invalid sing-box ${field} value at index ${index}`);
        }
        const text = item.trim();
        if (field === 'ip_cidr') {
          if (!IPValidator.isIpCidr(text)) throw new Error(`Invalid sing-box ip_cidr at index ${index}: ${text}`);
          rules.push(`${text.includes(':') ? 'IP-CIDR6' : 'IP-CIDR'},${text},no-resolve`);
        } else {
          rules.push(`${singboxMatchers[field]},${text}`);
        }
      }
    }
    if (rules.length === before) throw new Error(`Sing-box rule at index ${index} has no supported matchers`);
  }
  if (!allowEmpty && !rules.length) throw new Error('Empty sing-box rule-set is not allowed');
  return rules;
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
    const rules = convertSingboxRules(await response.json(), options.allowEmpty ?? false);

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
    if (isAnthropicIpDocsUrl(source)) {
      return loadAnthropicDocsIpRules(source, options);
    }
    if (isRipestatAnnouncedPrefixesUrl(source)) {
      return loadRipestatAsnRules(source, options);
    }
    if (isGoogleIpRangesUrl(source)) {
      return loadGoogleOwnedIpRules(source, options);
    }
    if (isSingboxJsonUrl(source)) {
      return loadFromSingboxJson(source, options);
    }
    return fetchAssets(source, null, true, options.allowEmpty ?? false);
  }

  if (source.endsWith('.ts')) {
    return loadFromTsModule(source, options);
  }

  console.warn(
    picocolors.yellow(`[rule-loader] Unknown source type, treating as URL: ${source}`)
  );
  return fetchAssets(source, null, true, options.allowEmpty ?? false);
}
