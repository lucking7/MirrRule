/**
 * 模块合并器主入口
 */

import process from 'node:process';
import picocolors from 'picocolors';
import type { MergeResult, TemplateData, MergeRuntimeOptions, ModuleSource, SectionType } from './types';
import { prepareModuleContent } from './module-content';
import { writeFileAtomic } from '../atomic-file';
import { ModuleMerger } from './merger';
import { TemplateEngine } from './template-engine';
import { loadMergeConfig } from './config-loader';
import { ModuleLoader } from './module-loader';
import { cleanPolicyForModule } from '../policy-cleaner';

/**
 * .sgmodule 输出中 Section 的固定排列顺序
 * MITM 单独处理（需要聚合 hostname），不在此列表中
 */
const SECTION_OUTPUT_ORDER: SectionType[] = [
  'General', 'Rule', 'URL Rewrite', 'Header Rewrite', 'Body Rewrite', 'Map Local', 'Script', 'Panel', 'Task',
];

/**
 * 合并模块
 * @param configPath 配置文件路径
 * @param runtimeOptions 运行时选项
 * @returns 合并结果
 */
export async function mergeModules(
  configPath: string,
  runtimeOptions: MergeRuntimeOptions = {}
): Promise<MergeResult> {
  console.log(picocolors.cyan('\nModule Merger\n'));

  // 1. 加载配置
  console.log(picocolors.gray('Loading configuration...'));
  const loadedConfig = await loadMergeConfig(configPath);
  const { config, baseDir } = loadedConfig;
  console.log(
    picocolors.green(`✓ Loaded config: ${config.name} (${config.modules.length} modules)`)
  );

  // 1.1 根据运行时选项筛选需要参与合并的模块
  const selectedModules = selectModuleSources(config.modules, runtimeOptions);
  if (!selectedModules.length) throw new Error('没有选中任何模块，拒绝生成空产物');
  console.log(
    picocolors.gray(
      `  - Modules selected for merge: ${selectedModules.length} / ${config.modules.length}`
    )
  );

  // 2. 下载模块（已保证按配置顺序返回）
  console.log(picocolors.cyan('\nDownloading modules...'));
  const loader = new ModuleLoader([baseDir, process.cwd()]);
  const { loaded, failures } = await loader.loadAll(selectedModules);
  loaded.forEach(module => {
    console.log(picocolors.green(`  ✓ ${module.header}`));
  });
  failures.forEach(failure => {
    console.log(picocolors.red(`  ✗ ${failure.header}: ${failure.reason}`));
  });
  if (failures.length) {
    throw new Error(`模块加载失败，未写入输出: ${failures.map(failure => `${failure.header}: ${failure.reason}`).join('; ')}`);
  }

  const merger = new ModuleMerger(config.options);
  const scriptHeaders = new Set<string>();
  const sourceByHeader = new Map(selectedModules.map(source => [source.header, source]));
  const sourceArguments = new Map<string, string>();
  const sourceDescriptions: string[] = [];
  let rulesDroppedForPolicy = 0;

  loaded.forEach(module => {
    const source = sourceByHeader.get(module.header)!;
    const scriptSwitch = source.scriptToggle === false ? undefined : `${source.id}_script`;
    const { sections, defaults, argumentsDesc } = prepareModuleContent(module, config.options.stripComments, scriptSwitch);
    for (const [name, value] of defaults) {
      if (sourceArguments.has(name)) throw new Error(`参数名称冲突: ${name}`);
      sourceArguments.set(name, value);
    }
    if (argumentsDesc) sourceDescriptions.push(String.raw`${module.header} 源参数\n${argumentsDesc}`);
    sections.forEach(section => {
      if (section.type.toLowerCase() === 'script') {
        scriptHeaders.add(module.header);
      }
      if (section.type === 'Rule') {
        const cleaned = _cleanModuleRules(section.content, module.header);
        section.content = cleaned.content;
        rulesDroppedForPolicy += cleaned.dropped;
      }
      merger.addSection(section, source.id);
    });
  });

  const switches = _buildSwitchInfo(selectedModules, scriptHeaders);

  // 3. 合并
  console.log(picocolors.cyan('\nMerging sections...'));
  const { sections, hostnames } = merger.merge();

  // 4. 构建输出内容
  console.log(picocolors.cyan('\nBuilding output...'));

  for (const info of switches) {
    if (sourceArguments.has(info.argumentName)) throw new Error(`模块开关与源参数名称冲突: ${info.argumentName}`);
  }
  const argumentsLine = [
    ...switches.map(info => `${info.argumentName}:${info.defaultOn ? '' : '#'}`),
    ...Array.from(sourceArguments, ([name, value]) => `${name}:${value}`),
  ].join(',');
  const argumentsDesc = [_buildSwitchDescription(switches), ...sourceDescriptions].join(String.raw`\n\n`);

  // 4.1 构建模板头部额外信息（模块开关与源参数）
  const headerExtraParts = [`#!arguments = ${argumentsLine}`, `#!arguments-desc = ${argumentsDesc}`];

  // 4.2 动态构建 sections body
  const sectionParts: string[] = [];
  const usedSections = new Set<string>();

  for (const sectionType of SECTION_OUTPUT_ORDER) {
    const content = sections.get(sectionType)?.trim();
    if (!content) continue;

    usedSections.add(sectionType);

    sectionParts.push(`[${sectionType}]\n${content}`);
  }

  // MITM section（聚合所有模块的 hostname，始终输出）
  if (hostnames.length > 0) {
    sectionParts.push(`[MITM]\nhostname = %APPEND% ${hostnames.join(', ')}`);
  }
  if (!sectionParts.length) throw new Error('没有可输出的 section，拒绝生成空产物');

  // 检查是否有未被模板使用的 section 类型
  for (const [type] of sections) {
    if (type.toLowerCase() !== 'mitm' && !usedSections.has(type)) {
      console.log(
        picocolors.yellow(`  ⚠ Section [${type}] 存在于源模块中但未包含在输出中`)
      );
    }
  }

  // 4.3 渲染模板
  console.log(picocolors.cyan('\nRendering template...'));
  const template = await TemplateEngine.loadTemplate(config.output.template);

  const templateData: TemplateData = {
    name: config.name,
    description: config.description,
    category: config.category,
    author: config.author,
    currentDate: new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }),
    header_extra: headerExtraParts.join('\n'),
    sections_body: sectionParts.join('\n\n'),
  };

  const sgmodule = TemplateEngine.render(template, templateData);
  if (!sgmodule.includes(`#!arguments = ${argumentsLine}`)) {
    throw new Error('模板必须输出 header_extra 以保留模块参数');
  }

  // 5. 写入文件
  if (runtimeOptions.dryRun) {
    console.log(picocolors.yellow('\nDRY RUN: 输出文件未写入磁盘'));
  } else {
    console.log(picocolors.cyan('\nWriting output file...'));
    await writeFileAtomic(config.output.sgmodule, sgmodule);
    console.log(picocolors.green(`  ✓ Saved: ${config.output.sgmodule}`));
  }

  const stats = merger.getStats();
  console.log(picocolors.green('\n✓ Merge completed'));
  console.log(picocolors.gray(`  - Modules processed: ${loaded.length}`));
  console.log(picocolors.gray(`  - Modules failed: ${failures.length}`));
  console.log(picocolors.gray(`  - Sections extracted: ${stats.sectionsExtracted}`));
  console.log(picocolors.gray(`  - Hostnames deduplicated: ${stats.hostnamesDeduplicated}`));
  console.log(picocolors.gray(`  - Repeated rules removed within modules: ${stats.rulesDeduplicated}`));
  console.log(picocolors.gray(`  - Rules removed for unknown policies: ${rulesDroppedForPolicy}`));

  return {
    sgmodule,
    stats: {
      modulesProcessed: loaded.length,
      ...stats,
      rulesDroppedForPolicy,
    },
  };
}

