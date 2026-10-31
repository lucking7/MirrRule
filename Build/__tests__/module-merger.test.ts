import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { mergeModules } from '../lib/module-merger';
import { ModuleMerger } from '../lib/module-merger/merger';
import { SectionParser } from '../lib/module-merger/section-parser';

describe('module merger section parser', () => {
  it('normalizes section aliases to canonical types', () => {
    const ruleFixture = '[Rule]\nDOMAIN,example.com,REJECT';
    const rulesFixture = '[Rules]\nDOMAIN,example.com,REJECT';
    const rewriteFixture = '[Rewrite]\n^https://example/old https://example/new';
    const mitmFixture = '[MITM]\nhostname = %APPEND% example.com';

    const ruleResult = SectionParser.parse(ruleFixture, { header: 'Rule Module', stripComments: false });
    const rulesResult = SectionParser.parse(rulesFixture, { header: 'Rules Module', stripComments: false });
    const rewriteResult = SectionParser.parse(rewriteFixture, { header: 'Rewrite Module', stripComments: false });
    const mitmResult = SectionParser.parse(mitmFixture, { header: 'MITM Module', stripComments: false });

    assert.equal(ruleResult.length, 1);
    assert.equal(rulesResult.length, 1);
    assert.equal(rewriteResult.length, 1);
    assert.equal(mitmResult.length, 1);

    assert.equal(ruleResult[0].type, 'Rule');
    assert.equal(rulesResult[0].type, 'Rule');
    assert.equal(rewriteResult[0].type, 'URL Rewrite');
    assert.equal(mitmResult[0].type, 'MITM');
  });

  it('strips comment lines while keeping rule lines when stripComments is true', () => {
    const fixture = `[Rule]
# a comment
DOMAIN,example.com,REJECT

// another comment
DOMAIN-SUFFIX,ads.com,REJECT`;

    const result = SectionParser.parse(fixture, { header: 'Test', stripComments: true });

    assert.equal(result.length, 1);
    assert.equal(result[0].type, 'Rule');
    assert.equal(result[0].content.includes('# a comment'), false);
    assert.equal(result[0].content.includes('// another comment'), false);
    assert.equal(result[0].content.includes('DOMAIN,example.com,REJECT'), true);
    assert.equal(result[0].content.includes('DOMAIN-SUFFIX,ads.com,REJECT'), true);
  });

  it('extracts and cleans MITM hostnames', () => {
    const fixture = 'hostname = %APPEND% example.com, *.example.com , , example.net';

    const hostnames = SectionParser.extractHostnames(fixture);

    assert.deepEqual(hostnames, ['example.com', '*.example.com', 'example.net']);
  });
});

describe('module merger engine', () => {
  const options = {
    deduplicateHostnames: true,
    stripComments: true,
    addDividers: true,
    dividerLength: 30,
  };

  it('deduplicates MITM hostnames in first-seen order', () => {
    const merger = new ModuleMerger(options);

    merger.addSection({
      type: 'MITM',
      header: 'Module A',
      content: 'hostname = %APPEND% a.com, b.com',
    });
    merger.addSection({
      type: 'MITM',
      header: 'Module B',
      content: 'hostname = %APPEND% b.com, c.com',
    });

    const { hostnames } = merger.merge();

    assert.deepEqual(hostnames, ['a.com', 'b.com', 'c.com']);
  });

  it('drops rules whose matcher repeats an earlier rule, whatever the policy', () => {
    const merger = new ModuleMerger(options);
    merger.addSection({
      type: 'Rule',
      header: 'Module A',
      content: 'DOMAIN,ads.example,REJECT\nIP-CIDR,192.0.2.0/24,REJECT,no-resolve\nURL-REGEX,"^https://x\\.test/[a,-z]",REJECT',
    });
    merger.addSection({
      type: 'Rule',
      header: 'Module B',
      content: [
        'domain, ads.example, REJECT-TINYGIF',
        'DOMAIN,ads.example,DIRECT',
        // An earlier rule may trigger DNS resolution, after which a repeated no-resolve rule can match.
        'IP-CIDR,192.0.2.0/24,REJECT,no-resolve',
        'IP-CIDR,192.0.2.0/24,REJECT',
        // Spaces inside a regular expression change what it matches.
        'URL-REGEX,"^https://x\\.test/[a, -z]",REJECT',
        'DOMAIN,new.example,REJECT',
      ].join('\n'),
    });
    merger.addSection({ type: 'Rule', header: 'Module C', content: 'DOMAIN,new.example,REJECT\nURL-REGEX,"^https://x\\.test/[a,-z]",REJECT-TINYGIF' });

    const { sections } = merger.merge();
    assert.equal(sections.get('Rule'), [
      '# ----------- Module A -----------',
      'DOMAIN,ads.example,REJECT\nIP-CIDR,192.0.2.0/24,REJECT,no-resolve\nURL-REGEX,"^https://x\\.test/[a,-z]",REJECT',
      '# ----------- Module B -----------',
      [
        'IP-CIDR,192.0.2.0/24,REJECT,no-resolve',
        'IP-CIDR,192.0.2.0/24,REJECT',
        'URL-REGEX,"^https://x\\.test/[a, -z]",REJECT',
        'DOMAIN,new.example,REJECT',
      ].join('\n'),
    ].join('\n\n'), 'a module whose rules all repeat leaves no empty divider');
    assert.equal(merger.getStats().rulesDeduplicated, 4);
  });
});

