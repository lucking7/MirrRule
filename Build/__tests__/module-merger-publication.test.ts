import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { mergeModules } from '../lib/module-merger';
import { prepareModuleContent } from '../lib/module-merger/module-content';
import { TemplateEngine } from '../lib/module-merger/template-engine';

const templatePath = path.resolve(__dirname, '../lib/module-merger/templates/all-in-one.template');

function fixture(directory: string, contents: Array<string | null>) {
  const modules = contents.map((content, index) => {
    const url = path.join(directory, `module-${index}.sgmodule`);
    if (content !== null) fs.writeFileSync(url, content);
    return { url, header: `Module ${index}`, id: `mod${index}` };
  });
  const config = {
    name: 'Test', version: '1', description: 'Test', category: 'Test', author: 'Test', modules,
    output: {
      sgmodule: path.join(directory, 'merged/output.sgmodule'),
      template: templatePath,
    },
  };
  const configPath = path.join(directory, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config));
  return { configPath, config };
}

function source(header: string, content: string) {
  return { header, content };
}

describe('module merger publication contracts', () => {
  for (const contents of [[null], ['[Rule]\nDOMAIN,ads.example,REJECT', null]]) {
    it(`fails the CLI and preserves the old output when ${contents.length === 1 ? 'all' : 'some'} inputs are missing`, t => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-merge-failure-'));
      t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
      const { config, configPath } = fixture(directory, contents);
      fs.mkdirSync(path.dirname(config.output.sgmodule), { recursive: true });
      fs.writeFileSync(config.output.sgmodule, 'previous');
      const result = spawnSync(process.execPath, [
        '-r', '@swc-node/register', path.resolve(__dirname, '../merge-modules.ts'), '--config', configPath,
      ], { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', env: { ...process.env, SWC_NODE_IGNORE_DYNAMIC: 'true' } });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /模块加载失败/);
      assert.equal(fs.readFileSync(config.output.sgmodule, 'utf8'), 'previous');
      assert.deepEqual(fs.readdirSync(path.dirname(config.output.sgmodule)), ['output.sgmodule']);
    });
  }

  it('rejects unknown selections, empty selections and invalid input even in dry-run', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-merge-selection-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const { configPath, config } = fixture(directory, ['<html>Service unavailable</html>']);
    await assert.rejects(mergeModules(configPath, { only: ['typo'], dryRun: true }), /未知模块/);
    await assert.rejects(mergeModules(configPath, { disable: ['mod0'] }), /没有选中/);
    await assert.rejects(mergeModules(configPath, { dryRun: true }), /没有可合并/);
    assert.equal(fs.existsSync(config.output.sgmodule), false);
  });

  it('creates the output directory and preserves source defaults and unique script names', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-merge-output-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const { configPath, config } = fixture(directory, [
      '#!arguments=debug:false,captionLang:"zh-Hans,en",enable:#\n#!arguments-desc=debug: Debug mode\\ncaptionLang: Language\n[Script]\n{{{enable}}}rewrite = type=http-response, pattern=^https://a/, script-path=https://a/script.js, argument=debug="{{{debug}}}"&lang="{{{captionLang}}}"\nrewrite = type=http-response, pattern=^https://b/, script-path=https://b/script.js',
      '#!arguments=debug:true\n[Script]\nrewrite = type=http-response, pattern=^https://c/, script-path=https://c/script.js, argument={{{debug}}}\n[Rule]\nDOMAIN,ads.example,REJECT',
    ]);
    const result = await mergeModules(configPath);
    assert.equal(result.stats.modulesProcessed, 2);
    assert.equal(fs.readFileSync(config.output.sgmodule, 'utf8'), result.sgmodule);
    assert.match(result.sgmodule, /m_[\da-f]+_debug:false/);
    assert.match(result.sgmodule, /m_[\da-f]+_debug:true/);
    assert.match(result.sgmodule, /m_[\da-f]+_captionLang:"zh-Hans,en"/);
    assert.match(result.sgmodule, /m_[\da-f]+_debug: Debug mode/);
    assert.match(result.sgmodule, /{{{mod0}}}{{{m_[\da-f]+_enable}}}m_/);
    assert.match(result.sgmodule, /#!arguments = mod0:,mod1:,m_/);
    assert.equal(result.sgmodule.includes('_script'), false);
    const offByDefault = structuredClone(config);
    Object.assign(offByDefault.modules[1], { defaultOff: true });
    fs.writeFileSync(configPath, JSON.stringify(offByDefault));
    assert.match((await mergeModules(configPath, { dryRun: true })).sgmodule, /#!arguments = mod0:,mod1:#,m_/);
    fs.writeFileSync(configPath, JSON.stringify(config));
    const withDefaults = result.sgmodule.replaceAll(/{{{mod[01]}}}/g, '').replaceAll(/{{{m_[\da-f]+_enable}}}/g, '#');
    assert.match(withDefaults, /^#m_[\da-f]+_1_rewrite = type=/m);
    const scripts = Array.from(result.sgmodule.matchAll(/^(.*?) = type=/gm), match => match[1].replaceAll(/{{{[^{}]+}}}/g, '1'));
    assert.equal(scripts.length, 3);
    assert.equal(new Set(scripts).size, 3);
    const declared = new Set(Array.from(result.sgmodule.matchAll(/(?: = |,)([^,:]+):/g), match => match[1]));
    for (const match of result.sgmodule.matchAll(/{{{([^{}]+)}}}/g)) {
      assert.ok(declared.has(match[1]), `Undefined parameter ${match[1]}`);
    }
    assert.deepEqual(fs.readdirSync(path.dirname(config.output.sgmodule)), ['output.sgmodule']);
    const dryRun = await mergeModules(configPath, { dryRun: true });
    assert.equal(dryRun.sgmodule, result.sgmodule);
  });

  it('rejects duplicate, missing or non-ASCII ids, legacy script switch fields and a leftover rule list output', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-merge-config-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const { configPath, config } = fixture(directory, ['[Rule]\nDOMAIN,a.example,REJECT', '[Rule]\nDOMAIN,b.example,REJECT']);
    const attempt = async (mutate: (modules: Array<Record<string, unknown>>) => void, pattern: RegExp) => {
      const copy = structuredClone(config);
      mutate(copy.modules);
      fs.writeFileSync(configPath, JSON.stringify(copy));
      await assert.rejects(mergeModules(configPath, { dryRun: true }), pattern);
    };
    await attempt(modules => { modules[1].header = modules[0].header; }, /必须唯一/);
    await attempt(modules => { modules[1].id = modules[0].id; }, /必须唯一/);
    await attempt(modules => { delete modules[0].id; }, /id 必须以字母开头/);
    for (const id of ['高德', '1abc', '_x', 'a-b', 'a b', '']) {
      await attempt(modules => { modules[0].id = id; }, /id 必须以字母开头/);
    }
    await attempt(modules => { modules[0].defaultOff = 'yes'; }, /defaultOff 必须是布尔值/);
    for (const field of ['scriptToggle', 'scriptDefaultOn']) {
      await attempt(modules => { modules[0][field] = true; }, new RegExp(`${field} 已停用`));
    }

    fs.writeFileSync(configPath, JSON.stringify({ ...config, output: { ...config.output, rulelist: path.join(directory, 'rules.list') } }));
    await assert.rejects(mergeModules(configPath, { dryRun: true }), /output\.rulelist 已停用/);
  });

  it('rejects a module switch that collides with a namespaced source argument', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-merge-collision-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const { configPath, config } = fixture(directory, ['#!arguments=debug:false\n[Rule]\nDOMAIN,a.example,REJECT', '[Rule]\nDOMAIN,b.example,REJECT']);
    const namespace = `m_${createHash('sha256').update('Module 0').digest('hex').slice(0, 16)}`;
    config.modules[1].id = `${namespace}_debug`;
    fs.writeFileSync(configPath, JSON.stringify(config));
    await assert.rejects(mergeModules(configPath, { dryRun: true }), /模块开关与源参数名称冲突/);
  });
});

