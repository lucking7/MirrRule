import { $$fetch, defaultRequestInit } from '../../utils/network/fetch-retry';
import { LoonPluginParser } from './loon-plugin-parser';
import type { Argument, LoonPlugin, RewriteRule, SurgeModule } from './loon-plugin-types';
import { generateSurgeOutput } from './surge-module-serializer';

/**
 * 本地插件转换器
 */
export class LocalPluginConverter {
  /**
   * Map Local 去重（优先保留完整数据版本）
   */
  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- helper method does not access instance state
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
  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- helper method does not access instance state
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
  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- helper method does not access instance state
  private async inlineExternalJq(surge: SurgeModule): Promise<void> {
    const tasks: Array<Promise<void>> = [];

    for (const rule of surge.bodyRewrites) {
      if ((rule as any).jqExternal && typeof rule.replacement === 'string') {
        const match = /jq-path=["'](.+?)["']/.exec(rule.replacement);
        if (!match) continue;

        const url = match[1];
        if (!/^https?:\/\//i.test(url)) continue;

        tasks.push(
          (async () => {
            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 15000);

              const response = await $$fetch(url, {
                ...defaultRequestInit,
                signal: controller.signal,
              });
              clearTimeout(timeoutId);

              if (!response.ok) throw new Error(`HTTP ${response.status}`);

              let content = await response.text();
              // eslint-disable-next-line sukka/unicorn/number-literal-case -- BOM char code is conventionally written in hex
              if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
              content = content.trim().replaceAll('\u0027', String.raw`\'`);

              delete (rule as any).jqExternal;
              rule.replacement = content;
            } catch {
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
      switch (rewrite.type) {
        case 'reject': {
          surge.urlRewrites.push(rewrite);

          break;
        }
        case 'redirect':
        case '302':
        case '307': {
          // 重定向支持
          const statusCode = rewrite.mockData?.statusCode || 302;
          surge.urlRewrites.push({
            pattern: rewrite.pattern,
            replacement: rewrite.replacement,
            type: String(statusCode) as any,
          });

          break;
        }
        case 'reject-dict': {
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

          break;
        }
        case 'reject-array': {
          surge.mapLocal.push({
            ...rewrite,
            type: 'mock',
            mockData: {
              dataType: 'text',
              statusCode: 200,
              data: '[]',
            },
          });

          break;
        }
        case 'reject-200':
        case 'reject-img':
        case 'reject-tinygif': {
          surge.mapLocal.push(rewrite);

          break;
        }
        case 'mock': {
          surge.mapLocal.push(rewrite);

          break;
        }
        case 'jq':
        case 'body-regex': {
          surge.bodyRewrites.push(rewrite);

          break;
        }
        default:
          break;
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

    // 内联外部 jq 文件
    await this.inlineExternalJq(surgeModule);

    // Map Local 去重
    surgeModule.mapLocal = this.dedupeMapLocal(surgeModule.mapLocal);

    return generateSurgeOutput(surgeModule);
  }

  /**
   * 转换 Loon argument 格式为 Surge 格式
   */
  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- conversion helper does not access instance state
  private convertLoonArgumentToSurge(loonArg: string): string {
    const arrayMatch = /^\[(.+)]$/.exec(loonArg);
    if (!arrayMatch) return loonArg;

    const params = arrayMatch[1].split(/\s*,\s*/).map(p => p.replaceAll(/[{}]/g, '').trim());
    const surgeParams = params.map(param => `${param}="{{{${param}}}}"`);
    return surgeParams.join('&');
  }
}
