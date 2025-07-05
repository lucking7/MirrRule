/**
 * 规则验证脚本 - 验证域名和IP规则的有效性
 *
 * 此脚本会：
 * 1. 扫描规则文件中的所有域名和IP规则
 * 2. 验证域名的可用性
 * 3. 验证IP规则的格式正确性
 * 4. 将失效域名和无效IP规则写入缓存文件
 * 5. 自动移除无效IP规则
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 导入验证器
import { validateDomains } from '../lib/domain-validator.js';
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
  path.join(ROOT_DIR, 'Dial'),
  path.join(ROOT_DIR, 'Chores', 'ruleset'),
];

// domainset目录 (如果有的话)
const DOMAINSET_DIRS = [path.join(ROOT_DIR, 'Surge', 'domainset')];

// 缓存文件
const DEAD_DOMAINS_CACHE = path.join(CACHE_DIR, 'dead-domains.json');
const INVALID_IP_RULES_CACHE = path.join(CACHE_DIR, 'invalid-ip-rules.json');
const AUTO_REMOVED_IP_RULES = path.join(CACHE_DIR, 'auto-removed-ip-rules.json');

// 定义支持的规则类型
const SUPPORTED_DOMAIN_TYPES = ['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD'];
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
 * 从ruleset规则中提取域名
 */
function extractDomainFromRule(line: string): string | null {
  const parts = line.split(',');
  if (parts.length < 2) {
    return null;
  }

  const ruleType = parts[0];
  const domain = parts[1];

  if (!SUPPORTED_DOMAIN_TYPES.includes(ruleType)) {
    return null;
  }

  return domain;
}

/**
 * 检查域名是否有效
 * 此处为简化实现，实际应当调用更复杂的检查
 */
async function isDomainAlive(domain: string): Promise<boolean> {
  try {
    // 这里简化实现，实际应该使用DNS查询等方法检查
    // 可以调用现有的域名验证函数
    return true; // 假设所有域名都是活跃的，实际中应当替换为真实的检查
  } catch (error) {
    return false;
  }
}

/**
 * 从规则文件中提取域名和IP规则
 */
async function extractRulesFromRuleset(filePath: string): Promise<{
  domains: { domain: string; source: string }[];
  ipRules: { rule: string; source: string }[];
}> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);

    const domainsWithSource: { domain: string; source: string }[] = [];
    const ipRulesWithSource: { rule: string; source: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const processedLine = processLine(lines[i]);
      if (!processedLine) {
        continue;
      }

      // 检查是否是IP规则
      let isIPRule = false;
      for (const ipType of SUPPORTED_IP_TYPES) {
        if (processedLine.startsWith(`${ipType},`)) {
          ipRulesWithSource.push({
            rule: processedLine,
            source: `${filePath}:${i + 1}`,
          });
          isIPRule = true;
          break;
        }
      }

      if (!isIPRule) {
        // 尝试提取域名
        const domain = extractDomainFromRule(processedLine);
        if (domain) {
          domainsWithSource.push({
            domain,
            source: `${filePath}:${i + 1}`,
          });
        }
      }
    }

    return { domains: domainsWithSource, ipRules: ipRulesWithSource };
  } catch (error) {
    console.error(`Error extracting rules from ${filePath}:`, error);
    return { domains: [], ipRules: [] };
  }
}

/**
 * 从domainset文件中提取域名
 */
