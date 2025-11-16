/**
 * 本地插件转换器 - 集成 /converter 目录的转换逻辑
 * 用于当 Script-Hub 服务不可用时的备用方案
 */

import picocolors from 'picocolors';
import { getPluginContent } from './plugin-mirror';
import type { PluginInfo } from './types';

/**
 * 参数类型
 */
type ArgumentType = 'switch' | 'select' | 'input';

/**
 * 参数定义
 */
interface Argument {
  name: string;
  type: ArgumentType;
  defaultValue: string | boolean;
  tag: string;
  desc: string;
  options?: string[];
  /** 是否为脚本开关（例如 12306_enable） */
  isEnableSwitch?: boolean;
}

/**
 * 脚本类型
 */
type ScriptType = 'http-request' | 'http-response' | 'cron' | 'event' | 'generic';

/**
 * 脚本定义
 */
interface Script {
  name: string;
  type: ScriptType;
  pattern: string;
  scriptPath: string;
  requiresBody?: boolean;
  binaryBodyMode?: boolean;
  timeout?: number;
  maxSize?: number;
  argument?: string;
  cronExpression?: string;
  engine?: string;
  enableParam?: string;
}

/**
 * 重写规则
 */
interface RewriteRule {
  pattern: string;
  replacement: string;
  type:
    | 'reject'
    | 'reject-dict'
    | 'reject-array'
    | 'reject-200'
    | 'reject-img'
    | 'reject-tinygif'
    | 'mock'
    | 'redirect'
    | '302'
    | '307'
    | 'header'
    | 'header-rewrite'
    | 'jq';
  comment?: string;
  mockData?: {
    dataType?: string;
    statusCode?: number;
    data?: string;
    header?: string;
  };
}

/**
 * Header Rewrite 规则
 */
interface HeaderRewriteRule {
  pattern: string;
  type: 'http-request' | 'http-response';
  action: 'header-del' | 'header-add' | 'header-replace' | 'header-replace-regex';
  params: string[];
  comment?: string;
}

/**
 * MITM 配置
 */
interface MitmConfig {
  hostnames: string[];
  h2?: boolean;
}

/**
 * 模块元信息
 */
interface ModuleMetadata {
  name?: string;
  desc?: string;
  author?: string;
  homepage?: string;
  icon?: string;
  openUrl?: string;
  tag?: string;
  category?: string;
  system?: string;
  systemVersion?: string;
  date?: string;
  version?: string;
}

/**
 * Loon 插件结构
 */
interface LoonPlugin {
  metadata: ModuleMetadata;
  arguments: Argument[];
  rewrites: RewriteRule[];
  headerRewrites?: HeaderRewriteRule[];
  scripts: Script[];
  mitm: MitmConfig;
  rules?: string[];
}

/**
 * Surge 模块结构
 */
interface SurgeModule {
  metadata: ModuleMetadata;
  arguments: Argument[];
  urlRewrites: RewriteRule[];
  headerRewrites: HeaderRewriteRule[];
  mapLocal: RewriteRule[];
  bodyRewrites: RewriteRule[];
  scripts: Script[];
  mitm: MitmConfig;
  rules?: string[];
}

/**
 * 本地转换结果
 */
export interface LocalConversionResult {
  pluginName: string;
  content: string | { error: string };
}

/**
 * Loon 插件解析器
 */
class LoonPluginParser {
  private static lastComment: string = '';

  /**
   * 解析 Loon 插件文件
   */
  static parse(content: string): LoonPlugin {
    this.lastComment = '';

    const lines = content.split('\n');
    const plugin: LoonPlugin = {
      metadata: {},
      arguments: [],
      rewrites: [],
      scripts: [],
      mitm: { hostnames: [] },
      rules: [],
      headerRewrites: [],
    };

    let currentSection: string | null = null;

    for (const line of lines) {
      const trimmedLine = line.trim();

      if (!trimmedLine) continue;

      // 解析元信息
      if (trimmedLine.startsWith('#!')) {
        this.parseMetadata(trimmedLine, plugin.metadata);
        continue;
      }

      // 检测区块
      if (trimmedLine.startsWith('[') && trimmedLine.endsWith(']')) {
        currentSection = trimmedLine.slice(1, -1).toLowerCase();
        continue;
      }

      // 根据当前区块解析内容
      switch (currentSection) {
        case 'argument':
          if (!trimmedLine.startsWith('#') && !trimmedLine.startsWith(';')) {
            const arg = this.parseArgument(trimmedLine);
            if (arg) plugin.arguments.push(arg);
          }
          break;

        case 'rewrite':
          if (trimmedLine.startsWith('#')) {
            this.lastComment = trimmedLine.substring(1).trim();
          } else if (!trimmedLine.startsWith(';')) {
            if (/\s(response-)?header-(del|add|replace|replace-regex)\s/.test(trimmedLine)) {
              const headerRewrite = this.parseHeaderRewrite(trimmedLine);
              if (headerRewrite) {
                if (this.lastComment) {
                  headerRewrite.comment = this.lastComment;
                  this.lastComment = '';
                }
                plugin.headerRewrites?.push(headerRewrite);
              }
            } else {
              const rewrite = this.parseRewrite(trimmedLine);
              if (rewrite) {
                if (this.lastComment) {
                  rewrite.comment = this.lastComment;
                  this.lastComment = '';
                }
                plugin.rewrites.push(rewrite);
              }
            }
          }
          break;

        case 'script':
          if (!trimmedLine.startsWith('#') && !trimmedLine.startsWith(';')) {
            const script = this.parseScript(trimmedLine);
            if (script) plugin.scripts.push(script);
          }
          break;

        case 'mitm':
          this.parseMitm(trimmedLine, plugin.mitm);
          break;

        case 'rule':
          if (!trimmedLine.startsWith('#') && !trimmedLine.startsWith(';')) {
            plugin.rules?.push(trimmedLine);
          }
          break;
      }
    }

    return plugin;
  }

