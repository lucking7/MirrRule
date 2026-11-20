import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { task } from './trace';
import { treeDir, TreeFileType } from './lib/tree-dir';
import type { TreeType, TreeTypeArray } from './lib/tree-dir';
import { PUBLIC_DIR, ROOT_DIR } from './constants/dir';
import { writeFile } from './lib/misc';
import { tagged as html } from 'foxts/tagged';
import { compareAndWriteFile } from './lib/create-file';
import { priorityOrder, prioritySorter } from './lib/public-index-sort.ts';
import { escapeHtml } from './utils/escape-html';
import { purgeRetiredArtifacts, writeLifecycleReport } from './lib/artifact-lifecycle';
import { writePagesInternalGate } from './lib/pages-internal-gate';
import { isNativeDomainsetPath, readPublishedDomainsetPaths } from './lib/publication-outputs';
import { PLATFORM_OUTPUT_LAYOUT, resolveRuleOutputTargets } from './lib/rule-output-variants';
import type { RuleOutputFormat } from './lib/rule-output-variants';
import type { SupportedPlatform } from './lib/platform-config';

const INDEX_CSS = fs.readFileSync(path.join(__dirname, 'assets', 'ruleset-index.css'), 'utf8');
const HIDDEN_INDEX_FILES = new Set(['cname', 'favicon.ico', 'favicon.svg', 'favicon.png', 'robots.txt']);
const CLOSED_ROOT_FOLDERS = new Set(['Mock', 'Internal']);
const NESTED_FOLDER_PRIORITY = new Map<string, number>([['domainset', 1], ['non_ip', 2], ['ip', 3]]);
const FORMAT_LABELS: Record<RuleOutputFormat, string> = {
  'surge-domainset': 'Surge DOMAIN-SET',
  'surge-classical': 'Surge RULE-SET',
  'clash-domain': 'Clash domain',
  'clash-classical': 'Clash classical',
  'loon-classical': 'Loon RULE-SET',
  'singbox-json-v2': 'sing-box rule-set JSON v2',
};
const VARIANT_FORMAT_LABELS = new Map<string, string>();
for (const platform of Object.keys(PLATFORM_OUTPUT_LAYOUT) as SupportedPlatform[]) {
  for (const target of resolveRuleOutputTargets(platform, 'example')) {
    if (target.slot !== 'merged') VARIANT_FORMAT_LABELS.set(path.posix.dirname(target.relativePath), FORMAT_LABELS[target.format]);
  }
}

export function isVisiblePublicFile(name: string): boolean {
  return !name.startsWith('.') && !name.startsWith('_') && !/\.html?$/i.test(name) && !HIDDEN_INDEX_FILES.has(name.toLowerCase());
}

function visibleTree(tree: TreeTypeArray, publishedDomainsets: ReadonlySet<string>): TreeTypeArray {
  const visible: TreeTypeArray = [];
  for (const entry of tree) {
    if (!isVisiblePublicFile(entry.name)) continue;
    const relative = entry.path.slice(1).split(path.sep).join('/');
    if (entry.type === TreeFileType.DIRECTORY) {
      const children = visibleTree(entry.children, publishedDomainsets);
      if (children.length || !isNativeDomainsetPath(relative)) visible.push({ ...entry, children });
    } else if (!isNativeDomainsetPath(relative) || publishedDomainsets.has(relative)) {
      visible.push(entry);
    }
  }
  return visible;
}

export async function scanPublicTree(publicDir: string = PUBLIC_DIR, publishedDomainsets?: ReadonlySet<string>): Promise<TreeTypeArray> {
  const [tree, verified] = await Promise.all([treeDir(publicDir), publishedDomainsets ?? readPublishedDomainsetPaths(publicDir)]);
  return visibleTree(tree, verified);
}

