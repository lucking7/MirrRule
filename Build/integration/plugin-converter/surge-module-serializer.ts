import type { Argument, SurgeModule } from './loon-plugin-types';

/**
 * 默认开启的脚本开关（使用转换后的参数名）
 */
const DEFAULT_ENABLED_SWITCHES = new Set<string>([
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
 * 生成 Surge 模块输出
 */
export function generateSurgeOutput(surge: SurgeModule): string {
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
    lines.push(generateArgumentsLine(surge.arguments));
    lines.push(generateArgumentsDescLine(surge.arguments));
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
      const formattedParams = headerRewrite.params
        .map(p => `'${p.replaceAll('"', '')}'`)
        .join(' ');
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

      if (mapLocal.mockData?.statusCode) {
        parts.push(`status-code=${mapLocal.mockData.statusCode}`);
      }
      if (mapLocal.mockData?.header) {
        parts.push(`header="${mapLocal.mockData.header}"`);
      }
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
      } else if (bodyRewrite.jqExternal) {
        // 外部 jq 文件
        lines.push(`http-response-jq ${bodyRewrite.pattern} ${bodyRewrite.replacement}`);
      } else {
        // 内联 jq 表达式 - 用单引号包裹
        const jqExpr = bodyRewrite.replacement.startsWith('\u0027')
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

function generateArgumentsLine(args: Argument[]): string {
  // 去重：使用 Map 保留最后一个同名参数
  const uniqueArgs = new Map<string, Argument>();
  args.forEach(arg => uniqueArgs.set(arg.name, arg));

  const parts = Array.from(uniqueArgs.values()).map(arg => {
    // 脚本开关参数：使用应用名称为参数名，部分默认开启
    if (arg.isEnableSwitch) {
      const enabledByDefault = DEFAULT_ENABLED_SWITCHES.has(arg.name);
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

function generateArgumentsDescLine(args: Argument[]): string {
  // 去重：使用 Map 保留最后一个同名参数
  const uniqueArgs = new Map<string, Argument>();
  args.forEach(arg => uniqueArgs.set(arg.name, arg));

  const parts = Array.from(uniqueArgs.values()).map(arg => {
    let desc = String.raw`${arg.name}: ${arg.tag}\n${arg.desc}`;
    if (arg.name.endsWith('_enable')) {
      desc += String.raw`\n将 # 改为任意值即可启用对应脚本`;
    }
    if (arg.type === 'select' && arg.options && arg.options.length > 0) {
      desc += String.raw`\n`;
      arg.options.forEach((opt, idx) => {
        const prefix = idx === arg.options!.length - 1 ? '└' : '├';
        desc += String.raw`    ${prefix} ${opt}\n`;
      });
    }
    return desc;
  });
  return String.raw`#!arguments-desc = ${parts.join(String.raw`\n\n`)}\n`;
}
