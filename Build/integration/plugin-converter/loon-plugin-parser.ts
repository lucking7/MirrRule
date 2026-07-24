/* eslint-disable regexp/no-super-linear-backtracking, regexp/optimal-quantifier-concatenation -- legacy Loon regex patterns are intentionally kept as-is for compatibility */

import { parseLoonRewrite } from './loon-rewrite-parser';
import type {
  Argument,
  ArgumentType,
  HeaderRewriteRule,
  LoonPlugin,
  MitmConfig,
  ModuleMetadata,
  Script,
  ScriptType,
} from './loon-plugin-types';

/**
 * Loon 插件解析器
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- parser intentionally preserves its legacy static class structure and state
export class LoonPluginParser {
  private static lastComment = '';

  /**
   * 解析 Loon 插件文件
   */
  static parse(this: void, content: string): LoonPlugin {
    LoonPluginParser.lastComment = '';

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
        LoonPluginParser.parseMetadata(trimmedLine, plugin.metadata);
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
            const arg = LoonPluginParser.parseArgument(trimmedLine);
            if (arg) plugin.arguments.push(arg);
          }
          break;

        case 'rewrite':
          if (trimmedLine.startsWith('#')) {
            LoonPluginParser.lastComment = trimmedLine.slice(1).trim();
          } else if (!trimmedLine.startsWith(';')) {
            if (/\s(?:response-)?header-(?:del|add|replace|replace-regex)\s/.test(trimmedLine)) {
              const headerRewrite = LoonPluginParser.parseHeaderRewrite(trimmedLine);
              if (headerRewrite) {
                if (LoonPluginParser.lastComment) {
                  headerRewrite.comment = LoonPluginParser.lastComment;
                  LoonPluginParser.lastComment = '';
                }
                plugin.headerRewrites?.push(headerRewrite);
              }
            } else {
              const rewrite = parseLoonRewrite(trimmedLine);
              if (rewrite) {
                if (LoonPluginParser.lastComment) {
                  rewrite.comment = LoonPluginParser.lastComment;
                  LoonPluginParser.lastComment = '';
                }
                plugin.rewrites.push(rewrite);
              }
            }
          }
          break;

        case 'script':
          if (!trimmedLine.startsWith('#') && !trimmedLine.startsWith(';')) {
            const script = LoonPluginParser.parseScript(trimmedLine);
            if (script) plugin.scripts.push(script);
          }
          break;

        case 'mitm':
          LoonPluginParser.parseMitm(trimmedLine, plugin.mitm);
          break;

        case 'rule':
          if (!trimmedLine.startsWith('#') && !trimmedLine.startsWith(';')) {
            plugin.rules?.push(trimmedLine);
          }
          break;
        default:
          break;
      }
    }

    return plugin;
  }

  private static parseMetadata(this: void, line: string, metadata: ModuleMetadata): void {
    const match = /^#!(\w+)\s*=\s*(.+)$/.exec(line);
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

  private static parseArgument(this: void, line: string): Argument | null {
    const regex =
      /^([^=]+?)\s*=\s*(\w+)\s*,\s*(.+?)\s*,\s*tag\s*=\s*([^,]+)(?:\s*,\s*desc\s*=\s*(.*))?$/;
    const match = regex.exec(line);

    if (!match) return null;

    const [, name, type, valueStr, tag, desc = ''] = match;
    const argType = type as ArgumentType;

    let defaultValue: string | boolean;
    let options: string[] | undefined;

    if (argType === 'switch') {
      const values = valueStr.split(',').map(v => v.trim());
      defaultValue = values[0] === 'true';
    } else if (argType === 'select') {
      options = valueStr.match(/"[^"]+"/g)?.map(s => s.slice(1, -1)) || [];
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

  private static parseScript(this: void, line: string): Script | null {
    const typeMatch = /^(http-request|http-response|cron|event|generic)\s+(.+)/.exec(line);
    if (!typeMatch) return null;

    const [, type, rest] = typeMatch;
    const parts = rest.split(/\s+/);
    const pattern = parts[0];

    const scriptPath = LoonPluginParser.extractParam(line, 'script-path');
    const tag = LoonPluginParser.extractParam(line, 'tag');
    const argument = LoonPluginParser.extractParam(line, 'argument');
    const requiresBody = LoonPluginParser.extractParam(line, 'requires-body') === '1';
    const binaryBodyMode = LoonPluginParser.extractParam(line, 'binary-body-mode') === '1';
    const timeout =
      Number.parseInt(LoonPluginParser.extractParam(line, 'timeout') || '0', 10) || undefined;
    const maxSize =
      Number.parseInt(LoonPluginParser.extractParam(line, 'max-size') || '0', 10) || undefined;
    const cronExpression = LoonPluginParser.extractParam(line, 'cron');
    const engine = LoonPluginParser.extractParam(line, 'engine');

    const enableMatch = /enable\s*=\s*{([^}]+)}/.exec(line);
    const enableParam = enableMatch ? enableMatch[1] : undefined;

    if (!scriptPath) return null;

    return {
      name: tag || LoonPluginParser.generateScriptName(scriptPath),
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

  private static parseHeaderRewrite(this: void, line: string): HeaderRewriteRule | null {
    const match = /^(.+?)\s+(response-)?(header-(?:del|add|replace|replace-regex))\s+(.+)$/.exec(
      line
    );
    if (!match) return null;

    const [, pattern, isResponse, action, paramsStr] = match;

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

  private static parseMitm(this: void, line: string, mitm: MitmConfig): void {
    if (line.startsWith('hostname')) {
      const hostnamesStr = line.split('=')[1]?.trim();
      if (hostnamesStr) {
        mitm.hostnames = hostnamesStr.split(/\s*,\s*/).filter(Boolean);
      }
    } else if (line.startsWith('h2')) {
      mitm.h2 = line.includes('true');
    }
  }

  private static extractParam(this: void, line: string, param: string): string {
    if (param === 'argument') {
      const regex = new RegExp(
        String.raw`${param}\s*=\s*(.+?)(?:,\s*(?:tag|requires-body|binary-body-mode|timeout|cron|script-path|engine)\s*=|$)`
      );
      const match = line.match(regex);
      return match?.[1]?.trim() || '';
    }

    const regex = new RegExp(String.raw`${param}\s*=\s*([^,]+)`);
    const match = line.match(regex);
    return match?.[1]?.trim() || '';
  }

  private static generateScriptName(this: void, scriptPath: string): string {
    const filename = scriptPath.split('/').pop() || 'script';
    return filename.replace(/\.(?:js|bundle\.js)$/, '');
  }
}
