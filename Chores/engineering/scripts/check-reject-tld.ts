import fs from 'node:fs/promises';
import path from 'node:path';
import { extractDomainFromRule } from '../lib/process-line.js';
import tldts from 'tldts';
import picocolors from 'picocolors';
import { EnhancedTldValidator, RuleSource } from '../lib/enhanced-tld-validator.js';

// 参考 Surge-master-2 的 ICP TLD 白名单
const ICP_TLD = [
  'ren',
  'wang',
  'citic',
  'top',
  'sohu',
  'xin',
  'com',
  'net',
  'club',
  'xyz',
  'site',
  'shop',
  'info',
  'mobi',
  'red',
  'pro',
  'kim',
  'ltd',
  'group',
  'biz',
  'link',
  'store',
  'tech',
  'fun',
  'online',
  'art',
  'design',
  'love',
  'center',
  'video',
  'social',
  'team',
  'show',
  'cool',
  'zone',
  'world',
  'today',
  'city',
  'chat',
  'company',
  'live',
  'fund',
  'gold',
  'plus',
  'guru',
  'run',
  'pub',
  'email',
  'life',
  'co',
  'baidu',
  'cloud',
  'host',
  'space',
  'press',
  'website',
  'archi',
  'asia',
  'bio',
  'black',
  'blue',
  'green',
  'lotto',
  'organic',
  'pet',
  'pink',
  'poker',
  'promo',
  'ski',
  'vote',
  'voto',
  'icu',
  'fans',
  'unicom',
  'jpmorgan',
  'chase',
  'cc',
  'band',
  'cab',
  'cafe',
  'cash',
  'fan',
  'fyi',
  'games',
  'market',
  'mba',
  'news',
  'media',
  'sale',
  'shopping',
  'studio',
  'tax',
  'technology',
  'vin',
  'baby',
  'college',
  'monster',
  'protection',
  'rent',
  'security',
  'storage',
  'theatre',
  'bond',
  'cyou',
  'uno',
  'school',
  'global',
  'me',
  'pw',
  'hk',
  'tv',
  'saxo',
  'click',
  'auto',
  'autos',
  'beauty',
  'boats',
  'car',
  'cars',
  'hair',
  'homes',
  'makeup',
  'motorcycles',
  'quest',
  'skin',
  'tickets',
  'yachts',
  'kids',
];

// 特殊用途 TLD（不应该被判定为非法）
const SPECIAL_PURPOSE_TLD = [
  'localhost',
  'local',
  'localdomain',
  'test',
  'example',
  'invalid',
  'lan',
  'home',
  'corp',
  'mail',
  'internal',
];

