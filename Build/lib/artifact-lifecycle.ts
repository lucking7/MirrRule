import fs from 'node:fs/promises';
import path from 'node:path';

import { writeFileAtomic } from './atomic-file';
import { extractScriptUrls } from '../integration/plugin-converter/script-extractor';

type ArtifactLifecycleState = 'deprecated' | 'retired';

export interface ArtifactLifecycleRecord {
  /** Stable identity; never reuse an id for a different subscription. */
  id: string,
  state: ArtifactLifecycleState,
  /** Public paths relative to the publication root, using `/` separators. */
  paths: readonly string[],
  /** Upstream sources whose conversion is retired, compared after canonicalization. */
  canonicalSources?: readonly string[],
  reason: string,
  evidence: string,
  replacement?: string
}

export const ARTIFACT_LIFECYCLE_VERSION = 2;

/** Public report location, relative to the publication root. */
export const ARTIFACT_LIFECYCLE_REPORT_PATH = 'Internal/artifact-lifecycle.json';

/** Top-level publication directories that lifecycle records may address. */
const LIFECYCLE_ROOTS = new Set(['List', 'Clash', 'Loon', 'sing-box', 'Modules', 'Scripts', 'Mirror', 'Mock']);
const SCRIPT_ROOT = 'Scripts';
const MODULE_SCAN_ROOTS = ['Modules', 'Mirror', SCRIPT_ROOT];
const MIRRORED_SCRIPT_PREFIX = '/Scripts/';

function platformPaths(id: string): string[] {
  return [
    ['List', 'list'], ['Clash', 'txt'], ['Loon', 'list'], ['sing-box', 'json'],
  ].flatMap(([root, extension]) => ['', 'domainset/', 'non_ip/', 'ip/'].map(variant => `${root}/${variant}${id}.${extension}`));
}

export const ARTIFACT_LIFECYCLE_REGISTRY: readonly ArtifactLifecycleRecord[] = [
  {
    id: 'plugin:tencent-video-remove-ads',
    state: 'retired',
    paths: ['Modules/Converted/腾讯视频去广告.sgmodule', 'Modules/Converted/Tencent_Video_remove_ads.sgmodule'],
    canonicalSources: ['https://kelee.one/Tool/Loon/Lpx/Tencent_Video_remove_ads.lpx'],
    reason: 'Upstream explicitly no longer maintains Tencent Video ad removal',
    evidence: 'Upstream plugin notice; README plugin conversion section',
  },
  ...(['container', 'discord', 'scholar'] as const).map((id): ArtifactLifecycleRecord => ({
    id: `ruleset:${id}`,
    state: 'retired',
    paths: platformPaths(id),
    reason: 'Standalone ruleset removed from rule sources',
    evidence: 'Build/lib/rule-sources.ts no longer configures this ruleset',
  })),
  {
    id: 'ruleset:china_asn:sing-box',
    state: 'retired',
    paths: platformPaths('china_asn').filter(relative => relative.startsWith('sing-box/')),
    reason: 'sing-box rule-set does not support IP-ASN; the artifact had no effective matchers',
    evidence: 'Build/core/output/rule-support-matrix.ts',
    replacement: 'sing-box/china_ip.json and sing-box/china_ip_ipv6.json (IP coverage is not equivalent to ASN matching)',
  },
];

/** Normalize a public relative path and reject absolute or traversing values. */
export function normalizePublicPath(relative: string): string {
  const posix = relative.replaceAll('\\', '/');
  if (!posix || posix.startsWith('/') || /^[a-z]:/i.test(posix)) {
    throw new Error(`Lifecycle path must be relative: ${relative}`);
  }
  const normalized = path.posix.normalize(posix);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.split('/').includes('..')) {
    throw new Error(`Lifecycle path escapes the publication root: ${relative}`);
  }
  return normalized;
}

