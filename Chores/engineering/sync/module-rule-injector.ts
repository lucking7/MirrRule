import * as fs from 'fs/promises';
import * as path from 'path';

interface ModuleRuleConfig {
  moduleName: string;
  ruleSetUrl: string;
  sourceType: 'qx' | 'loon';
}

// 配置需要添加规则的模块
const moduleRuleConfigs: ModuleRuleConfig[] = [
  {
    moduleName: 'Chongxie_by_fmz',
    ruleSetUrl: 'https://ruleset.chichi.sh/Surge/Rulesets/reject/reject-QX.list',
    sourceType: 'qx',
  },
  {
    moduleName: 'Remove_ads_by_fmz',
    ruleSetUrl: 'https://ruleset.chichi.sh/Surge/Rulesets/reject/reject-Loon.list',
    sourceType: 'loon',
  },
];

/**
 * 为 Surge 模块添加规则集
 * @param content 模块内容
 * @param ruleSetUrl 规则集 URL
 * @returns 修改后的内容
 */
function addRuleToModule(content: string, ruleSetUrl: string): string {
  const ruleToAdd = `RULE-SET,${ruleSetUrl},REJECT,pre-matching,extended-matching,no-resolve`;

  // 检查是否已经有这个规则（避免重复添加）
  if (content.includes(ruleToAdd)) {
    console.log('  规则已存在，跳过添加');
    return content;
  }

  // 查找 [Rule] 部分
  const ruleIndex = content.indexOf('[Rule]');

  if (ruleIndex !== -1) {
    // 找到 [Rule] 部分，在其后添加规则
    const lines = content.split('\n');
    let ruleLineIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '[Rule]') {
        ruleLineIndex = i;
        break;
      }
    }

    if (ruleLineIndex !== -1) {
      // 在 [Rule] 后面插入新规则
      lines.splice(ruleLineIndex + 1, 0, ruleToAdd);
      return lines.join('\n');
    }
  }

  // 如果没有 [Rule] 部分，在文件末尾添加
  return content + '\n\n[Rule]\n' + ruleToAdd;
}

/**
 * 处理单个模块文件
 * @param modulePath 模块文件路径
 * @param config 模块配置
 */
async function processModule(modulePath: string, config: ModuleRuleConfig): Promise<boolean> {
  try {
    console.log(`\n处理模块: ${config.moduleName}`);
    console.log(`  文件路径: ${modulePath}`);
    console.log(`  源类型: ${config.sourceType}`);
    console.log(`  规则集: ${config.ruleSetUrl}`);

    // 读取模块内容
    const content = await fs.readFile(modulePath, 'utf-8');

    // 添加规则
    const modifiedContent = addRuleToModule(content, config.ruleSetUrl);

    // 如果内容有变化，写回文件
    if (content !== modifiedContent) {
      await fs.writeFile(modulePath, modifiedContent, 'utf-8');
      console.log('  ✅ 规则添加成功');
      return true;
    } else {
      console.log('  ⏭️  无需修改');
      return false;
    }
  } catch (error) {
    console.error(`  ❌ 处理失败: ${error}`);
    return false;
  }
}

/**
 * 主函数：处理所有配置的模块
 */
async function main() {
  console.log('🔧 开始为转换后的 Surge 模块添加规则集...\n');

  const surgeModulesDir = path.join(process.cwd(), 'Surge/Modules');
  let processedCount = 0;
  let modifiedCount = 0;

  // 确保目录存在
  try {
    await fs.access(surgeModulesDir);
  } catch {
    console.error(`❌ 目录不存在: ${surgeModulesDir}`);
    process.exit(1);
  }

  // 处理每个配置的模块
  for (const config of moduleRuleConfigs) {
    const modulePath = path.join(surgeModulesDir, `${config.moduleName}.sgmodule`);

    // 检查文件是否存在
    try {
      await fs.access(modulePath);
      processedCount++;

      const modified = await processModule(modulePath, config);
      if (modified) {
        modifiedCount++;
      }
    } catch {
      console.log(`\n⚠️  模块文件不存在: ${config.moduleName}.sgmodule`);
    }
  }

  // 输出统计信息
  console.log('\n📊 处理统计:');
  console.log(`  - 配置的模块数: ${moduleRuleConfigs.length}`);
  console.log(`  - 处理的模块数: ${processedCount}`);
  console.log(`  - 修改的模块数: ${modifiedCount}`);
  console.log(`  - 跳过的模块数: ${moduleRuleConfigs.length - processedCount}`);

  console.log('\n✨ 规则集添加完成！');
}

// 运行主函数
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ 执行失败:', error);
    process.exit(1);
  });
}

export { addRuleToModule, processModule, moduleRuleConfigs };
