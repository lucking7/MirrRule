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
import { RETIRED_PLUGIN_ARTIFACTS } from './integration/plugin-converter/plugin-policy';

const INDEX_CSS = fs.readFileSync(path.join(__dirname, 'assets', 'ruleset-index.css'), 'utf8');
const HIDDEN_INDEX_FILES = new Set(['cname', 'favicon.ico', 'favicon.svg', 'favicon.png', 'robots.txt']);
const CLOSED_ROOT_FOLDERS = new Set(['Mock', 'Internal']);
const NESTED_FOLDER_PRIORITY = new Map([['domainset', 10], ['non_ip', 20], ['ip', 30]]);
const RETIRED_RULESET_ARTIFACTS = ['container', 'discord', 'scholar'].flatMap(id => [
  `List/${id}.list`,
  `Clash/${id}.txt`,
  `Loon/${id}.list`,
  `sing-box/${id}.json`,
]).concat('sing-box/china_asn.json');

export function isVisiblePublicFile(name: string): boolean {
  return !name.startsWith('.') && !name.startsWith('_') && !/\.html?$/i.test(name) && !HIDDEN_INDEX_FILES.has(name.toLowerCase());
}

function visibleTree(tree: TreeTypeArray): TreeTypeArray {
  const visible: TreeTypeArray = [];
  for (const entry of tree) {
    if (!isVisiblePublicFile(entry.name)) continue;
    visible.push(entry.type === TreeFileType.DIRECTORY
      ? { ...entry, children: visibleTree(entry.children) }
      : entry);
  }
  return visible;
}

export async function scanPublicTree(publicDir: string = PUBLIC_DIR): Promise<TreeTypeArray> {
  return visibleTree(await treeDir(publicDir));
}

export const buildPublic = task(
  require.main === module,
  __filename
)(async span => {
  await fsp.mkdir(PUBLIC_DIR, { recursive: true });
  await Promise.all(RETIRED_PLUGIN_ARTIFACTS.map(name =>
    fsp.rm(path.join(PUBLIC_DIR, 'Modules', 'Converted', name), { force: true })
  ));
  await Promise.all(RETIRED_RULESET_ARTIFACTS.map(relative =>
    fsp.rm(path.join(PUBLIC_DIR, relative), { force: true })
  ));
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
    .traceAsyncFn(() => scanPublicTree().then(tree => generateHtml(tree)));

  await Promise.all([
    compareAndWriteFile(
      span,
      [
        '/*',
        '  cache-control: public, max-age=240, stale-while-revalidate=60, stale-if-error=15',
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
export function treeHtml(tree: TreeTypeArray, level = 0): string {
  let result = '';
  const sortedTree = [...tree].sort(level === 0 ? prioritySorter : nestedFolderSorter);
  for (const entry of sortedTree) {
    if (!isVisiblePublicFile(entry.name)) continue;
    if (entry.type === TreeFileType.DIRECTORY) {
      const open = level === 0 && !CLOSED_ROOT_FOLDERS.has(entry.name) ? 'open' : '';
      result += html`
        <li class="folder">
          <details ${open}>
            <summary>${escapeHtml(entry.name)}</summary>
            <ul>${treeHtml(entry.children, level + 1)}</ul>
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
