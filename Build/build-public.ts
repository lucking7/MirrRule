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

export function treeHtml(tree: TreeTypeArray, level = 0): string {
  let result = '';
  tree.sort(prioritySorter);

  for (let i = 0, len = tree.length; i < len; i++) {
    const entry = tree[i];

    if (entry.type === TreeFileType.DIRECTORY) {
      const isOpenRoot = level === 0 && openRootFolders.has(entry.name);
      const openAttr = isOpenRoot ? 'open' : '';
      const children = treeHtml(entry.children, level + 1);
      const escapedName = escapeHtml(entry.name);
      const nameAttr = escapeHtml(entry.name.toLowerCase());
      if (level === 0) {
        result += html`
          <li class="folder" data-name="${nameAttr}" data-root="${escapeHtml(entry.name)}">
            <details ${openAttr}>
              <summary>${escapedName}</summary>
              <ul>
                ${children}
              </ul>
            </details>
          </li>
        `;
      } else {
        result += html`
          <li class="folder" data-name="${nameAttr}">
            <details>
              <summary>${escapedName}</summary>
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
      result += html`
        <li class="file" data-name="${escapeHtml(entry.name.toLowerCase())}" data-path="${pathAttr}">
          <div class="file-row">
            <a class="file-link" href="${pathAttr}">${escapedName}</a>
            <button
              type="button"
              class="copy-btn"
              data-path="${pathAttr}"
              aria-label="Copy URL for ${escapeHtml(entry.name)}"
            >
              copy
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
            padding: 0.3rem 0.55rem;
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
            padding: 0.28rem 0.5rem;
            border: 1px solid var(--color-line);
            border-radius: var(--radius);
            color: var(--color-muted);
            transition:
              color var(--dur-short) var(--ease-out),
              border-color var(--dur-short) var(--ease-out);
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

          .tree > .folder > details > summary {
            font-family: var(--font-mono);
            font-size: var(--text-xs);
            font-weight: 600;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: var(--color-muted);
            padding: 0.65rem 0.85rem;
            border-bottom: 1px solid var(--color-line);
            cursor: pointer;
            list-style: none;
          }

          .tree summary::-webkit-details-marker {
            display: none;
          }

          .tree summary::before {
            content: '▸';
            display: inline-block;
            width: 1em;
            margin-right: 0.35rem;
            color: var(--color-muted);
            transition: transform var(--dur-short) var(--ease-out);
          }

          .tree details[open] > summary::before {
            transform: rotate(90deg);
          }

          .tree .folder .folder > details > summary {
            padding-left: 1.5rem;
            border-bottom: 1px solid var(--color-line);
            background: transparent;
          }

          .tree .folder ul {
            padding: 0;
          }

          .tree .folder .folder ul {
            border-left: 1px solid var(--color-line);
            margin-left: 0.85rem;
          }

          .file-row {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: var(--space-3);
            align-items: center;
            padding: 0.45rem 0.85rem;
            border-top: 1px solid var(--color-line);
          }

          .tree > .folder > details > ul > .file:first-child .file-row,
          .tree .folder .folder > details > ul > .file:first-child .file-row {
            border-top: 0;
          }

          .file-row:hover {
            background: var(--color-hot);
          }

          .file-link {
            font-family: var(--font-mono);
            font-size: 0.8125rem;
            color: var(--color-ink);
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .file-link:hover {
            color: var(--color-accent);
            text-decoration: none;
          }

          .copy-btn {
            font-family: var(--font-mono);
            font-size: 0.6875rem;
            padding: 0.18rem 0.45rem;
            border: 1px solid var(--color-line);
            border-radius: var(--radius);
            color: var(--color-ink);
            white-space: nowrap;
            transition:
              background-color var(--dur-short) var(--ease-out),
              color var(--dur-short) var(--ease-out),
              border-color var(--dur-short) var(--ease-out);
          }

          .copy-btn:hover {
            border-color: var(--color-muted);
          }

          .copy-btn.is-done {
            background: var(--color-ink);
            border-color: var(--color-ink);
            color: var(--color-paper);
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

          <p class="lede">自用镜像。选平台 → 搜文件 → Copy URL 进客户端。</p>
          <p class="build-line">
            Last build <time datetime="${builtAt}">${builtAt}</time>
          </p>

          <div class="platforms" id="platform-chips" role="toolbar" aria-label="Platform filter">
            ${platformChipsHtml(roots)}
          </div>

          <div class="cmd-wrap">
            <div class="cmd">
              <span class="prompt" aria-hidden="true">find</span>
              <input
                id="search-input"
                type="search"
                placeholder="Search files and folders…"
                autocomplete="off"
                spellcheck="false"
                enterkeyhint="search"
              />
              <div class="cmd-actions">
                <button type="button" class="clear-btn" id="clear-btn" aria-label="Clear search">
                  clear
                </button>
                <kbd>/</kbd>
              </div>
            </div>
            <div class="quick" id="quick-chips" aria-label="Frequent rulesets">
              ${quickChipsHtml()}
            </div>
            <p class="result-count" id="search-result-count" aria-live="polite"></p>
          </div>

          <div class="tree-panel">
            <ul class="tree" id="file-tree">
              ${treeHtml(tree, 0)}
            </ul>
            <div class="empty-state" id="empty-state">
              <p>No match.</p>
              <p class="hint">Try another keyword, or press Esc to clear.</p>
            </div>
          </div>

          <footer class="colophon">
            <span>MirrRule → NRRule</span>
            <span>
              <a href="https://github.com/lucking7/MirrRule">source</a>
              ·
              <a href="/LICENSE">AGPL-3.0</a>
            </span>
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

            let activePlatform = 'all';
            let activeQuery = '';

            function absoluteUrl(filePath) {
              try {
                return new URL(filePath, window.location.origin).href;
              } catch {
                return filePath;
              }
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
              btn.textContent = 'copied';
              btn.classList.add('is-done');
              window.setTimeout(function () {
                btn.textContent = prev || 'copy';
                btn.classList.remove('is-done');
              }, 1200);
            }

            tree.addEventListener('click', function (event) {
              const btn = event.target.closest('.copy-btn');
              if (!btn || !tree.contains(btn)) return;
              event.preventDefault();
              copyPath(btn);
            });

            function setPlatform(name) {
              activePlatform = name || 'all';
              platformBar.querySelectorAll('.chip').forEach(function (chip) {
                const on = chip.getAttribute('data-platform') === activePlatform;
                chip.classList.toggle('is-on', on);
                chip.setAttribute('aria-pressed', on ? 'true' : 'false');
              });
              applyFilters();
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
              clearBtn.classList.toggle('is-visible', Boolean(q));
              setQuickHot(q);

              const files = tree.querySelectorAll('.file');
              const folders = tree.querySelectorAll('.folder');
              let matchCount = 0;

              // reset visibility
              files.forEach(function (li) {
                li.classList.remove('is-hidden');
              });
              folders.forEach(function (li) {
                li.classList.remove('is-hidden');
              });

              files.forEach(function (li) {
                const name = li.getAttribute('data-name') || '';
                const path = (li.getAttribute('data-path') || '').toLowerCase();
                const textOk = !q || name.includes(q) || path.includes(q);
                const show = platformAllows(li) && textOk;
                li.classList.toggle('is-hidden', !show);
                if (show) {
                  matchCount += 1;
                  if (q) {
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

              // platform filter on roots
              tree.querySelectorAll(':scope > .folder').forEach(function (folder) {
                const root = folder.getAttribute('data-root') || '';
                const platformOk = activePlatform === 'all' || root === activePlatform;
                if (!platformOk) folder.classList.add('is-hidden');
              });

              // hide folders with no visible files under search/platform
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
          })();
        </script>
      </body>
    </html>
  `;
}
