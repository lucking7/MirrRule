/**
 * Script dependency audit for published Surge modules.
 *
 * Every build probes the scripts that published modules load through `script-path`. A script
 * counts as missing only on HTTP 404 or 410 (or, for NRRule-hosted scripts, when the file is
 * absent from the tree); network errors, 5xx and rate limits leave its count unchanged. After
 * `MISSING_THRESHOLD` consecutive missing results, the lines that load the script are removed
 * from modules in directories this run refreshed. A module under `Mirror/` whose script lines
 * are all removed is deleted. `Modules/` files are never deleted: the merge configuration
 * requires them, and that directory is not gated against stale edge-cache copies.
 *
 * Directories this run did not refresh are copied from the accepted baseline at publication, so
 * edits there would be discarded; they are audited and counted but left unchanged. The counts
 * are carried between builds in `Internal/module-dependency-audit.json` of the accepted tree.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { writeFileAtomic } from './atomic-file';
import { listTreeFiles } from './publication-manifest';

export const MODULE_DEPENDENCY_AUDIT_PATH = 'Internal/module-dependency-audit.json';
export const MISSING_THRESHOLD = 3;
const NRRULE_ORIGIN = 'https://nrrule.pages.dev/';
const AUDITED_DIRS = ['Mirror', 'Modules'] as const;
export type AuditedDir = typeof AUDITED_DIRS[number];
const MODULE_EXTENSIONS = new Set(['.sgmodule', '.module']);
const SCRIPT_PATH = /\bscript-path\s*=\s*([^,\s]+)/i;

type ProbeResult = { status: 'ok' | 'missing' | 'unknown', httpStatus: number | null };
export type Probe = (url: string) => Promise<ProbeResult>;

interface ScriptState {
  url: string,
  consecutiveMissing: number,
  lastStatus: ProbeResult['status'],
  httpStatus: number | null,
  modules: string[]
}

export interface ModuleDependencyReport {
  schemaVersion: 1,
  generatedAt: string,
  threshold: number,
  refreshedDirs: AuditedDir[],
  /** Scripts that were missing at least once and have not been seen available since. */
  scripts: ScriptState[],
  strippedLines: Array<{ module: string, url: string, lines: number }>,
  removedModules: string[]
}

/** Script URLs loaded by the [Script] section of a Surge module, in file order. */
export function moduleScriptUrls(content: string): string[] {
  const urls: string[] = [];
  let inScript = false;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      inScript = header[1].trim().toLowerCase() === 'script';
      continue;
    }
    if (!inScript || !line || /^(?:#|;|\/\/)/.test(line)) continue;
    const match = SCRIPT_PATH.exec(line);
    if (match) urls.push(match[1]);
  }
  return urls;
}

/** Remove [Script] lines loading any of `urls`; returns the new content and removed line counts. */
export function stripScriptLines(content: string, urls: ReadonlySet<string>): { content: string, removed: Map<string, number>, remaining: number } {
  const removed = new Map<string, number>();
  let remaining = 0;
  let inScript = false;
  const kept = content.split(/(?<=\n)/).filter(raw => {
    const line = raw.trim();
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      inScript = header[1].trim().toLowerCase() === 'script';
      return true;
    }
    if (!inScript || !line || /^(?:#|;|\/\/)/.test(line)) return true;
    const url = SCRIPT_PATH.exec(line)?.[1];
    if (url === undefined) return true;
    if (!urls.has(url)) {
      remaining++;
      return true;
    }
    removed.set(url, (removed.get(url) ?? 0) + 1);
    return false;
  });
  return { content: kept.join(''), removed, remaining };
}

/** HTTP probe: 404/410 is missing, 2xx is available, anything else (including errors) is unknown. */
export function createHttpProbe(fetchImpl: typeof fetch = fetch, attempts = 2): Probe {
  return async url => {
    let last: ProbeResult = { status: 'unknown', httpStatus: null };
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        // eslint-disable-next-line no-await-in-loop -- bounded retry of one URL
        const response = await fetchImpl(url, {
          headers: { Range: 'bytes=0-0', 'User-Agent': 'MirrRule-module-dependency-audit' },
          redirect: 'follow',
          signal: AbortSignal.timeout(20_000),
        });
        await response.body?.cancel();
        if (response.ok) return { status: 'ok', httpStatus: response.status };
        if (response.status === 404 || response.status === 410) return { status: 'missing', httpStatus: response.status };
        last = { status: 'unknown', httpStatus: response.status };
      } catch {
        last = { status: 'unknown', httpStatus: null };
      }
    }
    return last;
  };
}

function nrrulePath(url: string): string | null {
  if (!url.startsWith(NRRULE_ORIGIN)) return null;
  try {
    return decodeURIComponent(new URL(url).pathname.slice(1));
  } catch {
    return null;
  }
}

