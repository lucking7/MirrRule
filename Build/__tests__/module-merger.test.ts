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

  it('drops rules whose matcher repeats an earlier rule of the same module, whatever the policy', () => {
    const merger = new ModuleMerger(options);
    merger.addSection({
      type: 'Rule',
      header: 'Module A',
      content: [
        'DOMAIN,ads.example,REJECT',
        'domain, ads.example, REJECT-TINYGIF',
        'DOMAIN,ads.example,DIRECT',
        // An earlier rule may trigger DNS resolution, after which a repeated no-resolve rule can match.
        'IP-CIDR,192.0.2.0/24,REJECT,no-resolve',
        'IP-CIDR,192.0.2.0/24,REJECT,no-resolve',
        'IP-CIDR,192.0.2.0/24,REJECT',
        // Spaces inside a regular expression change what it matches.
        String.raw`URL-REGEX,"^https://x\.test/[a,-z]",REJECT`,
        String.raw`URL-REGEX,"^https://x\.test/[a, -z]",REJECT`,
        String.raw`URL-REGEX,"^https://x\.test/[a,-z]",REJECT-TINYGIF`,
        // Patterns that differ only inside the quotes are different rules.
        String.raw`URL-REGEX,"^https://a\.com/b,c",REJECT`,
        String.raw`URL-REGEX,"^https://a\.com/b,d",REJECT`,
      ].join('\n'),
    });
    // Another module keeps its own copy, so switching Module A off cannot lose these rules.
    merger.addSection({ type: 'Rule', header: 'Module B', content: 'DOMAIN,ads.example,REJECT\nDOMAIN,ads.example,REJECT' });

    const { sections } = merger.merge();
    assert.equal(sections.get('Rule'), [
      '# ----------- Module A -----------',
      [
        'DOMAIN,ads.example,REJECT',
        'IP-CIDR,192.0.2.0/24,REJECT,no-resolve',
        'IP-CIDR,192.0.2.0/24,REJECT,no-resolve',
        'IP-CIDR,192.0.2.0/24,REJECT',
        String.raw`URL-REGEX,"^https://x\.test/[a,-z]",REJECT`,
        String.raw`URL-REGEX,"^https://x\.test/[a, -z]",REJECT`,
        String.raw`URL-REGEX,"^https://a\.com/b,c",REJECT`,
        String.raw`URL-REGEX,"^https://a\.com/b,d",REJECT`,
      ].join('\n'),
      '# ----------- Module B -----------',
      'DOMAIN,ads.example,REJECT',
    ].join('\n\n'));
    assert.equal(merger.getStats().rulesDeduplicated, 4);
  });

  it('prefixes active lines of per-line sections with the module switch, but not MITM or comments', () => {
    const merger = new ModuleMerger({ ...options, stripComments: false });
    merger.addSection({ type: 'Rule', header: 'Module A', content: '# note\nDOMAIN,a.example,REJECT' }, 'mod_a');
    merger.addSection({ type: 'Map Local', header: 'Module A', content: '^https://a/ data-type=text data="{}"' }, 'mod_a');
    merger.addSection({ type: 'MITM', header: 'Module A', content: 'hostname = %APPEND% a.example' }, 'mod_a');
    const { sections, hostnames } = merger.merge();
    assert.equal(sections.get('Rule'), '# ----------- Module A -----------\n\n# note\n{{{mod_a}}}DOMAIN,a.example,REJECT');
    assert.equal(sections.get('Map Local'), '# ----------- Module A -----------\n\n{{{mod_a}}}^https://a/ data-type=text data="{}"');
    assert.equal(sections.get('MITM'), '# ----------- Module A -----------\n\nhostname = %APPEND% a.example');
    assert.deepEqual(hostnames, ['a.example']);
  });
});