export const buildPublic = task(
  require.main === module,
  __filename
)(async span => {
  await fsp.mkdir(PUBLIC_DIR, { recursive: true });
  const removed = await purgeRetiredArtifacts(PUBLIC_DIR);
  if (removed.length) console.log(`Removed retired artifacts: ${removed.join(', ')}`);
  await writeLifecycleReport(PUBLIC_DIR, removed);
  const publishedDomainsets = await readPublishedDomainsetPaths(PUBLIC_DIR);
  await writePagesInternalGate(PUBLIC_DIR, publishedDomainsets);
  await span.traceChild('prepare public metadata').traceAsyncFn(() => Promise.all([
    fsp.copyFile(path.join(ROOT_DIR, 'LICENSE'), path.join(PUBLIC_DIR, 'LICENSE')),
    compareAndWriteFile(
      span,
      [
        '# NRRule - Surge / Clash / Loon / sing-box 规则部署仓库',
        '# 源码位于 [lucking7/MirrRule](https://github.com/lucking7/MirrRule)',
        '',
        '![GitHub repo size](https://img.shields.io/github/repo-size/lucking7/NRRule?style=flat-square)',
      ],
      path.join(PUBLIC_DIR, 'README.md')
    ),
  ]));

  // GeoIP serves binary mmdb payloads and retains its default content type.
  const rulesetHeaderDirs = Object.keys(priorityOrder).filter(name => name !== 'GeoIP');
  const pageHtml = await span
    .traceChild('generate index.html')
    .traceAsyncFn(() => scanPublicTree(PUBLIC_DIR, publishedDomainsets).then(tree => generateHtml(tree)));

  await Promise.all([
    compareAndWriteFile(
      span,
      [
        '/*',
        '  cache-control: public, max-age=0, must-revalidate',
        'https://:project.pages.dev/*',
        '  X-Robots-Tag: noindex',
        ...rulesetHeaderDirs.map(
          name => `/${name}/*\n  content-type: text/plain; charset=utf-8\n  X-Robots-Tag: noindex`
        ),
      ],
      path.join(PUBLIC_DIR, '_headers')
    ),
    compareAndWriteFile(
      span,
      [
        '# <pre>',
        '#########################################',
        '# Luck&#39;s Ruleset - 404 Not Found',
        '################## EOF ##################</pre>',
      ],
      path.join(PUBLIC_DIR, '404.html')
    ),
  ]);

  return writeFile(path.join(PUBLIC_DIR, 'index.html'), pageHtml);
});

function nestedFolderSorter(a: TreeType, b: TreeType): number {
  if (a.type === TreeFileType.DIRECTORY && b.type === TreeFileType.DIRECTORY) {
    const difference = (NESTED_FOLDER_PRIORITY.get(a.name) ?? Number.MAX_VALUE) - (NESTED_FOLDER_PRIORITY.get(b.name) ?? Number.MAX_VALUE);
    if (difference !== 0) return difference;
  }
  return prioritySorter(a, b);
}

/** Native directory markup follows SukkaW/Surge's AGPL-3.0 ruleset index. */
export function treeHtml(tree: TreeTypeArray, level = 0, parent = ''): string {
  let result = '';
  const sortedTree = [...tree].sort(level === 0 ? prioritySorter : nestedFolderSorter);
  for (const entry of sortedTree) {
    if (!isVisiblePublicFile(entry.name)) continue;
    if (entry.type === TreeFileType.DIRECTORY) {
      const open = level === 0 && !CLOSED_ROOT_FOLDERS.has(entry.name) ? 'open' : '';
      const format = level === 1 ? VARIANT_FORMAT_LABELS.get(`${parent}/${entry.name}`) : undefined;
      const summary = format ? `${entry.name} (${format})` : entry.name;
      result += html`
        <li class="folder">
          <details ${open}>
            <summary>${escapeHtml(summary)}</summary>
            <ul>${treeHtml(entry.children, level + 1, entry.name)}</ul>
          </details>
        </li>
      `;
    } else {
      const href = entry.path.split('/').map(segment => encodeURIComponent(segment)).join('/');
      result += html`
        <li class="file"><a class="file-link" href="${escapeHtml(href)}">${escapeHtml(entry.name)}</a></li>
      `;
    }
  }
  return result;
}

export function generateHtml(tree: TreeTypeArray, builtAt: Date = new Date()): string {
  const favicon = [
    { name: 'favicon.svg', type: 'image/svg+xml' },
    { name: 'favicon.ico', type: 'image/ico' },
    { name: 'favicon.png', type: 'image/png' },
  ].find(icon => fs.existsSync(path.join(PUBLIC_DIR, icon.name)));
  const faviconHtml = favicon ? html`<link href="/${favicon.name}" rel="icon" type="${favicon.type}">` : '';
  return html`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>NRRule Ruleset Server | Luck (@lucking7)</title>
        <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
        ${faviconHtml}
        <meta name="description" content="Luck 自用的 Surge / Clash / Loon / sing-box 规则组">
        <meta property="og:title" content="NRRule Ruleset Server | Luck (@lucking7)">
        <meta property="og:type" content="Website">
        <meta property="og:url" content="https://nrrule.pages.dev/">
        <meta property="og:description" content="Luck 自用的 Surge / Clash / Loon / sing-box 规则组">
        <meta name="twitter:card" content="summary">
        <link rel="canonical" href="https://nrrule.pages.dev/">
        <style>${INDEX_CSS}</style>
      </head>
      <body>
        <main class="container">
          <h1>NRRule Ruleset Server</h1>
          <p>
            Made by <a href="https://github.com/lucking7">Luck</a> | <a href="https://github.com/lucking7/MirrRule">Source @ GitHub</a> | Licensed under <a href="/LICENSE" target="_blank">AGPL-3.0</a>
          </p>
          <p>Last Build: ${builtAt.toISOString()}</p>
          <br>
          <ul class="tree">
            ${treeHtml(tree)}
          </ul>
        </main>
      </body>
    </html>
  `;
}
