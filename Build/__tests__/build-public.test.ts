import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';

import { generateHtml, isVisiblePublicFile, scanPublicTree, treeHtml } from '../build-public';
import { prioritySorter } from '../lib/public-index-sort';
import { TreeFileType } from '../lib/tree-dir';
import type { TreeTypeArray } from '../lib/tree-dir';
import { ruleGroups, specialRules } from '../lib/rule-sources';

it('removes withdrawn Container, Discord and Scholar artifacts on all clients while retaining active subscriptions', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-withdrawn-rules-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const ids = ['container', 'discord', 'scholar'];
  const paths = new Set([
    ...ruleGroups.flatMap(group => group.files.map(file => file.path)),
    ...specialRules.map(rule => rule.targetFile),
  ]);
  for (const id of ids) assert.equal(paths.has(`List/${id}.list`), false);
  const retired: string[] = [];
  const active: string[] = [];
  const outputs = [['List', 'list'], ['Clash', 'txt'], ['Loon', 'list'], ['sing-box', 'json']];
  await Promise.all(outputs.map(([root]) => fs.mkdir(path.join(directory, root), { recursive: true })));
  for (const [root, extension] of outputs) {
    for (const id of ids) retired.push(`${root}/${id}.${extension}`);
    for (const id of ['ai', 'direct-fmz', 'reject-fmz']) active.push(`${root}/${id}.${extension}`);
  }
  await Promise.all([...retired, ...active].map(relative =>
    fs.writeFile(path.join(directory, relative), `Fixture: ${relative}\n`)
  ));
  const result = spawnSync(process.execPath, ['-r', '@swc-node/register', 'Build/build-public.ts'], {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, PUBLIC_DIR: directory, SWC_NODE_IGNORE_DYNAMIC: 'true' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const index = await fs.readFile(path.join(directory, 'index.html'), 'utf8');
  await Promise.all(retired.map(async relative => {
    await assert.rejects(fs.access(path.join(directory, relative)), { code: 'ENOENT' });
    assert.equal(index.includes(relative), false);
  }));
  await Promise.all(active.map(async relative => {
    assert.equal(await fs.readFile(path.join(directory, relative), 'utf8'), `Fixture: ${relative}\n`);
    assert.equal(index.includes(relative), true);
  }));
});

it('retires only the unsupported sing-box ASN artifact and retains other client subscriptions', async (t) => {
  const group = ruleGroups.find(candidate => candidate.files.some(file => file.path === 'List/china_asn.list'));
  assert.ok(group);
  assert.deepEqual(group.targets, ['surge', 'clash', 'loon']);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-asn-retirement-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const entries = ['List/china_asn.list', 'Clash/china_asn.txt', 'Loon/china_asn.list', 'sing-box/china_asn.json'];
  await Promise.all(entries.map(async entry => {
    await fs.mkdir(path.dirname(path.join(directory, entry)), { recursive: true });
    await fs.writeFile(path.join(directory, entry), `Fixture: ${entry}\n`);
  }));
  const result = spawnSync(process.execPath, ['-r', '@swc-node/register', 'Build/build-public.ts'], {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, PUBLIC_DIR: directory, SWC_NODE_IGNORE_DYNAMIC: 'true' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const index = await fs.readFile(path.join(directory, 'index.html'), 'utf8');
  await assert.rejects(fs.access(path.join(directory, 'sing-box/china_asn.json')), { code: 'ENOENT' });
  assert.equal(index.includes('sing-box/china_asn.json'), false);
  for (const entry of entries.slice(0, 3)) {
    assert.equal(await fs.readFile(path.join(directory, entry), 'utf8'), `Fixture: ${entry}\n`);
    assert.ok(index.includes(entry));
  }
});

function script(name: string): string {
  return `[Script]\nrun=type=http-response, script-path=https://nrrule.pages.dev/Scripts/${name}`;
}

it('build-web removes retired subscriptions from historical artifacts before publishing the index', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-retired-index-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const converted = path.join(directory, 'Modules', 'Converted');
  await fs.mkdir(converted, { recursive: true });
  const retired = ['腾讯视频去广告.sgmodule', 'Tencent_Video_remove_ads.sgmodule'];
  await fs.mkdir(path.join(directory, 'Scripts'), { recursive: true });
  await Promise.all([
    ...retired.map(name => fs.writeFile(path.join(converted, name), `${script('tencent.js')}\n${script('shared.js')}`)),
    fs.writeFile(path.join(converted, '哈罗去广告.sgmodule'), script('shared.js')),
    fs.writeFile(path.join(directory, 'Scripts', 'tencent.js'), 'const tencent = true;'),
    fs.writeFile(path.join(directory, 'Scripts', 'shared.js'), 'const shared = true;'),
  ]);
  const result = spawnSync(process.execPath, ['-r', '@swc-node/register', 'Build/build-public.ts'], {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, PUBLIC_DIR: directory, SWC_NODE_IGNORE_DYNAMIC: 'true' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const index = await fs.readFile(path.join(directory, 'index.html'), 'utf8');
  await Promise.all(retired.map(async name => {
    await assert.rejects(fs.access(path.join(converted, name)), { code: 'ENOENT' });
    assert.equal(index.includes(name), false);
  }));
  await assert.rejects(fs.access(path.join(directory, 'Scripts', 'tencent.js')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(directory, 'Scripts', 'shared.js'), 'utf8'), 'const shared = true;');
  assert.match(index, /哈罗去广告\.sgmodule/);
  const report = JSON.parse(await fs.readFile(path.join(directory, 'Internal', 'artifact-lifecycle.json'), 'utf8'));
  assert.deepEqual(report.removed, [...retired.map(name => `Modules/Converted/${name}`), 'Scripts/tencent.js']);
  assert.equal(report.automaticRedirects, false);
  assert.ok(report.records.some((record: { id: string, state: string }) => record.id === 'plugin:tencent-video-remove-ads' && record.state === 'retired'));
  assert.match(index, /artifact-lifecycle\.json/);
});

function file(name: string, entryPath: string) {
  return { type: TreeFileType.FILE, name, path: entryPath } as const;
}

function dir(name: string, children: TreeTypeArray, entryPath = `/${name}`) {
  return { type: TreeFileType.DIRECTORY, name, path: entryPath, children } as const;
}

function unescapeAttribute(value: string): string {
  return value.replaceAll('&quot;', '"').replaceAll('&#39;', '\'').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

function fileLinks(html: string): Array<{ href: string, text: string }> {
  const result: Array<{ href: string, text: string }> = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([^<]*)<\/a>/g)) {
    if (!/\bclass="[^"]*\bfile-link\b[^"]*"/.test(match[1])) continue;
    const href = /\bhref="([^"]*)"/.exec(match[1]);
    assert.ok(href, 'Every file link must have an href');
    result.push({ href: unescapeAttribute(href[1]), text: match[2] });
  }
  return result;
}

async function withPublicDirectory(
  files: readonly string[],
  run: (directory: string) => Promise<void>
): Promise<void> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'public-index-'));
  try {
    await Promise.all(files.map(async relative => {
      const target = path.join(directory, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, `Fixture: ${relative}\n`);
    }));
    await run(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

describe('prioritySorter (real public root ordering)', () => {
  it('orders current output roots without inventing upstream client directories', () => {
    const names = ['Mirror', 'GeoIP', 'zz-unknown', 'sing-box', 'Loon', 'Clash', 'List', 'Mock', 'Modules', 'Scripts'];
    assert.deepEqual(names.map(name => dir(name, [])).sort(prioritySorter).map(entry => entry.name), [
      'List', 'Loon', 'Clash', 'sing-box', 'GeoIP', 'Mock', 'Modules', 'Scripts', 'Mirror', 'zz-unknown',
    ]);
  });

  it('keeps GeoIP at its case-sensitive priority and directories before files', () => {
    const entries: TreeTypeArray = [
      file('a-file', '/a-file'), dir('Mirror', []), dir('GeoIP', []), dir('sing-box', []),
    ];
    assert.deepEqual([...entries].sort(prioritySorter).map(entry => entry.name), [
      'sing-box', 'GeoIP', 'Mirror', 'a-file',
    ]);
  });
});

describe('native public directory tree', () => {
  it('keeps every actual client path instead of aggregating matching basenames', () => {
    const tree: TreeTypeArray = [
      dir('Clash', [file('apple.txt', '/Clash/apple.txt')]),
      dir('List', [file('apple.list', '/List/apple.list')]),
      dir('Loon', [file('apple.list', '/Loon/apple.list')]),
      dir('sing-box', [file('apple.json', '/sing-box/apple.json')]),
    ];
    const rendered = treeHtml(tree);
    assert.deepEqual(fileLinks(rendered).map(link => link.href), [
      '/List/apple.list', '/Loon/apple.list', '/Clash/apple.txt', '/sing-box/apple.json',
    ]);
    assert.deepEqual([...rendered.matchAll(/<summary>([^<]*)<\/summary>/g)].map(match => match[1]), [
      'List', 'Loon', 'Clash', 'sing-box',
    ]);
  });

  it('shows Surge-only files only under their actual output directory', () => {
    const tree: TreeTypeArray = [
      dir('List', [file('reject_url_regex.list', '/List/reject_url_regex.list')]),
      dir('Clash', [file('reject.txt', '/Clash/reject.txt')]),
      dir('Loon', [file('reject.list', '/Loon/reject.list')]),
      dir('sing-box', [file('reject.json', '/sing-box/reject.json')]),
    ];
    const links = fileLinks(treeHtml(tree)).filter(link => link.text.includes('reject_url_regex'));
    assert.deepEqual(links, [{ href: '/List/reject_url_regex.list', text: 'reject_url_regex.list' }]);
  });

  it('opens normal roots, closes Mock/Internal roots, and leaves nested directories collapsed', () => {
    const tree: TreeTypeArray = [
      dir('List', [dir('non_ip', [file('apple.conf', '/List/non_ip/apple.conf')], '/List/non_ip')]),
      dir('Mock', [file('response.json', '/Mock/response.json')]),
      dir('Internal', [file('dns.txt', '/Internal/dns.txt')]),
      dir('Mirror', [dir('Sukka', [file('module.sgmodule', '/Mirror/Sukka/module.sgmodule')], '/Mirror/Sukka')]),
    ];
    const states = [...treeHtml(tree).matchAll(/<details\b([^>]*)>\s*<summary>([^<]*)<\/summary>/g)]
      .map(match => [match[2], /\bopen\b/.test(match[1])]);
    assert.deepEqual(states, [
      ['List', true], ['non_ip (Surge RULE-SET)', false], ['Mock', false],
      ['Mirror', true], ['Sukka', false], ['Internal', false],
    ]);
  });

  it('labels split variant folders with their consumer format and leaves merged files and other folders unlabeled', () => {
    const variants = (root: string, extension: string) => dir(root, [
      file(`apple.${extension}`, `/${root}/apple.${extension}`),
      ...['ip', 'domainset', 'non_ip'].map(variant => dir(variant, [
        file(`apple.${extension}`, `/${root}/${variant}/apple.${extension}`),
      ], `/${root}/${variant}`)),
    ]);
    const tree: TreeTypeArray = [
      variants('List', 'list'), variants('Clash', 'txt'), variants('Loon', 'list'), variants('sing-box', 'json'),
      dir('Mirror', [dir('domainset', [file('a.sgmodule', '/Mirror/domainset/a.sgmodule')], '/Mirror/domainset')]),
      dir('List2', [dir('non_ip', [dir('ip', [file('x.list', '/List2/non_ip/ip/x.list')], '/List2/non_ip/ip')], '/List2/non_ip')]),
    ];
    const rendered = treeHtml(tree);
    assert.deepEqual([...rendered.matchAll(/<summary>([^<]*)<\/summary>/g)].map(match => match[1]), [
      'List', 'domainset (Surge DOMAIN-SET)', 'non_ip (Surge RULE-SET)', 'ip (Surge RULE-SET)',
      'Loon', 'domainset (Loon RULE-SET)', 'non_ip (Loon RULE-SET)', 'ip (Loon RULE-SET)',
      'Clash', 'domainset (Clash classical)', 'non_ip (Clash classical)', 'ip (Clash classical)',
      'sing-box', 'domainset (sing-box rule-set JSON v2)', 'non_ip (sing-box rule-set JSON v2)', 'ip (sing-box rule-set JSON v2)',
      'Mirror', 'domainset', 'List2', 'non_ip', 'ip',
    ]);
    const links = fileLinks(rendered).map(link => link.href);
    assert.deepEqual(links.slice(0, 4), ['/List/domainset/apple.list', '/List/non_ip/apple.list', '/List/ip/apple.list', '/List/apple.list']);
    assert.ok(links.includes('/sing-box/domainset/apple.json'));
  });

  it('preserves category order and sorts files without mutating the input at any depth', () => {
    const tree: TreeTypeArray = [
      file('README.md', '/README.md'),
      dir('List', [
        file('zeta.list', '/List/zeta.list'),
        dir('ip', [file('b.conf', '/List/ip/b.conf'), file('a.conf', '/List/ip/a.conf')], '/List/ip'),
        dir('non_ip', [file('service.conf', '/List/non_ip/service.conf')], '/List/non_ip'),
        dir('domainset', [file('cdn.conf', '/List/domainset/cdn.conf')], '/List/domainset'),
        file('alpha.list', '/List/alpha.list'),
      ]),
    ];
    const before = structuredClone(tree);
    assert.deepEqual(fileLinks(treeHtml(tree)).map(link => link.href), [
      '/List/domainset/cdn.conf', '/List/non_ip/service.conf', '/List/ip/a.conf',
      '/List/ip/b.conf', '/List/alpha.list', '/List/zeta.list', '/README.md',
    ]);
    assert.deepEqual(tree, before);
    generateHtml(tree, new Date('2026-10-07T18:02:03.456Z'));
    assert.deepEqual(tree, before);
  });
});

describe('public filename visibility and escaping', () => {
  it('lists documentation and real artifacts while hiding private and page support files', () => {
    for (const name of ['README.md', 'LICENSE', 'apple.list', 'rules.json', 'module.sgmodule', 'geoip.mmdb']) {
      assert.equal(isVisiblePublicFile(name), true, name);
    }
    for (const name of ['.secret', '_headers', '_redirects', 'index.html', '404.html', 'favicon.ico', 'favicon.svg', 'robots.txt', 'CNAME']) {
      assert.equal(isVisiblePublicFile(name), false, name);
    }
  });

  it('escapes text and links to literal Unicode and reserved filename characters', () => {
    const folder = '目录 "&\'';
    const name = '<script>"规则 & Jerry\'s #?100% 文件.list';
    const rawPath = `/${folder}/${name}`;
    const rendered = treeHtml([dir(folder, [file(name, rawPath)])]);
    assert.ok(rendered.includes('<summary>目录 &quot;&amp;&#39;</summary>'));
    const links = fileLinks(rendered);
    assert.equal(links.length, 1);
    assert.equal(links[0].text, '&lt;script&gt;&quot;规则 &amp; Jerry&#39;s #?100% 文件.list');
    const url = new URL(links[0].href, 'https://nrrule.pages.dev');
    assert.equal(url.origin, 'https://nrrule.pages.dev');
    assert.equal(decodeURIComponent(url.pathname), rawPath);
    assert.equal(url.search, '');
    assert.equal(url.hash, '');
    assert.equal(rendered.includes('<script>'), false);
    assert.equal(rendered.includes('onclick='), false);
  });

  it('keeps literal percent escapes in filenames distinct from spaces', () => {
    const links = fileLinks(treeHtml([
      file('a%20b.list', '/List/a%20b.list'), file('a b.list', '/List/a b.list'),
    ]));
    assert.equal(new Set(links.map(link => link.href)).size, 2);
    assert.deepEqual(links.map(link => decodeURIComponent(new URL(link.href, 'https://nrrule.pages.dev').pathname)), [
      '/List/a b.list', '/List/a%20b.list',
    ]);
  });

  it('scans the real filesystem and applies exclusions recursively', async () => {
    await withPublicDirectory([
      'README.md', 'LICENSE', 'List/apple.list', 'Clash/apple.txt', 'Loon/apple.list', 'sing-box/apple.json',
      'Mirror/Sukka/sgmodule/module.sgmodule', 'List/README.md', 'List/LICENSE',
      '.private/secret.txt', '_private/secret.txt', 'List/.secret', 'List/_private/secret.txt',
      'List/_metadata.json', 'List/report.html', 'index.html', '404.html', '_headers', '_redirects',
      'favicon.svg', 'favicon.ico', 'robots.txt', 'CNAME', 'Mirror/Sukka/robots.txt',
    ], async directory => {
      const links = fileLinks(treeHtml(await scanPublicTree(directory)));
      assert.deepEqual(links.map(link => link.href).sort(), [
        '/README.md', '/LICENSE', '/List/apple.list', '/Clash/apple.txt', '/Loon/apple.list', '/sing-box/apple.json',
        '/Mirror/Sukka/sgmodule/module.sgmodule', '/List/README.md', '/List/LICENSE',
      ].sort());
    });
  });

  it('retains actual directories without inventing file links when their contents are hidden', async () => {
    await withPublicDirectory(['Empty/index.html', 'List/apple.list'], async directory => {
      const rendered = treeHtml(await scanPublicTree(directory));
      assert.equal(rendered.includes('<summary>Empty</summary>'), true);
      assert.deepEqual(fileLinks(rendered).map(link => link.href), ['/List/apple.list']);
    });
  });
});

describe('standalone ruleset index generation', () => {
  it('uses NRRule/Luck branding and local service metadata without copied external assets or scripts', () => {
    const html = generateHtml([file('LICENSE', '/LICENSE')], new Date('2026-10-07T18:02:03.456Z'));
    assert.match(html, /<title>[^<]*NRRule[^<]*<\/title>/);
    assert.match(html, /<h1>[^<]*NRRule[^<]*<\/h1>/);
    assert.match(html, /Made by\s*<a[^>]*>Luck<\/a>/);
    assert.match(html, /href="https:\/\/github\.com\/lucking7\/MirrRule\/?"/);
    assert.match(html, /<link[^>]+rel="canonical"[^>]*href="https:\/\/nrrule\.pages\.dev\/"/);
    assert.match(html, /<meta[^>]+property="og:url"[^>]*content="https:\/\/nrrule\.pages\.dev\/"/);
    assert.match(html, /<meta[^>]+property="og:title"[^>]*content="[^"]*NRRule/);
    assert.match(html, /href="\/LICENSE"[^>]*>AGPL-3\.0<\/a>/);
    assert.doesNotMatch(html, /(?:href|src)="https?:\/\/(?:cdn\.skk\.moe|ruleset\.skk\.moe|skk\.moe)/);
    assert.doesNotMatch(html, /<script\b|__CF\$cv|cdn-cgi\/challenge-platform/);
    assert.doesNotMatch(html, /<link[^>]+rel="stylesheet"/);
  });

  it('renders the injected instant as ISO UTC without converting it through the local timezone', () => {
    const builtAt = new Date('2026-10-08T02:02:03.456+08:00');
    const before = builtAt.getTime();
    const html = generateHtml([], builtAt);
    assert.match(html, /Last Build:\s*2026-10-07T18:02:03\.456Z/);
    assert.equal(builtAt.getTime(), before);
    assert.equal(generateHtml([], builtAt), html);
  });

  it('inlines the captured stylesheet with responsive, theme, and native tree rules', async () => {
    const css = await fs.readFile(path.join(__dirname, '../assets/ruleset-index.css'), 'utf8');
    const html = generateHtml([], new Date('2026-10-07T18:02:03.456Z'));
    const inlineStyle = /<style>([\s\S]*?)<\/style>/.exec(html);
    assert.ok(inlineStyle);
    assert.equal(inlineStyle[1].trim(), css.trim());
    assert.match(css, /--font-family:\s*system-ui,\s*-apple-system/);
    assert.match(css, /--background-color:\s*#fff/);
    assert.match(css, /prefers-color-scheme:\s*dark/);
    assert.match(css, /--background-color:\s*#11191f/);
    for (const width of [576, 768, 992, 1200]) assert.match(css, new RegExp(String.raw`min-width:\s*${width}px`));
    assert.match(css, /\.tree li\.folder>details\[open\]>summary::before/);
  });

  it('builds into PUBLIC_DIR and lists README/LICENSE on the first run without inventing formats', async () => {
    await withPublicDirectory([
      'List/reject_url_regex.list', 'Clash/apple.txt', 'Loon/apple.list', 'sing-box/apple.json', 'GeoIP/country.mmdb',
    ], async directory => {
      const result = spawnSync(process.execPath, ['-r', '@swc-node/register', path.join(__dirname, '../build-public.ts')], {
        cwd: path.join(__dirname, '../..'),
        encoding: 'utf8',
        timeout: 15000,
        env: { ...process.env, SWC_NODE_IGNORE_DYNAMIC: 'true', PUBLIC_DIR: directory },
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const html = await fs.readFile(path.join(directory, 'index.html'), 'utf8');
      assert.deepEqual(fileLinks(html).map(link => link.href).sort(), [
        '/README.md', '/LICENSE', '/List/reject_url_regex.list', '/Clash/apple.txt',
        '/Loon/apple.list', '/sing-box/apple.json', '/GeoIP/country.mmdb', '/Internal/artifact-lifecycle.json',
      ].sort());
      assert.equal(await fs.readFile(path.join(directory, 'LICENSE'), 'utf8'),
        await fs.readFile(path.join(__dirname, '../../LICENSE'), 'utf8'));
      const readme = await fs.readFile(path.join(directory, 'README.md'), 'utf8');
      assert.match(readme, /lucking7\/MirrRule/);
      const headers = await fs.readFile(path.join(directory, '_headers'), 'utf8');
      assert.match(headers, /cache-control: public, max-age=0, must-revalidate/);
      assert.doesNotMatch(headers, /stale-while-revalidate|stale-if-error/);
      assert.match(headers, /\/List\/\*\n\s+content-type: text\/plain; charset=utf-8/);
      assert.doesNotMatch(headers, /\/GeoIP\/\*\n\s+content-type: text\/plain/);
    });
  });
});