function writeFixture(tempDir: string) {
  fs.writeFileSync(
    path.join(tempDir, 'module-a.sgmodule'),
    `#!arguments=policy:REJECT
[Rule]
DOMAIN,example.com,PROXY
DOMAIN-SUFFIX,ads.com,REJECT
DOMAIN,policy.example,{{{policy}}}
[URL Rewrite]
^https://example.com/old https://example.com/new 302
[Header Rewrite]
http-response ^https://example.com/a header-add "grpc-status" "0"
[Body Rewrite]
http-response-jq ^https://example.com/a 'del(.ads)'
[Map Local]
^https://example.com/map data-type=text data="{}"
[Script]
a = type=http-response, pattern=^https://example.com/a, script-path=https://example.com/a.js
[MITM]
hostname = %APPEND% a.com, b.com`
  );
  fs.writeFileSync(
    path.join(tempDir, 'module-b.sgmodule'),
    `[Rule]
DOMAIN,other.com,DIRECT
DOMAIN-SUFFIX,ads.com,REJECT
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
{{{header_extra}}}
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
    id: fixture_a
  - url: file://module-b.sgmodule
    header: Fixture B
    id: fixture_b
output:
  sgmodule: ./output.sgmodule
  template: ./template.txt`
  );
  return path.join(tempDir, 'merge-config.yaml');
}

/** Replace every {{{name}}} with a value, as Surge does before it applies the module. */
function applyArguments(sgmodule: string, overrides: Record<string, string> = {}): string {
  const line = /^#!arguments = (.*)$/m.exec(sgmodule)![1];
  const values = new Map(line.split(',').map(entry => [entry.slice(0, entry.indexOf(':')), entry.slice(entry.indexOf(':') + 1)]));
  for (const [name, value] of Object.entries(overrides)) values.set(name, value);
  return sgmodule.replaceAll(/{{{([^{}]+)}}}/g, (_match, name: string) => {
    assert.ok(values.has(name), `Undefined parameter ${name}`);
    return values.get(name)!;
  });
}

function activeLinesBySection(sgmodule: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  let section = '';
  for (const line of sgmodule.split('\n')) {
    const header = /^\[(.+)]$/.exec(line);
    if (header) {
      section = header[1];
      result.set(section, []);
    } else if (section && line.trim() && !line.startsWith('#')) {
      result.get(section)!.push(line);
    }
  }
  return result;
}

