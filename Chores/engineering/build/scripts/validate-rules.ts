import { glob } from 'glob';
import { readFile } from 'fs/promises';
import { parse } from 'tldts';

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
  'dev',
  'app',
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
  return ICANN_TLDS.has(tld);
}

async function validateFile(filePath: string): Promise<ValidationResult> {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  const errors: ValidationError[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#') || line.startsWith('//') || !line) continue;

    const parts = line.split(',');
    const domain = parts[0].includes('DOMAIN') ? parts[1] : parts[0];

    if (domain && !isValidTld(domain)) {
      errors.push({
        line: i + 1,
        domain,
        reason: '无效或非法的 TLD',
      });
    }
  }

  return { filePath, errors };
}

async function main() {
  const ruleFiles = await glob('Surge/Rulesets/**/*.list');
  const results = await Promise.all(ruleFiles.map(validateFile));

  results.forEach(result => {
    if (result.errors.length > 0) {
      console.log(`\n❌ 在 ${result.filePath} 中发现错误:`);
      result.errors.forEach(err => {
        console.log(`  - 行 ${err.line}: ${err.domain} (${err.reason})`);
      });
    }
  });
}

main().catch(console.error);
