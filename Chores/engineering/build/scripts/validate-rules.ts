import { glob } from 'glob';
import { readFile } from 'fs/promises';
import path from 'node:path';
import { type Span } from '../trace/index.js';
import picocolors from 'picocolors';

// 权威 TLD 列表
const ICANN_TLDS = new Set([
  'com',
  'net',
  'org',
  'io',
  'co',
  'ai',
  'app',
  'dev',
  'gg',
  'me',
  'tv',
  'tech',
  'xyz',
  'info',
  'cn',
  'com.cn',
  'net.cn',
  'org.cn',
  'gov.cn',
  'za',
  // 更多合法的 TLD...
  'de',
  'uk',
  'jp',
  'fr',
  'au',
  'ca',
  'es',
  'it',
  'ru',
  'br',
  'nl',
  'ch',
  'se',
  'no',
  'dk',
  'fi',
  'pl',
  'be',
  'at',
  'gr',
  'cz',
  'hu',
  'ro',
  'pt',
  'il',
  'in',
  'kr',
  'tw',
  'hk',
  'sg',
  'my',
  'th',
  'id',
  'ph',
  'vn',
  'tr',
  'ae',
  'sa',
  'eg',
]);

const VALID_LONG_TLDS = new Set([
  'googleapis.com',
  's3.amazonaws.com',
  'googlecode.com',
  'wixsite.com',
  'akamaihd.net',
  'edgesuite.net',
  'blogspot.com',
  '1e100.net',
  'googlevideo.com',
  'ggpht.com',
]);

interface ValidationResult {
  filePath: string;
  errors: ValidationError[];
}

interface ValidationError {
  line: number;
  domain: string;
  reason: string;
}

function getTld(domain: string): string | null {
  const parts = domain.split('.');
  if (parts.length < 2) return null;
  const tld = parts.slice(-1)[0];
  const secondLevelTld = parts.slice(-2).join('.');
  if (ICANN_TLDS.has(secondLevelTld) || VALID_LONG_TLDS.has(secondLevelTld)) {
    return secondLevelTld;
  }
  return tld;
}

function isValidTld(domain: string): boolean {
  const tld = getTld(domain);
  if (!tld) return false;
  return ICANN_TLDS.has(tld) || VALID_LONG_TLDS.has(tld);
}

async function validateFile(filePath: string): Promise<ValidationResult> {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  const errors: ValidationError[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 跳过注释和空行
    if (line.startsWith('#') || line.startsWith('//') || !line) continue;

    // 检查是否包含逗号（标准规则格式）
    if (line.includes(',')) {
      // 解析规则类型和内容
      const commaIndex = line.indexOf(',');
      const ruleType = line.substring(0, commaIndex).trim();
      const ruleContent = line.substring(commaIndex + 1).trim();

      // 只验证域名类型的规则
      if ((ruleType === 'DOMAIN' || ruleType === 'DOMAIN-SUFFIX') && ruleContent) {
        if (!isValidTld(ruleContent)) {
          errors.push({
            line: i + 1,
            domain: ruleContent,
            reason: '无效或非法的 TLD',
          });
        }
      }
      // 跳过其他类型的规则（IP-CIDR, IP-CIDR6, DOMAIN-KEYWORD, USER-AGENT, IP-ASN, PROCESS-NAME 等）
    } else {
      // 如果没有逗号，可能是单个域名
      if (
        !line.includes('/') &&
        line.includes('.') &&
        !line.startsWith('IP-') &&
        !line.includes('PROCESS-') &&
        !line.includes('USER-')
      ) {
        if (!isValidTld(line)) {
          errors.push({
            line: i + 1,
            domain: line,
            reason: '无效或非法的 TLD',
          });
        }
      }
    }
  }

  return { filePath, errors };
}

export async function validateRules(parentSpan: Span) {
  const span = parentSpan.traceChild('validate-rules');

  try {
    // 获取项目根目录
    const projectRoot = path.resolve(process.cwd());
    const ruleFiles = await glob('Surge/Rulesets/**/*.list', { cwd: projectRoot });

    const results = await Promise.all(
      ruleFiles.map(file => validateFile(path.join(projectRoot, file)))
    );

    let errorCount = 0;
    results.forEach(result => {
      if (result.errors.length > 0) {
        console.log(`\n❌ 在 ${path.relative(projectRoot, result.filePath)} 中发现错误:`);
        result.errors.forEach(err => {
          console.log(`  - 行 ${err.line}: ${err.domain} (${err.reason})`);
          errorCount++;
        });
      }
    });

    if (errorCount === 0) {
      console.log(picocolors.green('✅ 所有规则文件验证通过！'));
    } else {
      throw new Error(`发现 ${errorCount} 个规则错误`);
    }
  } finally {
    span.stop();
  }
}

// 如果直接运行脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  import('../trace/index.js').then(({ createSpan }) => {
    const rootSpan = createSpan('root');
    validateRules(rootSpan).catch(error => {
      console.error(picocolors.red('❌ 验证失败:'), error);
      process.exit(1);
    });
  });
}
