/* eslint-disable regexp/no-super-linear-backtracking -- legacy Loon regex patterns are intentionally kept as-is for compatibility */

import type { RewriteRule } from './loon-plugin-types';

function findParamQuotedValue(params: string, key: string): string | undefined {
  const regex = new RegExp(
    String.raw`${key}=(["'])([\s\S]*?)\1(?=\s+(?:data-type|status-code|header|mock-data-is-base64|keep-header|jq-path)\b|$)`,
    'i'
  );
  const match = params.match(regex);
  return match?.[2];
}
function findParamValue(params: string, key: string): string | undefined {
  const regex = new RegExp(String.raw`${key}=([^\s]+)`, 'i');
  const match = params.match(regex);
  return match?.[1];
}

export function parseLoonRewrite(line: string): RewriteRule | null {
    // 规范化常见重写规则中的 " - " 分隔符
    line = line.replaceAll(/\s+-\s+/g, ' ');

    // 检测重定向规则: pattern replacement 302/307/redirect
    const redirectMatch = /^(.+?)\s+(https?:\/\/\S+)\s+(302|307|redirect)$/i.exec(line);
    if (redirectMatch) {
      const [, pattern, replacement, type] = redirectMatch;
      return {
        pattern: pattern.trim(),
        replacement,
        type: type.toLowerCase() as any,
        mockData: {
          statusCode: type.toLowerCase() === 'redirect' ? 302 : Number.parseInt(type, 10),
        },
      };
    }

    // 处理 mock-response-body 格式（使用改进的参数提取器）
    if (line.includes(' mock-response-body ')) {
      const match = /^(.+?)\s+mock-response-body\s+(.+)$/.exec(line);
      if (match) {
        const [, pattern, params] = match;

        const explicitType = findParamValue(params, 'data-type');
        const statusCode = Number.parseInt(
          findParamValue(params, 'status-code') || '200',
          10
        );
        const dataPath = findParamQuotedValue(params, 'data-path');
        const data = findParamQuotedValue(params, 'data');
        const header = findParamQuotedValue(params, 'header');
        const isBase64 = /\bmock-data-is-base64\b/i.test(params);

        const resolvedType =
          explicitType || (isBase64 ? 'base64' : (data && /^\s*[[{]/.test(data) ? 'json' : 'text'));

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
            dataPath,
            statusCode,
            header: mockHeader,
          },
        };
      }
    }

    // 处理 response-body-replace-regex (Loon 格式 → Surge http-response)
    if (line.includes(' response-body-replace-regex ')) {
      const match = /^(.+?)\s+response-body-replace-regex\s+(.+?)\s+(.+)$/.exec(line);
      if (match) {
        const [, pattern, searchRegex, replacement] = match;
        return {
          pattern: pattern.trim(),
          replacement: `${searchRegex} ${replacement}`,
          type: 'body-regex' as any,
        };
      }
    }

    // 处理 response-body-json-del (删除 JSON 字段，支持多个字段)
    if (line.includes(' response-body-json-del ')) {
      const match = /^(.+?)\s+response-body-json-del\s+(.+)$/.exec(line);
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
          }
          // 简单字段：fieldName → delpaths([["fieldName"]])
          return {
            pattern: pattern.trim(),
            replacement: `delpaths([["${field}"]])`,
            type: 'jq' as any,
          };
        }
        // 多个字段：field1 field2 → delpaths([["field1"], ["field2"]])
        const paths = fieldList
          .map(f => {
            if (f.includes('.')) {
              const parts = f.split('.');
              const path = parts.map(p => `"${p}"`).join(',');
              return `[${path}]`;
            }
            return `["${f}"]`;
          })
          .join(', ');
        return {
          pattern: pattern.trim(),
          replacement: `delpaths([${paths}])`,
          type: 'jq' as any,
        };
      }
    }

    // 处理 response-body-json-replace (替换 JSON 值)
    if (line.includes(' response-body-json-replace ')) {
      const match = /^(.+?)\s+response-body-json-replace\s+(.+)$/.exec(line);
      if (match) {
        const [, pattern, replaceExpr] = match;
        return {
          pattern: pattern.trim(),
          replacement: replaceExpr,
          type: 'jq' as any,
        };
      }
    }

    // 处理所有 jq 变体（response-body-json-jq, http-response-json-jq, response-json-jq等）
    const jqRegex =
      /^(.+?)\s+(response-body-json-jq|http-response-json-jq|response-json-jq|request-body-json-jq|http-request-json-jq)\s+(.+)$/i;
    if (jqRegex.test(line)) {
      const match = jqRegex.exec(line);
      if (match) {
        const [, pattern, keyword, rest] = match;

        // 检查是否是外部 jq 文件
        const jqPathMatch = /jq-path=(["'])(.+?)\1/.exec(rest);
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
