import process from 'node:process';
import { dirname } from 'node:path';
import fs from 'node:fs';
import type { PathLike } from 'node:fs';
import fsp from 'node:fs/promises';
import { appendArrayInPlace } from 'foxts/append-array-in-place';
import { IPValidator } from '../utils/validation/validators';

export function fastStringCompare(a: string, b: string) {
  const lenA = a.length;
  const lenB = b.length;
  const minLen = lenA < lenB ? lenA : lenB;

  for (let i = 0; i < minLen; ++i) {
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(i);

    if (ca > cb) return 1;
    if (ca < cb) return -1;
  }

  if (lenA === lenB) {
    return 0;
  }

  return lenA > lenB ? 1 : -1;
};

interface Write {
  (
    destination: string,
    input: NodeJS.TypedArray | string,
  ): Promise<void>
}

export function mkdirp(dir: string) {
  if (fs.existsSync(dir)) {
    return;
  }
  return fsp.mkdir(dir, { recursive: true });
}

export const writeFile: Write = async (destination: string, input, dir = dirname(destination)): Promise<void> => {
  const p = mkdirp(dir);
  if (p) {
    await p;
  }
  return fsp.writeFile(destination, input, { encoding: 'utf-8' });
};

export function withBannerArray(title: string, description: string[] | readonly string[], date: Date, content: string[]) {
  const result: string[] = [
    '#########################################',
    `# ${title}`,
    `# Last Updated: ${date.toISOString()}`,
    `# Size: ${content.length}`
  ];

  appendArrayInPlace(result, description.map(line => (line ? `# ${line}` : '#')));

  result.push('#########################################');

  appendArrayInPlace(result, content);

  result.push('################## EOF ##################', '');

  return result;
};

export function withIdentityContent(title: string, description: string[] | readonly string[], date: Date, content: string[]) {
  return content;
};

export function isDirectoryEmptySync(path: PathLike) {
  const directoryHandle = fs.opendirSync(path);

  try {
    return directoryHandle.readSync() === null;
  } finally {
    directoryHandle.closeSync();
  }
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const STARTS_WITH_DIGIT = /^\d/;
const NUMERIC_LEADING_DOMAIN = /^(?=.{1,253}$)(?:[\da-z](?:[\da-z-]{0,61}[\da-z])?\.)+[a-z](?:[\da-z-]{0,61}[\da-z])?$/i;

const GEOSITE_PREFIXES: ReadonlyArray<{ prefix: string; type: string; strip?: string }> = [
  { prefix: '+.', type: 'DOMAIN-SUFFIX' },
  { prefix: 'full:', type: 'DOMAIN' },
  { prefix: 'domain:', type: 'DOMAIN-SUFFIX', strip: '+.' },
  { prefix: 'keyword:', type: 'DOMAIN-KEYWORD' },
];

/**
 * 简单规则格式转换（输入应已 trim）：
 * - `+.example.com` → `DOMAIN-SUFFIX,example.com`
 * - `full:example.com` → `DOMAIN,example.com`
 * - `domain:example.com` → `DOMAIN-SUFFIX,example.com`
 * - `keyword:example` → `DOMAIN-KEYWORD,example`
 * - `.example.com` → `DOMAIN-SUFFIX,example.com`
 * - `example.com`（纯域名，无逗号）→ `DOMAIN,example.com`
 * - `192.0.2.0/24` → `IP-CIDR,192.0.2.0/24`
 * - `2001:db8::/32` → `IP-CIDR6,2001:db8::/32`
 * - 其他规则原样返回
 */
export function smartConvertRule(rule: string): string {
  if (!rule) return rule;

  const comma = rule.indexOf(',');
  if (comma !== -1) {
    // Normalize only known QX types; downstream processing owns policies and options.
    const type = rule.slice(0, comma).trim().toLowerCase();
    switch (type) {
      case 'host': return 'DOMAIN' + rule.slice(comma);
      case 'host-suffix': return 'DOMAIN-SUFFIX' + rule.slice(comma);
      case 'host-keyword': return 'DOMAIN-KEYWORD' + rule.slice(comma);
      case 'ip-cidr': return 'IP-CIDR' + rule.slice(comma);
      case 'ip6-cidr': return 'IP-CIDR6' + rule.slice(comma);
      default: return rule;
    }
  }

  if (rule.includes('/')) {
    const ipType = IPValidator.getIpType(rule);
    if (ipType === 'ipv4') return `IP-CIDR,${rule}`;
    if (ipType === 'ipv6') return `IP-CIDR6,${rule}`;
  }

  for (const { prefix, type, strip } of GEOSITE_PREFIXES) {
    if (rule.startsWith(prefix)) {
      let value = rule.slice(prefix.length);
      if (strip && value.startsWith(strip)) value = value.slice(strip.length);
      if (value) return `${type},${value}`;
    }
  }

  if (rule.startsWith('.')) {
    const domain = rule.slice(1);
    if (domain) return `DOMAIN-SUFFIX,${domain}`;
  } else if (
    !rule.startsWith('#') &&
    !rule.startsWith('!') &&
    !rule.startsWith('//') &&
    !rule.startsWith(';') &&
    (!STARTS_WITH_DIGIT.test(rule) || NUMERIC_LEADING_DOMAIN.test(rule))
  ) {
    return `DOMAIN,${rule}`;
  }

  return rule;
}

export function registerGlobalErrorHandlers(): void {
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    process.exit(1);
  });
}