describe('module merger integration', () => {
  it('merges local fixtures into sgmodule and rulelist outputs', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-module-merger-'));

    try {
      fs.writeFileSync(
        path.join(tempDir, 'module-a.sgmodule'),
        `[Rule]
DOMAIN,example.com,PROXY
DOMAIN-SUFFIX,ads.com,REJECT
[Header Rewrite]
http-response ^https://example.com/a header-add "grpc-status" "0"
[Body Rewrite]
http-response-jq ^https://example.com/a 'del(.ads)'
[MITM]
hostname = %APPEND% a.com, b.com`
      );
      fs.writeFileSync(
        path.join(tempDir, 'module-b.sgmodule'),
        `[Rule]
DOMAIN,other.com,DIRECT
[header rewrite]
http-response ^https://example.com/b header-add "X-Test" "1"
[body rewrite]
http-response-jq ^https://example.com/b '.enabled=true'
[MITM]
hostname = %APPEND% b.com, c.com`
      );
      fs.writeFileSync(
        path.join(tempDir, 'template.txt'),
        `#!name={{{name}}}
{{{sections_body}}}`
      );
      fs.writeFileSync(
        path.join(tempDir, 'merge-config.yaml'),
        `name: Module Merger Integration Test
version: 1.0.0
description: Characterization test
category: Test
author: Test
modules:
  - url: file://module-a.sgmodule
    header: Fixture A
  - url: file://module-b.sgmodule
    header: Fixture B
output:
  sgmodule: ./output.sgmodule
  rulelist: ./output.rulelist
  template: ./template.txt`
      );

      const result = await mergeModules(path.join(tempDir, 'merge-config.yaml'));

      assert.equal(result.stats.modulesProcessed, 2);
      assert.equal(result.sgmodule.includes('[Rule]'), true);
      assert.equal(result.sgmodule.includes('[MITM]'), true);
      assert.ok(result.sgmodule.includes('[Header Rewrite]'));
      assert.ok(result.sgmodule.includes('[Body Rewrite]'));
      for (const action of [
        'http-response ^https://example.com/a header-add "grpc-status" "0"',
        'http-response ^https://example.com/b header-add "X-Test" "1"',
        'http-response-jq ^https://example.com/a \'del(.ads)\'',
        'http-response-jq ^https://example.com/b \'.enabled=true\'',
      ]) assert.ok(result.sgmodule.includes(action), action);
      assert.equal(result.rulelist.includes('DOMAIN,example.com'), true);
      assert.equal(result.rulelist.includes('DOMAIN-SUFFIX,ads.com'), true);
      assert.equal(result.rulelist.includes('DOMAIN,other.com'), true);
      assert.equal(result.rulelist.includes('PROXY'), false);
      assert.equal(result.rulelist.includes('DIRECT'), false);

      assert.equal(fs.existsSync(path.join(tempDir, 'output.sgmodule')), true);
      assert.equal(fs.existsSync(path.join(tempDir, 'output.rulelist')), true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
