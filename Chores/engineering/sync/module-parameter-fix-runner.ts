#!/usr/bin/env tsx
/**
 * 独立的模块参数修正脚本
 * 用于处理 Script Hub 转换后的 Surge 模块，添加参数控制
 */

import * as fs from 'fs';
import * as path from 'path';
import { moduleConfig, needsParameterFix, getLoonPluginUrl } from './module-config.js';
import { LoonToSurgeConverter } from './module-parameter-fixer.js';

async function downloadFile(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.statusText}`);
  }
  return await response.text();
}

async function processModule(modulePath: string): Promise<void> {
  const moduleName = path.basename(modulePath);

  if (!needsParameterFix(moduleName)) {
    console.log(`跳过: ${moduleName} (不需要参数修正)`);
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
    console.log(`  ✅ 参数修正完成`);

    // 清理临时文件
    fs.unlinkSync(loonTempFile);
  } catch (error) {
    console.error(`  ❌ 处理失败: ${error}`);
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

  console.log(`找到 ${moduleFiles.length} 个模块文件`);
  console.log(`需要参数修正的模块: ${moduleConfig.modulesRequiringParameterFix.join(', ')}`);
  console.log('');

  // 处理每个模块
  for (const moduleFile of moduleFiles) {
    await processModule(moduleFile);
  }

  console.log('\n参数修正完成！');
}

// 运行主函数
main().catch(error => {
  console.error('执行失败:', error);
  process.exit(1);
});