// CDN 和云服务域名（这些是 Public Suffix List 中的特殊域名）
const CDN_AND_CLOUD_DOMAINS = [
  // AWS
  'cloudfront.net',
  's3.amazonaws.com',
  's3-ap-northeast-1.amazonaws.com',
  's3-ap-northeast-2.amazonaws.com',
  's3-ap-south-1.amazonaws.com',
  's3-ap-southeast-1.amazonaws.com',
  's3-ap-southeast-2.amazonaws.com',
  's3-ca-central-1.amazonaws.com',
  's3-eu-central-1.amazonaws.com',
  's3-eu-west-1.amazonaws.com',
  's3-eu-west-2.amazonaws.com',
  's3-eu-west-3.amazonaws.com',
  's3-external-1.amazonaws.com',
  's3-fips-us-gov-west-1.amazonaws.com',
  's3-sa-east-1.amazonaws.com',
  's3-us-east-2.amazonaws.com',
  's3-us-gov-west-1.amazonaws.com',
  's3-us-west-1.amazonaws.com',
  's3-us-west-2.amazonaws.com',
  's3.ap-northeast-2.amazonaws.com',
  's3.ap-south-1.amazonaws.com',
  's3.cn-north-1.amazonaws.com.cn',
  's3.ca-central-1.amazonaws.com',
  's3.eu-central-1.amazonaws.com',
  's3.eu-west-2.amazonaws.com',
  's3.eu-west-3.amazonaws.com',
  's3.us-east-2.amazonaws.com',
  's3.dualstack.ap-northeast-1.amazonaws.com',
  's3.dualstack.ap-northeast-2.amazonaws.com',
  's3.dualstack.ap-south-1.amazonaws.com',
  's3.dualstack.ap-southeast-1.amazonaws.com',
  's3.dualstack.ap-southeast-2.amazonaws.com',
  's3.dualstack.ca-central-1.amazonaws.com',
  's3.dualstack.eu-central-1.amazonaws.com',
  's3.dualstack.eu-west-1.amazonaws.com',
  's3.dualstack.eu-west-2.amazonaws.com',
  's3.dualstack.eu-west-3.amazonaws.com',
  's3.dualstack.sa-east-1.amazonaws.com',
  's3.dualstack.us-east-1.amazonaws.com',
  's3.dualstack.us-east-2.amazonaws.com',
  'compute-1.amazonaws.com',
  'compute.amazonaws.com',
  'us-east-1.amazonaws.com',
  'elb.amazonaws.com',

  // Akamai
  'akamaihd.net',
  'akamaized.net',
  'akadns.net',
  'edgesuite.net',
  'edgekey.net',

  // Google
  'appspot.com',
  'googleapis.com',
  'googleusercontent.com',
  'googlevideo.com',
  'google.com',
  'googlecode.com',

  // GitHub
  'github.io',
  'github.com',
  'githubusercontent.com',

  // Heroku
  'herokuapp.com',

  // Cloudflare
  'cloudflare.com',
  'cloudflare.net',
  'cloudflare-dns.com',

  // Vercel
  'now.sh',
  'vercel.app',

  // 中国云服务
  'sinaapp.com',
  'aliyuncs.com',
  'qcloud.com',

  // 其他 CDN
  'azurewebsites.net',
  'fastly.net',
  'edgecastcdn.net',
  'stackpathdns.com',
  'cachefly.net',
  'kxcdn.com',
  'maxcdn.com',
  'incapdns.net',
  'netlify.app',
  'netlify.com',

  // 网站构建平台
  'wixsite.com',
  'weebly.com',
  'squarespace.com',

  // 公共 DNS 服务
  'dyndns.org',
  'dyndns.com',
  'no-ip.com',
  'no-ip.org',
  'no-ip.net',
  'no-ip.info',
  'duckdns.org',
  'ddns.net',
  'dyndn.es',

  // 国家/地区代码 TLD
  'com.cn',
  'com.tw',
  'com.hk',
  'com.sg',
  'com.au',
  'co.uk',
  'co.jp',
  'co.kr',
  'co.in',
  'com.br',
  'com.mx',
  'com.ru',
  'com.ua',
  'com.de',
  'com.fr',
  'com.es',
  'com.it',
  'com.pl',
  'com.tr',
  'com.sa',
  'com.eg',
  'com.za',
  'net.cn',
  'org.cn',
  'gov.cn',
  'edu.cn',
  'ac.cn',
];

// 构建 TLD 集合以提高查找效率
const ICP_TLD_SET = new Set(ICP_TLD);
const SPECIAL_PURPOSE_TLD_SET = new Set(SPECIAL_PURPOSE_TLD);
const CDN_AND_CLOUD_DOMAINS_SET = new Set(CDN_AND_CLOUD_DOMAINS);

interface TldCheckResult {
  file: string;
  totalDomains: number;
  illegalTldDomains: number;
  illegalTldDistribution: Map<string, number>;
  illegalDomainsList: Array<{
    domain: string;
    tld: string;
    line: string;
    lineNumber: number;
  }>;
}

interface TldCheckSummary {
  totalFiles: number;
  totalDomains: number;
  totalIllegalDomains: number;
  illegalTldDistribution: Map<string, number>;
  fileResults: TldCheckResult[];
}