describe('module merger integration', () => {
  const ignoredWarnings: string[] = [];
  const sectionTypes = ['Rule', 'URL Rewrite', 'Header Rewrite', 'Body Rewrite', 'Map Local', 'Script'];

  it('merges local fixtures into one sgmodule whose [Rule] section is the only rule output', async (t) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-module-merger-'));
    t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
    const warnings: string[] = [];
    t.mock.method(console, 'warn', (message: string) => warnings.push(message));

    const result = await mergeModules(writeFixture(tempDir));

    assert.equal(result.stats.modulesProcessed, 2);
    assert.equal(result.stats.rulesDroppedForPolicy, 1);
    assert.equal(result.stats.rulesDeduplicated, 0);
    assert.ok(warnings.some(message => message.startsWith('::warning::Fixture A:') && message.includes('DOMAIN,example.com,PROXY')), warnings.join('\n'));
    assert.deepEqual(fs.readdirSync(tempDir).sort(), ['merge-config.yaml', 'module-a.sgmodule', 'module-b.sgmodule', 'output.sgmodule', 'template.txt']);
    assert.equal(fs.readFileSync(path.join(tempDir, 'output.sgmodule'), 'utf8'), result.sgmodule);

    const active = activeLinesBySection(applyArguments(result.sgmodule));
    assert.deepEqual(active.get('Rule'), [
      'DOMAIN-SUFFIX,ads.com,REJECT',
      'DOMAIN,policy.example,REJECT',
      'DOMAIN,other.com,DIRECT',
      // Kept although Fixture A has it: switching Fixture A off must not drop Fixture B's rule.
      'DOMAIN-SUFFIX,ads.com,REJECT',
    ]);
    assert.match(result.sgmodule, /^{{{fixture_a}}}DOMAIN,policy\.example,{{{m_[\da-f]{16}_policy}}}$/m);
    assert.equal(result.sgmodule.includes('PROXY'), false);
    for (const action of [
      'http-response ^https://example.com/a header-add "grpc-status" "0"',
      'http-response ^https://example.com/b header-add "X-Test" "1"',
      'http-response-jq ^https://example.com/a \'del(.ads)\'',
      'http-response-jq ^https://example.com/b \'.enabled=true\'',
    ]) assert.ok(result.sgmodule.includes(action), action);
    assert.equal(/^\[MITM]\nhostname = %APPEND% (.*)$/m.exec(result.sgmodule)?.[1], 'a.com, b.com, c.com');
  });

  it('gives every module one switch for all its per-line sections and keeps the script switch as a second prefix', async (t) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-module-switch-'));
    t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
    t.mock.method(console, 'warn', (message: string) => ignoredWarnings.push(message));
    const { sgmodule } = await mergeModules(writeFixture(tempDir));

    assert.match(sgmodule, /^#!arguments = fixture_a:,fixture_b:,fixture_a_script:#,m_[\da-f]{16}_policy:REJECT$/m);
    const description = /^#!arguments-desc = (.*)$/m.exec(sgmodule)![1];
    for (const entry of ['fixture_a: Fixture A', 'fixture_b: Fixture B', 'fixture_a_script: Fixture A的脚本']) {
      assert.ok(description.includes(entry), entry);
    }
    assert.match(sgmodule, /^{{{fixture_a}}}{{{fixture_a_script}}}m_[\da-f]{16}_1_a = type=http-response/m);

    const scriptOn = activeLinesBySection(applyArguments(sgmodule, { fixture_a_script: '' }));
    const fixtureAOff = activeLinesBySection(applyArguments(sgmodule, { fixture_a: '#', fixture_a_script: '' }));
    for (const section of sectionTypes) {
      assert.ok(scriptOn.get(section)!.length > fixtureAOff.get(section)!.length, `Fixture A switch covers ${section}`);
    }
    assert.deepEqual(fixtureAOff.get('Rule'), ['DOMAIN,other.com,DIRECT', 'DOMAIN-SUFFIX,ads.com,REJECT']);
    assert.deepEqual(fixtureAOff.get('URL Rewrite'), []);
    assert.deepEqual(fixtureAOff.get('Map Local'), []);
    assert.deepEqual(fixtureAOff.get('Script'), []);
    assert.deepEqual(fixtureAOff.get('Header Rewrite'), ['http-response ^https://example.com/b header-add "X-Test" "1"']);
    assert.deepEqual(fixtureAOff.get('Body Rewrite'), ['http-response-jq ^https://example.com/b \'.enabled=true\'']);
    assert.equal(fixtureAOff.get('MITM')!.length, 1, 'MITM stays one always-on union');

    // Either switch set to # leaves the script commented.
    assert.deepEqual(activeLinesBySection(applyArguments(sgmodule)).get('Script'), []);
    assert.deepEqual(activeLinesBySection(applyArguments(sgmodule, { fixture_a: '#', fixture_a_script: '#' })).get('Script'), []);
    assert.equal(scriptOn.get('Script')!.length, 1);
  });

  it('puts a divider before every module that contributes lines to a section', async (t) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-module-divider-'));
    t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
    t.mock.method(console, 'warn', (message: string) => ignoredWarnings.push(message));
    const { sgmodule } = await mergeModules(writeFixture(tempDir));

    const contributors = new Map<string, string[]>();
    let section = '';
    let divider = '';
    for (const line of sgmodule.split('\n')) {
      const header = /^\[(.+)]$/.exec(line);
      const dividerMatch = /^# -+ (.+?) -+$/.exec(line);
      if (header) [section, divider] = [header[1], ''];
      else if (dividerMatch) divider = dividerMatch[1];
      else if (section && section !== 'MITM' && line.trim() && !line.startsWith('#')) {
        assert.ok(divider, `${section} line without divider: ${line}`);
        const list = contributors.get(section) ?? [];
        if (!list.includes(divider)) list.push(divider);
        contributors.set(section, list);
      }
    }
    assert.deepEqual(Object.fromEntries(contributors), {
      Rule: ['Fixture A', 'Fixture B'],
      'URL Rewrite': ['Fixture A'],
      'Header Rewrite': ['Fixture A', 'Fixture B'],
      'Body Rewrite': ['Fixture A', 'Fixture B'],
      'Map Local': ['Fixture A'],
      Script: ['Fixture A'],
    });
  });
});