  private static parseMetadata(line: string, metadata: ModuleMetadata): void {
    const match = line.match(/^#!(\w+)\s*=\s*(.+)$/);
    if (!match) return;

    const [, key, value] = match;
    const trimmedValue = value.trim();

    const keyMap: Record<string, keyof ModuleMetadata> = {
      name: 'name',
      desc: 'desc',
      author: 'author',
      homepage: 'homepage',
      icon: 'icon',
      openUrl: 'openUrl',
      tag: 'tag',
      system: 'system',
      system_version: 'systemVersion',
      date: 'date',
      version: 'version',
    };

    const metaKey = keyMap[key];
    if (metaKey) {
      (metadata as any)[metaKey] = trimmedValue;
    }
  }

  private static parseArgument(line: string): Argument | null {
    const regex =
      /^([^=]+?)\s*=\s*(\w+)\s*,\s*(.+?)\s*,\s*tag\s*=\s*([^,]+)(?:\s*,\s*desc\s*=\s*(.*))?$/;
    const match = line.match(regex);

    if (!match) return null;

    const [, name, type, valueStr, tag, desc = ''] = match;
    const argType = type as ArgumentType;

    let defaultValue: string | boolean;
    let options: string[] | undefined;

    if (argType === 'switch') {
      const values = valueStr.split(',').map(v => v.trim());
      defaultValue = values[0] === 'true';
    } else if (argType === 'select') {
      options = valueStr.match(/"([^"]+)"/g)?.map(s => s.slice(1, -1)) || [];
      defaultValue = options[0] || '';
    } else {
      defaultValue = valueStr.replace(/^"(.*)"$/, '$1');
    }

    const nameTrimmed = name.trim();

    return {
      name: nameTrimmed,
      type: argType,
      defaultValue,
      tag: tag.trim(),
      desc: desc.trim(),
      options,
      isEnableSwitch: nameTrimmed.endsWith('_enable'),
    };
  }

  private static parseScript(line: string): Script | null {
    const typeMatch = line.match(/^(http-request|http-response|cron|event|generic)\s+(.+)/);
    if (!typeMatch) return null;

    const [, type, rest] = typeMatch;
    const parts = rest.split(/\s+/);
    const pattern = parts[0];

    const scriptPath = this.extractParam(line, 'script-path');
    const tag = this.extractParam(line, 'tag');
    const argument = this.extractParam(line, 'argument');
    const requiresBody = this.extractParam(line, 'requires-body') === '1';
    const binaryBodyMode = this.extractParam(line, 'binary-body-mode') === '1';
    const timeout = parseInt(this.extractParam(line, 'timeout') || '0') || undefined;
    const maxSize = parseInt(this.extractParam(line, 'max-size') || '0') || undefined;
    const cronExpression = this.extractParam(line, 'cron');
    const engine = this.extractParam(line, 'engine');

    const enableMatch = line.match(/enable\s*=\s*\{([^}]+)\}/);
    const enableParam = enableMatch ? enableMatch[1] : undefined;

    if (!scriptPath) return null;

