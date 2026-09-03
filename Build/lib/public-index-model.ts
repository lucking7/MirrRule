import { fastStringCompare } from './misc';
import { TreeFileType } from './tree-dir';
import type { TreeType, TreeTypeArray } from './tree-dir';

/** Rule platform directory metadata is the single source for ordering and labels. */
export interface ClientDirectory {
  readonly dir: string,
  readonly client: string,
  readonly short: string
}

export const CLIENT_DIRS = [
  { dir: 'List', client: 'Surge', short: 'S' },
  { dir: 'Clash', client: 'Clash', short: 'C' },
  { dir: 'Loon', client: 'Loon', short: 'L' },
  { dir: 'sing-box', client: 'sing-box', short: 'X' },
] as const satisfies readonly ClientDirectory[];

const SKIP_INDEX_FILES = new Set([
  'README.md',
  'LICENSE',
  'CNAME',
  'favicon.ico',
  'favicon.svg',
  'robots.txt',
]);

export interface RuleFormat {
  client: string,
  short: string,
  dir: string,
  filename: string,
  /** encodeURI'd relative href */
  href: string,
}

export interface RuleEntry {
  name: string,
  formats: RuleFormat[],
}

export function shouldListFile(name: string): boolean {
  return !name.startsWith('_') && !name.endsWith('.html') && !SKIP_INDEX_FILES.has(name);
}

function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}

/** Aggregate client outputs into one rule entry per basename. */
export function collectRules(tree: TreeTypeArray): {
  rules: RuleEntry[],
  restRoots: TreeTypeArray,
} {
  const clientDirNames = new Set<string>(CLIENT_DIRS.map(client => client.dir));
  const byName = new Map<string, Map<string, RuleFormat>>();
  const restRoots: TreeTypeArray = [];

  for (const entry of tree) {
    if (entry.type !== TreeFileType.DIRECTORY || !clientDirNames.has(entry.name)) {
      restRoots.push(entry);
      continue;
    }
    const metadata = CLIENT_DIRS.find(client => client.dir === entry.name)!;
    for (const child of entry.children) {
      if (child.type !== TreeFileType.FILE || !shouldListFile(child.name)) {
        continue;
      }
      const ruleName = stripExtension(child.name);
      let formats = byName.get(ruleName);
      if (!formats) {
        formats = new Map();
        byName.set(ruleName, formats);
      }
      formats.set(metadata.dir, {
        client: metadata.client,
        short: metadata.short,
        dir: metadata.dir,
        filename: child.name,
        href: encodeURI(child.path),
      });
    }
  }

  const rules = [...byName.entries()]
    .map(([name, formatMap]) => {
      const formats: RuleFormat[] = [];
      for (const client of CLIENT_DIRS) {
        const format = formatMap.get(client.dir);
        if (format) formats.push(format);
      }
      return { name, formats };
    })
    .sort((left, right) => fastStringCompare(left.name, right.name));

  return { rules, restRoots };
}

/** Count files that are visible in the public artifact catalog. */
export function countListedFiles(entry: TreeType): number {
  if (entry.type === TreeFileType.FILE) {
    return shouldListFile(entry.name) ? 1 : 0;
  }
  let total = 0;
  for (const child of entry.children) {
    total += countListedFiles(child);
  }
  return total;
}