async function readPreviousStates(baselineDir: string | null): Promise<Map<string, ScriptState>> {
  if (!baselineDir) return new Map();
  try {
    const report = JSON.parse(await fs.readFile(path.join(baselineDir, MODULE_DEPENDENCY_AUDIT_PATH), 'utf8')) as Partial<ModuleDependencyReport>;
    const states = new Map<string, ScriptState>();
    for (const state of Array.isArray(report.scripts) ? report.scripts : []) {
      if (typeof state.url === 'string' && Number.isSafeInteger(state.consecutiveMissing)) states.set(state.url, state);
    }
    return states;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
    throw error;
  }
}

async function mapWithLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      // eslint-disable-next-line no-await-in-loop -- worker pool
      results[index] = await fn(items[index]);
    }
  }));
  return results;
}

export async function auditModuleDependencies(options: {
  publicDir: string,
  refreshedDirs: readonly AuditedDir[],
  baselineDir: string | null,
  probe?: Probe,
  generatedAt?: string,
  log?: (message: string) => void
}): Promise<ModuleDependencyReport> {
  const { publicDir, refreshedDirs } = options;
  const probe = options.probe ?? createHttpProbe();
  const tree = new Set(await listTreeFiles(publicDir).catch(() => [] as string[]));

  const modulesByUrl = new Map<string, Set<string>>();
  const contents = new Map<string, string>();
  for (const relative of tree) {
    const top = relative.split('/')[0];
    if (!(AUDITED_DIRS as readonly string[]).includes(top) || !MODULE_EXTENSIONS.has(path.extname(relative))) continue;
    // eslint-disable-next-line no-await-in-loop -- sequential read of module files
    const content = await fs.readFile(path.join(publicDir, relative), 'utf8');
    contents.set(relative, content);
    for (const url of moduleScriptUrls(content)) {
      const modules = modulesByUrl.get(url) ?? new Set<string>();
      modules.add(relative);
      modulesByUrl.set(url, modules);
    }
  }

  const previous = await readPreviousStates(options.baselineDir);
  // Previously missing scripts stay tracked after their lines were stripped, so a refreshed
  // upstream copy that still loads them is stripped again without restarting the count.
  const urls = [...new Set([...modulesByUrl.keys(), ...previous.keys()])].sort();
  const results = await mapWithLimit(urls, 16, async (url): Promise<ProbeResult> => {
    const local = nrrulePath(url);
    if (local !== null) return tree.has(local) ? { status: 'ok', httpStatus: null } : { status: 'missing', httpStatus: null };
    return probe(url);
  });

  const states: ScriptState[] = [];
  const confirmed = new Set<string>();
  for (const [index, url] of urls.entries()) {
    const result = results[index];
    const before = previous.get(url)?.consecutiveMissing ?? 0;
    const consecutiveMissing = result.status === 'missing' ? before + 1 : (result.status === 'ok' ? 0 : before);
    if (consecutiveMissing === 0) continue;
    states.push({ url, consecutiveMissing, lastStatus: result.status, httpStatus: result.httpStatus, modules: [...(modulesByUrl.get(url) ?? [])].sort() });
    if (consecutiveMissing >= MISSING_THRESHOLD) confirmed.add(url);
    if (result.status === 'missing') options.log?.(`missing ${consecutiveMissing}/${MISSING_THRESHOLD}: ${url}`);
  }

  const strippedLines: ModuleDependencyReport['strippedLines'] = [];
  const removedModules: string[] = [];
  if (confirmed.size) {
    for (const [relative, content] of contents) {
      const top = relative.split('/')[0] as AuditedDir;
      if (!refreshedDirs.includes(top)) continue;
      const result = stripScriptLines(content, confirmed);
      if (!result.removed.size) continue;
      for (const [url, lines] of result.removed) strippedLines.push({ module: relative, url, lines });
      if (top === 'Mirror' && result.remaining === 0) {
        // eslint-disable-next-line no-await-in-loop -- sequential edits keep the log ordered
        await fs.rm(path.join(publicDir, relative));
        removedModules.push(relative);
        options.log?.(`removed ${relative}: every script it loads is missing`);
      } else {
        // eslint-disable-next-line no-await-in-loop -- sequential edits keep the log ordered
        await writeFileAtomic(path.join(publicDir, relative), result.content);
        options.log?.(`stripped ${[...result.removed.values()].reduce((a, b) => a + b, 0)} script line(s) from ${relative}`);
      }
    }
  }

  const report: ModuleDependencyReport = {
    schemaVersion: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    threshold: MISSING_THRESHOLD,
    refreshedDirs: [...refreshedDirs].sort(),
    scripts: states,
    strippedLines,
    removedModules,
  };
  await writeFileAtomic(path.join(publicDir, MODULE_DEPENDENCY_AUDIT_PATH), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
