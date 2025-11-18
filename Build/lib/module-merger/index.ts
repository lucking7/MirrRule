/**
 * 模块合并器主入口
 */

import process from 'node:process';
import fs from 'node:fs/promises';
import path from 'node:path';
import picocolors from 'picocolors';
import type { MergeResult, TemplateData, MergeRuntimeOptions, ModuleSource } from './types';
import { SectionParser } from './section-parser';
import { ModuleMerger } from './merger';
import { TemplateEngine } from './template-engine';
import { loadMergeConfig } from './config-loader';
import { ModuleLoader } from './module-loader';

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
  console.log(picocolors.cyan('\n📦 Module Merger\n'));

  // 1. 加载配置
  console.log(picocolors.gray('Loading configuration...'));
  const loadedConfig = await loadMergeConfig(configPath);
  const { config, baseDir } = loadedConfig;
  console.log(
    picocolors.green(`✓ Loaded config: ${config.name} (${config.modules.length} modules)`)
  );

  // 1.1 根据运行时选项筛选需要参与合并的模块
  const selectedModules = _applyModuleSelection(config.modules, runtimeOptions);
  console.log(
    picocolors.gray(
      `  - Modules selected for merge: ${selectedModules.length} / ${config.modules.length}`
    )
  );

  // 2. 下载模块
  console.log(picocolors.cyan('\nDownloading modules...'));
  const loader = new ModuleLoader([baseDir, process.cwd()]);
  const { loaded, failures } = await loader.loadAll(selectedModules);
  loaded.forEach(module => {
    console.log(picocolors.green(`  ✓ ${module.header}`));
  });
  failures.forEach(failure => {
    console.log(picocolors.red(`  ✗ ${failure.header}: ${failure.reason}`));
  });

  const merger = new ModuleMerger(config.options);
  const scriptHeaders = new Set<string>();

  loaded.forEach(module => {
    const sections = SectionParser.parse(module.content, {
      header: module.header,
      stripComments: config.options.stripComments,
    });
    sections.forEach(section => {
      if (section.type.toLowerCase() === 'script') {
        scriptHeaders.add(module.header);
      }
      merger.addSection(section);
    });
  });

  const scriptToggleInfo = _buildScriptToggleInfo(selectedModules, scriptHeaders);
  const scriptToggleMap = Object.fromEntries(
    scriptToggleInfo.map(info => [info.header, info.argumentName] as const)
  );
  merger.setScriptToggleMap(scriptToggleMap);

  // 3. 合并
  console.log(picocolors.cyan('\nMerging sections...'));
  const { sections, hostnames } = merger.merge();

  // 4. 渲染模板
  console.log(picocolors.cyan('\nRendering template...'));
  const template = await TemplateEngine.loadTemplate(config.output.template);

  const { argumentsLine, argumentsDesc } = _buildArgumentsLines(scriptToggleInfo);

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
    hostname_append: hostnames.join(', '),
    arguments: argumentsLine,
    arguments_desc: argumentsDesc,
  };

  // 添加各个 Section
  for (const [type, content] of sections) {
    templateData[type] = content;
  }

  const sgmodule = TemplateEngine.render(template, templateData);

  // 5. 生成 rulelist
  const rulelist = sections.get('Rule') || '';

  // 6. 写入文件
  if (runtimeOptions.dryRun) {
    console.log(picocolors.yellow('\nDRY RUN: 输出文件未写入磁盘'));
  } else {
    console.log(picocolors.cyan('\nWriting output files...'));
    await fs.mkdir(path.dirname(config.output.sgmodule), { recursive: true });

    await fs.writeFile(config.output.sgmodule, sgmodule, 'utf-8');
    await fs.writeFile(config.output.rulelist, rulelist, 'utf-8');

    console.log(picocolors.green(`  ✓ Saved: ${config.output.sgmodule}`));
    console.log(picocolors.green(`  ✓ Saved: ${config.output.rulelist}`));
  }

  const stats = merger.getStats();
  console.log(picocolors.green('\n✓ Merge completed'));
  console.log(picocolors.gray(`  - Modules processed: ${loaded.length}`));
  console.log(picocolors.gray(`  - Modules failed: ${failures.length}`));
  console.log(picocolors.gray(`  - Sections extracted: ${stats.sectionsExtracted}`));
  console.log(picocolors.gray(`  - Hostnames deduplicated: ${stats.hostnamesDeduplicated}`));

  return {
    sgmodule,
    rulelist,
    stats: {
      modulesProcessed: loaded.length,
      modulesFailed: failures.length,
      ...stats,
    },
    failures,
  };
}

interface ScriptToggleInfo {
  header: string;
  argumentName: string;
}

/* eslint-disable sukka/no-single-return -- helper functions use explicit early returns for readability */
/**
 * 根据运行时选项筛选需要参与合并的模块
 */
function _applyModuleSelection(
  modules: ModuleSource[],
  runtimeOptions: MergeRuntimeOptions
): ModuleSource[] {
  if (!modules.length) {
    return modules;
  }

  const onlyKeys = (runtimeOptions.only ?? []).map(_normalizeRuntimeKey);
  const enableKeys = (runtimeOptions.enable ?? []).map(_normalizeRuntimeKey);
  const disableKeys = (runtimeOptions.disable ?? []).map(_normalizeRuntimeKey);

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
  return source.key?.trim() ?? source.header.trim();
}

function _normalizeRuntimeKey(raw: string): string {
  return raw.trim();
}

/**
 * 构建脚本开关信息，按配置中模块顺序输出
 */
function _buildScriptToggleInfo(
  modules: ModuleSource[],
  scriptHeaders: Set<string>
): ScriptToggleInfo[] {
  const result: ScriptToggleInfo[] = [];

  for (const source of modules) {
    if (source.scriptToggle === false) {
      continue;
    }
    if (!scriptHeaders.has(source.header)) {
      continue;
    }

    // argument 参数命名严格参考配置文件中的 header，本身作为参数名
    const argumentName = source.header.trim();

    result.push({
      header: source.header,
      argumentName,
    });
  }

  return result;
}

/**
 * 生成 #!arguments 和 #!arguments-desc 内容
 */
function _buildArgumentsLines(scriptToggles: ScriptToggleInfo[]): {
  argumentsLine: string;
  argumentsDesc: string;
} {
  if (!scriptToggles.length) {
    return {
      argumentsLine: '',
      argumentsDesc: '',
    };
  }

  const argumentsLine = scriptToggles.map(info => `${info.argumentName}:#`).join(',');

  const argumentsDesc = scriptToggles
    .map(
      info =>
        `${info.argumentName}: ${info.header}脚本开关\\n将 # 改为任意值即可启用/禁用该模块相关脚本`
    )
    .join('\\n\\n');

  return { argumentsLine, argumentsDesc };
}

/* eslint-enable sukka/no-single-return */

// 导出类型 & 类
export type {
  MergeConfig,
  MergeConfigFile,
  MergeOptions,
  MergeRuntimeOptions,
  ModuleSource,
  OutputConfig,
  SectionType,
  ParsedSection,
  LoadedModule,
  ModuleLoadError,
  MergeResult,
  MergeStats,
  TemplateData,
} from './types';
export { SectionParser } from './section-parser';
export { ModuleMerger } from './merger';
export { TemplateEngine } from './template-engine';
