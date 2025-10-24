import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';

import { task } from './trace';
import { treeDir, TreeFileType } from './lib/tree-dir';
import type { TreeType, TreeTypeArray } from './lib/tree-dir';

import { OUTPUT_MOCK_DIR, OUTPUT_MODULES_RULES_DIR, PUBLIC_DIR, ROOT_DIR } from './constants/dir';
import { fastStringCompare, writeFile } from './lib/misc';
import type { VoidOrVoidArray } from './lib/misc';
import picocolors from 'picocolors';
import { tagged as html } from 'foxts/tagged';
import { compareAndWriteFile } from './lib/create-file';

const priorityOrder: Record<'default' | (string & {}), number> = {
  LICENSE: 0,
  domainset: 10,
  non_ip: 20,
  ip: 30,
  List: 40,
  Loon: 50,
  QuantumultX: 60,
  Clash: 70,
  'sing-box': 80,
  GEOIP: 90,
  Surge: 100,
  Surfboard: 110,
  LegacyClashPremium: 111,
  Script: 130,
  Mock: 140,
  Assets: 150,
  Internal: 160,
  // 低优先级条目（排在最后）
  Modules: 200,
  Scripts: 210,
  Mirror: 220,
  default: Number.MAX_VALUE
};

const closedRootFolders = ['Mock', 'Internal'];

export const buildPublic = task(
  require.main === module,
  __filename
)(async span => {
  await span.traceChildAsync('copy rest of the files', async () => {
    const p: Array<Promise<any>> = [];

    // Mock 和 Modules 已由 downloadMockAndModules 直接下载到 public 目录，无需复制

    await Promise.all(p);
  });

  const html = await span
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
        )
      ],
      path.join(PUBLIC_DIR, '_headers')
    ),
    compareAndWriteFile(
      span,
      [
        '# <pre>',
        '#########################################',
        '# Luck\'s Ruleset - 404 Not Found',
        '################## EOF ##################</pre>'
      ],
      path.join(PUBLIC_DIR, '404.html')
    ),
    compareAndWriteFile(
      span,
      [
        '# This is a Robot-managed repo containing only output',
        '# The source code is located at [Sukkaw/Surge](https://github.com/Sukkaw/Surge)',
        '# Please follow the development at the source code repo instead',
        '',
        '![GitHub repo size](https://img.shields.io/github/repo-size/sukkalab/ruleset.skk.moe?style=flat-square)'
      ],
      path.join(PUBLIC_DIR, 'README.md')
    )
  ]);

  return writeFile(path.join(PUBLIC_DIR, 'index.html'), html);
});

function prioritySorter(a: TreeType, b: TreeType) {
  // 1. 类型优先：目录 > 文件
  if (a.type !== b.type) {
    return a.type === TreeFileType.DIRECTORY ? -1 : 1;
  }
  
  // 2. 优先级数值排序
  const priorityDiff = (priorityOrder[a.name] || priorityOrder.default)
    - (priorityOrder[b.name] || priorityOrder.default);
  
  if (priorityDiff !== 0) {
    return priorityDiff;
  }
  
  // 3. 同优先级内按字母序
  return fastStringCompare(a.name, b.name);
}

function treeHtml(tree: TreeTypeArray, level = 0, closedFolderList: string[] = []): string {
  let result = '';
  tree.sort(prioritySorter);

  for (let i = 0, len = tree.length; i < len; i++) {
    const entry = tree[i];
    const open = closedFolderList.includes(entry.name) ? '' : (level === 0 ? 'open' : '');

    if (entry.type === TreeFileType.DIRECTORY) {
      result += html`
        <li class="folder">
          <details ${open}>
            <summary>${entry.name}</summary>
            <ul>
              ${treeHtml(entry.children, level + 1)}
            </ul>
          </details>
        </li>
      `;
    } else if (
      /* entry.type === 'file' && */ !entry.name.endsWith('.html')
      && !entry.name.startsWith('_')
    ) {
      result += html`
        <li class="file"><a class="file-link" href="${entry.path}">${entry.name}</a></li>
      `;
    }
  }
  return result;
}

