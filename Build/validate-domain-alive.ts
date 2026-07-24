import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';
import picocolors from 'picocolors';
import { task } from './trace';
import { getMethods } from './utils/domain/is-domain-alive';
import { SOURCE_DIR } from './constants/dir';
import { getErrorMessage } from './lib/misc';

export interface DomainCheckResult {
  total: number,
  alive: string[],
  dead: string[],
  unknown: Array<{ domain: string, error: string }>
}

export async function checkDomains(
  domains: Iterable<string>,
  checker: (domain: string) => Promise<boolean | { alive: boolean }>
): Promise<DomainCheckResult> {
  const domainList = [...domains];
  const result: DomainCheckResult = { total: domainList.length, alive: [], dead: [], unknown: [] };
  for (const domain of domainList) {
    try {
      // eslint-disable-next-line no-await-in-loop -- intentionally sequential
      const checked = await checker(domain);
      if (typeof checked === 'boolean' ? checked : checked.alive) result.alive.push(domain);
      else result.dead.push(domain);
    } catch (error) {
      result.unknown.push({ domain, error: getErrorMessage(error) });
    }
  }
  return result;
}

export function domainCheckExitCode(result: DomainCheckResult): number {
  return result.dead.length > 0 || result.unknown.length > 0 ? 1 : 0;
}

export const validateDomainAlive = task(
  require.main === module,
  __filename
)(async () => {
  console.log(picocolors.cyan('[Domain Check] Starting domain availability validation...'));

  const { isDomainAlive } = await getMethods();

  const domains = new Set<string>();

  if (!fs.existsSync(SOURCE_DIR)) {
    console.error(picocolors.red(`[Domain Check] Source directory not found: ${SOURCE_DIR}`));
    process.exitCode = 1;
    return;
  }

  const files = fs.readdirSync(SOURCE_DIR, { recursive: true });
  const domainRegex = /['"]((?:[\da-z](?:[\da-z-]*[\da-z])?\.)+[a-z]{2,})['"]/gi;

  for (const file of files) {
    if (typeof file !== 'string') continue;
    const filePath = path.join(SOURCE_DIR, file);
    try {
      if (!fs.statSync(filePath).isFile()) continue;
    } catch {
      continue;
    }
    if (!filePath.endsWith('.ts') && !filePath.endsWith('.txt')) continue;

    const content = fs.readFileSync(filePath, 'utf-8');
    for (const match of content.matchAll(domainRegex)) {
      const domain = match[1];
      if (!domain || !domain.includes('.') || domain.startsWith('.')) continue;
      domains.add(domain);
    }
  }

  console.log(picocolors.gray(`[Domain Check] Found ${domains.size} unique domains to check`));

  if (domains.size === 0) {
    console.log(picocolors.yellow('[Domain Check] No domains found to validate'));
    return;
  }

  const result = await checkDomains(domains, isDomainAlive);

  console.log(picocolors.cyan('\n[Domain Check] Summary:'));
  console.log(picocolors.green(`  \u2713 Alive: ${result.alive.length}`));
  console.log(picocolors.red(`  \u2717 Dead: ${result.dead.length}`));
  console.log(picocolors.yellow(`  ? Unknown: ${result.unknown.length}`));

  if (result.dead.length > 0) {
    console.log(picocolors.red('\n[Domain Check] Dead domains:'));
    for (const domain of result.dead.sort()) {
      console.log(picocolors.red(`  - ${domain}`));
    }
  }
  if (result.unknown.length > 0) {
    console.log(picocolors.yellow('\n[Domain Check] Unknown domains:'));
    for (const { domain, error } of result.unknown.sort((a, b) => a.domain.localeCompare(b.domain))) {
      console.log(picocolors.yellow(`  - ${domain}: ${error}`));
    }
  }
  process.exitCode = domainCheckExitCode(result);
});
