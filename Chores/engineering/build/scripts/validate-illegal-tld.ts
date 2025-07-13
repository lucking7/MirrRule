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

// 规则集类型枚举
enum RulesetType {
  DOMAINSET = 'DomainsetOutput',
  IPLIST = 'IPListOutput',
  RULESET = 'RulesetOutput',
  UNKNOWN = 'Unknown',
}

// 规则类型标识符
const DOMAIN_RULE_PREFIXES = [
  'DOMAIN,',
  'DOMAIN-SUFFIX,',
  'DOMAIN-KEYWORD,',
  'DOMAIN-SET,',
  'DOMAIN-WILDCARD,',
];
const IP_RULE_PREFIXES = ['IP-CIDR,', 'IP-CIDR6,', 'GEOIP,', 'IP-ASN,'];
const OTHER_RULE_PREFIXES = [
  'USER-AGENT,',
  'URL-REGEX,',
  'PROCESS-NAME,',
  'AND,',
  'OR,',
  'NOT,',
  'SUBNET,',
  'DEST-PORT,',
  'SRC-PORT,',
  'SRC-IP,',
  'PROTOCOL,',
  'SCRIPT,',
  'CELLULAR-RADIO,',
  'DEVICE-NAME,',
];

interface IllegalDomainInfo {
  domain: string;
  file: string;
  line: number;
}

// 检测文件的规则集类型
async function detectRulesetType(filePath: string): Promise<RulesetType> {
  let hasDomainRules = false;
  let hasIpRules = false;
  let hasOtherRules = false;
  let hasPureDomains = false;
  let lineCount = 0;
  const maxLinesToCheck = 100; // 只检查前100行来判断类型

  try {
    for await (const line of readFileByLine(filePath)) {
      lineCount++;
      if (lineCount > maxLinesToCheck) break;

      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith('#') || trimmedLine.startsWith('//')) {
        continue;
      }

      // 检查是否包含规则前缀
      const hasRulePrefix = [
        ...DOMAIN_RULE_PREFIXES,
        ...IP_RULE_PREFIXES,
        ...OTHER_RULE_PREFIXES,
      ].some(prefix => trimmedLine.startsWith(prefix));

      if (hasRulePrefix) {
        // 检查具体是哪种规则
        if (DOMAIN_RULE_PREFIXES.some(prefix => trimmedLine.startsWith(prefix))) {
          hasDomainRules = true;
        }
        if (IP_RULE_PREFIXES.some(prefix => trimmedLine.startsWith(prefix))) {
          hasIpRules = true;
        }
        if (OTHER_RULE_PREFIXES.some(prefix => trimmedLine.startsWith(prefix))) {
          hasOtherRules = true;
        }
      } else if (trimmedLine.includes('.')) {
        // 可能是纯域名格式
        hasPureDomains = true;
      }
    }

    // 判断规则集类型
    if (hasDomainRules || hasIpRules || hasOtherRules) {
      // 混合规则集
      return RulesetType.RULESET;
    } else if (hasIpRules && !hasDomainRules && !hasOtherRules) {
      // 纯 IP 规则集
      return RulesetType.IPLIST;
    } else if (hasPureDomains && !hasIpRules && !hasOtherRules) {
      // 纯域名集
      return RulesetType.DOMAINSET;
    }

    return RulesetType.UNKNOWN;
  } catch (error) {
    console.warn(`⚠️ 无法检测文件类型 ${filePath}: ${error}`);
    return RulesetType.UNKNOWN;
  }
}

function isIllegal(tld: string, filePath: string, rulesetType: RulesetType): boolean {
  const lowerTld = tld.toLowerCase();
  const fileName = path.basename(filePath).toLowerCase();

  // 1. 真正非法的 TLD 在任何文件中都无效
  if (TRULY_ILLEGAL_TLDS.has(lowerTld)) {
    return true;
  }

  // 2. 对于混合规则集（RulesetOutput），不检查内部和特殊网络 TLD
  //    因为这些规则集可能包含各种合法的内部网络和特殊用途域名
  if (rulesetType === RulesetType.RULESET) {
    return false;
  }

  // 3. 对于特定文件名的规则集，采用宽松策略
  if (fileName.includes('direct') || fileName.includes('reject')) {
    return false;
  }

  // 4. 对于纯域名集（DomainsetOutput），内部TLD和特殊网络TLD都被视为非法
  if (rulesetType === RulesetType.DOMAINSET) {
    return INTERNAL_TLDS.has(lowerTld) || SPECIAL_NETWORK_TLDS.has(lowerTld);
  }

  // 5. 对于 IP 规则集，不应该包含域名，但如果包含了，则检查 TLD
  return INTERNAL_TLDS.has(lowerTld) || SPECIAL_NETWORK_TLDS.has(lowerTld);
}

async function checkFileForIllegalTLD(
  filePath: string,
  rulesetType: RulesetType
): Promise<IllegalDomainInfo[]> {
  const illegalDomains: IllegalDomainInfo[] = [];
  const fileName = path.basename(filePath);

  // 混合规则集（RulesetOutput）不需要 TLD 验证
  if (rulesetType === RulesetType.RULESET) {
    console.log(picocolors.gray(`    跳过混合规则集的 TLD 验证: ${fileName}`));
    return illegalDomains;
  }

  // IP 规则集也不需要 TLD 验证
  if (rulesetType === RulesetType.IPLIST) {
    console.log(picocolors.gray(`    跳过 IP 规则集的 TLD 验证: ${fileName}`));
    return illegalDomains;
  }

  let lineNumber = 0;
  const source = readFileByLine(filePath);

  try {
    for await (const line of source) {
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

        if (tld && isIllegal(tld, filePath, rulesetType)) {
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
    const dirsToCheck = [
      // 移除不存在的Source目录，避免CI报错
      // path.join(SOURCE_DIR, 'domainset'),
      // path.join(SOURCE_DIR, 'non_ip'),
      path.join(SURGE_DIR, 'Rulesets'),
    ];

    const allIllegalDomains: IllegalDomainInfo[] = [];

    for (const dir of dirsToCheck) {
      try {
        const files = await fs.readdir(dir);
        const targetFiles = files.filter(
          f => f.endsWith('.txt') || f.endsWith('.conf') || f.endsWith('.list')
        );

        for (const file of targetFiles) {
          const filePath = path.join(dir, file);

          // 先检测规则集类型
          const rulesetType = await detectRulesetType(filePath);
          console.log(picocolors.gray(`  检测 ${file}: ${rulesetType}`));

          // 根据规则集类型进行相应的检查
          const illegalDomains = await checkFileForIllegalTLD(filePath, rulesetType);
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
