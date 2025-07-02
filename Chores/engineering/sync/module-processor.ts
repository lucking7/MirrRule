#!/usr/bin/env tsx
/**
 * 模块处理器 - 统一处理 Surge 模块的验证和修复
 * 包含地址修复、验证等功能
 */

import * as fs from 'fs';
import * as path from 'path';
import { moduleConfig } from './module-config.js';

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
   * 处理单个模块文件
   */
  static async processModuleFile(
    filePath: string,
    options: { fix: boolean; validate: boolean } = { fix: true, validate: true }
  ): Promise<{ modified: boolean; validation: any }> {
    const moduleName = path.basename(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    let modified = false;
    let validation = null;

    // 验证
    if (options.validate) {
      validation = this.validateModule(content);
      if (!validation.valid || validation.warnings.length > 0) {
        console.log(`\n${moduleName}:`);
        validation.errors.forEach(error => console.log(`  ❌ ${error}`));
        validation.warnings.forEach(warning => console.log(`  ⚠️  ${warning}`));
      }
    }

    // 修复
    if (options.fix) {
      const { fixed, changes } = this.fixAddresses(content);

      if (changes > 0 || fixed !== content) {
        fs.writeFileSync(filePath, fixed);
        modified = true;
        console.log(`  ✅ 已修复 ${changes} 处问题`);
      }
    }

    return { modified, validation };
  }

  /**
   * 批量处理目录中的所有模块文件
   */
  static async processDirectory(
    directory: string,
    options: { fix: boolean; validate: boolean } = { fix: true, validate: true }
  ): Promise<{ totalFiles: number; modifiedFiles: number; errorFiles: number }> {
    const files = fs
      .readdirSync(directory)
      .filter(file => file.endsWith('.sgmodule'))
      .map(file => path.join(directory, file));

    let modifiedFiles = 0;
    let errorFiles = 0;

    console.log(`处理 ${files.length} 个模块文件...\n`);

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