const normalizeTldtsOpt = {
  allowPrivateDomains: true,
  detectIp: false,
};

async function checkRejectTld(files: string[], autoFix: boolean = false): Promise<TldCheckSummary> {
  const summary: TldCheckSummary = {
    totalFiles: files.length,
    totalDomains: 0,
    totalIllegalDomains: 0,
    illegalTldDistribution: new Map(),
    fileResults: [],
  };

  for (const file of files) {
    console.log(`\n${picocolors.blue('检测文件:')} ${file}`);

    const result = await checkSingleFile(file, autoFix);
    summary.fileResults.push(result);
    summary.totalDomains += result.totalDomains;
    summary.totalIllegalDomains += result.illegalTldDomains;

    // 合并 TLD 分布
    for (const [tld, count] of result.illegalTldDistribution) {
      summary.illegalTldDistribution.set(
        tld,
        (summary.illegalTldDistribution.get(tld) || 0) + count
      );
    }
  }

  return summary;
}

async function checkSingleFile(filePath: string, autoFix: boolean): Promise<TldCheckResult> {
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split('\n');

  const result: TldCheckResult = {
    file: filePath,
    totalDomains: 0,
    illegalTldDomains: 0,
    illegalTldDistribution: new Map(),
    illegalDomainsList: [],
  };

  const newLines: string[] = [];
  let modified = false;

  // 创建增强验证器
  const validator = new EnhancedTldValidator();

  // 判断文件来源（这里暂时都使用本地文件模式，可以根据需要扩展）
  const source = RuleSource.LocalFile;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 保留空行和注释
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
      newLines.push(line);
      continue;
    }

    // 提取域名
    const extracted = extractDomainFromRule(trimmed);
    if (!extracted || !extracted.domain) {
      newLines.push(line);
      continue;
    }

    const { domain } = extracted;
    result.totalDomains++;

    // 使用增强验证器验证域名
    const validationResult = validator.validate(domain, { source });

    // 检查 TLD 合法性
    if (!validationResult.valid) {
      result.illegalTldDomains++;

      const tld = validationResult.publicSuffix || 'UNKNOWN';
      result.illegalTldDistribution.set(tld, (result.illegalTldDistribution.get(tld) || 0) + 1);

      result.illegalDomainsList.push({
        domain,
        tld,
        line: trimmed,
        lineNumber: i + 1,
      });

      if (autoFix) {
        // 如果自动修复，注释掉该行而不是删除
        newLines.push(`# [${validationResult.reason}] ${line}`);
        modified = true;
      } else {
        newLines.push(line);
      }
    } else {
      newLines.push(line);
    }
  }

  // 如果修改了文件且启用自动修复，写回文件
  if (modified && autoFix) {
    await fs.writeFile(filePath, newLines.join('\n'));
    console.log(picocolors.green(`✅ 已修复文件: ${filePath}`));
  }

  return result;
}

// shouldFilterDomain 函数已被 EnhancedTldValidator 替代