async function extractDomainsFromDomainset(filePath: string): Promise<{
  domains: { domain: string; source: string }[];
}> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);

    const domainsWithSource: { domain: string; source: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const processedLine = processLine(lines[i]);
      if (!processedLine) {
        continue;
      }

      // domainset中每行就是一个域名
      domainsWithSource.push({
        domain: processedLine,
        source: `${filePath}:${i + 1}`,
      });
    }

    return { domains: domainsWithSource };
  } catch (error) {
    console.error(`Error extracting domains from ${filePath}:`, error);
    return { domains: [] };
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
async function collectRulesFromDirectories(): Promise<{
  domains: { domain: string; source: string }[];
  ipRules: { rule: string; source: string }[];
}> {
  const allDomains: { domain: string; source: string }[] = [];
  const allIPRules: { rule: string; source: string }[] = [];

  // 过滤掉不存在的目录
  const validRuleDirs: string[] = [];
  for (const dir of RULE_DIRS) {
    if (await dirExists(dir)) {
      validRuleDirs.push(dir);
    } else {
      console.log(`Ruleset目录不存在，跳过: ${dir}`);
    }
  }

  const validDomainsetDirs: string[] = [];
  for (const dir of DOMAINSET_DIRS) {
    if (await dirExists(dir)) {
      validDomainsetDirs.push(dir);
    } else {
      console.log(`Domainset目录不存在，跳过: ${dir}`);
    }
  }

  // 处理ruleset目录
  for (const dir of validRuleDirs) {
    try {
      await scanRulesetDirectory(dir);
    } catch (error) {
      console.error(`Error scanning ruleset directory ${dir}:`, error);
    }
  }

  // 处理domainset目录
  for (const dir of validDomainsetDirs) {
    try {
      await scanDomainsetDirectory(dir);
    } catch (error) {
      console.error(`Error scanning domainset directory ${dir}:`, error);
    }
  }

  async function scanRulesetDirectory(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await scanRulesetDirectory(fullPath);
        } else if (
          entry.isFile() &&
          (entry.name.endsWith('.list') || entry.name.endsWith('.conf'))
        ) {
          const { domains, ipRules } = await extractRulesFromRuleset(fullPath);

          // 添加到集合中
          allDomains.push(...domains);
          allIPRules.push(...ipRules);
        }
      }
    } catch (error) {
      console.error(`Error reading directory ${dir}:`, error);
    }
  }

  async function scanDomainsetDirectory(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await scanDomainsetDirectory(fullPath);
        } else if (
          entry.isFile() &&
          (entry.name.endsWith('.list') || entry.name.endsWith('.conf'))
        ) {
          const { domains } = await extractDomainsFromDomainset(fullPath);

          // 添加到集合中
          allDomains.push(...domains);
        }
      }
    } catch (error) {
      console.error(`Error reading directory ${dir}:`, error);
    }
  }

  return {
    domains: allDomains,
    ipRules: allIPRules,
  };
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
    console.log('开始验证规则...');

    // 确保缓存目录存在
    await fs.mkdir(CACHE_DIR, { recursive: true });

    // 收集所有规则
    console.log('收集规则文件中的域名和IP规则...');
    const { domains, ipRules } = await collectRulesFromDirectories();

    console.log(`共发现 ${domains.length} 个域名和 ${ipRules.length} 条IP规则`);

    // 验证域名
    console.log('验证域名可用性...');
    // 提取纯域名列表用于验证
    const domainList = domains.map(d => d.domain);
    const { dead: deadDomains } = await validateDomains(domainList);

    // 创建死域名关联源文件的映射
    const deadDomainsWithSource = domains
      .filter(d => deadDomains.includes(d.domain))
      .map(d => ({ domain: d.domain, source: d.source }));

    // 验证IP规则
    console.log('验证IP规则格式...');
    // 提取纯IP规则列表用于验证
    const ipRuleList = ipRules.map(r => r.rule);
    const { invalid: invalidIPRuleList } = await validateIPRules(ipRuleList);

    // 创建无效IP规则关联源文件的映射
    const invalidIPRulesWithSource = ipRules
      .filter(r => invalidIPRuleList.includes(r.rule))
      .map(r => ({ rule: r.rule, source: r.source }));

    // 自动移除无效IP规则
    console.log('自动移除无效IP规则...');
    const { removed } = await removeInvalidIPRules(invalidIPRulesWithSource);

    // 写入缓存文件
    await fs.writeFile(DEAD_DOMAINS_CACHE, JSON.stringify(deadDomainsWithSource, null, 2));
    await fs.writeFile(INVALID_IP_RULES_CACHE, JSON.stringify(invalidIPRulesWithSource, null, 2));
    await fs.writeFile(AUTO_REMOVED_IP_RULES, JSON.stringify(removed, null, 2));

    // 输出结果
    console.log(
      `验证完成！发现 ${deadDomains.length} 个失效域名和 ${invalidIPRuleList.length} 条无效IP规则`
    );

    if (removed.length > 0) {
      console.log(`已自动移除 ${removed.length} 条无效IP规则`);
    }

    // 设置GitHub Actions输出
    if (process.env.GITHUB_OUTPUT) {
      const outputPath = process.env.GITHUB_OUTPUT;
      await fs.appendFile(outputPath, `has_dead_domains=${deadDomains.length > 0}\n`);
      await fs.appendFile(outputPath, `has_invalid_ip_rules=${invalidIPRuleList.length > 0}\n`);
      await fs.appendFile(outputPath, `auto_removed_rules=${removed.length}\n`);
    }

    // 如果有问题，设置错误代码
    if (deadDomains.length > 0 || invalidIPRuleList.length > 0) {
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
