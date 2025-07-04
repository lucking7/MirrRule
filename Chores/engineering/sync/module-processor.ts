#!/usr/bin/env tsx
/**
 * 模块处理器 - 统一处理 Surge 模块的各种转换和增强
 * 包含地址修复、验证、参数注入、规则注入等功能
 */

import * as fs from 'fs';
import * as path from 'path';
import { moduleConfig } from './module-config.js';
import { ParameterInjector } from './module-parameter-injector.js';
import { addRuleToModule } from './module-rule-injector.js';

export class ModuleProcessor {
  /**
   * 修复模块中的地址问题
   * 使用配置文件中定义的地址修复模式
   */
  static fixAddresses(content: string): { fixed: string; changes: number } {
    let fixed = content;
    let totalChanges = 0;

    // 应用所有地址修复模式
    for (const { pattern, replacement } of moduleConfig.addressFixPatterns) {
      const matches = fixed.match(pattern) || [];
      const changeCount = matches.length;

      if (changeCount > 0) {
        fixed = fixed.replace(pattern, replacement);
        totalChanges += changeCount;
      }
    }

    // 额外的修复模式（来自原 validator）
    // 修复空的 script-path
    fixed = fixed.replace(/script-path\s*=\s*(?=,|$)/g, 'script-path = ');

    // 移除 @http://script.hub 标记
    fixed = fixed.replace(/@http:\/\/script\.hub/g, '');

    return { fixed, changes: totalChanges };
  }

