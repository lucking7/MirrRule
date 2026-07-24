import path from 'node:path';

import { task } from './trace';
import { treeDir, TreeFileType } from './lib/tree-dir';
import type { TreeType, TreeTypeArray } from './lib/tree-dir';

import { PUBLIC_DIR } from './constants/dir';
import { writeFile } from './lib/misc';
import { tagged as html } from 'foxts/tagged';
import { compareAndWriteFile } from './lib/create-file';
import { priorityOrder, prioritySorter } from './lib/public-index-sort.ts';
import { escapeHtml } from './utils/escape-html';

/** Root folders open by default on first paint (Austere workbench keeps noise low). */
const openRootFolders = new Set(['List']);

/** Shortcut chips → search queries (personal high-frequency rulesets). */
const QUICK_SEARCHES = ['emby', 'reject', 'stream', 'github', 'geoip'] as const;

/** Site meta files — not ruleset payloads. */
const SKIP_INDEX_FILES = new Set([
  'README.md',
  'LICENSE',
  'CNAME',
  'favicon.ico',
  'favicon.svg',
  'robots.txt',
]);

function shouldListFile(name: string): boolean {
  return !name.startsWith('_') && !name.endsWith('.html') && !SKIP_INDEX_FILES.has(name);
}

export const buildPublic = task(
  require.main === module,
  __filename
)(async span => {
  await span.traceChildAsync('copy rest of the files', async () => {
    await Promise.all([]);
  });

  const pageHtml = await span
    .traceChild('generate index.html')
    .traceAsyncFn(() => treeDir(PUBLIC_DIR).then(generateHtml));

  await Promise.all([
    compareAndWriteFile(
      span,
      [
        '/*',
        '  cache-control: public, max-age=240, stale-while-revalidate=60, stale-if-error=15',
        'https://:project.pages.dev/*',
        '  X-Robots-Tag: noindex',
        ...Object.keys(priorityOrder).map(
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
    compareAndWriteFile(
      span,
      [
        '# NRRule - Surge / Clash 规则部署仓库',
        '# 源码位于 [lucking7/MirrRule](https://github.com/lucking7/MirrRule)',
        '',
        '![GitHub repo size](https://img.shields.io/github/repo-size/lucking7/NRRule?style=flat-square)',
      ],
      path.join(PUBLIC_DIR, 'README.md')
    ),
  ]);

  return writeFile(path.join(PUBLIC_DIR, 'index.html'), pageHtml);
});

function buildTimestampGmt8(): string {
  const now = new Date();
  const offsetMinutes = 8 * 60;
  const msPerMinute = 60 * 1000;
  const gmtPlus8 = new Date(
    now.getTime() + (offsetMinutes - now.getTimezoneOffset()) * msPerMinute
  );
  return gmtPlus8.toISOString().replace('Z', '+08:00');
}

function rootFolderNames(tree: TreeTypeArray): string[] {
  return tree
    .filter(entry => entry.type === TreeFileType.DIRECTORY)
    .sort(prioritySorter)
    .map(entry => entry.name);
}

function platformChipsHtml(roots: string[]): string {
  const chips = [
    html`<button type="button" class="chip is-on" data-platform="all" aria-pressed="true">All</button>`,
    ...roots.map(
      name =>
        html`<button type="button" class="chip" data-platform="${name}" aria-pressed="false">${name}</button>`
    ),
  ];
  return chips.join('\n');
}

function quickChipsHtml(): string {
  return QUICK_SEARCHES.map(
    q => html`<button type="button" class="quick-chip" data-query="${q}">${q}</button>`
  ).join('\n');
}

/** Count files that will appear in the index under a tree node. */
function countListedFiles(entry: TreeType): number {
  if (entry.type === TreeFileType.FILE) {
    return shouldListFile(entry.name) ? 1 : 0;
  }
  let total = 0;
  for (const child of entry.children) {
    total += countListedFiles(child);
  }
  return total;
}

/**
 * Render directory tree with depth / path context so nested folders
 * (e.g. Mirror/…/sgmodule) stay readable instead of bare leaf names.
 */
export function treeHtml(
  tree: TreeTypeArray,
  level = 0,
  parentPath = '',
  rootName = ''
): string {
  let result = '';
  tree.sort(prioritySorter);

  for (let i = 0, len = tree.length; i < len; i++) {
    const entry = tree[i];

    if (entry.type === TreeFileType.DIRECTORY) {
      const isOpenRoot = level === 0 && openRootFolders.has(entry.name);
      const openAttr = isOpenRoot ? 'open' : '';
      const folderPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
      const currentRoot = level === 0 ? entry.name : rootName;
      const fileCount = countListedFiles(entry);
      const children = treeHtml(entry.children, level + 1, folderPath, currentRoot);
      const escapedName = escapeHtml(entry.name);
      const nameAttr = escapeHtml(entry.name.toLowerCase());
      const pathAttr = escapeHtml(folderPath);
      // depth 1 sits under a visible root (Modules → Converted): no trail.
      // depth ≥ 2 needs path context (Mirror / DualSubs / sgmodule).
      const trailHtml =
        level >= 2 && parentPath
          ? html`<span class="folder-trail">${escapeHtml(parentPath.split('/').join(' / '))}</span>`
          : '';
      const countLabel = fileCount === 1 ? '1 file' : `${fileCount} files`;
      let depthClass = 'is-branch';
      if (level === 0) depthClass = 'is-root';
      else if (level === 1) depthClass = 'is-section';
      const summaryInner = html`
        <summary class="folder-summary ${depthClass}" style="--depth: ${String(level)}">
          <span class="folder-summary-main">
            ${trailHtml}
            <span class="folder-name">${escapedName}</span>
          </span>
          <span class="folder-count" title="${countLabel}">${String(fileCount)}</span>
        </summary>
      `;

      if (level === 0) {
        result += html`
          <li
            class="folder"
            data-name="${nameAttr}"
            data-path="${pathAttr}"
            data-depth="${String(level)}"
            data-count="${String(fileCount)}"
            data-root="${escapeHtml(entry.name)}"
            style="--depth: ${String(level)}"
          >
            <details ${openAttr}>
              ${summaryInner}
              <ul>
                ${children}
              </ul>
            </details>
          </li>
        `;
      } else {
        result += html`
          <li
            class="folder"
            data-name="${nameAttr}"
            data-path="${pathAttr}"
            data-depth="${String(level)}"
            data-count="${String(fileCount)}"
            style="--depth: ${String(level)}"
          >
            <details>
              ${summaryInner}
              <ul>
                ${children}
              </ul>
            </details>
          </li>
        `;
      }
    } else if (shouldListFile(entry.name)) {
      const encodedPath = encodeURI(entry.path);
      const pathAttr = escapeHtml(encodedPath);
      const escapedName = escapeHtml(entry.name);
      const platformRoot = rootName || '';
      result += html`
        <li
          class="file"
          data-name="${escapeHtml(entry.name.toLowerCase())}"
          data-path="${pathAttr}"
          data-platform-root="${escapeHtml(platformRoot)}"
        >
          <div class="file-row">
            <span class="file-main">
              ${platformRoot
                ? html`<span class="root-badge" data-root-badge>${escapeHtml(platformRoot)}</span>`
                : ''}
              <a class="file-link" href="${pathAttr}" target="_blank" rel="noopener noreferrer"
                >${escapedName}</a
              >
            </span>
            <button
              type="button"
              class="copy-btn"
              data-path="${pathAttr}"
              aria-label="Copy URL for ${escapeHtml(entry.name)}"
            >
              Copy URL
            </button>
          </div>
        </li>
      `;
    }
  }
  return result;
}

/**
 * Hallmark · macrostructure: Workbench · tone: austere · genre: editorial
 * audience: self · use: copy ruleset URL · theme: custom austere (warm paper)
 * nav: N1a minimal · footer: Ft4 dense colophon · enrichment: none
 */
function generateHtml(tree: TreeTypeArray) {
  const roots = rootFolderNames(tree);
  const builtAt = buildTimestampGmt8();

  return html`
    <!DOCTYPE html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8" />
        <title>NRRule · personal rules index</title>
        <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
        <link href="/favicon.svg" rel="icon" type="image/svg+xml" />
        <meta name="description" content="Luck 自用的 Surge / Clash / Loon 规则镜像与索引" />
        <meta property="og:title" content="NRRule · personal rules index" />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://github.com/lucking7/MirrRule" />
        <meta property="og:description" content="Luck 自用的 Surge / Clash / Loon 规则镜像与索引" />
        <meta name="twitter:card" content="summary" />
        <link rel="canonical" href="https://github.com/lucking7/NRRule" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <style>
          /* Impeccable · typeset · Workbench / Austere
           * font system: IBM Plex only — Sans (UI) + Mono (paths / data)
           * paper: oklch(96% 0.01 85) · accent: oklch(42% 0.09 45)
           */
          :root {
            --color-paper: oklch(96% 0.01 85);
            --color-surface: oklch(98.5% 0.008 85);
            --color-ink: oklch(22% 0.02 60);
            --color-muted: oklch(48% 0.02 60);
            --color-line: oklch(86% 0.015 85);
            --color-accent: oklch(42% 0.09 45);
            --color-hot: oklch(93% 0.015 85);
            --color-focus: oklch(42% 0.09 45 / 0.28);
            /* Single family: Plex Sans for UI, Plex Mono for paths / data only */
            --font-ui: 'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif;
            --font-mono: 'IBM Plex Mono', ui-monospace, 'Menlo', 'Consolas', monospace;
            --text-base: 1rem;
            --text-sm: 0.875rem;
            --text-xs: 0.75rem;
            --text-lg: 1.125rem;
            --text-xl: 1.375rem;
            --space-1: 0.25rem;
            --space-2: 0.5rem;
            --space-3: 0.75rem;
            --space-4: 1rem;
            --space-5: 1.25rem;
            --space-6: 1.5rem;
            --space-8: 2rem;
            --space-10: 2.5rem;
            --space-12: 3rem;
            --radius: 2px;
            --measure: 44rem;
            --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
            --dur-short: 140ms;
            color-scheme: light;
          }

          @media (prefers-color-scheme: dark) {
            :root {
              --color-paper: oklch(18% 0.015 60);
              --color-surface: oklch(21% 0.015 60);
              --color-ink: oklch(92% 0.015 85);
              --color-muted: oklch(68% 0.02 70);
              --color-line: oklch(32% 0.015 60);
              --color-accent: oklch(72% 0.08 55);
              --color-hot: oklch(26% 0.02 60);
              --color-focus: oklch(72% 0.08 55 / 0.28);
              color-scheme: dark;
            }
          }

          *,
          *::before,
          *::after {
            box-sizing: border-box;
          }

          html,
          body {
            margin: 0;
            padding: 0;
            background: var(--color-paper);
            color: var(--color-ink);
            font-family: var(--font-ui);
            font-size: var(--text-base);
            line-height: 1.5;
            overflow-x: clip;
            font-synthesis: none;
            text-rendering: optimizeLegibility;
          }

          a {
            color: var(--color-accent);
            text-decoration: none;
          }

          a:hover {
            text-decoration: underline;
            text-underline-offset: 0.12em;
          }

          a:focus-visible,
          button:focus-visible,
          input:focus-visible,
          summary:focus-visible {
            outline: 2px solid var(--color-accent);
            outline-offset: 2px;
          }

          button {
            font: inherit;
            color: inherit;
            background: transparent;
            cursor: pointer;
          }

          kbd {
            font-family: var(--font-mono);
            font-size: 10px;
            padding: 0.1rem 0.35rem;
            border: 1px solid var(--color-line);
            border-radius: var(--radius);
            color: var(--color-muted);
          }

          .shell {
            width: min(100% - 2 * var(--space-4), 52rem);
            margin: 0 auto;
            padding: var(--space-8) 0 var(--space-12);
            display: grid;
            gap: var(--space-5);
          }

          @media (min-width: 768px) {
            .shell {
              width: min(100% - 2 * var(--space-8), 52rem);
              padding-top: var(--space-10);
            }
          }

          .top {
            display: flex;
            flex-wrap: wrap;
            align-items: baseline;
            justify-content: space-between;
            gap: var(--space-3) var(--space-4);
            padding-bottom: var(--space-4);
            border-bottom: 1px solid var(--color-line);
          }

          .brand {
            display: flex;
            flex-wrap: wrap;
            align-items: baseline;
            gap: var(--space-2) var(--space-3);
            min-width: 0;
          }

          .brand h1 {
            margin: 0;
            font-family: var(--font-ui);
            font-size: var(--text-xl);
            font-weight: 600;
            font-style: normal;
            letter-spacing: -0.02em;
            line-height: 1.2;
            color: var(--color-ink);
          }

          .brand .tag {
            font-family: var(--font-mono);
            font-size: var(--text-xs);
            color: var(--color-muted);
            white-space: nowrap;
          }

          .meta-links {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-2) var(--space-3);
            font-family: var(--font-mono);
            font-size: var(--text-xs);
            color: var(--color-muted);
          }

          .meta-links a {
            color: var(--color-muted);
          }

          .meta-links a:hover {
            color: var(--color-ink);
          }

          .lede {
            margin: 0;
            max-width: var(--measure);
            font-size: var(--text-sm);
            color: var(--color-muted);
          }

          .build-line {
            margin: 0;
            font-family: var(--font-mono);
            font-size: var(--text-xs);
            color: var(--color-muted);
          }

          .platforms {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-2);
          }

          .chip {
            font-family: var(--font-mono);
            font-size: var(--text-xs);
            min-height: 2rem;
            padding: 0.4rem 0.7rem;
            border: 1px solid var(--color-line);
            border-radius: var(--radius);
            color: var(--color-muted);
            transition:
              background-color var(--dur-short) var(--ease-out),
              color var(--dur-short) var(--ease-out),
              border-color var(--dur-short) var(--ease-out);
          }

          .chip:hover {
            border-color: var(--color-muted);
            color: var(--color-ink);
          }

          .chip.is-on {
            background: var(--color-ink);
            border-color: var(--color-ink);
            color: var(--color-paper);
          }

          .cmd-wrap {
            display: grid;
            gap: var(--space-2);
          }

          .cmd {
            display: flex;
            align-items: center;
            gap: var(--space-3);
            padding: 0.65rem 0.75rem;
            background: var(--color-surface);
            border: 1px solid var(--color-line);
            border-radius: var(--radius);
          }

          .cmd:focus-within {
            border-color: var(--color-accent);
            box-shadow: 0 0 0 3px var(--color-focus);
          }

          .cmd .prompt {
            font-family: var(--font-mono);
            font-size: var(--text-xs);
            color: var(--color-muted);
            user-select: none;
          }

          .cmd input {
            flex: 1;
            min-width: 0;
            border: 0;
            background: transparent;
            color: var(--color-ink);
            font-family: var(--font-mono);
            font-size: var(--text-sm);
            outline: none;
            padding: 0;
          }

          .cmd input::placeholder {
            color: var(--color-muted);
            opacity: 0.8;
          }

          .cmd .cmd-actions {
            display: flex;
            align-items: center;
            gap: var(--space-2);
          }

          .cmd .clear-btn {
            display: none;
            font-family: var(--font-mono);
            font-size: var(--text-xs);
            color: var(--color-muted);
            border: 1px solid var(--color-line);
            border-radius: var(--radius);
            padding: 0.15rem 0.4rem;
          }

          .cmd .clear-btn.is-visible {
            display: inline-flex;
          }

          .cmd .clear-btn:hover {
            color: var(--color-ink);
            border-color: var(--color-muted);
          }

          .quick {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-2);
          }

          .quick-chip {
            font-family: var(--font-mono);
            font-size: var(--text-xs);
            min-height: 2rem;
            padding: 0.35rem 0.65rem;
            border: 1px solid var(--color-line);
            border-radius: var(--radius);
            color: var(--color-muted);
            transition:
              color var(--dur-short) var(--ease-out),
              border-color var(--dur-short) var(--ease-out),
              background-color var(--dur-short) var(--ease-out);
          }

          .quick-chip:hover,
          .quick-chip.is-hot {
            color: var(--color-accent);
            border-color: var(--color-accent);
          }

          .result-count {
            min-height: 1.2em;
            margin: 0;
            font-family: var(--font-mono);
            font-size: var(--text-xs);
            color: var(--color-muted);
          }

          .controls {
            position: sticky;
            top: 0;
            z-index: 4;
            display: grid;
            gap: var(--space-3);
            padding: var(--space-2) 0 var(--space-3);
            background: var(--color-paper);
            border-bottom: 1px solid transparent;
          }

          .controls.is-stuck {
            border-bottom-color: var(--color-line);
          }

          .tree-toolbar {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-2);
          }

          .tree-toolbar .collapse-btn {
            font-family: var(--font-mono);
            font-size: var(--text-xs);
            min-height: 2rem;
            padding: 0.35rem 0.65rem;
            border: 1px solid var(--color-line);
            border-radius: var(--radius);
            color: var(--color-muted);
          }

          .tree-toolbar .collapse-btn:hover {
            color: var(--color-ink);
            border-color: var(--color-muted);
          }

          .tree-panel {
            border: 1px solid var(--color-line);
            border-radius: var(--radius);
            background: var(--color-surface);
            overflow: hidden;
          }

          .tree,
          .tree ul {
            list-style: none;
            margin: 0;
            padding: 0;
          }

          .folder-summary {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-3);
            /* Depth-aware inset: root 0.85rem, then +0.9rem per level */
            padding: 0.55rem 0.85rem;
            padding-left: calc(0.85rem + (var(--depth, 0) * 0.9rem));
            border-bottom: 1px solid var(--color-line);
            cursor: pointer;
            list-style: none;
            font-family: var(--font-mono);
            color: var(--color-ink);
            background: transparent;
          }

          .tree summary::-webkit-details-marker {
            display: none;
          }

          .folder-summary::before {
            content: '▸';
            flex: 0 0 auto;
            display: inline-block;
            width: 1em;
            margin-right: 0.35rem;
            color: var(--color-muted);
            transition: transform var(--dur-short) var(--ease-out);
          }

          .tree details[open] > .folder-summary::before {
            transform: rotate(90deg);
          }

          /* Root section header (List, Modules, Mirror…) */
          .folder-summary.is-root {
            font-size: var(--text-xs);
            font-weight: 600;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: var(--color-muted);
            background: var(--color-surface);
            min-height: 2.5rem;
          }

          .folder-summary.is-root .folder-name {
            color: var(--color-muted);
          }

          /*
           * Level-1 sections under a root (Modules → Converted / Merged / Rules).
           * These are the weird "bare name" rows — treat as clear subsections,
           * not as anonymous file-like summaries.
           */
          .folder-summary.is-section {
            font-size: 0.875rem;
            font-weight: 600;
            letter-spacing: 0;
            text-transform: none;
            color: var(--color-ink);
            min-height: 2.4rem;
            background: color-mix(in oklch, var(--color-paper) 55%, var(--color-surface));
            border-bottom: 1px solid var(--color-line);
          }

          .folder-summary.is-section:hover {
            background: var(--color-hot);
          }

          .folder-summary.is-section .folder-name {
            color: var(--color-ink);
          }

          .folder-summary.is-section .folder-count {
            border: 1px solid var(--color-line);
            border-radius: var(--radius);
            padding: 0.12rem 0.4rem;
            background: var(--color-surface);
          }

          /* Deeper branches (Mirror / DualSubs / sgmodule) */
          .folder-summary.is-branch {
            font-size: 0.8125rem;
            font-weight: 500;
            letter-spacing: 0;
            text-transform: none;
            color: var(--color-ink);
            min-height: 2.25rem;
          }

          .folder-summary.is-branch:hover {
            background: var(--color-hot);
          }

          .folder-summary-main {
            display: flex;
            flex-wrap: wrap;
            align-items: baseline;
            gap: 0.35rem 0.5rem;
            min-width: 0;
          }

          .folder-trail {
            color: var(--color-muted);
            font-weight: 400;
            font-size: 0.75rem;
          }

          .folder-trail::after {
            content: '/';
            margin-left: 0.35rem;
            opacity: 0.7;
          }

          .folder-name {
            font-weight: 600;
            color: var(--color-ink);
          }

          .folder-count {
            flex: 0 0 auto;
            font-size: 0.6875rem;
            font-weight: 500;
            color: var(--color-muted);
            font-variant-numeric: tabular-nums;
          }

          .tree .folder ul {
            padding: 0;
          }

          .tree .folder .folder > details > ul {
            border-left: 1px solid var(--color-line);
            margin-left: calc(0.85rem + (var(--depth, 1) * 0.45rem));
          }

          /* When a platform chip isolates one root, open it as the workspace */
          body[data-platform]:not([data-platform='all'])
            .folder[data-root]:not(.is-hidden)
            > details
            > .folder-summary.is-root {
            background: var(--color-hot);
            color: var(--color-ink);
          }

          body[data-platform]:not([data-platform='all'])
            .folder[data-root]:not(.is-hidden)
            > details
            > .folder-summary.is-root
            .folder-name {
            color: var(--color-ink);
          }

          .file-row {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: var(--space-3);
            align-items: center;
            min-height: 2.5rem;
            padding: 0.35rem 0.85rem;
            border-top: 1px solid var(--color-line);
          }

          .folder[data-depth] .file .file-row {
            padding-left: calc(0.85rem + ((var(--depth, 0) + 1) * 0.9rem));
          }

          .tree > .folder > details > ul > .file:first-child .file-row,
          .tree .folder .folder > details > ul > .file:first-child .file-row {
            border-top: 0;
          }

          .file-row:hover {
            background: var(--color-hot);
          }

          .file-main {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            min-width: 0;
          }

          .root-badge {
            flex: 0 0 auto;
            font-family: var(--font-mono);
            font-size: 0.625rem;
            font-weight: 600;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            color: var(--color-muted);
            border: 1px solid var(--color-line);
            border-radius: var(--radius);
            padding: 0.1rem 0.35rem;
          }

          body[data-platform]:not([data-platform='all']) .root-badge {
            display: none;
          }

          .file-link {
            font-family: var(--font-mono);
            font-size: 0.8125rem;
            color: var(--color-muted);
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            text-decoration: underline;
            text-decoration-color: transparent;
            text-underline-offset: 0.12em;
          }

          .file-link:hover {
            color: var(--color-accent);
            text-decoration-color: var(--color-accent);
          }

          .copy-btn {
            font-family: var(--font-mono);
            font-size: var(--text-xs);
            font-weight: 600;
            min-height: 2rem;
            min-width: 5.5rem;
            padding: 0.4rem 0.7rem;
            border: 1px solid var(--color-ink);
            border-radius: var(--radius);
            background: var(--color-ink);
            color: var(--color-paper);
            white-space: nowrap;
            transition:
              background-color var(--dur-short) var(--ease-out),
              color var(--dur-short) var(--ease-out),
              border-color var(--dur-short) var(--ease-out);
          }

          .copy-btn:hover {
            background: var(--color-accent);
            border-color: var(--color-accent);
          }

          .copy-btn.is-done {
            background: var(--color-surface);
            border-color: var(--color-accent);
            color: var(--color-accent);
          }

          .sr-only {
            position: absolute;
            width: 1px;
            height: 1px;
            padding: 0;
            margin: -1px;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
            white-space: nowrap;
            border: 0;
          }

          .file.is-hidden,
          .folder.is-hidden {
            display: none;
          }

          .empty-state {
            display: none;
            padding: var(--space-10) var(--space-4);
            text-align: left;
            font-family: var(--font-ui);
            color: var(--color-muted);
          }

          .empty-state.is-visible {
            display: block;
          }

          .empty-state p {
            margin: 0 0 var(--space-2);
            font-size: var(--text-sm);
          }

          .empty-state .hint {
            font-family: var(--font-mono);
            font-size: var(--text-xs);
          }

          .colophon {
            display: flex;
            flex-wrap: wrap;
            justify-content: space-between;
            gap: var(--space-2) var(--space-4);
            padding-top: var(--space-4);
            border-top: 1px solid var(--color-line);
            font-family: var(--font-mono);
            font-size: var(--text-xs);
            color: var(--color-muted);
          }

          .colophon a {
            color: var(--color-muted);
          }

          .colophon a:hover {
            color: var(--color-ink);
          }

          @media (prefers-reduced-motion: reduce) {
            *,
            *::before,
            *::after {
              transition: none !important;
            }
          }
        </style>
      </head>
      <body>
        <div class="shell">
          <header class="top">
            <div class="brand">
              <h1>NRRule</h1>
              <span class="tag">personal rules index</span>
            </div>
            <div class="meta-links">
              <a href="https://github.com/lucking7/MirrRule">Source</a>
              <a href="/LICENSE">AGPL-3.0</a>
              <a href="https://github.com/lucking7">@lucking7</a>
            </div>
          </header>

          <p class="lede">自用镜像。选平台 → 搜文件 → 复制 URL 进客户端。</p>
          <p class="build-line">
            Last build <time datetime="${builtAt}">${builtAt}</time>
          </p>

          <div class="controls" id="controls">
            <div class="platforms" id="platform-chips" role="toolbar" aria-label="目录过滤">
              ${platformChipsHtml(roots)}
            </div>

            <div class="cmd-wrap">
              <div class="cmd">
                <span class="prompt" aria-hidden="true">find</span>
                <label class="sr-only" for="search-input">搜索文件与文件夹</label>
                <input
                  id="search-input"
                  type="search"
                  placeholder="Search files and folders…"
                  autocomplete="off"
                  spellcheck="false"
                  enterkeyhint="search"
                  aria-label="搜索文件与文件夹"
                />
                <div class="cmd-actions">
                  <button type="button" class="clear-btn" id="clear-btn" aria-label="清除搜索">
                    clear
                  </button>
                  <kbd>/</kbd>
                </div>
              </div>
              <div class="quick" id="quick-chips" aria-label="常用规则">
                ${quickChipsHtml()}
              </div>
              <div class="tree-toolbar">
                <p class="result-count" id="search-result-count" aria-live="polite"></p>
                <button type="button" class="collapse-btn" id="collapse-btn">
                  折叠目录
                </button>
              </div>
            </div>
          </div>

          <div class="tree-panel">
            <ul class="tree" id="file-tree">
              ${treeHtml(tree, 0)}
            </ul>
            <div class="empty-state" id="empty-state">
              <p>无匹配结果。</p>
              <p class="hint">换个关键词，或按 Esc 清空。</p>
            </div>
          </div>

          <p class="sr-only" id="status-live" aria-live="polite" aria-atomic="true"></p>

          <footer class="colophon">
            <span>MirrRule → NRRule</span>
            <span>规则索引 · 复制绝对 URL</span>
          </footer>
        </div>

        <script>
          (function () {
            const searchInput = document.getElementById('search-input');
            const clearBtn = document.getElementById('clear-btn');
            const resultCount = document.getElementById('search-result-count');
            const tree = document.getElementById('file-tree');
            const emptyState = document.getElementById('empty-state');
            const platformBar = document.getElementById('platform-chips');
            const quickBar = document.getElementById('quick-chips');
            const collapseBtn = document.getElementById('collapse-btn');
            const statusLive = document.getElementById('status-live');
            const PLATFORM_KEY = 'nrrule-platform';
            const openRoots = new Set(['List']);

            let activePlatform = 'all';
            let activeQuery = '';
            /** @type {Map<string, boolean> | null} */
            let openSnapshot = null;
            let wasSearching = false;

            function absoluteUrl(filePath) {
              try {
                return new URL(filePath, window.location.origin).href;
              } catch {
                return filePath;
              }
            }

            function detailsKey(details) {
              const folder = details.closest('.folder');
              return (folder && folder.getAttribute('data-path')) || '';
            }

            function snapshotOpenState() {
              const map = new Map();
              tree.querySelectorAll('details').forEach(function (details) {
                const key = detailsKey(details);
                if (key) map.set(key, details.open);
              });
              return map;
            }

            function restoreOpenState(map) {
              tree.querySelectorAll('details').forEach(function (details) {
                const key = detailsKey(details);
                if (map && map.has(key)) {
                  details.open = Boolean(map.get(key));
                  return;
                }
                const folder = details.closest('.folder');
                const root = folder && folder.getAttribute('data-root');
                details.open = Boolean(root && openRoots.has(root));
              });
            }

            function collapseFolders() {
              tree.querySelectorAll('details').forEach(function (details) {
                const folder = details.closest('.folder');
                const root = folder && folder.getAttribute('data-root');
                details.open = Boolean(root && openRoots.has(root));
              });
              openSnapshot = null;
              wasSearching = false;
              if (statusLive) statusLive.textContent = '已折叠目录';
            }

            async function copyPath(btn) {
              const filePath = btn.getAttribute('data-path');
              if (!filePath) return;
              const url = absoluteUrl(filePath);
              try {
                await navigator.clipboard.writeText(url);
              } catch {
                const ta = document.createElement('textarea');
                ta.value = url;
                ta.setAttribute('readonly', '');
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
              }
              const prev = btn.textContent;
              btn.textContent = 'Copied';
              btn.classList.add('is-done');
              if (statusLive) {
                statusLive.textContent = '已复制 ' + url;
              }
              window.setTimeout(function () {
                btn.textContent = prev || 'Copy URL';
                btn.classList.remove('is-done');
              }, 1400);
            }

            tree.addEventListener('click', function (event) {
              const btn = event.target.closest('.copy-btn');
              if (!btn || !tree.contains(btn)) return;
              event.preventDefault();
              copyPath(btn);
            });

            function openPlatformRoot(name) {
              if (!name || name === 'all') return;
              tree.querySelectorAll(':scope > .folder').forEach(function (folder) {
                const root = folder.getAttribute('data-root') || '';
                const details = folder.querySelector(':scope > details');
                if (!details) return;
                // Open the selected root; close other roots for a clean workbench.
                details.open = root === name;
              });
            }

            function setPlatform(name, persist) {
              activePlatform = name || 'all';
              document.body.setAttribute('data-platform', activePlatform);
              platformBar.querySelectorAll('.chip').forEach(function (chip) {
                const on = chip.getAttribute('data-platform') === activePlatform;
                chip.classList.toggle('is-on', on);
                chip.setAttribute('aria-pressed', on ? 'true' : 'false');
              });
              if (persist !== false) {
                try {
                  localStorage.setItem(PLATFORM_KEY, activePlatform);
                } catch {
                  /* ignore */
                }
              }
              applyFilters();
              if (activePlatform !== 'all') {
                openPlatformRoot(activePlatform);
              }
            }

            function setQuickHot(query) {
              quickBar.querySelectorAll('.quick-chip').forEach(function (chip) {
                chip.classList.toggle('is-hot', chip.getAttribute('data-query') === query);
              });
            }

            function platformAllows(li) {
              if (activePlatform === 'all') return true;
              const root = li.closest('.folder[data-root]');
              return Boolean(root && root.getAttribute('data-root') === activePlatform);
            }

            function applyFilters() {
              const q = activeQuery.trim().toLowerCase();
              const searching = Boolean(q);

              if (searching && !wasSearching) {
                openSnapshot = snapshotOpenState();
              }
              if (!searching && wasSearching) {
                restoreOpenState(openSnapshot);
                openSnapshot = null;
              }
              wasSearching = searching;

              clearBtn.classList.toggle('is-visible', searching);
              setQuickHot(q);

              const files = tree.querySelectorAll('.file');
              const folders = tree.querySelectorAll('.folder');
              let matchCount = 0;

              files.forEach(function (li) {
                li.classList.remove('is-hidden');
              });
              folders.forEach(function (li) {
                li.classList.remove('is-hidden');
              });

              files.forEach(function (li) {
                const name = li.getAttribute('data-name') || '';
                const path = (li.getAttribute('data-path') || '').toLowerCase();
                const folderPath = (li.closest('.folder') &&
                  li.closest('.folder').getAttribute('data-path')) || '';
                const textOk =
                  !q ||
                  name.includes(q) ||
                  path.includes(q) ||
                  folderPath.toLowerCase().includes(q);
                const show = platformAllows(li) && textOk;
                li.classList.toggle('is-hidden', !show);
                if (show) {
                  matchCount += 1;
                  if (searching) {
                    let parent = li.parentElement;
                    while (parent && parent !== tree) {
                      if (parent.classList && parent.classList.contains('folder')) {
                        parent.classList.remove('is-hidden');
                        const details = parent.querySelector(':scope > details');
                        if (details) details.open = true;
                      }
                      parent = parent.parentElement;
                    }
                  }
                }
              });

              tree.querySelectorAll(':scope > .folder').forEach(function (folder) {
                const root = folder.getAttribute('data-root') || '';
                const platformOk = activePlatform === 'all' || root === activePlatform;
                if (!platformOk) folder.classList.add('is-hidden');
              });

              folders.forEach(function (folder) {
                if (folder.classList.contains('is-hidden')) return;
                if (!folder.querySelector('.file:not(.is-hidden)')) {
                  folder.classList.add('is-hidden');
                }
              });

              if (matchCount > 0) {
                resultCount.textContent = q
                  ? matchCount + ' match' + (matchCount === 1 ? '' : 'es')
                  : '';
                emptyState.classList.remove('is-visible');
                tree.style.display = '';
              } else {
                resultCount.textContent = '';
                emptyState.classList.add('is-visible');
                tree.style.display = 'none';
              }
            }

            function performSearch(query) {
              activeQuery = query || '';
              applyFilters();
            }

            platformBar.addEventListener('click', function (event) {
              const chip = event.target.closest('.chip');
              if (!chip) return;
              setPlatform(chip.getAttribute('data-platform') || 'all');
            });

            quickBar.addEventListener('click', function (event) {
              const chip = event.target.closest('.quick-chip');
              if (!chip) return;
              const query = chip.getAttribute('data-query') || '';
              searchInput.value = query;
              performSearch(query);
              searchInput.focus();
            });

            clearBtn.addEventListener('click', function () {
              searchInput.value = '';
              performSearch('');
              searchInput.focus();
            });

            collapseBtn.addEventListener('click', function () {
              collapseFolders();
            });

            searchInput.addEventListener('input', function (e) {
              performSearch(e.target.value);
            });

            document.addEventListener('keydown', function (e) {
              if (e.key === '/' && document.activeElement !== searchInput) {
                const tag = (document.activeElement && document.activeElement.tagName) || '';
                if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
                  e.preventDefault();
                  searchInput.focus();
                  searchInput.select();
                }
              }
              if (e.key === 'Escape' && document.activeElement === searchInput) {
                if (searchInput.value) {
                  searchInput.value = '';
                  performSearch('');
                } else {
                  searchInput.blur();
                }
              }
            });

            try {
              const saved = localStorage.getItem(PLATFORM_KEY);
              if (saved && platformBar.querySelector('[data-platform="' + saved + '"]')) {
                setPlatform(saved, false);
              } else {
                setPlatform('all', false);
              }
            } catch {
              setPlatform('all', false);
            }
          })();
        </script>
      </body>
    </html>
  `;
}