function printResults(summary: TldCheckSummary) {
  console.log('\n' + picocolors.bold('📊 TLD 合法性检测报告'));
  console.log(picocolors.cyan('========================'));

  console.log(`\n${picocolors.bold('总体统计:')}`);
  console.log(`  📁 检测文件数: ${summary.totalFiles}`);
  console.log(`  🌐 总域名数: ${summary.totalDomains.toLocaleString()}`);
  console.log(`  ❌ 非法 TLD 域名数: ${summary.totalIllegalDomains.toLocaleString()}`);

  if (summary.totalDomains > 0) {
    const percentage = ((summary.totalIllegalDomains / summary.totalDomains) * 100).toFixed(2);
    console.log(`  📈 非法 TLD 比例: ${percentage}%`);
  }

  if (summary.illegalTldDistribution.size > 0) {
    console.log(`\n${picocolors.bold('非法 TLD 分布:')}`);
    const sortedTlds = Array.from(summary.illegalTldDistribution.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);

    console.table(
      sortedTlds.map(([tld, count]) => ({
        TLD: tld,
        数量: count.toLocaleString(),
        占比: ((count / summary.totalIllegalDomains) * 100).toFixed(2) + '%',
      }))
    );
  }

  // 显示每个文件的详细信息
  console.log(`\n${picocolors.bold('文件详情:')}`);
  for (const result of summary.fileResults) {
    console.log(`\n${picocolors.blue(path.basename(result.file))}`);
    console.log(`  - 总域名数: ${result.totalDomains.toLocaleString()}`);
    console.log(`  - 非法 TLD: ${result.illegalTldDomains.toLocaleString()}`);

    if (result.illegalDomainsList.length > 0 && result.illegalDomainsList.length <= 10) {
      console.log(`  - 示例:`);
      for (const item of result.illegalDomainsList.slice(0, 5)) {
        console.log(`    行 ${item.lineNumber}: ${item.domain} (TLD: ${item.tld})`);
      }
      if (result.illegalDomainsList.length > 5) {
        console.log(`    ... 还有 ${result.illegalDomainsList.length - 5} 个`);
      }
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const autoFix = args.includes('--fix');

  // 获取项目根目录
  const projectRoot = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '..',
    '..',
    '..'
  );

  // 要检测的文件列表
  const targetFiles = [
    path.join(projectRoot, 'Surge', 'Rulesets', 'reject', 'block.list'),
    path.join(projectRoot, 'Surge', 'Rulesets', 'reject', 'reject-Loon.list'),
    path.join(projectRoot, 'Surge', 'Rulesets', 'reject', 'reject-QX.list'),
  ];

  console.log(picocolors.bold('🔍 Reject 规则 TLD 合法性检测'));
  console.log(`📋 模式: ${autoFix ? picocolors.yellow('自动修复') : picocolors.green('仅检测')}`);
  console.log(`📁 目标文件:`);
  for (const file of targetFiles) {
    console.log(`  - ${file}`);
  }

  // 检查文件是否存在
  const existingFiles: string[] = [];
  for (const file of targetFiles) {
    try {
      await fs.access(file);
      existingFiles.push(file);
    } catch {
      console.warn(picocolors.yellow(`⚠️  文件不存在: ${file}`));
    }
  }

  if (existingFiles.length === 0) {
    console.error(picocolors.red('❌ 没有找到任何目标文件'));
    process.exit(1);
  }

  try {
    const summary = await checkRejectTld(existingFiles, autoFix);
    printResults(summary);

    // 保存详细报告
    const reportPath = 'reject-tld-check-report.json';
    await fs.writeFile(
      reportPath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          mode: autoFix ? 'fix' : 'check',
          summary: {
            totalFiles: summary.totalFiles,
            totalDomains: summary.totalDomains,
            totalIllegalDomains: summary.totalIllegalDomains,
            illegalTldDistribution: Object.fromEntries(summary.illegalTldDistribution),
          },
          details: summary.fileResults.map(r => ({
            file: r.file,
            totalDomains: r.totalDomains,
            illegalTldDomains: r.illegalTldDomains,
            illegalTldDistribution: Object.fromEntries(r.illegalTldDistribution),
            examples: r.illegalDomainsList.slice(0, 10),
          })),
        },
        null,
        2
      )
    );

    console.log(`\n📄 详细报告已保存至: ${reportPath}`);

    if (summary.totalIllegalDomains > 0 && !autoFix) {
      console.log(
        `\n💡 提示: 使用 ${picocolors.yellow('--fix')} 参数可以自动注释掉非法 TLD 的域名`
      );
    }
  } catch (error) {
    console.error(picocolors.red('❌ 检测过程中发生错误:'), error);
    process.exit(1);
  }
}

// 导出函数供其他脚本使用
export { checkRejectTld };

// 如果直接运行此脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