/** Reject records that could address unregistered locations or collide with another identity. */
export function validateLifecycleRegistry(registry: readonly ArtifactLifecycleRecord[]): void {
  const ids = new Set<string>();
  const paths = new Map<string, string>();
  for (const record of registry) {
    if (ids.has(record.id)) throw new Error(`Duplicate lifecycle id: ${record.id}`);
    ids.add(record.id);
    if (!record.reason.trim() || !record.evidence.trim()) throw new Error(`Lifecycle record needs reason and evidence: ${record.id}`);
    if (!record.paths.length) throw new Error(`Lifecycle record needs at least one path: ${record.id}`);
    for (const raw of record.paths) {
      const normalized = normalizePublicPath(raw);
      const segments = normalized.split('/');
      if (segments.length < 2 || !LIFECYCLE_ROOTS.has(segments[0])) {
        throw new Error(`Lifecycle path is outside registered publication directories: ${raw}`);
      }
      const owner = paths.get(normalized);
      if (owner) throw new Error(`Lifecycle path ${normalized} registered by ${owner} and ${record.id}`);
      paths.set(normalized, record.id);
    }
    if (!record.canonicalSources) continue;
    for (const source of record.canonicalSources) {
      const url = new URL(source);
      if (url.hash || url.toString() !== source) throw new Error(`Lifecycle source is not canonical: ${source}`);
    }
  }
}

validateLifecycleRegistry(ARTIFACT_LIFECYCLE_REGISTRY);

export function retiredPublicPaths(registry: readonly ArtifactLifecycleRecord[] = ARTIFACT_LIFECYCLE_REGISTRY): string[] {
  return registry.filter(record => record.state === 'retired').flatMap(record => record.paths.map(normalizePublicPath));
}

export function findLifecycleRecord(
  relative: string,
  registry: readonly ArtifactLifecycleRecord[] = ARTIFACT_LIFECYCLE_REGISTRY
): ArtifactLifecycleRecord | undefined {
  const normalized = normalizePublicPath(relative);
  return registry.find(record => record.paths.some(candidate => normalizePublicPath(candidate) === normalized));
}

export function isRetiredPublicPath(relative: string, registry: readonly ArtifactLifecycleRecord[] = ARTIFACT_LIFECYCLE_REGISTRY): boolean {
  return findLifecycleRecord(relative, registry)?.state === 'retired';
}

/** Find the retired record owning a canonical upstream source URL. */
export function findRetiredSourceRecord(
  canonicalSource: string,
  registry: readonly ArtifactLifecycleRecord[] = ARTIFACT_LIFECYCLE_REGISTRY
): ArtifactLifecycleRecord | undefined {
  return registry.find(record => record.state === 'retired' && record.canonicalSources?.includes(canonicalSource));
}

function isInside(root: string, target: string): boolean {
  return target.startsWith(root + path.sep);
}

