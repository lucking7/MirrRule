/**
 * 哈希冲突检测脚本
 *
 * 功能：
 * 1. 扫描所有规则文件
 * 2. 计算每行规则的哈希值
 * 3. 检测并报告哈希冲突
 * 4. 支持GitHub Actions集成
 *
 * 基于Surge-master的validate-hash-collision-test.ts改进
 */

import { readFile, writeFile } from 'fs/promises';
import { glob } from 'glob';
import { createHash } from 'crypto';

// 支持的哈希算法
const HASH_ALGORITHMS = ['md5', 'sha1', 'sha256'] as const;
type HashAlgorithm = (typeof HASH_ALGORITHMS)[number];

// 要检查的规则集路径
const RULE_PATHS = [
  'Surge/Rulesets/**/*.list',
  'Surge/domainset/**/*.conf',
  'Chores/ruleset/**/*.list',
];

interface HashCollision {
  hash: string;
  algorithm: HashAlgorithm;
  domains: Array<{
    domain: string;
    file: string;
    line: number;
  }>;
}

interface CollisionReport {
  algorithm: HashAlgorithm;
  totalHashes: number;
  totalCollisions: number;
  collisions: HashCollision[];
}

/**
 * 计算字符串的哈希值
 */
function computeHash(text: string, algorithm: HashAlgorithm): string {
  return createHash(algorithm).update(text).digest('hex');
}

/**
 * 从文件中提取域名
 */
async function extractDomainsFromFile(
  filePath: string
): Promise<Array<{ domain: string; line: number }>> {
  const content = await readFile(filePath, 'utf-8');
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
    } else if (line.startsWith('.')) {
      // domainset 格式
      domain = line.substring(1);
    } else if (!line.includes(',') && line.includes('.')) {
      // 纯域名格式
      domain = line;
    }

    if (domain) {
      domain = domain.split('#')[0].trim().toLowerCase();
      domains.push({ domain, line: i + 1 });
    }
  }

  return domains;
}

/**
 * 检测哈希冲突
 */
async function detectHashCollisions(algorithm: HashAlgorithm): Promise<CollisionReport> {
  const hashMap = new Map<string, Array<{ domain: string; file: string; line: number }>>();

  // 收集所有文件
  const allFiles: string[] = [];
  for (const pattern of RULE_PATHS) {
    const files = await glob(pattern);
    allFiles.push(...files);
  }

  // 处理每个文件
  for (const file of allFiles) {
    try {
      const domains = await extractDomainsFromFile(file);

      for (const { domain, line } of domains) {
        const hash = computeHash(domain, algorithm);

        if (!hashMap.has(hash)) {
          hashMap.set(hash, []);
        }

        hashMap.get(hash)!.push({ domain, file, line });
      }
    } catch (error) {
      console.error(`处理文件失败 ${file}:`, error);
    }
  }

  // 找出冲突
  const collisions: HashCollision[] = [];
  for (const [hash, entries] of hashMap) {
    if (entries.length > 1) {
      // 检查是否真的是不同的域名
      const uniqueDomains = new Set(entries.map(e => e.domain));
      if (uniqueDomains.size > 1) {
        collisions.push({
          hash,
          algorithm,
          domains: entries,
        });
      }
    }
  }

  return {
    algorithm,
    totalHashes: hashMap.size,
    totalCollisions: collisions.length,
    collisions,
  };
}

/**
 * 生成冲突报告
 */
function generateCollisionReport(reports: CollisionReport[]): string {
  let output = '# 哈希冲突检测报告\n\n';
  output += `生成时间: ${new Date().toISOString()}\n\n`;

  for (const report of reports) {
    output += `## ${report.algorithm.toUpperCase()} 算法\n\n`;
    output += `- 总哈希数: ${report.totalHashes}\n`;
    output += `- 冲突数: ${report.totalCollisions}\n`;
    output += `- 冲突率: ${((report.totalCollisions / report.totalHashes) * 100).toFixed(4)}%\n\n`;

    if (report.totalCollisions > 0) {
      output += '### 冲突详情\n\n';

      report.collisions.slice(0, 10).forEach((collision, index) => {
        output += `#### 冲突 ${index + 1}\n`;
        output += `哈希值: ${collision.hash}\n`;
        output += '涉及域名:\n';

        const domainGroups = new Map<string, Array<{ file: string; line: number }>>();
        collision.domains.forEach(d => {
          if (!domainGroups.has(d.domain)) {
            domainGroups.set(d.domain, []);
          }
          domainGroups.get(d.domain)!.push({ file: d.file, line: d.line });
        });

        for (const [domain, locations] of domainGroups) {
          output += `- **${domain}**\n`;
          locations.forEach(loc => {
            output += `  - ${loc.file}:${loc.line}\n`;
          });
        }
        output += '\n';
      });

      if (report.totalCollisions > 10) {
        output += `... 还有 ${report.totalCollisions - 10} 个冲突\n\n`;
      }
    }
  }

  return output;
}

async function main() {
  console.log('🔍 开始哈希冲突检测...');

  const reports: CollisionReport[] = [];

  // 对每种算法进行检测
  for (const algorithm of HASH_ALGORITHMS) {
    console.log(`\n检测 ${algorithm.toUpperCase()} 哈希冲突...`);
    const report = await detectHashCollisions(algorithm);
    reports.push(report);

    console.log(`  - 总哈希数: ${report.totalHashes}`);
    console.log(`  - 冲突数: ${report.totalCollisions}`);

    if (report.totalCollisions > 0) {
      console.log(`  ⚠️  发现哈希冲突！`);

      // 显示前 3 个冲突
      report.collisions.slice(0, 3).forEach((collision, index) => {
        const domains = [...new Set(collision.domains.map(d => d.domain))];
        console.log(`    冲突 ${index + 1}: ${domains.join(' ↔ ')}`);
      });

      if (report.totalCollisions > 3) {
        console.log(`    ... 还有 ${report.totalCollisions - 3} 个冲突`);
      }
    } else {
      console.log(`  ✅ 未发现哈希冲突`);
    }
  }

  // 生成详细报告
  const reportContent = generateCollisionReport(reports);
  await writeFile('.cache/hash-collision-report.md', reportContent);

  // 保存 JSON 格式的数据
  const jsonData = reports.map(r => ({
    algorithm: r.algorithm,
    totalHashes: r.totalHashes,
    totalCollisions: r.totalCollisions,
    collisions: r.collisions.map(c => ({
      hash: c.hash,
      domains: [...new Set(c.domains.map(d => d.domain))],
      locations: c.domains.map(d => ({ file: d.file, line: d.line })),
    })),
  }));

  await writeFile('.cache/hash-collisions.json', JSON.stringify(jsonData, null, 2));

  // 统计总体情况
  const totalCollisions = reports.reduce((sum, r) => sum + r.totalCollisions, 0);

  console.log('\n📊 总体统计:');
  console.log(`  - 检测算法数: ${reports.length}`);
  console.log(`  - 总冲突数: ${totalCollisions}`);

  if (totalCollisions > 0) {
    console.log('\n⚠️  发现哈希冲突，这可能会影响某些依赖哈希的系统');
    console.log('建议检查并修改冲突的域名');
  } else {
    console.log('\n✅ 所有算法均未发现哈希冲突');
  }
}

main().catch(console.error);