interface SwitchInfo {
  header: string,
  argumentName: string,
  defaultOn: boolean,
  /** 只控制 [Script] 行的第二个开关 */
  scriptOnly: boolean
}

/* eslint-disable sukka/no-single-return -- helper functions use explicit early returns for readability */
/**
 * 根据运行时选项筛选需要参与合并的模块
 */
export function selectModuleSources(
  modules: ModuleSource[],
  runtimeOptions: MergeRuntimeOptions
): ModuleSource[] {
  if (!modules.length) {
    return modules;
  }

  const onlyKeys = (runtimeOptions.only ?? []).map(_normalizeRuntimeKey);
  const enableKeys = (runtimeOptions.enable ?? []).map(_normalizeRuntimeKey);
  const disableKeys = (runtimeOptions.disable ?? []).map(_normalizeRuntimeKey);
  const availableKeys = new Set(modules.map(_getModuleKey));
  for (const key of [...onlyKeys, ...enableKeys, ...disableKeys]) {
    if (!availableKeys.has(key)) throw new Error(`未知模块 key: ${key}`);
  }

  const onlySet = onlyKeys.length ? new Set(onlyKeys) : null;
  const enableSet = new Set(enableKeys);
  const disableSet = new Set(disableKeys);

  return modules.filter(source => {
    const key = _getModuleKey(source);

    if (onlySet) {
      return onlySet.has(key);
    }

    const enabledFromSource = source.enabledByDefault;
    let enabled = enabledFromSource ?? true;

    if (enableSet.has(key)) {
      enabled = true;
    }

    if (disableSet.has(key)) {
      enabled = false;
    }

    return enabled;
  });
}

