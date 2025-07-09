import picocolors from 'picocolors';
import { readFileByLine } from '../lib/fetch-text-by-line.js';
import path from 'node:path';
import { SOURCE_DIR, SURGE_DIR } from '../constants/dir.js';
import { type Span } from '../trace/index.js';
import { promises as fs } from 'node:fs';

// 一些已知的非法 TLD
const TRULY_ILLEGAL_TLDS = new Set(['test', 'example', 'invalid', 'localhost']);

// 内部域名 TLD（在 direct 规则中是合法的）
const INTERNAL_TLDS = new Set([
  'local',
  'internal',
  'private',
  'lan',
  'home',
  'corp',
  'mail',
  'localdomain',
  'workgroup',
]);

// 特殊网络 TLD（在 reject 规则中是合法的）
const SPECIAL_NETWORK_TLDS = new Set([
  'onion', // Tor network
  'i2p', // I2P network
]);

interface IllegalDomainInfo {
  domain: string;
  file: string;
  line: number;
}

function isIllegal(tld: string, filePath: string): boolean {
  const lowerTld = tld.toLowerCase();
  const fileName = path.basename(filePath).toLowerCase();

  // 1. 真正非法的 TLD 在任何文件中都无效
  if (TRULY_ILLEGAL_TLDS.has(lowerTld)) {
    return true;
  }

  // 2. 对于 direct.list 和 reject.list，只要不是真正非法的TLD，就都算合法
  //    这样就允许了 .lan, .internal, .onion 等特殊TLD
  if (fileName.includes('direct') || fileName.includes('reject')) {
    return false;
  }

  // 3. 对于其他所有规则文件，内部TLD和特殊网络TLD都被视为非法
  return INTERNAL_TLDS.has(lowerTld) || SPECIAL_NETWORK_TLDS.has(lowerTld);
}

async function checkFileForIllegalTLD(filePath: string): Promise<IllegalDomainInfo[]> {
  const illegalDomains: IllegalDomainInfo[] = [];
  let lineNumber = 0;

  try {
    for await (const line of readFileByLine(filePath)) {
      lineNumber++;
      const trimmedLine = line.trim();

      // 跳过空行和注释
      if (!trimmedLine || trimmedLine.startsWith('#') || trimmedLine.startsWith('//')) {
        continue;
      }

      // 提取域名
      let domain: string | null = null;

      if (trimmedLine.includes(',')) {
        // 规则格式: DOMAIN,example.com 或 DOMAIN-SUFFIX,example.com
        const parts = trimmedLine.split(',');
        if (parts[0] === 'DOMAIN' || parts[0] === 'DOMAIN-SUFFIX') {
          domain = parts[1]?.trim();
        }
      } else if (trimmedLine.includes('.')) {
        // 纯域名格式
        domain = trimmedLine;
      }

      if (domain) {
        // 检查是否包含非法 TLD
        const parts = domain.split('.');
        const tld = parts.at(-1);

        if (tld && isIllegal(tld, filePath)) {
          illegalDomains.push({
            domain,
            file: path.relative(process.cwd(), filePath),
            line: lineNumber,
          });
        }
      }
    }
  } catch (error) {
    console.warn(`⚠️ 无法读取文件 ${filePath}: ${error}`);
  }

  return illegalDomains;
}

export async function validateIllegalTLD(parentSpan: Span) {
  console.log(picocolors.blue('🔍 检查非法 TLD...'));

  const span = parentSpan.traceChild('validate-illegal-tld');
  try {
    const dirsToCheck = [path.join(SURGE_DIR, 'Rulesets')];

    const allIllegalDomains: IllegalDomainInfo[] = [];

    for (const dir of dirsToCheck) {
      try {
        const files = await fs.readdir(dir);
        const targetFiles = files.filter(
          f => f.endsWith('.txt') || f.endsWith('.conf') || f.endsWith('.list')
        );

        for (const file of targetFiles) {
          const filePath = path.join(dir, file);
          const illegalDomains = await checkFileForIllegalTLD(filePath);
          allIllegalDomains.push(...illegalDomains);
        }
      } catch (error) {
        console.warn(`⚠️ 无法访问目录 ${dir}: ${error}`);
      }
    }

    if (allIllegalDomains.length === 0) {
      console.log(picocolors.green('✅ 未发现非法 TLD'));
      return;
    }

    console.log(picocolors.red(`\n❌ 发现 ${allIllegalDomains.length} 个非法 TLD:\n`));

    // 按文件分组
    const byFile = new Map<string, IllegalDomainInfo[]>();
    for (const info of allIllegalDomains) {
      if (!byFile.has(info.file)) {
        byFile.set(info.file, []);
      }
      byFile.get(info.file)!.push(info);
    }

    // 输出结果
    for (const [file, domains] of byFile) {
      console.log(picocolors.yellow(`📄 ${file}:`));
      for (const info of domains) {
        console.log(`  行 ${info.line}: ${info.domain}`);
      }
      console.log();
    }

    throw new Error(`发现 ${allIllegalDomains.length} 个非法 TLD`);
  } finally {
    span.stop();
  }
}

// 如果直接运行脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  import('../trace/index.js').then(({ createSpan }) => {
    const rootSpan = createSpan('root');
    validateIllegalTLD(rootSpan).catch(error => {
      console.error(picocolors.red('❌ 验证失败:'), error);
      process.exit(1);
    });
  });
}
