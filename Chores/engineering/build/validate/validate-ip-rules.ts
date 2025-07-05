/**
 * IP规则验证脚本 - 验证IP规则的格式正确性
 *
 * 此脚本会：
 * 1. 扫描规则文件中的所有IP规则
 * 2. 验证IP规则的格式正确性
 * 3. 将无效IP规则写入缓存文件
 * 4. 可选择自动移除无效IP规则
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 导入验证器
import { validateIPRules } from '../lib/ip-validator.js';

// 获取脚本目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 根目录和缓存目录
const ROOT_DIR = path.resolve(__dirname, '../../../..');
const CACHE_DIR = path.join(ROOT_DIR, '.cache');

// 规则目录
const RULE_DIRS = [
  path.join(ROOT_DIR, 'Surge', 'Rulesets'),
  path.join(ROOT_DIR, 'Chores', 'ruleset'),
];

// 缓存文件
const INVALID_IP_RULES_CACHE = path.join(CACHE_DIR, 'invalid-ip-rules.json');
const AUTO_REMOVED_IP_RULES = path.join(CACHE_DIR, 'auto-removed-ip-rules.json');

// 定义支持的IP规则类型
const SUPPORTED_IP_TYPES = ['IP-CIDR', 'IP-CIDR6', 'GEOIP', 'IP-ASN'];

/**
 * 处理单行，清理注释和空白
 */
function processLine(line: string): string | null {
  // 去除前后空白
  const trimmedLine = line.trim();

  // 跳过空行
  if (trimmedLine === '') {
    return null;
  }

  // 跳过注释行 (# 或 //)
  if (trimmedLine.startsWith('#') || trimmedLine.startsWith('//')) {
    return null;
  }

  // 处理行内注释
  const commentIndex = Math.min(
    trimmedLine.indexOf(' #') >= 0 ? trimmedLine.indexOf(' #') : Number.MAX_SAFE_INTEGER,
    trimmedLine.indexOf(' //') >= 0 ? trimmedLine.indexOf(' //') : Number.MAX_SAFE_INTEGER
  );

  if (commentIndex !== Number.MAX_SAFE_INTEGER) {
    return trimmedLine.substring(0, commentIndex).trim();
  }

  return trimmedLine;
}

/**
 * 从规则文件中提取IP规则
 */
async function extractIPRulesFromRuleset(filePath: string): Promise<{
  ipRules: { rule: string; source: string }[];
}> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);

    const ipRulesWithSource: { rule: string; source: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const processedLine = processLine(lines[i]);
      if (!processedLine) {
        continue;
      }

      // 检查是否是IP规则
      for (const ipType of SUPPORTED_IP_TYPES) {
        if (processedLine.startsWith(`${ipType},`)) {
          ipRulesWithSource.push({
            rule: processedLine,
            source: `${filePath}:${i + 1}`,
          });
          break;
        }
      }
    }

    return { ipRules: ipRulesWithSource };
  } catch (error) {
    console.error(`读取文件 ${filePath} 时出错:`, error);
    return { ipRules: [] };
  }
}

/**
 * 检查目录是否存在
 */
async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * 从目录中收集所有IP规则
 */
async function collectIPRulesFromDirectories(): Promise<{
  ipRules: { rule: string; source: string }[];
}> {
  const allIPRules: { rule: string; source: string }[] = [];

  const scanRulesetDirectory = async (dir: string): Promise<void> => {
    if (!(await dirExists(dir))) {
      return;
    }

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await scanRulesetDirectory(fullPath);
        } else if (entry.isFile() && (entry.name.endsWith('.list') || entry.name.endsWith('.conf'))) {
          const { ipRules } = await extractIPRulesFromRuleset(fullPath);
          allIPRules.push(...ipRules);
        }
      }
    } catch (error) {
      console.error(`扫描目录 ${dir} 时出错:`, error);
    }
  };

  // 扫描所有规则目录
  for (const ruleDir of RULE_DIRS) {
    console.log(`扫描目录: ${ruleDir}`);
    await scanRulesetDirectory(ruleDir);
  }

  return { ipRules: allIPRules };
}

/**
 * 自动移除无效的IP规则
 */
