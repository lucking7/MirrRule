import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse } from 'tldts';
import picocolors from 'picocolors';
import { extractDomainRules } from '../lib/rule-extractor.js';

// 常量定义
const SCAN_DIRECTORIES = ['Chores/ruleset', 'Surge/Rulesets', 'Surge/domainset', 'Dial'];

interface DomainRule {
  domain: string;
  ruleType: string;
  filePath: string;
  lineNumber: number;
  originalLine: string;
}

interface IllegalTldResult {
  domain: string;
  tld: string;
  filePath: string;
  lineNumber: number;
  originalLine: string;
  ruleType: string;
}

/**
 * 扫描规则文件
 */
async function scanRuleFiles(): Promise<DomainRule[]> {
  const allRules: DomainRule[] = [];

  // 获取项目根目录（从 build/scripts 回到项目根目录）
  const projectRoot = path.resolve(process.cwd(), '../..');

  for (const scanPath of SCAN_DIRECTORIES) {
    try {
      const fullPath = path.join(projectRoot, scanPath);
      const ruleFiles = await fs.readdir(fullPath, { withFileTypes: true });
      for (const file of ruleFiles) {
        if (file.isFile()) {
          const filePath = path.join(fullPath, file.name);
          const rules = await extractDomainRules(filePath, {
            includeKeywords: true,
            recordLineNumbers: true,
            validateDomains: false,
          });
          allRules.push(...rules);
        }
      }
    } catch (error) {
      console.log(picocolors.yellow(`[skip] 目录不存在或无法访问: ${scanPath}`));
    }
  }

  return allRules;
}

/**
 * 检测非法TLD
 */
async function detectIllegalTlds(rules: DomainRule[]): Promise<IllegalTldResult[]> {
  const results: IllegalTldResult[] = [];

  for (const rule of rules) {
    try {
      const parsed = parse(rule.domain);

      if (!parsed.publicSuffix) {
        continue;
      }

      if (parsed.isIcann || parsed.isPrivate) {
        continue;
      }

      results.push({
        domain: rule.domain,
        tld: parsed.publicSuffix,
        filePath: rule.filePath,
        lineNumber: rule.lineNumber,
        originalLine: rule.originalLine,
        ruleType: rule.ruleType,
      });
    } catch (error) {
      const lastDotIndex = rule.domain.lastIndexOf('.');
      if (lastDotIndex > 0) {
        const tld = rule.domain.substring(lastDotIndex + 1);
        results.push({
          domain: rule.domain,
          tld: tld,
          filePath: rule.filePath,
          lineNumber: rule.lineNumber,
          originalLine: rule.originalLine,
          ruleType: rule.ruleType,
        });
      }
    }
  }

  return results;
}

/**
 * 主函数
 */
async function main() {
  console.log(picocolors.blue('开始检测非法/笔误TLD...'));

  const rules = await scanRuleFiles();
  console.log(picocolors.green(`扫描完成，共发现 ${rules.length} 条域名规则`));

  if (rules.length === 0) {
    console.log(picocolors.yellow('没有找到任何域名规则，请检查规则文件路径'));
    return;
  }

  const illegalResults = await detectIllegalTlds(rules);

  console.log(picocolors.green(`检测完成，发现 ${illegalResults.length} 个非法TLD`));

  if (illegalResults.length === 0) {
    console.log(picocolors.green('所有域名的TLD都是有效的！'));
    return;
  }

  console.log(picocolors.red('\n发现非法/笔误TLD:'));

  const tldGroups: Record<string, IllegalTldResult[]> = {};
  for (const result of illegalResults) {
    if (!tldGroups[result.tld]) {
      tldGroups[result.tld] = [];
    }
    tldGroups[result.tld].push(result);
  }

  for (const [tld, results] of Object.entries(tldGroups)) {
    console.log(picocolors.red(`\n  .${tld} (${results.length} 个域名):`));
    for (const result of results.slice(0, 5)) {
      console.log(
        picocolors.gray(
          `    ${result.domain} (${path.relative(process.cwd(), result.filePath)}:${
            result.lineNumber
          })`
        )
      );
    }
    if (results.length > 5) {
      console.log(picocolors.gray(`    ... 还有 ${results.length - 5} 个`));
    }
  }

  console.log(picocolors.yellow('\n建议:'));
  console.log('   1. 检查是否为拼写错误（如 .con → .com）');
  console.log('   2. 确认是否为已废弃的TLD');
  console.log('   3. 对于DOMAIN-KEYWORD规则，确认关键词是否合理');
  console.log('   4. 私有域名（如.local, .tor, .dn42等）会被自动跳过');
}

// 执行主函数
main().catch(error => {
  console.error(picocolors.red('TLD检测失败:'), error);
  process.exit(1);
});