describe('module content import', () => {
  it('renames scripts while preserving comments and source toggles', () => {
    const module = source('Demo', '#!arguments=enable:#\n[Script]\n# comment = preserved\n\n{{{enable}}}response = type=http-response, script-path=https://example/script.js');
    const prepared = prepareModuleContent(module, false);
    assert.match(prepared.sections[0].content, /^# comment = preserved\n\n{{{m_[\da-f]+_enable}}}m_[\da-f]+_1_response = type=http-response/);
    assert.deepEqual([...prepared.defaults.values()], ['#']);
  });

  it('rewrites Panel references and keeps the script definition unchanged', () => {
    const prepared = prepareModuleContent(source('Panel', '[Script]\nstatus = type=generic, script-path=https://example/script.js\n[Panel]\nstatus = script-name=status, update-interval=60'), true);
    const script = prepared.sections[0].content.split(' = ')[0];
    assert.match(prepared.sections[0].content, / = type=generic, script-path=https:\/\/example\/script.js$/);
    assert.ok(prepared.sections[1].content.includes(`script-name=${script},`));
    assert.deepEqual(prepareModuleContent(source('Panel', '[Script]\nstatus = type=generic, script-path=https://example/script.js\n[Panel]\nstatus = script-name=status, update-interval=60'), true), prepared);
  });

  it('rejects undefined parameters, duplicate definitions and ambiguous Panel references', () => {
    assert.throws(() => prepareModuleContent(source('Bad', '[Script]\na = type=generic, argument={{{missing}}}'), true), /未定义/);
    assert.throws(() => prepareModuleContent(source('Bad', '#!arguments=x:1,x:2\n[Rule]\nDOMAIN,a,REJECT'), true), /重复/);
    assert.throws(() => prepareModuleContent(source('Bad', '[Script]\na = type=generic\na = type=generic\n[Panel]\na = script-name=a'), true), /缺失或重名/);
    assert.throws(() => prepareModuleContent(source('Bad', '#!arguments=x:"unclosed\n[Rule]\nDOMAIN,a,REJECT'), true), /未闭合/);
  });

  it('preserves escaped delimiters and empty parameter defaults', () => {
    const prepared = prepareModuleContent(source('Escapes', String.raw`#!arguments=empty:,value:a\,b,quoted:"a\"b,c"
[Rule]
DOMAIN,a.example,REJECT`), true);
    assert.deepEqual(Array.from(prepared.defaults.values()), ['', String.raw`a\,b`, String.raw`"a\"b,c"`]);
  });

  it('renders dollar sequences literally and does not re-expand inserted content', () => {
    const body = '$& $$ $` $\' {{{name}}}';
    assert.equal(TemplateEngine.render('{{{sections_body}}} {{name}}', { sections_body: body, name: 'Title' }), `${body} Title`);
    assert.equal(TemplateEngine.render('{{a.b}} {{axb}}', { 'a.b': '$&' }), '$& {{axb}}');
  });
});
