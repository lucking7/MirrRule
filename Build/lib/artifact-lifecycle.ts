import fs from 'node:fs/promises';
import path from 'node:path';

export type ArtifactLifecycleState = 'deprecated' | 'retired';

export interface ArtifactLifecycleRecord {
  /** Stable identity; never reuse an id for a different subscription. */
  id: string;
  state: ArtifactLifecycleState;
  /** Public paths relative to the publication root, using `/` separators. */
  paths: readonly string[];
  /** Upstream sources whose conversion is retired, compared after canonicalization. */
  canonicalSources?: readonly string[];
  reason: string;
  evidence: string;
  replacement?: string;
}

export const ARTIFACT_LIFECYCLE_VERSION = 1;

const PLATFORM_PATHS = (id: string) => [
  `List/${id}.list`,
  `Clash/${id}.txt`,
  `Loon/${id}.list`,
  `sing-box/${id}.json`,
];

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
    paths: PLATFORM_PATHS(id),
    reason: 'Standalone ruleset removed from rule sources',
    evidence: 'Build/lib/rule-sources.ts no longer configures this ruleset',
  })),
  {
    id: 'ruleset:china_asn:sing-box',
    state: 'retired',
    paths: ['sing-box/china_asn.json'],
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

function validateRegistry(registry: readonly ArtifactLifecycleRecord[]): void {
  const ids = new Set<string>();
  const paths = new Map<string, string>();
  for (const record of registry) {
    if (ids.has(record.id)) throw new Error(`Duplicate lifecycle id: ${record.id}`);
    ids.add(record.id);
    if (!record.reason.trim() || !record.evidence.trim()) throw new Error(`Lifecycle record needs reason and evidence: ${record.id}`);
    for (const raw of record.paths) {
      const normalized = normalizePublicPath(raw);
      const owner = paths.get(normalized);
      if (owner) throw new Error(`Lifecycle path ${normalized} registered by ${owner} and ${record.id}`);
      paths.set(normalized, record.id);
    }
  }
}

validateRegistry(ARTIFACT_LIFECYCLE_REGISTRY);

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

/** Remove registered retired files under a publication root; returns removed relative paths. */
export async function purgeRetiredArtifacts(
  publicRoot: string,
  registry: readonly ArtifactLifecycleRecord[] = ARTIFACT_LIFECYCLE_REGISTRY
): Promise<string[]> {
  const root = path.resolve(publicRoot);
  const removed: string[] = [];
  for (const relative of retiredPublicPaths(registry)) {
    const target = path.resolve(root, ...relative.split('/'));
    if (!target.startsWith(root + path.sep)) throw new Error(`Lifecycle path escapes the publication root: ${relative}`);
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

/** Fail when any registered retired file remains under a publication root. */
export async function assertNoRetiredArtifacts(
  publicRoot: string,
  registry: readonly ArtifactLifecycleRecord[] = ARTIFACT_LIFECYCLE_REGISTRY
): Promise<void> {
  const root = path.resolve(publicRoot);
  const present: string[] = [];
  for (const relative of retiredPublicPaths(registry)) {
    try {
      // eslint-disable-next-line no-await-in-loop -- deterministic report order
      await fs.access(path.resolve(root, ...relative.split('/')));
      present.push(relative);
    } catch {
      // absent is the expected state
    }
  }
  if (present.length) throw new Error(`Retired artifacts present in publication: ${present.join(', ')}`);
}
