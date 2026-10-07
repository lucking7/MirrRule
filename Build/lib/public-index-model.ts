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
  dir: string,
  filename: string,
  /** encodeURI'd relative href */
  href: string,
}

export interface RuleEntry {
  name: string,
  formats: RuleFormat[],
}

interface RulePresentation {
  category: string,
  title: string,
  description: string,
  guidance: string,
  help?: {
    label: string,
    href: string,
  },
}

const RULE_PRESENTATIONS: Record<string, RulePresentation> = {
  apple: {
    category: 'Apple',
    title: '兼容合集',
    description: 'Apple 服务、中国大陆 CDN 与 iCloud Private Relay 的兼容合集。',
    guidance: '需要分别选择策略时，使用 Apple 拆分订阅；Apple Intelligence 单独订阅。',
  },
  apple_cdn: {
    category: 'Apple',
    title: '中国大陆 CDN',
    description: 'Apple 在中国大陆使用的 CDN 域名。',
    guidance: '大陆用户通常可直连；放在 Apple 服务和 Download 等合集之前。',
  },
  apple_cn: {
    category: 'Apple',
    title: '中国大陆服务',
    description: '云上贵州 iCloud、Apple 地图中国大陆服务等域名。',
    guidance: '通常可直连；放在 Apple 服务合集之前。',
  },
  apple_services: {
    category: 'Apple',
    title: '服务规则',
    description: 'Apple 服务规则，供用户与中国大陆 CDN、iCloud Private Relay 分别选择策略。',
    guidance: '放在 CDN 和中国大陆服务订阅之后；Loon 和 sing-box 不包含进程匹配。',
  },
  apple_services_ip: {
    category: 'Apple',
    title: '服务 IP',
    description: 'Apple 服务的 IP 地址段。',
    guidance: '放在所有域名订阅之后；按需选择 Apple 服务策略。',
  },
  icloud_private_relay: {
    category: 'Apple',
    title: 'iCloud Private Relay',
    description: 'iCloud Private Relay 域名，单独选择其连接策略。',
    guidance: '放在 Apple 合集之前；与 Apple Intelligence 分开订阅。',
  },
  apple_intelligence: {
    category: 'Apple',
    title: 'Apple Intelligence',
    description: 'Apple Intelligence 服务域名。',
    guidance: '按服务可用性选择策略；与 iCloud Private Relay 分开订阅。',
  },
  microsoft_cdn: {
    category: 'Microsoft',
    title: '中国大陆 CDN',
    description: 'Microsoft 在中国大陆使用的 CDN 和 HTTP 证书查询路径。',
    guidance: '大陆用户通常可直连；放在 Microsoft 和 Download 合集之前。Clash、sing-box 仅包含域名部分。',
  },
  reject_url_regex: {
    category: 'Reject',
    title: '可选 URL 拦截 · Surge only',
    description: 'URL 级广告与跟踪拦截，仅支持 Surge。HTTPS 匹配需要启用 MITM。',
    guidance: '启用并信任 Surge MITM 证书，再加载配套模块；需要 URL 拦截时才订阅。',
    help: {
      label: '配套 MITM 模块',
      href: '/Mirror/Sukka/sgmodule/sukka_mitm_hostnames.sgmodule',
    },
  },
};

/** Presentation does not change filenames or infer client availability. */
export function getRulePresentation(name: string): RulePresentation | undefined {
  return Object.hasOwn(RULE_PRESENTATIONS, name) ? RULE_PRESENTATIONS[name] : undefined;
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
