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
import { RULESET_INDEX_SCRIPT } from './lib/ruleset-index-script';

const INDEX_CSS = fs.readFileSync(path.join(__dirname, 'assets', 'ruleset-index.css'), 'utf8');
const HIDDEN_INDEX_FILES = new Set(['cname', 'favicon.ico', 'favicon.svg', 'favicon.png', 'robots.txt']);
const CLOSED_ROOT_FOLDERS = new Set(['Mock', 'Internal']);
const NESTED_FOLDER_PRIORITY = new Map<string, number>([['domainset', 1], ['non_ip', 2], ['ip', 3]]);
const CLIENT_ROOTS = new Map<string, string>([
  ['List', 'Surge'],
  ['Loon', 'Loon'],
  ['Clash', 'Clash'],
  ['sing-box', 'sing-box'],
]);
const SLOT_LABELS = new Map<string, string>([
  ['domainset', 'Domain set'],
  ['non_ip', 'Non-IP'],
  ['ip', 'Destination IP'],
  ['merged', 'Merged'],
]);
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

const UTC_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const NUMBER_FORMAT = new Intl.NumberFormat('en-US');

// Official Tabler Icons (MIT, 24x24 grid, 1.5px stroke, currentColor).
const TABLER_SPRITE = `<svg class="sr-only" aria-hidden="true" focusable="false"><defs>
  <symbol id="ico-route" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 19a2 2 0 1 0 4 0a2 2 0 0 0-4 0M19 7a2 2 0 1 0 0-4a2 2 0 0 0 0 4m-8 12h5.5a3.5 3.5 0 0 0 0-7h-8a3.5 3.5 0 0 1 0-7H13"/></symbol>
  <symbol id="ico-github" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2c2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2a4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6c-.6.6-.6 1.2-.5 2V21"/></symbol>
  <symbol id="ico-folder" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2"/></symbol>
  <symbol id="ico-folder-open" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m5 19l2.757-7.351A1 1 0 0 1 8.693 11H21a1 1 0 0 1 .986 1.164l-.996 5.211A2 2 0 0 1 19.026 19za2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4l3 3h7a2 2 0 0 1 2 2v2"/></symbol>
  <symbol id="ico-layers" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 4L4 8l8 4l8-4zm-8 8l8 4l8-4M4 16l8 4l8-4"/></symbol>
  <symbol id="ico-file" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2M9 9h1m-1 4h6m-6 4h6"/></g></symbol>
  <symbol id="ico-file-json" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2"/><path d="m10 13l-1 2l1 2m4-4l1 2l-1 2"/></g></symbol>
  <symbol id="ico-file-db" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><path d="M4 6a8 3 0 1 0 16 0A8 3 0 1 0 4 6"/><path d="M4 6v6a8 3 0 0 0 16 0V6"/><path d="M4 12v6a8 3 0 0 0 16 0v-6"/></g></symbol>
  <symbol id="ico-search" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 10a7 7 0 1 0 14 0a7 7 0 1 0-14 0m18 11l-6-6"/></symbol>
  <symbol id="ico-chevron" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m9 6l6 6l-6 6"/></symbol>
  <symbol id="ico-copy" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><path d="M7 9.667A2.667 2.667 0 0 1 9.667 7h8.666A2.667 2.667 0 0 1 21 9.667v8.666A2.667 2.667 0 0 1 18.333 21H9.667A2.667 2.667 0 0 1 7 18.333z"/><path d="M4.012 16.737A2 2 0 0 1 3 15V5c0-1.1.9-2 2-2h10c.75 0 1.158.385 1.5 1"/></g></symbol>
  <symbol id="ico-check" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m5 12l5 5L20 7"/></symbol>
  <symbol id="ico-x" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M18 6L6 18M6 6l12 12"/></symbol>
</defs></svg>`;

function svgUse(symbolId: string, className = 'ico'): string {
  return `<svg class="${className}" aria-hidden="true" focusable="false"><use href="#${symbolId}"/></svg>`;
}

function fileIconId(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.json')) return 'ico-file-json';
  if (lower.endsWith('.mmdb') || lower.endsWith('.dat') || lower.endsWith('.gz')) return 'ico-file-db';
  return 'ico-file';
}

