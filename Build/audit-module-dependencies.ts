/**
 * Audit script dependencies of published modules and strip the lines that load scripts missing
 * for several consecutive builds. See Build/lib/module-dependency-audit.ts for the rules.
 *
 *   pnpm run node Build/audit-module-dependencies.ts --public public --refreshed Mirror,Modules
 *
 * --refreshed lists the directories this run rebuilt (may be empty); others are only counted.
 * The previous counts are read from PUBLICATION_BASELINE_DIR when it is set.
 */
import path from 'node:path';
import process from 'node:process';

import { auditModuleDependencies } from './lib/module-dependency-audit';
import type { AuditedDir } from './lib/module-dependency-audit';
import { getErrorMessage } from './lib/misc';

const REFRESHABLE = new Set<string>(['Mirror', 'Modules']);

export function parseArgs(argv: readonly string[]): { publicDir: string, refreshedDirs: AuditedDir[] } {
  let publicDir = 'public';
  let refreshed = '';
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index + 1];
    if (value !== undefined && argv[index] === '--public') publicDir = argv[++index];
    else if (value !== undefined && argv[index] === '--refreshed') refreshed = argv[++index];
    else throw new Error(`unknown or incomplete argument: ${argv[index]}`);
  }
  const refreshedDirs = refreshed.split(',').flatMap(dir => (dir.trim() ? [dir.trim()] : []));
  const unknown = refreshedDirs.filter(dir => !REFRESHABLE.has(dir));
  if (unknown.length) throw new Error(`--refreshed accepts Mirror and Modules, got ${unknown.join(', ')}`);
  return { publicDir, refreshedDirs: refreshedDirs as AuditedDir[] };
}

async function main() {
  const { publicDir, refreshedDirs } = parseArgs(process.argv.slice(2));
  const baselineDir = process.env.PUBLICATION_BASELINE_DIR?.trim() || null;
  if (baselineDir !== null && !path.isAbsolute(baselineDir)) throw new Error('PUBLICATION_BASELINE_DIR must be an absolute path');
  const report = await auditModuleDependencies({
    publicDir,
    refreshedDirs,
    baselineDir,
    log: message => console.log(`[module-dependencies] ${message}`),
  });
  const pending = report.scripts.filter(script => script.consecutiveMissing < report.threshold && script.lastStatus === 'missing');
  for (const script of pending) {
    console.log(`::warning::Module script missing (${script.consecutiveMissing}/${report.threshold}): ${script.url}`);
  }
  for (const item of report.strippedLines) {
    console.log(`::warning::Removed ${item.lines} line(s) loading a missing script from ${item.module}: ${item.url}`);
  }
  for (const module of report.removedModules) {
    console.log(`::warning::Removed ${module}: every script it loads is missing`);
  }
  console.log(`[module-dependencies] tracked ${report.scripts.length} missing script(s); stripped ${report.strippedLines.length} line group(s); removed ${report.removedModules.length} module(s); refreshed ${refreshedDirs.join(', ') || 'none'}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[module-dependencies] ${getErrorMessage(error)}`);
    process.exit(1);
  });
}
