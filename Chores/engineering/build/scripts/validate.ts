/**
 * 规则验证脚本 - 验证域名和IP规则的有效性
 *
 * 此脚本会：
 * 1. 扫描规则文件中的所有域名和IP规则
 * 2. 验证域名的可用性
 * 3. 验证IP规则的格式正确性
 * 4. 将失效域名和无效IP规则写入缓存文件
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 导入验证器
import { extractDomainsFromRule, validateDomains } from '../lib/domain-validator.js';
import { extractIPRulesFromFile, validateIPRules } from '../lib/ip-validator.js';

// 获取脚本目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 根目录和缓存目录
const ROOT_DIR = path.resolve(__dirname, '../../../..');
const CACHE_DIR = path.join(ROOT_DIR, '.cache');

// 规则目录
const RULE_DIRS = [
  path.join(ROOT_DIR, 'Surge', 'Rulesets'),
  path.join(ROOT_DIR, 'Dial'),
  path.join(ROOT_DIR, 'Chores', 'ruleset'),
];

// 缓存文件
const DEAD_DOMAINS_CACHE = path.join(CACHE_DIR, 'dead-domains.json');
const INVALID_IP_RULES_CACHE = path.join(CACHE_DIR, 'invalid-ip-rules.json');

/**
 * 从规则文件中提取域名和IP规则
 */
async function extractRulesFromFile(
  filePath: string
): Promise<{ domains: string[]; ipRules: string[] }> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);

    const domains: string[] = [];
    const ipRules: string[] = [];

    for (const line of lines) {
      const trimmedLine = line.trim();

      // 跳过注释和空行
      if (trimmedLine.startsWith('#') || trimmedLine === '') {
        continue;
      }

      // 检查是否是IP规则
      if (
        trimmedLine.startsWith('IP-CIDR,') ||
        trimmedLine.startsWith('IP-CIDR6,') ||
        trimmedLine.startsWith('GEOIP,') ||
        trimmedLine.startsWith('IP-ASN,')
      ) {
        ipRules.push(trimmedLine);
      } else {
        // 尝试提取域名
        const extractedDomains = extractDomainsFromRule(trimmedLine);
        domains.push(...extractedDomains);
      }
    }

    return { domains, ipRules };
  } catch (error) {
    console.error(`Error extracting rules from ${filePath}:`, error);
    return { domains: [], ipRules: [] };
  }
}

/**
 * 检查目录是否存在
 */
async function dirExists(dirPath: string): Promise<boolean> {
  try {
    await fs.access(dirPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 从目录中收集所有规则
 */
async function collectRulesFromDirectories(
  directories: string[]
): Promise<{ domains: string[]; ipRules: string[] }> {
  const allDomains = new Set<string>();
  const allIPRules = new Set<string>();

  // 过滤掉不存在的目录
  const validDirs: string[] = [];
  for (const dir of directories) {
    if (await dirExists(dir)) {
      validDirs.push(dir);
    } else {
      console.log(`目录不存在，跳过: ${dir}`);
    }
  }

  for (const dir of validDirs) {
    try {
      await scanDirectory(dir);
    } catch (error) {
      console.error(`Error scanning directory ${dir}:`, error);
    }
  }

  async function scanDirectory(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await scanDirectory(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.list')) {
          const { domains, ipRules } = await extractRulesFromFile(fullPath);

          // 添加到集合中（自动去重）
          domains.forEach(domain => allDomains.add(domain));
          ipRules.forEach(rule => allIPRules.add(rule));
        }
      }
    } catch (error) {
      console.error(`Error reading directory ${dir}:`, error);
    }
  }

  return {
    domains: [...allDomains],
    ipRules: [...allIPRules],
  };
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  try {
    console.log('开始验证规则...');

    // 确保缓存目录存在
    await fs.mkdir(CACHE_DIR, { recursive: true });

    // 收集所有规则
    console.log('收集规则文件中的域名和IP规则...');
    const { domains, ipRules } = await collectRulesFromDirectories(RULE_DIRS);

    console.log(`共发现 ${domains.length} 个域名和 ${ipRules.length} 条IP规则`);

    // 验证域名
    console.log('验证域名可用性...');
    const { dead: deadDomains } = await validateDomains(domains);

    // 验证IP规则
    console.log('验证IP规则格式...');
    const { invalid: invalidIPRules } = await validateIPRules(ipRules);

    // 写入缓存文件
    await fs.writeFile(DEAD_DOMAINS_CACHE, JSON.stringify(deadDomains, null, 2));
    await fs.writeFile(INVALID_IP_RULES_CACHE, JSON.stringify(invalidIPRules, null, 2));

    // 输出结果
    console.log(
      `验证完成！发现 ${deadDomains.length} 个失效域名和 ${invalidIPRules.length} 条无效IP规则`
    );

    // 设置GitHub Actions输出
    if (process.env.GITHUB_OUTPUT) {
      const outputPath = process.env.GITHUB_OUTPUT;
      await fs.appendFile(outputPath, `has_dead_domains=${deadDomains.length > 0}\n`);
      await fs.appendFile(outputPath, `has_invalid_ip_rules=${invalidIPRules.length > 0}\n`);
    }

    // 如果有问题，设置错误代码
    if (deadDomains.length > 0 || invalidIPRules.length > 0) {
      console.log('规则验证发现问题，但仍然继续执行');
    }
  } catch (error) {
    console.error('规则验证失败:', error);
    process.exit(1);
  }
}

// 执行主函数
main().catch(error => {
  console.error('未捕获的错误:', error);
  process.exit(1);
});
