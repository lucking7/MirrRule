import type { RuleGroup, SpecialRuleConfig } from './rule-source-types';
import type { MirrorGroup } from '../integration/mirror-sync/sync-engine';

export type SourceRole = 'primary' | 'fallback' | 'special-source' | 'mirror-repository' | 'mirror-extra';

export interface SourceInventoryEntry {
  id: string,
  url: string,
  role: SourceRole
}

function add(entries: SourceInventoryEntry[], role: SourceRole, url: string): void {
  let identityUrl = url;
  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    for (const key of parsed.searchParams.keys()) {
      if (/token|key|secret|signature|credential|password|auth/i.test(key)) parsed.searchParams.set(key, '[REDACTED]');
    }
    identityUrl = parsed.toString();
  } catch {}
  entries.push({ id: `${role}:${identityUrl}`, role, url });
}

function isNetworkSource(source: string): boolean {
  return source.startsWith('https://') || source.startsWith('http://');
}

/** Enumerate configured network inputs without reading source files or performing I/O. */
export function createSourceInventory(
  ruleGroups: readonly RuleGroup[],
  specialRules: readonly SpecialRuleConfig[],
  mirrorGroups: readonly MirrorGroup[]
): SourceInventoryEntry[] {
  const entries: SourceInventoryEntry[] = [];

  for (const group of ruleGroups) {
    for (const file of group.files) {
      add(entries, 'primary', file.url);
      for (const fallback of file.fallbackUrls ?? []) add(entries, 'fallback', fallback);
    }
  }
  for (const rule of specialRules) {
    for (const source of rule.sourceFiles) {
      // Local files are build intermediates, not upstream network dependencies.
      if (isNetworkSource(source)) add(entries, 'special-source', source);
    }
  }
  for (const group of mirrorGroups) {
    for (const repository of group.repositories) {
      add(entries, 'mirror-repository', `https://api.github.com/repos/${repository.repo}/releases/latest`);
    }
    for (const download of group.extraDownloads ?? []) add(entries, 'mirror-extra', download.url);
  }

  return [...new Map(entries.map(entry => [entry.id, entry])).values()]
    .sort((a, b) => a.id.localeCompare(b.id));
}