function generateHtml(tree: TreeTypeArray) {
  return html`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Surge Ruleset Server | Luck (@lucking7)</title>
        <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
        <link href="/favicon.svg" rel="icon" type="image/svg+xml" />
        <meta name="description" content="Luck 自用的 Surge / Clash Premium 规则组" />

        <meta property="og:title" content="Surge Ruleset | Luck (@lucking7)" />
        <meta property="og:type" content="Website" />
        <meta property="og:url" content="https://github.com/lucking7/esdeath" />
        <meta
          property="og:image"
          content="/favicon.svg"
        />
        <meta property="og:description" content="Luck 自用的 Surge / Clash Premium 规则组" />
        <meta name="twitter:card" content="summary" />
        <link rel="canonical" href="https://github.com/lucking7/esdeath" />
        <style>
          :root {
            --font-family: system-ui, -apple-system, 'Segoe UI', 'Roboto', 'Ubuntu', 'Cantarell',
              'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol',
              'Noto Color Emoji';
            --line-height: 1.5;
            --font-weight: 400;
            --font-size: 16px;
            --border-radius: 0.25rem;
            --border-width: 1px;
            --outline-width: 3px;
            --spacing: 1rem;
            --typography-spacing-vertical: 1.5rem;
            --block-spacing-vertical: calc(var(--spacing) * 2);
            --block-spacing-horizontal: var(--spacing);
            --nav-element-spacing-vertical: 1rem;
            --nav-element-spacing-horizontal: 0.5rem;
            --nav-link-spacing-vertical: 0.5rem;
            --nav-link-spacing-horizontal: 0.5rem;
            --form-label-font-weight: var(--font-weight);
            --transition: 0.2s ease-in-out;

            /* 圆角系统 */
            --radius-xs: 0.125rem;    /* 2px */
            --radius-sm: 0.25rem;     /* 4px */
            --radius-md: 0.375rem;    /* 6px */
            --radius-lg: 0.5rem;      /* 8px */
            --radius-xl: 0.75rem;     /* 12px */
            --radius-2xl: 1rem;       /* 16px */
            --radius-3xl: 1.5rem;     /* 24px */

            /* 排版系统 */
            --text-xs: 0.75rem;       /* 12px */
            --text-sm: 0.875rem;      /* 14px */
            --text-base: 1rem;        /* 16px */
            --text-lg: 1.125rem;      /* 18px */
            --text-xl: 1.25rem;       /* 20px */
            --text-2xl: 1.5rem;       /* 24px */
            --text-3xl: 1.875rem;     /* 30px */
            --text-4xl: 2.25rem;      /* 36px */
            --text-5xl: 3rem;         /* 48px */
            --text-6xl: 3.75rem;      /* 60px */
            --text-7xl: 4.5rem;       /* 72px */

            /* 间距系统 */
            --spacing-0: 0;
            --spacing-1: 0.25rem;     /* 4px */
            --spacing-2: 0.5rem;      /* 8px */
            --spacing-3: 0.75rem;     /* 12px */
            --spacing-4: 1rem;        /* 16px */
            --spacing-5: 1.25rem;     /* 20px */
            --spacing-6: 1.5rem;      /* 24px */
            --spacing-8: 2rem;        /* 32px */
            --spacing-10: 2.5rem;     /* 40px */
            --spacing-11: 2.75rem;    /* 44px */
            --spacing-12: 3rem;       /* 48px */
            --spacing-16: 4rem;       /* 64px */
            --spacing-20: 5rem;       /* 80px */
          }

          @media (min-width: 576px) {
            :root {
              --font-size: 17px;
            }
          }

          @media (min-width: 768px) {
            :root {
              --font-size: 18px;
            }
          }

          @media (min-width: 992px) {
            :root {
              --font-size: 19px;
            }
          }

          @media (min-width: 1200px) {
            :root {
              --font-size: 20px;
            }
          }

          a {
            --text-decoration: none;
          }

          a.contrast,
          a.secondary {
            --text-decoration: underline;
          }

          small {
            --font-size: 0.875em;
          }

          h1,
          h2,
          h3,
          h4,
          h5,
          h6 {
            --font-weight: 700;
          }

          h1 {
            --font-size: 2rem;
            --typography-spacing-vertical: 3rem;
          }

          :not(thead):not(tfoot) > * > td {
            --font-size: 0.875em;
          }

          code,
          kbd,
          pre,
          samp {
            --font-family: 'Menlo', 'Consolas', 'Roboto Mono', 'Ubuntu Monospace', 'Noto Mono',
              'Oxygen Mono', 'Liberation Mono', monospace, 'Apple Color Emoji', 'Segoe UI Emoji',
              'Segoe UI Symbol', 'Noto Color Emoji';
          }

          kbd {
            --font-weight: bolder;
          }

          :root:not([data-theme='dark']),
          [data-theme='light'] {
            --background-color: #fff;
            --color: #415462;
            --h1-color: #1b2832;
            --h2-color: #24333e;
            --h3-color: #2c3d49;
            --h4-color: #374956;
            --h5-color: #415462;
            --h6-color: #4d606d;
            --muted-color: #73828c;
            --muted-border-color: #edf0f3;
            --primary: #1095c1;
            --primary-hover: #08769b;
            --primary-focus: rgba(16, 149, 193, 0.125);
            --primary-inverse: #fff;
            --secondary: #596b78;
            --secondary-hover: #415462;
            --secondary-focus: rgba(89, 107, 120, 0.125);
            --secondary-inverse: #fff;
            --contrast: #1b2832;
            --contrast-hover: #000;
            --contrast-focus: rgba(89, 107, 120, 0.125);
            --contrast-inverse: #fff;
            --mark-background-color: #fff2ca;
            --mark-color: #543a26;
            --modal-overlay-background-color: rgba(213, 220, 226, 0.8);
            --loading-spinner-opacity: 0.5;
            --icon-folder: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23415462' d='M9.52 3a2 2 0 0 1 1.442.614l.12.137L12.48 5.5H20a2 2 0 0 1 1.995 1.85L22 7.5V19a2 2 0 0 1-1.85 1.995L20 21H4a2 2 0 0 1-1.995-1.85L2 19V5a2 2 0 0 1 1.85-1.995L4 3zM20 11H4v8h16zM9.52 5H4v4h16V7.5h-7.52a2 2 0 0 1-1.442-.614l-.12-.137z'/%3E%3C/svg%3E");
            --icon-file: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23415462' d='M13.586 2A2 2 0 0 1 15 2.586L19.414 7A2 2 0 0 1 20 8.414V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM12 4H6v16h12V10h-4.5A1.5 1.5 0 0 1 12 8.5zm3 10a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2zm-5-4a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2Zm4-5.586V8h3.586z'/%3E%3C/svg%3E");
            --icon-folder-open: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23415462' d='M9.52 3a2 2 0 0 1 1.442.614l.12.137L12.48 5.5H19a2 2 0 0 1 1.995 1.85L21 7.5v1.53a2 2 0 0 1 1.61 2.398l-.038.147l-2.4 8a2 2 0 0 1-1.752 1.418l-.164.007H4a2 2 0 0 1-1.995-1.85L2 19V5a2 2 0 0 1 1.85-1.995L4 3zm11.136 8H6.744l-2.4 8h13.912zM9.519 5H4v8.187l.828-2.762A2 2 0 0 1 6.744 9H19V7.5h-6.52a2 2 0 0 1-1.561-.75z'/%3E%3C/svg%3E");
            color-scheme: light;
          }

          @media only screen and (prefers-color-scheme: dark) {
            :root:not([data-theme='light']) {
              --background-color: #11191f;
              --color: #bbc6ce;
              --h1-color: #edf0f3;
              --h2-color: #e1e6eb;
              --h3-color: #d5dce2;
              --h4-color: #c8d1d8;
              --h5-color: #bbc6ce;
              --h6-color: #afbbc4;
              --muted-color: #73828c;
              --muted-border-color: #1f2d38;
              --primary: #1095c1;
              --primary-hover: #1ab3e6;
              --primary-focus: rgba(16, 149, 193, 0.25);
              --primary-inverse: #fff;
              --secondary: #596b78;
              --secondary-hover: #73828c;
              --secondary-focus: rgba(115, 130, 140, 0.25);
              --secondary-inverse: #fff;
              --contrast: #edf0f3;
              --contrast-hover: #fff;
              --contrast-focus: rgba(115, 130, 140, 0.25);
              --contrast-inverse: #000;
              --mark-background-color: #d1c284;
              --mark-color: #11191f;
              --modal-overlay-background-color: rgba(36, 51, 62, 0.9);
              --loading-spinner-opacity: 0.5;
              --icon-folder: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23bbc6ce' d='M9.52 3a2 2 0 0 1 1.442.614l.12.137L12.48 5.5H20a2 2 0 0 1 1.995 1.85L22 7.5V19a2 2 0 0 1-1.85 1.995L20 21H4a2 2 0 0 1-1.995-1.85L2 19V5a2 2 0 0 1 1.85-1.995L4 3zM20 11H4v8h16zM9.52 5H4v4h16V7.5h-7.52a2 2 0 0 1-1.442-.614l-.12-.137z'/%3E%3C/svg%3E");
              --icon-file: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23bbc6ce' d='M13.586 2A2 2 0 0 1 15 2.586L19.414 7A2 2 0 0 1 20 8.414V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM12 4H6v16h12V10h-4.5A1.5 1.5 0 0 1 12 8.5zm3 10a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2zm-5-4a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2Zm4-5.586V8h3.586z'/%3E%3C/svg%3E");
              --icon-folder-open: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23bbc6ce' d='M9.52 3a2 2 0 0 1 1.442.614l.12.137L12.48 5.5H19a2 2 0 0 1 1.995 1.85L21 7.5v1.53a2 2 0 0 1 1.61 2.398l-.038.147l-2.4 8a2 2 0 0 1-1.752 1.418l-.164.007H4a2 2 0 0 1-1.995-1.85L2 19V5a2 2 0 0 1 1.85-1.995L4 3zm11.136 8H6.744l-2.4 8h13.912zM9.519 5H4v8.187l.828-2.762A2 2 0 0 1 6.744 9H19V7.5h-6.52a2 2 0 0 1-1.561-.75z'/%3E%3C/svg%3E");
              color-scheme: dark;
            }
          }

          *,
          :after,
          :before {
            background-repeat: no-repeat;
            box-sizing: border-box;
          }

          :after,
          :before {
            text-decoration: inherit;
            vertical-align: inherit;
          }

          :where(:root) {
            -webkit-tap-highlight-color: transparent;
            -webkit-text-size-adjust: 100%;
            -moz-text-size-adjust: 100%;
            text-size-adjust: 100%;
            background-color: var(--background-color);
            color: var(--color);
            cursor: default;
            font-family: var(--font-family);
            font-size: var(--font-size);
            font-weight: var(--font-weight);
            line-height: var(--line-height);
            overflow-wrap: break-word;
            -moz-tab-size: 4;
            -o-tab-size: 4;
            tab-size: 4;
            text-rendering: optimizeLegibility;
          }

          main {
            display: block;
          }

          body {
            margin: 0;
            width: 100%;
          }

          body > footer,
          body > header,
          body > main {
            margin-left: auto;
            margin-right: auto;
            padding: var(--block-spacing-vertical) 0;
            width: 100%;
          }

          .container,
          .container-fluid {
            margin-left: auto;
            margin-right: auto;
            padding-left: var(--spacing);
            padding-right: var(--spacing);
            width: 100%;
          }

          @media (min-width: 576px) {
            .container {
              max-width: 510px;
              padding-left: 0;
              padding-right: 0;
            }
          }

          @media (min-width: 768px) {
            .container {
              max-width: 700px;
            }
          }

          @media (min-width: 992px) {
            .container {
              max-width: 920px;
            }
          }

          @media (min-width: 1200px) {
            .container {
              max-width: 1130px;
            }
          }

          section {
            margin-bottom: var(--block-spacing-vertical);
          }

          b,
          strong {
            font-weight: bolder;
          }

          address,
          blockquote,
          dl,
          figure,
          form,
          ol,
          p,
          pre,
          table,
          ul {
            color: var(--color);
            font-size: var(--font-size);
            font-style: normal;
            font-weight: var(--font-weight);
            margin-bottom: var(--typography-spacing-vertical);
            margin-top: 0;
          }

          [role='link'],
          a:not(.file-link) {
            --color: var(--primary);
            --background-color: transparent;
            background-color: var(--background-color);
            color: var(--color);
            outline: none;
            -webkit-text-decoration: var(--text-decoration);
            text-decoration: var(--text-decoration);
          }

          [role='link']:is([aria-current], :hover, :active, :focus):not(.file-link),
          a:is([aria-current], :hover, :active, :focus):not(.file-link) {
            color: var(--primary-hover);
            text-decoration: underline;
          }

          [role='link']:focus:not(.file-link),
          a:focus:not(.file-link) {
            --background-color: var(--primary-focus);
          }

          h1,
          h2,
          h3,
          h4,
          h5,
          h6 {
            color: var(--color);
            font-family: var(--font-family);
            font-size: var(--font-size);
            font-weight: var(--font-weight);
            margin-bottom: var(--typography-spacing-vertical);
            margin-top: 0;
          }

          h1 {
            --color: var(--h1-color);
          }

          h2 {
            --color: var(--h2-color);
          }

          h3 {
            --color: var(--h3-color);
          }

          h4 {
            --color: var(--h4-color);
          }

          h5 {
            --color: var(--h5-color);
          }

          h6 {
            --color: var(--h6-color);
          }

          :where(address, blockquote, dl, figure, form, ol, p, pre, table, ul)
            ~ :is(h1, h2, h3, h4, h5, h6) {
            margin-top: var(--typography-spacing-vertical);
          }

          p {
            margin-bottom: var(--typography-spacing-vertical);
          }

          small {
            font-size: var(--font-size);
          }

          :where(dl, ol, ul) {
            -webkit-padding-start: var(--spacing);
            -webkit-padding-end: 0;
            padding-left: var(--spacing);
            padding-right: 0;
            padding-inline-end: 0;
            padding-inline-start: var(--spacing);
          }

          :where(dl, ol, ul) li {
            margin-bottom: calc(var(--typography-spacing-vertical) * 0.25);
          }

          :where(dl, ol, ul) :is(dl, ol, ul) {
            margin: 0;
            margin-top: calc(var(--typography-spacing-vertical) * 0.25);
          }

          mark {
            background-color: var(--mark-background-color);
            color: var(--mark-color);
            padding: 0.125rem 0.25rem;
            vertical-align: baseline;
          }

          ::-moz-selection {
            background-color: var(--primary-focus);
          }

          ::selection {
            background-color: var(--primary-focus);
          }

          :where(audio, canvas, iframe, img, svg, video) {
            vertical-align: middle;
          }

          img {
            border-style: none;
            height: auto;
            max-width: 100%;
          }

          :where(svg:not([fill])) {
            fill: currentColor;
          }

          svg:not(:root) {
            overflow: hidden;
          }

          legend {
            color: inherit;
            max-width: 100%;
            padding: 0;
            white-space: normal;
          }

          ::-webkit-inner-spin-button,
          ::-webkit-outer-spin-button {
            height: auto;
          }

          ::-moz-focus-inner {
            border-style: none;
            padding: 0;
          }

          :-moz-focusring {
            outline: none;
          }

          :-moz-ui-invalid {
            box-shadow: none;
          }

          ::-ms-expand {
            display: none;
          }

          fieldset {
            border: 0;
            margin: 0;
            margin-bottom: var(--spacing);
            padding: 0;
          }

          fieldset legend,
          label {
            display: block;
            font-weight: var(--form-label-font-weight, var(--font-weight));
            margin-bottom: calc(var(--spacing) * 0.25);
          }

          [aria-controls] {
            cursor: pointer;
          }

          [aria-disabled='true'],
          [disabled] {
            cursor: not-allowed;
          }

          [aria-hidden='false'][hidden] {
            display: initial;
          }

          [aria-hidden='false'][hidden]:not(:focus) {
            clip: rect(0, 0, 0, 0);
            position: absolute;
          }

          [tabindex],
          a,
          area,
          button,
          input,
          label,
          select,
          summary,
          textarea {
            -ms-touch-action: manipulation;
          }

          .tree {
            --tree-spacing: 1.5rem;
            --radius: 10px;
          }

          .tree a {
            border-bottom: 1px solid transparent;
            border-color: var(--secondary);
            color: var(--color);
            text-decoration: none;
            transition: all 0.2s ease;
          }

          .tree a:hover {
            border-color: var(--secondary-hover);
            color: var(--h3-color);
          }

          .tree,
          .tree ul,
          .tree li {
            list-style: none;
            list-style-type: none;
          }

          .tree .folder li {
            display: block;
            position: relative;
            padding-left: calc(2 * var(--tree-spacing) - var(--radius) - 2px);
          }

          .tree ul {
            margin-left: calc(var(--radius) - var(--tree-spacing));
            padding-left: 0;
          }

          .tree summary {
            display: block;
            cursor: pointer;
          }

          .tree summary::marker,
          .tree summary::-webkit-details-marker {
            display: none;
          }

          .tree summary:focus {
            outline: none;
          }

          .tree summary:focus-visible {
            outline: 1px dotted #000;
          }

          .tree li.file::before {
            margin-right: 10px;
            vertical-align: middle;
            height: 20px;
            width: 20px;
            content: '';
            display: inline-block;
            background-image: var(--icon-file);
            background-position: top;
            background-size: 75% auto;
          }

          .tree li.folder > details > summary {
            letter-spacing: -0.02em;
            font-size: 1em;
          }

          .tree li.file a {
            font-size: 0.95em;
            color: var(--muted-color);
            letter-spacing: 0;
          }

          .tree li.folder > details > summary::before {
            z-index: 1;

            margin-right: 10px;
            vertical-align: middle;
            height: 20px;
            width: 20px;
            content: '';
            display: inline-block;
            background-image: var(--icon-folder);
            background-position: top;
            background-size: 75% auto;
          }

          .tree li.folder > details[open] > summary::before {
            background-image: var(--icon-folder-open);
          }
        </style>
      </head>
      <body>
        <main class="container">
          <h1>Luck Ruleset Server</h1>
          <div style="display:flex;align-items:center;justify-content:flex-start;flex-wrap:wrap;gap:0.25rem 0.5rem;margin:1rem 0;font-size:0.9rem;color:var(--muted-color)">
            <span style="display:inline-flex;align-items:center;gap:0.25rem;white-space:nowrap">Made by <a href="https://github.com/lucking7" style="display:inline-flex;align-items:center;gap:0.25rem"><svg style="display:inline-block;width:1em;height:1em;vertical-align:-0.125em;fill:#F77E2D" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2a1 1 0 0 1 1 1v1.522a2.501 2.501 0 0 1 2.89 4.003l-.355.354l.707.707l.354-.354a2.5 2.5 0 1 1 0 3.536l-.354-.354l-.707.707l.354.354a2.5 2.5 0 0 1-1.14 4.188a1 1 0 0 1-.25.203V21a1 1 0 1 1-2 0v-3h-1v3a1 1 0 1 1-2 0v-3.134a1 1 0 0 1-.248-.203a2.5 2.5 0 0 1-1.14-4.188l.353-.354l-.707-.707l-.353.354a2.5 2.5 0 1 1 0-3.536l.353.354l.707-.707l-.353-.354A2.5 2.5 0 0 1 11 4.522V3a1 1 0 0 1 1-1m2.121 12.536l-.707.707l.354.353a.5.5 0 1 0 .707-.707zm-4.242 0l-.354.353a.5.5 0 1 0 .707.707l.354-.353zm-4.597-3.89a.5.5 0 0 0 .708.708L6.343 11l-.353-.354a.5.5 0 0 0-.708 0m12.728 0l-.353.354l.353.354a.5.5 0 1 0 0-.707M9.525 6.405a.5.5 0 0 0 0 .707l.354.354l.707-.708l-.354-.353a.5.5 0 0 0-.707 0m4.95 0a.5.5 0 0 0-.638-.058l-.07.058l-.353.353l.707.708l.354-.354a.5.5 0 0 0 0-.707"/></svg>Luck</a></span>
            <span style="color:var(--muted-color);user-select:none" aria-hidden="true">•</span>
            <span style="display:inline-flex;align-items:center;gap:0.25rem;white-space:nowrap"><a href="https://github.com/lucking7/esdeath" style="display:inline-flex;align-items:center;gap:0.25rem">Source @ GitHub</a></span>
            <span style="color:var(--muted-color);user-select:none" aria-hidden="true">•</span>
            <span style="display:inline-flex;align-items:center;gap:0.25rem;white-space:nowrap">Licensed under <a href="/LICENSE" target="_blank" rel="noopener noreferrer">AGPL-3.0</a></span>
          </div>
          <p>Last Build: ${(() => {
            const now = new Date();
            const offset = 8 * 60; // GMT+8 in minutes
            const gmtPlus8 = new Date(now.getTime() + (offset - now.getTimezoneOffset()) * 60000);
            return gmtPlus8.toISOString().replace('Z', '+08:00');
          })()}</p>
          <div style="position:relative;margin:var(--spacing-6) 0;max-width:720px;width:100%">
            <svg id="search-icon" style="position:absolute;left:var(--spacing-4);top:50%;transform:translateY(-50%);width:18px;height:18px;fill:var(--muted-color);pointer-events:none;transition:fill 0.2s" viewBox="0 0 24 24"><path d="M10.5 2a8.5 8.5 0 1 0 5.262 15.176l3.652 3.652a1 1 0 0 0 1.414-1.414l-3.652-3.652A8.5 8.5 0 0 0 10.5 2M4 10.5a6.5 6.5 0 1 1 13 0a6.5 6.5 0 0 1-13 0"/></svg>
            <input type="text" id="search-input" placeholder="Search files and folders..." style="width:100%;padding:var(--spacing-3) var(--spacing-4);padding-left:3rem;padding-right:3rem;border:2px solid var(--muted-border-color);border-radius:18px;font-family:var(--font-family);font-size:var(--font-size);background-color:var(--background-color);color:var(--color);transition:all 0.2s;outline:none;box-shadow:0 1px 3px rgba(0,0,0,0.05)" />
            <button id="clear-btn" style="display:none;position:absolute;right:var(--spacing-4);top:50%;transform:translateY(-50%);background:transparent;border:1px solid rgba(0,0,0,0.06);padding:0;cursor:pointer;width:32px;height:32px;border-radius:9999px;transition:all 0.2s" aria-label="清除搜索">
              <svg style="width:16px;height:16px;fill:var(--muted-color);transition:fill 0.2s" viewBox="0 0 24 24"><path d="M12 2c5.523 0 10 4.477 10 10s-4.477 10-10 10S2 17.523 2 12S6.477 2 12 2m0 2a8 8 0 1 0 0 16a8 8 0 0 0 0-16M9.879 8.464L12 10.586l2.121-2.122a1 1 0 1 1 1.415 1.415l-2.122 2.12l2.122 2.122a1 1 0 0 1-1.415 1.415L12 13.414l-2.121 2.122a1 1 0 0 1-1.415-1.415L10.586 12L8.465 9.879a1 1 0 0 1 1.414-1.415"/></svg>
            </button>
          </div>
          <div id="search-result-count" style="margin:calc(var(--spacing-2) * -1) 0 var(--spacing-4) 0;font-size:var(--text-sm);color:var(--muted-color);min-height:1.3125rem"></div>
          <ul class="tree">
            ${treeHtml(tree, 0, closedRootFolders)}
          </ul>
          <div id="empty-state" style="display:none;text-align:center;padding:var(--spacing-12) var(--spacing-4);color:var(--muted-color)">
            <p style="font-size:var(--text-7xl);margin:0 0 var(--spacing-2) 0">🔍</p>
            <p style="margin:0;font-size:var(--text-lg)">未找到匹配的文件或文件夹</p>
            <p style="margin:var(--spacing-2) 0 0 0;font-size:var(--text-sm)">试试其他关键词</p>
          </div>
        </main>
        <script>
          (function() {
            const searchInput = document.getElementById('search-input');
            const searchIcon = document.getElementById('search-icon');
            const clearBtn = document.getElementById('clear-btn');
            const resultCount = document.getElementById('search-result-count');
            const treeContainer = document.querySelector('.tree');
            const emptyState = document.getElementById('empty-state');
            const treeItems = document.querySelectorAll('.tree li');

            // 焦点状态样式
            searchInput.addEventListener('focus', function() {
              this.style.borderColor = 'var(--primary)';
              this.style.boxShadow = '0 0 0 4px var(--primary-focus)';
              searchIcon.style.fill = 'var(--primary)';
            });

            searchInput.addEventListener('blur', function() {
              this.style.borderColor = 'var(--muted-border-color)';
              this.style.boxShadow = 'none';
              searchIcon.style.fill = 'var(--muted-color)';
            });

            // Hover 状态
            searchInput.addEventListener('mouseenter', function() {
              if (document.activeElement !== this) {
                this.style.borderColor = 'var(--primary-hover)';
              }
            });

            searchInput.addEventListener('mouseleave', function() {
              if (document.activeElement !== this) {
                this.style.borderColor = 'var(--muted-border-color)';
              }
            });

            // Clear button hover effects
            clearBtn.addEventListener('mouseenter', function() {
              this.style.backgroundColor = 'rgba(0,0,0,0.04)';
              this.querySelector('svg').style.fill = 'var(--primary)';
            });

            clearBtn.addEventListener('mouseleave', function() {
              this.style.backgroundColor = 'transparent';
              this.querySelector('svg').style.fill = 'var(--muted-color)';
            });

            // 清除按钮点击事件
            clearBtn.addEventListener('click', function() {
              searchInput.value = '';
              searchInput.focus();
              performSearch('');
            });

            // 搜索功能
            function performSearch(query) {
              const lowerQuery = query.toLowerCase().trim();

              // 控制清除按钮显示
              clearBtn.style.display = query ? 'block' : 'none';

              if (!lowerQuery) {
                treeItems.forEach(li => li.style.display = '');
                resultCount.textContent = '';
                treeContainer.style.display = '';
                emptyState.style.display = 'none';
                return;
              }

              let matchCount = 0;

              treeItems.forEach(li => {
                const text = li.textContent.toLowerCase();
                const shouldShow = text.includes(lowerQuery);
                li.style.display = shouldShow ? '' : 'none';

                if (shouldShow) {
                  matchCount++;
                  // 展开父文件夹
                  if (li.classList.contains('file')) {
                    let parent = li.parentElement;
                    while (parent && parent.tagName === 'UL') {
                      const parentLi = parent.closest('li.folder');
                      if (parentLi) {
                        parentLi.style.display = '';
                        const details = parentLi.querySelector('details');
                        if (details) details.open = true;
                      }
                      parent = parent.parentElement;
                    }
                  }
                }
              });

              // 更新结果计数
              if (matchCount > 0) {
                resultCount.textContent = \`找到 \${matchCount} 个结果\`;
                treeContainer.style.display = '';
                emptyState.style.display = 'none';
              } else {
                resultCount.textContent = '';
                treeContainer.style.display = 'none';
                emptyState.style.display = 'block';
              }
            }

            // 输入事件
            searchInput.addEventListener('input', function(e) {
              performSearch(e.target.value);
            });
          })();
        </script>
      </body>
    </html>
  `;
}
