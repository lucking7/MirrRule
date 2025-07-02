/**
 * 模块参数修正器
 * 用于修正 Script Hub 转换后的 Surge 模块，添加基于 Loon 插件 [Script] 部分的参数控制
 */
import * as fs from 'fs';
import * as path from 'path';

interface ScriptInfo {
  tag: string;
  content: string;
  enableParam?: string;
}

export class LoonToSurgeConverter {
  /**
   * 解析 Loon 插件的 [Script] 部分，提取脚本信息
   */
  static parseLoonScripts(content: string): ScriptInfo[] {
    const scripts: ScriptInfo[] = [];
    const lines = content.split('\n');
    let inScriptSection = false;

    for (const line of lines) {
      const trimmedLine = line.trim();

      if (trimmedLine === '[Script]') {
        inScriptSection = true;
        continue;
      }

      if (trimmedLine.startsWith('[') && trimmedLine.endsWith(']')) {
        inScriptSection = false;
        continue;
      }

      if (!inScriptSection || !trimmedLine || trimmedLine.startsWith('#')) {
        continue;
      }

      // 解析脚本行，提取 tag 和 enable 参数
      const tagMatch = trimmedLine.match(/tag=([^,\s]+)/);
      const enableMatch = trimmedLine.match(/enable=\{([^}]+)\}/);

      if (tagMatch) {
        // 移除 enable 部分，获取纯净的脚本内容
        let cleanContent = trimmedLine;
        if (enableMatch) {
          cleanContent = trimmedLine.replace(/,?\s*enable=\{[^}]+\}/, '');
        }

        const scriptInfo: ScriptInfo = {
          tag: tagMatch[1],
          content: cleanContent,
        };
        if (enableMatch) {
          scriptInfo.enableParam = enableMatch[1];
        }
        scripts.push(scriptInfo);
      }
    }

    return scripts;
  }

  /**
   * 修正 Script Hub 转换后的 Surge 模块，添加参数控制
   */
  static fixSurgeModule(surgeContent: string, loonScripts: ScriptInfo[]): string {
    const lines = surgeContent.split('\n');
    const result: string[] = [];
    let inScriptSection = false;

    // 创建 tag 到脚本信息的映射
    const scriptMap = new Map<string, ScriptInfo>();
    loonScripts.forEach(script => {
      scriptMap.set(script.tag, script);
    });

    // 收集所有唯一的参数名（使用脚本 tag）
    const uniqueParams = new Set<string>();
    loonScripts.forEach(script => {
      uniqueParams.add(script.tag);
    });

    // 生成新的参数列表，格式：参数名:默认值
    // 默认值设为参数名本身，这样默认情况下脚本是开启的
    const argsList: string[] = Array.from(uniqueParams).map(tag => `${tag}:${tag}`);
    const argsDesc: string[] = Array.from(uniqueParams).map(tag => `${tag} - 传入#号关闭`);

    let headerInserted = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // 跳过旧的 #!arguments 和 #!arguments-desc 行
      if (trimmedLine.startsWith('#!arguments')) {
        continue;
      }

      // 在 #!desc 后插入新的参数元数据
      if (
        !headerInserted &&
        (trimmedLine.startsWith('#!desc') || trimmedLine.startsWith('#!description'))
      ) {
        result.push(line);
        if (argsList.length > 0) {
          // 参数列表已经包含了 "参数名:默认值" 格式
          result.push(`#!arguments=${argsList.join(',')}`);
          result.push(`#!arguments-desc=${argsDesc.join('\\n')}`);
        }
        headerInserted = true;
        continue;
      }

      if (trimmedLine === '[Script]') {
        inScriptSection = true;
        result.push(line);
        continue;
      }

      if (trimmedLine.startsWith('[') && trimmedLine.endsWith(']')) {
        inScriptSection = false;
        result.push(line);
        continue;
      }

      if (inScriptSection && trimmedLine && !trimmedLine.startsWith('#')) {
        // 处理两种格式：
        // 1. ScriptName = type=http-request, ...
        // 2. type=http-request, ...（没有脚本名）

        // 先尝试匹配有脚本名的格式
        const scriptMatch = trimmedLine.match(/^([^=]+)\s*=\s*(.+)$/);
        if (scriptMatch) {
          const scriptName = scriptMatch[1].trim();
          const scriptContent = scriptMatch[2].trim();

          // 通过脚本内容中的 pattern 或其他特征查找对应的 Loon 脚本
          let matchedScript: ScriptInfo | undefined;

          // 尝试通过脚本名匹配
          matchedScript = scriptMap.get(scriptName);

          // 如果没有匹配到，尝试通过 pattern 匹配
          if (!matchedScript) {
            const patternMatch = scriptContent.match(/pattern=([^,\s]+)/);
            if (patternMatch) {
              const pattern = patternMatch[1];
              // 查找具有相同 pattern 的脚本
              for (const [tag, script] of scriptMap) {
                if (script.content.includes(pattern)) {
                  matchedScript = script;
                  break;
                }
              }
            }
          }

          if (matchedScript) {
            // 使用脚本 tag 作为参数名，格式：{{{tag}}} = scriptContent
            result.push(`{{{${matchedScript.tag}}}} = ${scriptContent}`);
            continue;
          }
        } else {
          // 处理没有脚本名的格式，尝试通过 pattern 匹配
          const patternMatch = trimmedLine.match(/pattern=([^,\s]+)/);
          if (patternMatch) {
            const pattern = patternMatch[1];
            // 查找具有相同 pattern 的脚本
            for (const [tag, script] of scriptMap) {
              if (script.content.includes(pattern)) {
                // 使用脚本 tag 作为参数名，格式：{{{tag}}} = scriptContent
                result.push(`{{{${script.tag}}}} = ${trimmedLine}`);
                continue;
              }
            }
          }
        }
      }

      result.push(line);
    }

    return result.join('\n');
  }

  /**
   * 完整的转换流程
   */
  static async convertLoonToSurge(
    loonPluginPath: string,
    surgeModulePath: string,
    outputPath: string
  ): Promise<void> {
    // 读取文件
    const loonContent = fs.readFileSync(loonPluginPath, 'utf-8');
    const surgeContent = fs.readFileSync(surgeModulePath, 'utf-8');

    // 解析 Loon 插件脚本
    const loonScripts = this.parseLoonScripts(loonContent);

    // 修正 Surge 模块
    const fixedContent = this.fixSurgeModule(surgeContent, loonScripts);

    // 写入结果
    fs.writeFileSync(outputPath, fixedContent);
  }
}