function _getModuleKey(source: ModuleSource): string {
  return source.id;
}

function _normalizeRuntimeKey(raw: string): string {
  return raw.trim();
}

/**
 * 删除策略不是 Surge 内置策略也不是参数的规则：模块规则引用用户配置中不存在的策略时 Surge 会报错。
 */
function _cleanModuleRules(content: string, header: string): { content: string, dropped: number } {
  let dropped = 0;
  const lines: string[] = [];
  for (const line of content.split('\n')) {
    const cleaned = cleanPolicyForModule(line);
    if (cleaned === null) {
      dropped++;
      console.warn(`::warning::${header}: 规则的策略不是 Surge 内置策略，已从合并模块删除: ${line.trim()}`);
    } else {
      lines.push(cleaned);
    }
  }
  return { content: lines.join('\n'), dropped };
}

/**
 * 按配置中模块顺序生成开关：先列出每个模块的整模块开关（默认开启），
 * 再列出今天已有脚本开关的模块的 <id>_script 开关（默认值来自 scriptDefaultOn）。
 */
function _buildSwitchInfo(
  modules: ModuleSource[],
  scriptHeaders: Set<string>
): SwitchInfo[] {
  const moduleSwitches = modules.map(source => ({
    header: source.header,
    argumentName: source.id,
    defaultOn: true,
    scriptOnly: false,
  }));
  const scriptSwitches = modules.flatMap(source => (source.scriptToggle !== false && scriptHeaders.has(source.header)
    ? [{
      header: source.header,
      argumentName: `${source.id}_script`,
      defaultOn: source.scriptDefaultOn ?? false,
      scriptOnly: true,
    }]
    : []));
  return [...moduleSwitches, ...scriptSwitches];
}

/**
 * 生成 #!arguments-desc 中开关部分：先说明一次用法，再逐个列出开关对应的模块。
 * 开启必须是空值，才能与源模块自己的 # 注释开关组合。
 */
function _buildSwitchDescription(switches: SwitchInfo[]): string {
  const usage = [
    '模块开关：留空表示启用，填 # 表示停用。',
    '停用后，该模块在 Rule、URL Rewrite、Header Rewrite、Body Rewrite、Map Local、Script 中的所有行都会被注释掉。',
    'MITM 主机名不随开关变化，始终包含全部模块的主机名。',
    '以 _script 结尾的开关只控制该模块的 Script 行，模块开关或脚本开关任一填 # 时脚本都不运行。',
    '源模块自带的参数仍然有效。',
  ].join(String.raw`\n`);
  const moduleLines: string[] = [];
  const scriptLines: string[] = [];
  for (const info of switches) {
    if (info.scriptOnly) scriptLines.push(`${info.argumentName}: ${info.header}的脚本`);
    else moduleLines.push(`${info.argumentName}: ${info.header}`);
  }
  return [usage, moduleLines.join(String.raw`\n`), scriptLines.join(String.raw`\n`)].filter(Boolean).join(String.raw`\n\n`);
}

/* eslint-enable sukka/no-single-return */

export type { MergeRuntimeOptions, MergeResult } from './types';
