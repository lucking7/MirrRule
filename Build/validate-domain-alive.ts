import path from 'node:path';
import fs from 'node:fs';
import picocolors from 'picocolors';
import { task } from './trace';
import { getMethods } from './utils/domain/is-domain-alive';
import { SOURCE_DIR } from './constants/dir';
import { getErrorMessage } from './lib/misc';

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

  const deadDomains: string[] = [];
  let checked = 0;

  for (const domain of domains) {
    checked++;
    if (checked % 50 === 0) {
      console.log(picocolors.gray(`[Domain Check] Progress: ${checked}/${domains.size}`));
    }

    try {
      // eslint-disable-next-line no-await-in-loop -- intentionally sequential
      const alive = await isDomainAlive(domain);
      if (!alive) {
        deadDomains.push(domain);
        console.log(picocolors.red(`[Domain Check] \u2717 Dead: ${domain}`));
      }
    } catch (error: unknown) {
      const msg = getErrorMessage(error);
      console.log(picocolors.yellow(`[Domain Check] ? Error checking ${domain}: ${msg}`));
    }
  }

  console.log(picocolors.cyan('\n[Domain Check] Summary:'));
  console.log(picocolors.green(`  \u2713 Alive: ${domains.size - deadDomains.length}`));
  console.log(picocolors.red(`  \u2717 Dead: ${deadDomains.length}`));

  if (deadDomains.length > 0) {
    console.log(picocolors.red('\n[Domain Check] Dead domains:'));
    for (const domain of deadDomains.sort()) {
      console.log(picocolors.red(`  - ${domain}`));
    }
    process.exitCode = 1;
  }
});
