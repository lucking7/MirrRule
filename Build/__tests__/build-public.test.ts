import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { treeHtml } from '../build-public';
import { TreeFileType } from '../lib/tree-dir';
import type { TreeTypeArray } from '../lib/tree-dir';
import { escapeHtml } from '../utils/escape-html';

describe('public index HTML escaping', () => {
  it('escapes all HTML metacharacters without double-escaping generated entities', () => {
    const unsafe = '<script>"Tom & Jerry\'s"</script>';

    assert.equal(
      escapeHtml(unsafe),
      '&lt;script&gt;&quot;Tom &amp; Jerry&#39;s&quot;&lt;/script&gt;'
    );
    assert.equal(escapeHtml('&'), '&amp;');
  });

  it('escapes visible names and URI-encodes link paths without escaping slashes twice', () => {
    const name = '<script>"规则 & Jerry\'s 文件.list';
    const tree: TreeTypeArray = [{
      type: TreeFileType.DIRECTORY,
      name: '目录 "&\'',
      path: '/目录 "&\'',
      children: [{
        type: TreeFileType.DIRECTORY,
        name: 'sgmodule',
        path: '/目录/sgmodule',
        children: [{
          type: TreeFileType.FILE,
          name,
          path: `/目录/中文 space/${name}`,
        }],
      }],
    }];

    const rendered = treeHtml(tree);

    assert.ok(rendered.includes('<span class="folder-name">目录 &quot;&amp;&#39;</span>'));
    assert.ok(rendered.includes('data-path="目录 &quot;&amp;&#39;"'));
    // depth-1 section has no trail; depth-2 branch would, but fixture is root → section → file
    assert.ok(rendered.includes('folder-summary is-section'));
    assert.ok(rendered.includes('<span class="folder-name">sgmodule</span>'));
    assert.ok(rendered.includes(
      '&lt;script&gt;&quot;规则 &amp; Jerry&#39;s 文件.list'
    ));
    assert.ok(rendered.includes(
      'href="/%E7%9B%AE%E5%BD%95/%E4%B8%AD%E6%96%87%20space/%3Cscript%3E%22%E8%A7%84%E5%88%99%20&amp;%20Jerry&#39;s%20%E6%96%87%E4%BB%B6.list"'
    ));
    assert.ok(rendered.includes('Copy URL'));
    assert.equal(rendered.includes('<script>'), false);
    assert.equal(rendered.includes('%2520'), false);
    assert.equal(rendered.includes('%2F'), false);
  });
});