    return {
      name: tag || this.generateScriptName(scriptPath),
      type: type as ScriptType,
      pattern,
      scriptPath,
      requiresBody,
      binaryBodyMode,
      timeout,
      maxSize,
      argument,
      cronExpression,
      engine,
      enableParam,
    };
  }

  private static parseHeaderRewrite(line: string): HeaderRewriteRule | null {
    const match = line.match(
      /^(.+?)\s+(response-)?(header-(del|add|replace|replace-regex))\s+(.+)$/
    );
    if (!match) return null;

    const [, pattern, isResponse, action, , paramsStr] = match;

    const params: string[] = [];
    const regex = /"([^"]*)"|(\S+)/g;
    let paramMatch;
    while ((paramMatch = regex.exec(paramsStr)) !== null) {
      params.push(paramMatch[1] || paramMatch[2]);
    }

    return {
      pattern,
      type: isResponse ? 'http-response' : 'http-request',
      action: action as any,
      params,
    };
  }

  private static parseRewrite(line: string): RewriteRule | null {
    // ⭐ 规范化 Quantumult X 风格的 " - " 分隔符
    line = line.replace(/\s+-\s+/g, ' ');

    // ⭐ 检测重定向规则: pattern replacement 302/307/redirect
    const redirectMatch = line.match(/^(.+?)\s+(https?:\/\/\S+)\s+(302|307|redirect)$/i);
    if (redirectMatch) {
      const [, pattern, replacement, type] = redirectMatch;
      return {
        pattern: pattern.trim(),
        replacement,
        type: type.toLowerCase() as any,
        mockData: { statusCode: type.toLowerCase() === 'redirect' ? 302 : parseInt(type) },
      };
    }

    // ⭐ 处理 mock-response-body 格式（使用改进的参数提取器）
    if (line.includes(' mock-response-body ')) {
      const match = line.match(/^(.+?)\s+mock-response-body\s+(.+)$/);
      if (match) {
        const [, pattern, params] = match;

        const explicitType = LocalPluginConverter.findParamValue(params, 'data-type');
        const statusCode = parseInt(
          LocalPluginConverter.findParamValue(params, 'status-code') || '200'
        );
        const dataPath = LocalPluginConverter.findParamQuotedValue(params, 'data-path');
        const data = LocalPluginConverter.findParamQuotedValue(params, 'data');
        const header = LocalPluginConverter.findParamQuotedValue(params, 'header');
        const isBase64 = /\bmock-data-is-base64\b/i.test(params);

        const resolvedType =
          explicitType ||
          (isBase64 ? 'base64' : data && /^[\s\r\n]*[\[{]/.test(data) ? 'json' : 'text');

        const headerMap: Record<string, string> = {
          json: 'Content-Type:application/json',
          text: 'Content-Type:text/plain',
          html: 'Content-Type:text/html',
          javascript: 'Content-Type:text/javascript',
          css: 'Content-Type:text/css',
          base64: 'Content-Type:application/octet-stream',
        };

        const mockHeader = header || headerMap[resolvedType] || 'Content-Type:text/plain';

        return {
          pattern: pattern.trim(),
          replacement: '-',
          type: 'mock',
          mockData: {
            dataType: resolvedType,
            data: data || '',
            dataPath: dataPath as any,
            statusCode,
            header: mockHeader,
          },
        };
      }
    }

    // ⭐ 处理 response-body-replace-regex (Loon 格式 → Surge http-response)
    if (line.includes(' response-body-replace-regex ')) {
      const match = line.match(/^(.+?)\s+response-body-replace-regex\s+(.+?)\s+(.+?)$/);
      if (match) {
        const [, pattern, searchRegex, replacement] = match;
        return {
          pattern: pattern.trim(),
          replacement: `${searchRegex} ${replacement}`,
          type: 'body-regex' as any,
        };
      }
    }

    // ⭐ 处理 response-body-json-del (删除 JSON 字段，支持多个字段)
    if (line.includes(' response-body-json-del ')) {
      const match = line.match(/^(.+?)\s+response-body-json-del\s+(.+)$/);
      if (match) {
        const [, pattern, fields] = match;
        // 支持多个字段：field1 field2 field3
        const fieldList = fields.trim().split(/\s+/);

        // 将多个字段转换为 delpaths 语法
        if (fieldList.length === 1) {
          // 单个字段：del(.field) 或 delpaths([["field","subfield"]])
          const field = fieldList[0];
          if (field.includes('.')) {
            // 嵌套字段：data.common_equip → delpaths([["data","common_equip"]])
            const parts = field.split('.');
            const path = parts.map(p => `"${p}"`).join(',');
            return {
              pattern: pattern.trim(),
              replacement: `delpaths([[${path}]])`,
              type: 'jq' as any,
            };
          } else {
            // 简单字段：fieldName → delpaths([["fieldName"]])
            return {
              pattern: pattern.trim(),
              replacement: `delpaths([["${field}"]])`,
              type: 'jq' as any,
            };
          }
        } else {
          // 多个字段：field1 field2 → delpaths([["field1"], ["field2"]])
          const paths = fieldList
            .map(f => {
              if (f.includes('.')) {
                const parts = f.split('.');
                const path = parts.map(p => `"${p}"`).join(',');
                return `[${path}]`;
              } else {
                return `["${f}"]`;
              }
            })
            .join(', ');
          return {
            pattern: pattern.trim(),
            replacement: `delpaths([${paths}])`,
            type: 'jq' as any,
          };
        }
      }
    }

    // ⭐ 处理 response-body-json-replace (替换 JSON 值)
    if (line.includes(' response-body-json-replace ')) {
      const match = line.match(/^(.+?)\s+response-body-json-replace\s+(.+)$/);
      if (match) {
        const [, pattern, replaceExpr] = match;
        return {
          pattern: pattern.trim(),
          replacement: replaceExpr,
          type: 'jq' as any,
        };
      }
    }

    // ⭐ 处理所有 jq 变体（response-body-json-jq, http-response-json-jq, response-json-jq等）
    const jqRegex =
      /^(.+?)\s+(response-body-json-jq|http-response-json-jq|response-json-jq|request-body-json-jq|http-request-json-jq)\s+(.+)$/i;
    if (jqRegex.test(line)) {
      const match = line.match(jqRegex);
      if (match) {
        const [, pattern, keyword, rest] = match;

        // 检查是否是外部 jq 文件
        const jqPathMatch = rest.match(/jq-path=(["'])(.+?)\1/);
        if (jqPathMatch) {
          return {
            pattern: pattern.trim(),
            replacement: `jq-path="${jqPathMatch[2]}"`,
            type: 'jq' as any,
            jqExternal: true as any,
          };
        }

        // 内联 jq 表达式 - 移除可能的 keep-header 等标志
        const jqExpression = rest.trim().replace(/\s+keep-header\s*$/i, '');

        return {
          pattern: pattern.trim(),
          replacement: jqExpression,
          type: (keyword.toLowerCase().startsWith('request') ? 'request-jq' : 'jq') as any,
        };
      }
    }

    // 提取 pattern 和 type（使用空格分隔，不是 " - "）
    const parts = line.split(/\s+/);
    if (parts.length < 2) return null;

    const lastPart = parts[parts.length - 1];
    const pattern = parts.slice(0, -1).join(' ');

    // reject 系列（注意顺序：先匹配长后缀，再匹配短后缀）
    if (lastPart === 'reject-dict') {
      return {
        pattern,
        replacement: '-',
        type: 'reject-dict',
      };
    }

    if (lastPart === 'reject-array') {
      return {
        pattern,
        replacement: '-',
        type: 'reject-array',
      };
    }

    if (lastPart === 'reject-200') {
      return {
        pattern,
        replacement: '-',
        type: 'mock',
        mockData: {
          dataType: 'text',
          data: ' ',
          statusCode: 200,
        },
      };
    }

    if (lastPart === 'reject-img' || lastPart === 'reject-tinygif') {
      return {
        pattern,
        replacement: '-',
        type: 'mock',
        mockData: {
          dataType: 'tiny-gif',
          statusCode: 200,
        },
      };
    }

    // reject (通用，最后匹配)
    if (lastPart === 'reject') {
      return {
        pattern,
        replacement: '-',
        type: 'reject',
      };
    }

    return null;
  }

  private static parseMitm(line: string, mitm: MitmConfig): void {
    if (line.startsWith('hostname')) {
      const hostnamesStr = line.split('=')[1]?.trim();
      if (hostnamesStr) {
        mitm.hostnames = hostnamesStr.split(/\s*,\s*/).filter(h => h);
      }
    } else if (line.startsWith('h2')) {
      mitm.h2 = line.includes('true');
    }
  }

  private static extractParam(line: string, param: string): string {
    if (param === 'argument') {
      const regex = new RegExp(
        `${param}\\s*=\\s*(.+?)(?:,\\s*(?:tag|requires-body|binary-body-mode|timeout|cron|script-path|engine)\\s*=|$)`
      );
      const match = line.match(regex);
      return match?.[1]?.trim() || '';
    }

    const regex = new RegExp(`${param}\\s*=\\s*([^,]+)`);
    const match = line.match(regex);
    return match?.[1]?.trim() || '';
  }

  private static generateScriptName(scriptPath: string): string {
    const filename = scriptPath.split('/').pop() || 'script';
    return filename.replace(/\.(js|bundle\.js)$/, '');
  }
}

/**
 * 本地插件转换器
 */
export class LocalPluginConverter {
  /**
   * 默认开启的脚本开关（使用转换后的参数名）
   */
  private static readonly DEFAULT_ENABLED_SWITCHES = new Set<string>([
    '12306',
    '阿里巴巴',
    '阿里云盘',
    '百度地图',
    '薄荷健康',
    '彩云天气',
    '菜鸟裹裹',
    '大众点评',
    '叮咚买菜',
    '滴滴出行',
    '盒马',
    '航旅纵横',
    '京东',
    'Keep',
    '夸克',
    '买单吧',
    '什么值得买',
    '淘宝',
    '解除微信链接限制',
    '闲鱼',
    '小红书',
    'YouTube',
    '喜马拉雅',
    '中国国际航空',
  ]);

  /**
   * 提取带引号的参数值（支持嵌套 JSON）
   */
  private static findParamQuotedValue(params: string, key: string): string | undefined {
    const regex = new RegExp(
      `${key}=(["'])([\\s\\S]*?)\\1(?=\\s+(?:data-type|status-code|header|mock-data-is-base64|keep-header|jq-path)\\b|$)`,
      'i'
    );
    const match = params.match(regex);
    return match?.[2];
  }

  /**
   * 提取简单参数值
   */
  private static findParamValue(params: string, key: string): string | undefined {
    const regex = new RegExp(`${key}=([^\\s]+)`, 'i');
    const match = params.match(regex);
    return match?.[1];
  }

  /**
   * Map Local 去重（优先保留完整数据版本）
   */
  private dedupeMapLocal(list: RewriteRule[]): RewriteRule[] {
    const map = new Map<string, RewriteRule>();

    const score = (rule: RewriteRule) => {
      const data = rule.mockData?.data ?? '';
      const hasDataPath = (rule.mockData as any)?.dataPath ? 10 : 0;
      const isCompleteJson = /[\]}]\s*$/.test(data) ? 1 : 0;
      const lengthScore = Math.min(3, Math.floor(data.length / 256));
      return hasDataPath + lengthScore + isCompleteJson;
    };

    for (const rule of list) {
      if (rule.type !== 'mock') continue;

      const key = `${rule.pattern}|${rule.mockData?.dataType || '-'}|${
        rule.mockData?.statusCode || 200
      }`;
      const existing = map.get(key);
      if (!existing || score(rule) > score(existing)) {
        map.set(key, rule);
      }
    }

    const nonMockRules = list.filter(r => r.type !== 'mock');
    return [...Array.from(map.values()), ...nonMockRules];
  }

  /**
   * 根据 Loon 参数定义，生成用于 Surge 的参数名（主要用于 *_enable 开关）
   */
  private normalizeArgumentName(arg: Argument): string {
    if (!arg.isEnableSwitch || !arg.tag) return arg.name;

    let baseName = arg.tag.replace(/-脚本开关$/, '').trim();

    // 纯小写英文名（如 keep）做一下首字母大写，便于展示
    if (/^[a-z]+$/.test(baseName)) {
      baseName = baseName.charAt(0).toUpperCase() + baseName.slice(1);
    }

    return baseName || arg.name;
  }

  /**
   * 内联外部 jq 文件
   */
  private async inlineExternalJq(surge: SurgeModule): Promise<void> {
    const tasks: Promise<void>[] = [];

    for (const rule of surge.bodyRewrites) {
      if ((rule as any).jqExternal && typeof rule.replacement === 'string') {
        const match = rule.replacement.match(/jq-path=["'](.+?)["']/);
        if (!match) continue;

        const url = match[1];
        if (!/^https?:\/\//i.test(url)) continue;

        tasks.push(
          (async () => {
            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 15000);

              const { $$fetch, defaultRequestInit } = require('../../utils/network/fetch-retry');
              const response = await $$fetch(url, {
                ...defaultRequestInit,
                signal: controller.signal,
              });
              clearTimeout(timeoutId);

              if (!response.ok) throw new Error(`HTTP ${response.status}`);

              let content = await response.text();
              if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
              content = content.trim().replace(/'/g, "\\'");

              delete (rule as any).jqExternal;
              rule.replacement = content;
            } catch (error) {
              // 保持 jq-path
            }
          })()
        );
      }
    }

    await Promise.all(tasks);
  }

  /**
   * Loon 插件转 Surge 模块
   */
  private loonToSurge(loon: LoonPlugin): SurgeModule {
    const surge: SurgeModule = {
      metadata: { ...loon.metadata },
      arguments: [],
      urlRewrites: [],
      headerRewrites: loon.headerRewrites || [],
      mapLocal: [],
      bodyRewrites: [],
      scripts: [],
      mitm: loon.mitm,
      rules: loon.rules,
    };

    // 转换元信息
    if (loon.metadata.tag) {
      surge.metadata.category = loon.metadata.tag;
      delete surge.metadata.tag;
    }

    // 规范化参数名（特别是 *_enable 开关），并记录原名到新名的映射
    const argNameMap = new Map<string, string>();
    const surgeArguments: Argument[] = [];

    for (const arg of loon.arguments) {
      const normalizedName = this.normalizeArgumentName(arg);
      const newArg: Argument = { ...arg, name: normalizedName };
      surgeArguments.push(newArg);
      if (normalizedName !== arg.name) {
        argNameMap.set(arg.name, normalizedName);
      }
    }

    surge.arguments = surgeArguments;

    // 转换重写规则
    for (const rewrite of loon.rewrites) {
      if (rewrite.type === 'reject') {
        surge.urlRewrites.push(rewrite);
      } else if (rewrite.type === 'redirect' || rewrite.type === '302' || rewrite.type === '307') {
        // ⭐ 重定向支持
        const statusCode = rewrite.mockData?.statusCode || 302;
        surge.urlRewrites.push({
          pattern: rewrite.pattern,
          replacement: rewrite.replacement,
          type: String(statusCode) as any,
        });
      } else if (rewrite.type === 'reject-dict') {
        surge.mapLocal.push({
          ...rewrite,
          type: 'mock',
          mockData: {
            dataType: 'text',
            statusCode: 200,
            data: '{}',
            header: 'Content-Type:application/json',
          },
        });
      } else if (rewrite.type === 'reject-array') {
        surge.mapLocal.push({
          ...rewrite,
          type: 'mock',
          mockData: {
            dataType: 'text',
            statusCode: 200,
            data: '[]',
          },
        });
      } else if (
        rewrite.type === 'reject-200' ||
        rewrite.type === 'reject-img' ||
        rewrite.type === 'reject-tinygif'
      ) {
        surge.mapLocal.push(rewrite);
      } else if (rewrite.type === 'mock') {
        surge.mapLocal.push(rewrite);
      } else if (rewrite.type === 'jq' || rewrite.type === 'body-regex') {
        surge.bodyRewrites.push(rewrite);
      }
    }

    // 转换脚本
    for (const script of loon.scripts) {
      const surgeScript = { ...script };

      // 转换 argument 格式
      if (script.argument) {
        surgeScript.argument = this.convertLoonArgumentToSurge(script.argument);
      }

      // 将 enableParam 同步到新的参数名（如果发生了重命名）
      if (surgeScript.enableParam && argNameMap.has(surgeScript.enableParam)) {
        surgeScript.enableParam = argNameMap.get(surgeScript.enableParam)!;
      }

      surgeScript.engine = 'webview';
      surge.scripts.push(surgeScript);
    }

    return surge;
  }

  /**
   * 转换插件（async 版本，支持 jq-path 内联）
   */
  async convert(content: string): Promise<string> {
    const loonPlugin = LoonPluginParser.parse(content);
    const surgeModule = this.loonToSurge(loonPlugin);

    // ⭐ 内联外部 jq 文件
    await this.inlineExternalJq(surgeModule);

    // ⭐ Map Local 去重
    surgeModule.mapLocal = this.dedupeMapLocal(surgeModule.mapLocal);

    return this.generateSurgeOutput(surgeModule);
  }

  /**
   * 同步版本（兼容旧代码）
   */
  convertSync(content: string): string {
    const loonPlugin = LoonPluginParser.parse(content);
    const surgeModule = this.loonToSurge(loonPlugin);
    surgeModule.mapLocal = this.dedupeMapLocal(surgeModule.mapLocal);
    return this.generateSurgeOutput(surgeModule);
  }

  /**
   * 转换 Loon argument 格式为 Surge 格式
   */
  private convertLoonArgumentToSurge(loonArg: string): string {
    const arrayMatch = loonArg.match(/^\[(.+)\]$/);
    if (!arrayMatch) return loonArg;

    const params = arrayMatch[1].split(/\s*,\s*/).map(p => p.replace(/[{}]/g, '').trim());
    const surgeParams = params.map(param => `${param}="{{{${param}}}}"`);
    return surgeParams.join('&');
  }

  /**
   * 生成 Surge 模块输出
   */
  private generateSurgeOutput(surge: SurgeModule): string {
    const lines: string[] = [];

    // 元信息
    if (surge.metadata.name) lines.push(`#!name = ${surge.metadata.name}`);
    if (surge.metadata.desc) lines.push(`#!desc = ${surge.metadata.desc}`);
    if (surge.metadata.openUrl) lines.push(`#!openUrl = ${surge.metadata.openUrl}`);
    if (surge.metadata.author) lines.push(`#!author = ${surge.metadata.author}`);
    if (surge.metadata.homepage) lines.push(`#!homepage = ${surge.metadata.homepage}`);
    if (surge.metadata.icon) lines.push(`#!icon = ${surge.metadata.icon}`);
    if (surge.metadata.category) lines.push(`#!category = ${surge.metadata.category}`);
    if (surge.metadata.date) lines.push(`#!date = ${surge.metadata.date}`);
    if (surge.metadata.version) lines.push(`#!version = ${surge.metadata.version}`);

    // Arguments
    if (surge.arguments.length > 0) {
      lines.push(this.generateArgumentsLine(surge.arguments));
      lines.push(this.generateArgumentsDescLine(surge.arguments));
    }

    lines.push('');

    // URL Rewrite
    if (surge.urlRewrites.length > 0) {
      lines.push('[URL Rewrite]');
      for (const rewrite of surge.urlRewrites) {
        if (rewrite.comment) lines.push(`# ${rewrite.comment}`);
        lines.push(`${rewrite.pattern} ${rewrite.replacement} ${rewrite.type}`);
      }
      lines.push('');
    }

    // Header Rewrite
    if (surge.headerRewrites.length > 0) {
      lines.push('[Header Rewrite]');
      for (const headerRewrite of surge.headerRewrites) {
        if (headerRewrite.comment) lines.push(`# ${headerRewrite.comment}`);
        const formattedParams = headerRewrite.params.map(p => `'${p.replace(/"/g, '')}'`).join(' ');
        lines.push(
          `${headerRewrite.type} ${headerRewrite.pattern} ${headerRewrite.action} ${formattedParams}`
        );
      }
      lines.push('');
    }

    // Map Local
    if (surge.mapLocal.length > 0) {
      lines.push('[Map Local]');
      for (const mapLocal of surge.mapLocal) {
        if (mapLocal.comment) lines.push(`# ${mapLocal.comment}`);
        const parts = [mapLocal.pattern];
        if (mapLocal.mockData?.dataType) parts.push(`data-type=${mapLocal.mockData.dataType}`);

        // 支持 data-path (外部文件) 或 data (内联数据)
        if ((mapLocal.mockData as any)?.dataPath) {
          parts.push(`data-path="${(mapLocal.mockData as any).dataPath}"`);
        } else if (mapLocal.mockData?.data !== undefined) {
          parts.push(`data="${mapLocal.mockData.data}"`);
        }

        if (mapLocal.mockData?.statusCode)
          parts.push(`status-code=${mapLocal.mockData.statusCode}`);
        if (mapLocal.mockData?.header) parts.push(`header="${mapLocal.mockData.header}"`);
        lines.push(parts.join(' '));
      }
      lines.push('');
    }

    // Body Rewrite (for response-body-json-jq and response-body-replace-regex)
    if (surge.bodyRewrites.length > 0) {
      lines.push('[Body Rewrite]');
      for (const bodyRewrite of surge.bodyRewrites) {
        if (bodyRewrite.comment) lines.push(`# ${bodyRewrite.comment}`);

        if (bodyRewrite.type === 'body-regex') {
          // 正则替换
          lines.push(`http-response ${bodyRewrite.pattern} ${bodyRewrite.replacement}`);
        } else if ((bodyRewrite as any).jqExternal) {
          // 外部 jq 文件
          lines.push(`http-response-jq ${bodyRewrite.pattern} ${bodyRewrite.replacement}`);
        } else {
          // 内联 jq 表达式 - 用单引号包裹
          const jqExpr = bodyRewrite.replacement.startsWith("'")
            ? bodyRewrite.replacement
            : `'${bodyRewrite.replacement}'`;
          lines.push(`http-response-jq ${bodyRewrite.pattern} ${jqExpr}`);
        }
      }
      lines.push('');
    }

    // Rules（规则区块尽早展示，方便查看整体规则集）
    if (surge.rules && surge.rules.length > 0) {
      lines.push('[Rule]');
      for (const rule of surge.rules) {
        lines.push(rule);
      }
      lines.push('');
    }

    // Scripts
    if (surge.scripts.length > 0) {
      lines.push('[Script]');
      for (const script of surge.scripts) {
        const scriptName = script.enableParam
          ? `{{{${script.enableParam}}}}${script.name}`
          : script.name;
        const parts = [`${scriptName} = type=${script.type}`];

        // cron 类型使用 cronexp，event/generic 可能不需要 pattern
        if (script.type === 'cron') {
          if (script.cronExpression) {
            parts.push(`cronexp="${script.cronExpression}"`);
          }
        } else if (script.type === 'event' || script.type === 'generic') {
          if (script.pattern && script.pattern !== '-') {
            parts.push(`pattern=${script.pattern}`);
          }
        } else {
          parts.push(`pattern=${script.pattern}`);
        }

        if (script.requiresBody) parts.push('requires-body=1');
        if (script.binaryBodyMode) parts.push('binary-body-mode=1');
        if (script.engine) parts.push(`engine=${script.engine}`);
        if (script.maxSize) parts.push(`max-size=${script.maxSize}`);
        if (script.timeout) parts.push(`timeout=${script.timeout}`);
        parts.push(`script-path=${script.scriptPath}`);
        if (script.argument) parts.push(`argument=${script.argument}`);
        lines.push(parts.join(', '));
      }
      lines.push('');
    }

    // MITM 放在最后，方便整体查看脚本与规则后再确认证书配置
    if (surge.mitm.hostnames.length > 0) {
      lines.push('[MITM]');
      lines.push(`hostname = %APPEND% ${surge.mitm.hostnames.join(', ')}`);
      if (surge.mitm.h2) lines.push('h2 = true');
      lines.push('');
    }

    return lines.join('\n');
  }

  private generateArgumentsLine(args: Argument[]): string {
    // 去重：使用 Map 保留最后一个同名参数
    const uniqueArgs = new Map<string, Argument>();
    args.forEach(arg => uniqueArgs.set(arg.name, arg));

    const parts = Array.from(uniqueArgs.values()).map(arg => {
      // 脚本开关参数：使用应用名称为参数名，部分默认开启
      if (arg.isEnableSwitch) {
        const enabledByDefault = LocalPluginConverter.DEFAULT_ENABLED_SWITCHES.has(arg.name);
        const value = enabledByDefault ? 'true' : '#';
        return `${arg.name}:${value}`;
      }

      // 其他参数保持原有默认值逻辑
      if (typeof arg.defaultValue === 'boolean') {
        return `${arg.name}:${arg.defaultValue}`;
      }

      return `${arg.name}:"${arg.defaultValue}"`;
    });

    return `#!arguments = ${parts.join(',')}`;
  }

  private generateArgumentsDescLine(args: Argument[]): string {
    // 去重：使用 Map 保留最后一个同名参数
    const uniqueArgs = new Map<string, Argument>();
    args.forEach(arg => uniqueArgs.set(arg.name, arg));

    const parts = Array.from(uniqueArgs.values()).map(arg => {
      let desc = `${arg.name}: ${arg.tag}\\n${arg.desc}`;
      if (arg.name.endsWith('_enable')) {
        desc += '\\n将 # 改为任意值即可启用对应脚本';
      }
      if (arg.type === 'select' && arg.options && arg.options.length > 0) {
        desc += '\\n';
        arg.options.forEach((opt, idx) => {
          const prefix = idx === arg.options!.length - 1 ? '└' : '├';
          desc += `    ${prefix} ${opt}\\n`;
        });
      }
      return desc;
    });
    return `#!arguments-desc = ${parts.join('\\n\\n')}\\n`;
  }

  /**
   * 转换插件
   */
  convert(content: string): string {
    const loonPlugin = LoonPluginParser.parse(content);
    const surgeModule = this.loonToSurge(loonPlugin);
    return this.generateSurgeOutput(surgeModule);
  }
}

/**
 * 下载并本地转换插件
 * 使用镜像系统缓存插件文件
 */
export async function convertPluginLocally(
  plugin: PluginInfo,
  forceUpdate = false
): Promise<LocalConversionResult> {
  console.log(picocolors.gray(`  [Local] Converting ${plugin.name}...`));

  try {
    // 获取插件内容（优先使用镜像）
    const contentResult = await getPluginContent(plugin, forceUpdate);

    if (!contentResult.success || !contentResult.content) {
      return {
        pluginName: plugin.name,
        content: { error: contentResult.error || 'Failed to get plugin content' },
      };
    }

    const loonContent = contentResult.content;

    // 本地转换（使用 async 版本）
    const converter = new LocalPluginConverter();
    const surgeContent = await converter.convert(loonContent);

    console.log(picocolors.green(`  [Local] ✓ ${plugin.name} converted successfully`));

    return {
      pluginName: plugin.name,
      content: surgeContent,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.log(picocolors.red(`  [Local] ✗ ${plugin.name}: ${errorMsg}`));
    return {
      pluginName: plugin.name,
      content: { error: errorMsg },
    };
  }
}

/**
 * 批量本地转换插件
 */
export async function convertPluginsLocallyBatch(
  plugins: PluginInfo[],
  forceUpdate = false
): Promise<LocalConversionResult[]> {
  console.log(picocolors.cyan(`[Local Converter] Converting ${plugins.length} plugins locally...`));

  const results: LocalConversionResult[] = [];

  for (const plugin of plugins) {
    const result = await convertPluginLocally(plugin, forceUpdate);
    results.push(result);
  }

  const successCount = results.filter(r => typeof r.content === 'string').length;
  console.log(
    picocolors.green(`[Local Converter] Converted ${successCount}/${plugins.length} plugins`)
  );

  return results;
}