/** Resolve a lifecycle path inside the root, refusing symlinked ancestors that leave it. */
async function resolveInsideRoot(root: string, relative: string): Promise<string | undefined> {
  const normalized = normalizePublicPath(relative);
  const target = path.resolve(root, ...normalized.split('/'));
  if (!isInside(root, target)) throw new Error(`Lifecycle path escapes the publication root: ${relative}`);
  let parent: string;
  let realRoot: string;
  try {
    [parent, realRoot] = await Promise.all([fs.realpath(path.dirname(target)), fs.realpath(root)]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  if (parent !== realRoot && !isInside(realRoot, parent)) {
    throw new Error(`Lifecycle path resolves outside the publication root: ${relative}`);
  }
  return target;
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await fs.lstat(file)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function removeRegistered(root: string, relatives: readonly string[]): Promise<string[]> {
  const removed: string[] = [];
  for (const relative of relatives) {
    // eslint-disable-next-line no-await-in-loop -- report removals in registry order
    const target = await resolveInsideRoot(root, relative);
    if (!target) continue;
    try {
      // eslint-disable-next-line no-await-in-loop -- report removals in registry order
      await fs.rm(target);
      removed.push(relative);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return removed;
}

async function filesUnder(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const nested = await Promise.all(entries.map(async (entry): Promise<string[]> => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(file);
    return entry.isFile() ? [file] : [];
  }));
  return nested.flat();
}

interface MirroredScriptReference {
  relative: string,
  pathname: string
}

function mirroredScriptReferences(content: string): MirroredScriptReference[] {
  const references: MirroredScriptReference[] = [];
  for (const script of extractScriptUrls(content)) {
    if (!script.isMirrored) continue;
    try {
      const { pathname } = new URL(script.originalUrl);
      if (!pathname.startsWith(MIRRORED_SCRIPT_PREFIX)) continue;
      const relative = normalizePublicPath(`${SCRIPT_ROOT}/${decodeURIComponent(pathname.slice(MIRRORED_SCRIPT_PREFIX.length))}`);
      if (relative.split('/')[0] !== SCRIPT_ROOT) continue;
      references.push({ relative, pathname });
    } catch {
      // A malformed or traversing reference proves nothing and never authorizes deletion.
    }
  }
  return references;
}

/**
 * Scripts under `Scripts/` referenced by present retired files and not reachable, directly or
 * through other scripts, from any active file under Modules, Mirror or Scripts. Shared or
 * unproven scripts are never returned.
 */
export async function findRetiredExclusiveScripts(
  publicRoot: string,
  registry: readonly ArtifactLifecycleRecord[] = ARTIFACT_LIFECYCLE_REGISTRY
): Promise<string[]> {
  validateLifecycleRegistry(registry);
  const root = path.resolve(publicRoot);
  const retired = new Set(retiredPublicPaths(registry));
  const candidates = new Map<string, MirroredScriptReference>();
  for (const relative of retired) {
    if (relative.split('/')[0] === SCRIPT_ROOT) continue;
    // eslint-disable-next-line no-await-in-loop -- deterministic candidate order
    const target = await resolveInsideRoot(root, relative);
    // eslint-disable-next-line no-await-in-loop -- deterministic candidate order
    if (!target || !(await isFile(target))) continue;
    // eslint-disable-next-line no-await-in-loop -- deterministic candidate order
    for (const reference of mirroredScriptReferences(await fs.readFile(target, 'utf8'))) {
      if (retired.has(reference.relative) || findLifecycleRecord(reference.relative, registry)) continue;
      if (!candidates.has(reference.relative)) candidates.set(reference.relative, reference);
    }
  }
  if (!candidates.size) return [];

  // Every non-retired file outside the candidate set is a live root. Candidates reached from a
  // live file become live themselves and are scanned in turn, so the kept set is the transitive
  // closure of references from active files, independent of scan order.
  const files = new Map<string, string>();
  for (const file of (await Promise.all(MODULE_SCAN_ROOTS.map(directory => filesUnder(path.join(root, directory))))).flat()) {
    files.set(path.relative(root, file).split(path.sep).join('/'), file);
  }
  const pending = [...files.keys()].filter(relative => !retired.has(relative) && !candidates.has(relative));
  while (pending.length && candidates.size) {
    const relative = pending.pop()!;
    // eslint-disable-next-line no-await-in-loop -- worklist depends on each file's references
    const content = await fs.readFile(files.get(relative)!, 'utf8');
    const reached = new Set(mirroredScriptReferences(content).map(reference => reference.relative));
    for (const [relativeScript, reference] of candidates) {
      if (!reached.has(relativeScript) && !content.includes(reference.pathname) && !content.includes(`/${relativeScript}`)) continue;
      candidates.delete(relativeScript);
      if (files.has(relativeScript)) pending.push(relativeScript);
    }
  }
  if (!candidates.size) return [];

  const exclusive: string[] = [];
  for (const relative of candidates.keys()) {
    // eslint-disable-next-line no-await-in-loop -- deterministic result order
    const target = await resolveInsideRoot(root, relative);
    // eslint-disable-next-line no-await-in-loop -- deterministic result order
    if (target && await isFile(target)) exclusive.push(relative);
  }
  return exclusive;
}

/** Remove only scripts proven to belong exclusively to present retired files. */
export async function purgeOrphanedRetiredScripts(
  publicRoot: string,
  registry: readonly ArtifactLifecycleRecord[] = ARTIFACT_LIFECYCLE_REGISTRY
): Promise<string[]> {
  const root = path.resolve(publicRoot);
  return removeRegistered(root, await findRetiredExclusiveScripts(root, registry));
}

/**
 * Remove registered retired files under a publication root, plus scripts referenced exclusively
 * by those files; returns removed relative paths.
 */
export async function purgeRetiredArtifacts(
  publicRoot: string,
  registry: readonly ArtifactLifecycleRecord[] = ARTIFACT_LIFECYCLE_REGISTRY
): Promise<string[]> {
  const root = path.resolve(publicRoot);
  const exclusiveScripts = await findRetiredExclusiveScripts(root, registry);
  const removed = await removeRegistered(root, retiredPublicPaths(registry));
  removed.push(...await removeRegistered(root, exclusiveScripts));
  return removed;
}

/** Fail when any registered retired file remains under a publication root. */
export async function assertNoRetiredArtifacts(
  publicRoot: string,
  registry: readonly ArtifactLifecycleRecord[] = ARTIFACT_LIFECYCLE_REGISTRY
): Promise<void> {
  validateLifecycleRegistry(registry);
  const root = path.resolve(publicRoot);
  const present: string[] = [];
  for (const relative of retiredPublicPaths(registry)) {
    try {
      // eslint-disable-next-line no-await-in-loop -- deterministic report order
      await fs.lstat(path.resolve(root, ...relative.split('/')));
      present.push(relative);
    } catch {
      // absent is the expected state
    }
  }
  if (present.length) throw new Error(`Retired artifacts present in publication: ${present.join(', ')}`);
}

interface ArtifactLifecycleReportRecord {
  id: string,
  state: ArtifactLifecycleState,
  paths: string[],
  canonicalSources?: string[],
  reason: string,
  evidence: string,
  replacement?: string
}

export interface ArtifactLifecycleReport {
  version: number,
  /** Replacements are informational; no path is redirected to another subscription or format. */
  automaticRedirects: false,
  records: ArtifactLifecycleReportRecord[],
  /** Paths removed from the publication tree by the run that wrote this report. */
  removed: string[]
}

/** Public, machine-readable lifecycle report; deprecated records stay published, retired ones are removed. */
export function createLifecycleReport(
  removed: readonly string[],
  registry: readonly ArtifactLifecycleRecord[] = ARTIFACT_LIFECYCLE_REGISTRY
): ArtifactLifecycleReport {
  validateLifecycleRegistry(registry);
  return {
    version: ARTIFACT_LIFECYCLE_VERSION,
    automaticRedirects: false,
    records: registry.map(record => ({
      id: record.id,
      state: record.state,
      paths: record.paths.map(normalizePublicPath),
      ...(record.canonicalSources && record.canonicalSources.length > 0 && { canonicalSources: [...record.canonicalSources] }),
      reason: record.reason,
      evidence: record.evidence,
      ...(record.replacement && { replacement: record.replacement }),
    })),
    removed: removed.map(normalizePublicPath),
  };
}

/** Write the lifecycle report to `Internal/artifact-lifecycle.json`; returns the written path. */
export async function writeLifecycleReport(
  publicRoot: string,
  removed: readonly string[],
  registry: readonly ArtifactLifecycleRecord[] = ARTIFACT_LIFECYCLE_REGISTRY
): Promise<string> {
  const target = path.resolve(publicRoot, ...ARTIFACT_LIFECYCLE_REPORT_PATH.split('/'));
  await writeFileAtomic(target, `${JSON.stringify(createLifecycleReport(removed, registry), null, 2)}\n`);
  return target;
}