function folderIconHtml(): string {
  return `<span class="icon-swap folder-glyph" aria-hidden="true"><span class="icon-layer icon-closed">${svgUse('ico-folder')}</span><span class="icon-layer icon-open">${svgUse('ico-folder-open')}</span></span>`;
}

function formatUtcDisplay(date: Date): string {
  const month = UTC_MONTHS[date.getUTCMonth()];
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${month} ${day}, ${year} · ${hh}:${mm} UTC`;
}

function formatCount(count: number, singular: string, plural: string): string {
  return `${NUMBER_FORMAT.format(count)} ${count === 1 ? singular : plural}`;
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

function fileStem(name: string): string {
  const ext = path.posix.extname(name);
  return ext ? name.slice(0, -ext.length) : name;
}

function summarizeTree(tree: TreeTypeArray): { files: number, rulesets: number } {
  let files = 0;
  const rulesetIds = new Set<string>();

  function walk(nodes: TreeTypeArray, inClientRoot: boolean): void {
    for (const entry of nodes) {
      if (!isVisiblePublicFile(entry.name)) continue;
      if (entry.type === TreeFileType.DIRECTORY) {
        walk(entry.children, inClientRoot || CLIENT_ROOTS.has(entry.name));
      } else {
        files++;
        if (inClientRoot && /\.(?:list|conf|txt|json)$/i.test(entry.name)) {
          rulesetIds.add(fileStem(entry.name).toLowerCase());
        }
      }
    }
  }

  walk(tree, false);
  return { files, rulesets: rulesetIds.size };
}

function renderFileRow(
  entry: Extract<TreeType, { type: TreeFileType.FILE }>,
  context: { region: string, slot: string, format: string }
): string {
  const href = entry.path.split('/').map(segment => encodeURIComponent(segment)).join('/');
  const glyph = svgUse(fileIconId(entry.name), 'ico file-glyph');
  const slotLabel = SLOT_LABELS.get(context.slot) ?? '';
  const ruleStem = fileStem(entry.name);
  return `<li class="file" data-leaf data-region="${escapeHtml(context.region)}" data-slot="${escapeHtml(context.slot)}" data-slot-label="${escapeHtml(slotLabel)}" data-format="${escapeHtml(context.format)}" data-rule="${escapeHtml(ruleStem)}"><span class="file-main">${glyph}<a class="file-link" href="${escapeHtml(href)}">${escapeHtml(entry.name)}</a></span></li>`;
}

export function treeHtml(tree: TreeTypeArray, level = 0, parent = ''): string {
  let result = '';
  const sortedTree = [...tree].sort(level === 0 ? prioritySorter : nestedFolderSorter);
  const topSegment = parent.split('/')[0];
  const clientRegion = CLIENT_ROOTS.get(topSegment) ?? '';
  const isDirectClientRoot = level === 1 && CLIENT_ROOTS.has(parent);
  const mergedRows: string[] = [];

  for (const entry of sortedTree) {
    if (!isVisiblePublicFile(entry.name)) continue;
    if (entry.type === TreeFileType.DIRECTORY) {
      const open = level === 0 && !CLOSED_ROOT_FOLDERS.has(entry.name) ? ' open' : '';
      const entryDir = parent ? `${parent}/${entry.name}` : entry.name;
      const rootClass = level === 0 ? ' folder-root' : '';
      const format = level === 1 ? VARIANT_FORMAT_LABELS.get(entryDir) : undefined;
      const formatAttr = format ? ` title="${escapeHtml(format)}"` : '';
      result += `<li class="folder${rootClass}"><details data-branch data-folder="${escapeHtml(entryDir)}"${open}><summary${formatAttr}>${folderIconHtml()}<span class="folder-name">${escapeHtml(entry.name)}</span></summary><ul>${treeHtml(entry.children, level + 1, entryDir)}</ul></details></li>`;
    } else if (isDirectClientRoot) {
      const format = VARIANT_FORMAT_LABELS.get(`${parent}/non_ip`) ?? '';
      mergedRows.push(renderFileRow(entry, { region: clientRegion, slot: 'merged', format }));
    } else {
      const slot = level === 2 && clientRegion && SLOT_LABELS.has(path.posix.basename(parent))
        ? path.posix.basename(parent)
        : 'resource';
      const format = VARIANT_FORMAT_LABELS.get(parent) ?? '';
      result += renderFileRow(entry, { region: clientRegion, slot, format });
    }
  }

  if (mergedRows.length > 0) {
    const countText = formatCount(mergedRows.length, 'file', 'files');
    result += `<li class="collection"><details data-branch data-folder="merged:${escapeHtml(parent)}"><summary>${svgUse('ico-layers', 'ico layers-glyph')}<span class="collection-name">Merged files</span><span class="branch-pill" data-branch-count>${escapeHtml(countText)}</span>${svgUse('ico-chevron', 'ico chevron-glyph')}</summary><ul>${mergedRows.join('')}</ul></details></li>`;
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
  const builtIso = builtAt.toISOString();
  const builtDisplay = formatUtcDisplay(builtAt);
  const stats = summarizeTree(tree);
  const rulesetsLabel = formatCount(stats.rulesets, 'ruleset', 'rulesets');
  const filesLabel = formatCount(stats.files, 'file', 'files');
  const statsHtml = stats.rulesets > 0
    ? `<span class="meta-counts"><span class="meta-stat">${escapeHtml(rulesetsLabel)}</span><span class="meta-stat">${escapeHtml(filesLabel)}</span></span>`
    : `<span class="meta-counts"><span class="meta-stat">${escapeHtml(filesLabel)}</span></span>`;

  return html`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <title>NRRule · nrrule.pages.dev</title>
      <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
      <meta name="color-scheme" content="light dark">
      ${faviconHtml}
      <meta name="description" content="NRRule static proxy ruleset index for Surge, Clash, sing-box, and Loon.">
      <meta property="og:title" content="NRRule · nrrule.pages.dev">
      <meta property="og:type" content="website">
      <meta property="og:url" content="https://nrrule.pages.dev/">
      <meta property="og:description" content="NRRule static proxy ruleset index for Surge, Clash, sing-box, and Loon.">
      <meta name="twitter:card" content="summary">
      <link rel="canonical" href="https://nrrule.pages.dev/">
      <style>${INDEX_CSS}</style>
    </head>
    <body>
      ${TABLER_SPRITE}
      <a class="skip-link" href="#main-content">Skip to content</a>
      <main id="main-content" class="container" tabindex="-1">
        <header class="masthead">
          <div class="masthead-top">
            <div class="wordmark">
              <span class="wordmark-glyph" aria-hidden="true">${svgUse('ico-route', 'ico-route')}</span>
              <h1>NRRule</h1>
              <span class="wordmark-host">nrrule.pages.dev</span>
            </div>
            <a class="ghost-link" href="https://github.com/lucking7/MirrRule" aria-label="Source code on GitHub">
              ${svgUse('ico-github', 'ico-sm')}
              <span>GitHub</span>
            </a>
          </div>

          <div class="masthead-bar">
            <div class="masthead-meta">
              <span class="meta-fresh">
                <span class="fresh-dot" aria-hidden="true"></span>
                <span>Updated <time datetime="${builtIso}" title="${builtIso}">${escapeHtml(builtDisplay)}</time></span>
              </span>
              ${statsHtml}
            </div>

            <div id="tree-filter" class="search-cluster" hidden>
              <div class="search-field">
                <label class="sr-only" for="tree-query">Filter files</label>
                ${svgUse('ico-search', 'ico-sm search-ico')}
                <input id="tree-query" type="search" placeholder="apple_cdn, non_ip" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="search">
                <kbd class="key-hint" aria-hidden="true">/</kbd>
                <button id="tree-clear" class="clear-btn" type="button" aria-label="Clear filter">${svgUse('ico-x', 'ico-xs')}</button>
              </div>
              <span id="tree-status" role="status" aria-live="polite"></span>
            </div>
          </div>
        </header>

        <ul class="tree">
          ${treeHtml(tree)}
        </ul>

        <footer class="page-foot">
          <div class="foot-group">
            <span>Maintained by <a href="https://github.com/lucking7">Luck</a></span>
            <a href="/LICENSE" target="_blank">AGPL-3.0</a>
          </div>
          <div class="foot-group">
            <a href="https://github.com/lucking7/MirrRule">Source on GitHub</a>
            <a href="/README.md">README</a>
          </div>
        </footer>
      </main>
      <div id="copy-status" class="sr-only" role="status" aria-live="polite"></div>
      <script>${RULESET_INDEX_SCRIPT}</script>
    </body>
    </html>
  `;
}