async function removeInvalidIPRules(
  invalidIPRulesWithSource: { rule: string; source: string }[]
): Promise<{
  removed: { rule: string; source: string }[];
}> {
  const removedRules: { rule: string; source: string }[] = [];

  // 按文件分组
  const fileToRulesMap = new Map<string, { lineNumber: number; rule: string }[]>();

  for (const { rule, source } of invalidIPRulesWithSource) {
    const [filePath, lineNumberStr] = source.split(':');
    const lineNumber = parseInt(lineNumberStr, 10);

    if (!fileToRulesMap.has(filePath)) {
      fileToRulesMap.set(filePath, []);
    }

    fileToRulesMap.get(filePath)!.push({ lineNumber, rule });
  }

  // 处理每个文件
  for (const [filePath, rules] of fileToRulesMap.entries()) {
    try {
      // 读取文件内容
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split(/\r?\n/);

      // 记录要移除的行号
      const linesToRemove = new Set(rules.map(r => r.lineNumber));

      // 创建新内容，跳过无效行
      const newLines = lines.filter((_, index) => !linesToRemove.has(index + 1));

      // 写回文件
      await fs.writeFile(filePath, newLines.join('\n'));

      // 记录移除的规则
      for (const { rule, lineNumber } of rules) {
        removedRules.push({ rule, source: `${filePath}:${lineNumber}` });
      }

      console.log(`已从 ${filePath} 移除 ${rules.length} 条无效IP规则`);
    } catch (error) {
      console.error(`处理文件 ${filePath} 时出错:`, error);
    }
  }

  return { removed: removedRules };
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  try {
    console.log('🔢 开始验证IP规则...');

    // 确保缓存目录存在
    await fs.mkdir(CACHE_DIR, { recursive: true });

    // 收集所有IP规则
    console.log('📊 收集规则文件中的IP规则...');
    const { ipRules } = await collectIPRulesFromDirectories();

    console.log(`共发现 ${ipRules.length} 条IP规则`);

    if (ipRules.length === 0) {
      console.log('✅ 没有找到IP规则');
      // 写入空的缓存文件
      await fs.writeFile(INVALID_IP_RULES_CACHE, JSON.stringify([], null, 2));
      await fs.writeFile(AUTO_REMOVED_IP_RULES, JSON.stringify([], null, 2));
      return;
    }

    // 验证IP规则
    console.log('🔍 验证IP规则格式...');
    // 提取纯IP规则列表用于验证
    const ipRuleList = ipRules.map(r => r.rule);
    const { invalid: invalidIPRuleList } = await validateIPRules(ipRuleList);

    // 创建无效IP规则关联源文件的映射
    const invalidIPRulesWithSource = ipRules
      .filter(r => invalidIPRuleList.includes(r.rule))
      .map(r => ({ rule: r.rule, source: r.source }));

    // 写入无效IP规则缓存
    await fs.writeFile(INVALID_IP_RULES_CACHE, JSON.stringify(invalidIPRulesWithSource, null, 2));

    // 检查是否需要自动移除（通过命令行参数控制）
    const shouldAutoRemove = process.argv.includes('--fix') || process.argv.includes('--auto-remove');
    let removedRules: { rule: string; source: string }[] = [];

    if (shouldAutoRemove && invalidIPRulesWithSource.length > 0) {
      console.log('🔧 自动移除无效IP规则...');
      const { removed } = await removeInvalidIPRules(invalidIPRulesWithSource);
      removedRules = removed;
    }

    // 写入自动移除的规则缓存
    await fs.writeFile(AUTO_REMOVED_IP_RULES, JSON.stringify(removedRules, null, 2));

    // 输出结果
    if (invalidIPRuleList.length === 0) {
      console.log('✅ 所有IP规则格式正确');
    } else {
      console.log(`❌ 发现 ${invalidIPRuleList.length} 条无效IP规则`);
      console.log('💾 无效规则已保存到:', INVALID_IP_RULES_CACHE);
      
      if (shouldAutoRemove && removedRules.length > 0) {
        console.log(`🔧 已自动移除 ${removedRules.length} 条无效IP规则`);
      } else if (!shouldAutoRemove && invalidIPRulesWithSource.length > 0) {
        console.log('💡 使用 --fix 参数可自动移除无效IP规则');
      }
    }

    // 设置GitHub Actions输出
    if (process.env.GITHUB_OUTPUT) {
      const outputPath = process.env.GITHUB_OUTPUT;
      await fs.appendFile(outputPath, `has_invalid_ip_rules=${invalidIPRuleList.length > 0}\n`);
      await fs.appendFile(outputPath, `invalid_ip_rules_count=${invalidIPRuleList.length}\n`);
      await fs.appendFile(outputPath, `auto_removed_ip_rules=${removedRules.length}\n`);
    }

    // 如果有无效规则且未自动移除，则退出码为1
    if (invalidIPRuleList.length > 0 && !shouldAutoRemove) {
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ IP规则验证失败:', error);
    process.exit(1);
  }
}

// 执行主函数
main().catch(error => {
  console.error('未捕获的错误:', error);
  process.exit(1);
});
