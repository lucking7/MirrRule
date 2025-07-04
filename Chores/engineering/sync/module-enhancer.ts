#!/usr/bin/env tsx
/**
 * 模块增强器 - ScriptHub 后处理工具
 * 对 ScriptHub 转换后的 Surge 模块进行增强处理
 * 主要功能：从 Loon 插件源提取脚本信息，为 Surge 模块添加参数化控制能力
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

  private convertLoonPlugin(content: string): string {
    // ... existing code ...
    return content;
  }

  private addRuleSet(
    content: string,
    ruleSet: string,
    policy: string = 'REJECT',
    params: string[] = []
  ): string {
    const paramsString = params.length > 0 ? `,${params.join(',')}` : '';
    const ruleLine = `RULE-SET,${ruleSet},${policy}${paramsString}`;

    if (content.includes('[Rule]')) {
      // 使用正则表达式来确保替换的精确性，并保留原有的[Rule]行
      return content.replace(/(\[Rule\])/, `$1\n${ruleLine}`);
    } else {
      // 如果没有[Rule]部分，则在末尾添加
      return `${content}\n\n[Rule]\n${ruleLine}`;
    }
  }

  /**
   * Enhances a module with additional rules and configurations.
   * @returns The enhanced module content.
   */
  public enhance(name: string, content: string): string {
    switch (name) {
      case 'BiliBili.Enhanced':
        // ... existing code ...
        break;
      case 'BiliBili.ADBlock':
        // ... existing code ...
        break;
      case 'Chongxie_by_fmz': {
        const ruleParams = ['pre-matching', 'extended-matching', 'no-resolve'];
        const ruleSetUrl =
          'https://raw.githubusercontent.com/deesdew/esdeath/main/Surge/Rulesets/reject/reject-QX.list';
        content = this.addRuleSet(content, ruleSetUrl, 'REJECT', ruleParams);
        break;
      }
      case 'blockAds_plugin': {
        const ruleParams = ['pre-matching', 'extended-matching', 'no-resolve'];
        const ruleSetUrl =
          'https://raw.githubusercontent.com/deesdew/esdeath/main/Surge/Rulesets/reject/reject-Loon.list';
        content = this.addRuleSet(content, ruleSetUrl, 'REJECT', ruleParams);
        break;
      }
      default:
        break;
    }

    // Add surge reject rule set
    if (!content.includes('// Surge-Rule-Set')) {
      // ... existing code ...
    }

    return content;
  }
}

/**
 * 下载文件
 */
async function downloadFile(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.statusText}`);
  }
  return await response.text();
}

/**
 * 处理单个模块
 */
async function processModule(modulePath: string): Promise<void> {
  const { needsParameterFix, getLoonPluginUrl } = await import('./module-config.js');
  const moduleName = path.basename(modulePath);

  if (!needsParameterFix(moduleName)) {
    console.log(`跳过: ${moduleName} (不需要增强处理)`);
    return;
  }

  console.log(`处理: ${moduleName}`);

  // 获取对应的 Loon 插件 URL
  const loonUrl = getLoonPluginUrl(moduleName);
  if (!loonUrl) {
    console.error(`错误: 找不到 ${moduleName} 对应的 Loon 插件 URL`);
    return;
  }

  try {
    // 下载 Loon 插件
    console.log(`  下载 Loon 插件...`);
    const loonContent = await downloadFile(loonUrl);

    // 创建临时文件
    const tempDir = path.join(process.cwd(), '.cache', 'parameter-fix');
    fs.mkdirSync(tempDir, { recursive: true });

    const loonTempFile = path.join(tempDir, `${moduleName}.loon`);
    fs.writeFileSync(loonTempFile, loonContent);

    // 读取当前的 Surge 模块
    const surgeContent = fs.readFileSync(modulePath, 'utf-8');

    // 解析 Loon 脚本
    const loonScripts = LoonToSurgeConverter.parseLoonScripts(loonContent);

    if (loonScripts.length === 0) {
      console.log(`  警告: ${moduleName} 没有找到脚本定义`);
      return;
    }

    console.log(`  找到 ${loonScripts.length} 个脚本`);

    // 统计唯一的 tag
    const uniqueTags = new Set(loonScripts.map(s => s.tag));
    console.log(`  找到 ${uniqueTags.size} 个唯一的脚本标签`);

    // 修正模块
    const fixedContent = LoonToSurgeConverter.fixSurgeModule(surgeContent, loonScripts);

    // 写回文件
    fs.writeFileSync(modulePath, fixedContent);
    console.log(`  ✅ 增强处理完成`);

    // 清理临时文件
    fs.unlinkSync(loonTempFile);
  } catch (error) {
    console.error(`  ❌ 处理失败: ${error}`);
  }
}

/**
 * 主函数
 */
async function main() {
  const { moduleConfig } = await import('./module-config.js');
  const modulesDir = path.join(process.cwd(), 'Surge', 'Modules');

  if (!fs.existsSync(modulesDir)) {
    console.error('错误: Surge/Modules 目录不存在');
    process.exit(1);
  }

  // 获取所有 .sgmodule 文件
  const moduleFiles = fs
    .readdirSync(modulesDir)
    .filter(file => file.endsWith('.sgmodule'))
    .map(file => path.join(modulesDir, file));

  console.log(`找到 ${moduleFiles.length} 个模块文件`);
  console.log(`需要增强处理的模块: ${moduleConfig.modulesRequiringEnhancement.join(', ')}`);
  console.log('');

  // 处理每个模块
  for (const moduleFile of moduleFiles) {
    await processModule(moduleFile);
  }

  console.log('\n模块增强处理完成！');
}

// 如果直接运行此文件
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('执行失败:', error);
    process.exit(1);
  });
}
