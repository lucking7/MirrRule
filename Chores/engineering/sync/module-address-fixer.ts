#!/usr/bin/env tsx
/**
 * 模块地址修复脚本
 * 用于修复 Script Hub 转换后产生的 127.0.0.1 地址问题
 */

import * as fs from 'fs';
import * as path from 'path';
import { moduleConfig } from './module-config.js';

function fixModuleAddresses(content: string): { fixed: string; changes: number } {
  let fixed = content;
  let totalChanges = 0;

  // 应用所有地址修复模式
  for (const { pattern, replacement } of moduleConfig.addressFixPatterns) {
    const matches = fixed.match(pattern) || [];
    const changeCount = matches.length;

    if (changeCount > 0) {
      fixed = fixed.replace(pattern, replacement);
      totalChanges += changeCount;
      console.log(`  修复 ${changeCount} 处 ${pattern.source} -> ${replacement}`);
    }
  }

  return { fixed, changes: totalChanges };
}

async function processModule(modulePath: string): Promise<boolean> {
  const moduleName = path.basename(modulePath);

  try {
    const content = fs.readFileSync(modulePath, 'utf-8');

    // 检查是否需要修复
    const needsFix = moduleConfig.addressFixPatterns.some(({ pattern }) => pattern.test(content));

    if (!needsFix) {
      return false;
    }

    console.log(`修复: ${moduleName}`);
    const { fixed, changes } = fixModuleAddresses(content);

    if (changes > 0) {
      fs.writeFileSync(modulePath, fixed);
      console.log(`  ✅ 共修复 ${changes} 处问题`);
      return true;
    } else {
      console.log(`  ℹ️  没有需要修复的问题`);
      return false;
    }
  } catch (error) {
    console.error(`  ❌ 处理失败: ${error}`);
    return false;
  }
}

async function main() {
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

  console.log(`扫描 ${moduleFiles.length} 个模块文件...`);
  console.log('');

  let fixedCount = 0;

  // 处理每个模块
  for (const moduleFile of moduleFiles) {
    if (await processModule(moduleFile)) {
      fixedCount++;
    }
  }

  console.log('');
  console.log(`地址修复完成！共修复 ${fixedCount} 个文件`);

  // 返回适当的退出码
  process.exit(0);
}

// 运行主函数
if (require.main === module) {
  main().catch(error => {
    console.error('执行失败:', error);
    process.exit(1);
  });
}