  /**
   * 验证模块的完整性
   */
  static validateModule(content: string): { valid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 检查必要的元数据
    if (!content.includes('#!name=')) {
      errors.push('缺少 #!name 元数据');
    }

    if (!content.includes('#!desc=') && !content.includes('#!description=')) {
      warnings.push('缺少 #!desc 或 #!description 元数据');
    }

    // 检查是否有无效的 127.0.0.1 地址
    const has127Address = moduleConfig.addressFixPatterns.some(({ pattern }) =>
      pattern.test(content)
    );
    if (has127Address) {
      errors.push('包含无效的 127.0.0.1 地址');
    }

    // 检查是否有空的 script-path
    const emptyScriptPath = /script-path\s*=\s*(?:,|$)/;
    if (emptyScriptPath.test(content)) {
      warnings.push('包含空的 script-path');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 处理参数注入
   */
  static async processParameterInjection(modulePath: string, moduleName: string): Promise<boolean> {
    const { needsParameterFix, getLoonPluginUrl } = await import('./module-config.js');

    if (!needsParameterFix(moduleName)) {
      return false;
    }

    const loonUrl = getLoonPluginUrl(moduleName);
    if (!loonUrl) {
      console.error(`  ❌ 找不到 ${moduleName} 对应的 Loon 插件 URL`);
      return false;
    }

    try {
      // 下载 Loon 插件
      const loonContent = await this.downloadFile(loonUrl);

      // 读取当前的 Surge 模块
      const surgeContent = fs.readFileSync(modulePath, 'utf-8');

      // 解析 Loon 脚本
      const loonScripts = ParameterInjector.parseLoonScripts(loonContent);

      if (loonScripts.length === 0) {
        console.log(`  ⚠️  ${moduleName} 没有找到脚本定义`);
        return false;
      }

      // 注入参数
      const fixedContent = ParameterInjector.injectParameters(surgeContent, loonScripts);

      // 写回文件
      fs.writeFileSync(modulePath, fixedContent);
      console.log(`  ✅ 参数注入完成（${loonScripts.length} 个脚本）`);
      return true;
    } catch (error) {
      console.error(`  ❌ 参数注入失败: ${error}`);
      return false;
    }
  }

  /**
   * 处理规则注入
   */
  static processRuleInjection(modulePath: string, moduleName: string): boolean {
    // 查找模块的规则注入配置
    const ruleConfig = moduleConfig.moduleRuleInjections.find(
      config => config.moduleName === moduleName.replace('.sgmodule', '')
    );

    if (!ruleConfig) {
      return false;
    }

    try {
      // 读取模块内容
      const content = fs.readFileSync(modulePath, 'utf-8');

      // 添加规则
      const modifiedContent = addRuleToModule(
        content,
        ruleConfig.ruleSetUrl,
        ruleConfig.policy || 'REJECT',
        ruleConfig.params || []
      );

      // 如果内容有变化，写回文件
      if (content !== modifiedContent) {
        fs.writeFileSync(modulePath, modifiedContent, 'utf-8');
        console.log(`  ✅ 规则注入完成`);
        return true;
      }
    } catch (error) {
      console.error(`  ❌ 规则注入失败: ${error}`);
    }

    return false;
  }

  /**
   * 下载文件
   */
  static async downloadFile(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download: ${response.statusText}`);
    }
    return await response.text();
  }

  /**
   * 处理单个模块文件
   */
  static async processModuleFile(
    filePath: string,
    options: {
      fix: boolean;
      validate: boolean;
      parameterInject: boolean;
      ruleInject: boolean;
    } = { fix: true, validate: true, parameterInject: true, ruleInject: true }
  ): Promise<{ modified: boolean; validation: any }> {
    const moduleName = path.basename(filePath);
    let content = fs.readFileSync(filePath, 'utf-8');
    let modified = false;
    let validation = null;

    console.log(`\n处理模块: ${moduleName}`);

    // 验证
    if (options.validate) {
      validation = this.validateModule(content);
      if (!validation.valid || validation.warnings.length > 0) {
        validation.errors.forEach(error => console.log(`  ❌ ${error}`));
        validation.warnings.forEach(warning => console.log(`  ⚠️  ${warning}`));
      }
    }

    // 地址修复
    if (options.fix) {
      const { fixed, changes } = this.fixAddresses(content);

      if (changes > 0 || fixed !== content) {
        fs.writeFileSync(filePath, fixed);
        modified = true;
        console.log(`  ✅ 地址修复完成（${changes} 处）`);
        content = fixed;
      }
    }

    // 参数注入
    if (options.parameterInject) {
      const parameterModified = await this.processParameterInjection(filePath, moduleName);
      if (parameterModified) {
        modified = true;
      }
    }

    // 规则注入
    if (options.ruleInject) {
      const ruleModified = this.processRuleInjection(filePath, moduleName);
      if (ruleModified) {
        modified = true;
      }
    }

    return { modified, validation };
  }

  /**
   * 批量处理目录中的所有模块文件
   */
  static async processDirectory(
    directory: string,
    options: {
      fix: boolean;
      validate: boolean;
      parameterInject: boolean;
      ruleInject: boolean;
    } = { fix: true, validate: true, parameterInject: true, ruleInject: true }
  ): Promise<{ totalFiles: number; modifiedFiles: number; errorFiles: number }> {
    const files = fs
      .readdirSync(directory)
      .filter(file => file.endsWith('.sgmodule'))
      .map(file => path.join(directory, file));

    let modifiedFiles = 0;
    let errorFiles = 0;

    console.log(`发现 ${files.length} 个模块文件`);
    console.log('处理选项:', options);
    console.log('');

    for (const file of files) {
      try {
        const { modified, validation } = await this.processModuleFile(file, options);
        if (modified) modifiedFiles++;
        if (validation && !validation.valid) errorFiles++;
      } catch (error) {
        console.error(`处理 ${path.basename(file)} 失败:`, error);
        errorFiles++;
      }
    }

    return {
      totalFiles: files.length,
      modifiedFiles,
      errorFiles,
    };
  }
}

// 命令行接口
async function main() {
  const args = process.argv.slice(2);

  // 解析参数
  const options = {
    fix: !args.includes('--no-fix'),
    validate: !args.includes('--no-validate'),
    parameterInject: !args.includes('--no-parameter-inject'),
    ruleInject: !args.includes('--no-rule-inject'),
  };

  const targetPath =
    args.find(arg => !arg.startsWith('--')) || path.join(process.cwd(), 'Surge', 'Modules');

  if (!fs.existsSync(targetPath)) {
    console.error(`错误: 路径不存在: ${targetPath}`);
    process.exit(1);
  }

  const stats = fs.statSync(targetPath);

  try {
    if (stats.isDirectory()) {
      const result = await ModuleProcessor.processDirectory(targetPath, options);
      console.log('\n处理完成:');
      console.log(`  总文件数: ${result.totalFiles}`);
      console.log(`  修改文件: ${result.modifiedFiles}`);
      console.log(`  错误文件: ${result.errorFiles}`);

      process.exit(result.errorFiles > 0 ? 1 : 0);
    } else {
      const { modified, validation } = await ModuleProcessor.processModuleFile(targetPath, options);
      console.log('\n处理完成');

      process.exit(validation && !validation.valid ? 1 : 0);
    }
  } catch (error) {
    console.error('处理失败:', error);
    process.exit(1);
  }
}

// 如果直接运行此文件
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
