import * as fs from 'fs';
import * as path from 'path';

export class ModuleValidator {
  /**
   * 修复模块中的 127.0.0.1 地址问题
   * Script Hub 转换有时会产生错误的 127.0.0.1 地址
   */
  static fixLocalHostAddresses(content: string): string {
    // 修复常见的 127.0.0.1 模式
    let fixed = content;

    // 1. 修复 script-path 中的 127.0.0.1
    fixed = fixed.replace(/script-path\s*=\s*https?:\/\/127\.0\.0\.1[^,\s]*/g, 'script-path = ');

    // 2. 修复 data 中的 127.0.0.1
    fixed = fixed.replace(/data\s*=\s*"https?:\/\/127\.0\.0\.1[^"]*"/g, 'data = ""');

    // 3. 修复 @http://script.hub 标记
    fixed = fixed.replace(/@http:\/\/script\.hub/g, '');

    return fixed;
  }

  /**
   * 验证模块的完整性
   */
  static validateModule(content: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 检查必要的元数据
    if (!content.includes('#!name=')) {
      errors.push('Missing #!name metadata');
    }

    if (!content.includes('#!desc=') && !content.includes('#!description=')) {
      errors.push('Missing #!desc or #!description metadata');
    }

    // 检查是否有无效的 127.0.0.1 地址
    if (content.includes('127.0.0.1') && !content.includes('# 127.0.0.1')) {
      errors.push('Contains invalid 127.0.0.1 addresses');
    }

    // 检查是否有空的 script-path
    const emptyScriptPath = /script-path\s*=\s*(?:,|$)/;
    if (emptyScriptPath.test(content)) {
      errors.push('Contains empty script-path');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * 处理单个模块文件
   */
  static async processModuleFile(filePath: string): Promise<void> {
    const content = fs.readFileSync(filePath, 'utf-8');

    // 先验证
    const validation = this.validateModule(content);
    if (!validation.valid) {
      console.log(`Validation issues found in ${filePath}:`);
      validation.errors.forEach(error => console.log(`  - ${error}`));
    }

    // 修复问题
    const fixed = this.fixLocalHostAddresses(content);

    // 如果有修改，写回文件
    if (fixed !== content) {
      fs.writeFileSync(filePath, fixed);
      console.log(`Fixed issues in ${filePath}`);
    }
  }

  /**
   * 批量处理目录中的所有模块文件
   */
  static async processDirectory(directory: string): Promise<void> {
    const files = fs.readdirSync(directory);

    for (const file of files) {
      if (file.endsWith('.sgmodule')) {
        const filePath = path.join(directory, file);
        await this.processModuleFile(filePath);
      }
    }
  }
}

// 如果作为脚本运行
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: ts-node module-validator.ts <file-or-directory>');
    process.exit(1);
  }

  const target = args[0];
  const stats = fs.statSync(target);

  if (stats.isDirectory()) {
    ModuleValidator.processDirectory(target)
      .then(() => console.log('Processing completed'))
      .catch(err => {
        console.error('Processing failed:', err);
        process.exit(1);
      });
  } else {
    ModuleValidator.processModuleFile(target)
      .then(() => console.log('Processing completed'))
      .catch(err => {
        console.error('Processing failed:', err);
        process.exit(1);
      });
  }
}
