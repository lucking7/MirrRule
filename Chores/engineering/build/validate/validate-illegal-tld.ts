import { readFile, writeFile } from 'fs/promises';
import { glob } from 'glob';
import tldts from 'tldts';
import { isIPv4, isIPv6 } from 'node:net';

// 非法/可疑的 TLD 列表
const ILLEGAL_TLDS = new Set([
  // 常见的钓鱼 TLD
  'tk',
  'ml',
  'ga',
  'cf',
  // 非标准 TLD
  'tor',
  'onion',
  'i2p',
  'bit',
  'eth',
  'crypto',
  // 测试 TLD
  'test',
  'example',
  'invalid',
  'localhost',
]);

// 需要检查的规则文件
const RULES_TO_CHECK = [
  'Surge/Rulesets/reject/block.list',
  'Surge/Rulesets/reject/reject.list',
  'Surge/Rulesets/reject/reject-Loon.list',
  'Surge/Rulesets/reject/reject-QX.list',
];

interface ValidationResult {
  file: string;
  illegalDomains: Array<{
    domain: string;
    tld: string;
    line: number;
    reason: string;
  }>;
  totalChecked: number;
}

async function extractDomains(content: string): Promise<Array<{ domain: string; line: number }>> {
  const lines = content.split('\n');
  const domains: Array<{ domain: string; line: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 跳过空行和注释
    if (!line || line.startsWith('#')) continue;

    let domain: string | null = null;

    // 提取域名
    if (line.includes('DOMAIN-SUFFIX,')) {
      domain = line.split(',')[1];
    } else if (line.includes('DOMAIN,')) {
      domain = line.split(',')[1];
    } else if (line.includes('DOMAIN-KEYWORD,')) {
      // 跳过关键词规则
      continue;
    } else if (!line.includes(',') && line.includes('.')) {
      // 可能是纯域名格式
      domain = line;
    }

    if (domain) {
      // 去除可能的注释
      domain = domain.split('#')[0].trim();

      // 跳过 IP 地址
      if (isIPv4(domain) || isIPv6(domain)) continue;

      domains.push({ domain, line: i + 1 });
    }
  }

  return domains;
}

async function validateFile(filePath: string): Promise<ValidationResult> {
  const content = await readFile(filePath, 'utf-8');
  const domains = await extractDomains(content);
  const illegalDomains: ValidationResult['illegalDomains'] = [];

  for (const { domain, line } of domains) {
    try {
      const parsed = tldts.parse(domain, {
        allowPrivateDomains: true,
        extractHostname: true,
      });

      if (!parsed.publicSuffix) {
        illegalDomains.push({
          domain,
          tld: 'N/A',
          line,
          reason: '无法识别的 TLD',
        });
        continue;
      }

      // 检查是否为 ICANN 认证的 TLD
      if (!parsed.isIcann && !parsed.isPrivate) {
        illegalDomains.push({
          domain,
          tld: parsed.publicSuffix,
          line,
          reason: '非 ICANN 认证的 TLD',
        });
      }

      // 检查是否在黑名单中
      if (ILLEGAL_TLDS.has(parsed.publicSuffix)) {
        illegalDomains.push({
          domain,
          tld: parsed.publicSuffix,
          line,
          reason: '可疑/非法 TLD',
        });
      }

      // 检查过长的 TLD（可能是钓鱼）
      if (parsed.publicSuffix.length > 10) {
        illegalDomains.push({
          domain,
          tld: parsed.publicSuffix,
          line,
          reason: 'TLD 过长（可能是钓鱼）',
        });
      }
    } catch (error) {
      illegalDomains.push({
        domain,
        tld: 'ERROR',
        line,
        reason: `解析错误: ${error}`,
      });
    }
  }

  return {
    file: filePath,
    illegalDomains,
    totalChecked: domains.length,
  };
}

async function removeIllegalDomains(
  filePath: string,
  illegalDomains: ValidationResult['illegalDomains']
): Promise<void> {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  const linesToRemove = new Set(illegalDomains.map(d => d.line - 1));

  const filteredLines = lines.filter((_, index) => !linesToRemove.has(index));
  await writeFile(filePath, filteredLines.join('\n'));
}

async function main() {
  console.log('🔍 开始非法 TLD 验证...');

  const results: ValidationResult[] = [];
  let totalIllegal = 0;

  // 扩展文件列表，包括通配符
  const allFiles: string[] = [];
  for (const pattern of RULES_TO_CHECK) {
    if (pattern.includes('*')) {
      const files = await glob(pattern);
      allFiles.push(...files);
    } else {
      allFiles.push(pattern);
    }
  }

  for (const file of allFiles) {
    try {
      console.log(`\n检查文件: ${file}`);
      const result = await validateFile(file);
      results.push(result);

      if (result.illegalDomains.length > 0) {
        console.log(`❌ 发现 ${result.illegalDomains.length} 个非法 TLD`);

        // 显示前 10 个问题
        result.illegalDomains.slice(0, 10).forEach(item => {
          console.log(
            `  - 行 ${item.line}: ${item.domain} (TLD: ${item.tld}, 原因: ${item.reason})`
          );
        });

        if (result.illegalDomains.length > 10) {
          console.log(`  ... 还有 ${result.illegalDomains.length - 10} 个问题`);
        }

        // 可选：自动修复（移除非法域名）
        if (process.argv.includes('--fix')) {
          console.log('🔧 自动修复中...');
          await removeIllegalDomains(file, result.illegalDomains);
          console.log('✅ 已移除非法域名');
        }
      } else {
        console.log('✅ 未发现非法 TLD');
      }

      totalIllegal += result.illegalDomains.length;
    } catch (error) {
      console.error(`❌ 处理文件失败 ${file}:`, error);
    }
  }

  // 生成报告
  console.log('\n📊 验证统计:');
  console.log(`  - 检查文件数: ${results.length}`);
  console.log(`  - 非法 TLD 总数: ${totalIllegal}`);

  // 保存详细报告
  await writeFile(
    '.cache/illegal-tlds.json',
    JSON.stringify(
      results.map(r => ({
        file: r.file,
        errors: r.illegalDomains.map(d => ({
          domain: d.domain,
          tld: d.tld,
          line: d.line,
          reason: d.reason,
        })),
      })),
      null,
      2
    )
  );

  // 如果发现问题且未修复，退出码为 1
  if (totalIllegal > 0 && !process.argv.includes('--fix')) {
    process.exit(1);
  }
}

main().catch(console.error);
