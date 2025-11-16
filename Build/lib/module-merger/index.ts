/**
 * 模块合并器主入口
 */

import process from 'node:process';
import fs from 'node:fs/promises';
import path from 'node:path';
import picocolors from 'picocolors';
import type { MergeResult, TemplateData, MergeRuntimeOptions } from './types';
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
    picocolors.green(
      `✓ Loaded config: ${config.name} (${config.modules.length} modules)`
    )
  );

  // 2. 下载模块
  console.log(picocolors.cyan('\nDownloading modules...'));
  const loader = new ModuleLoader([baseDir, process.cwd()]);
  const { loaded, failures } = await loader.loadAll(config.modules);
  loaded.forEach(module => {
    console.log(picocolors.green(`  ✓ ${module.header}`));
  });
  failures.forEach(failure => {
    console.log(picocolors.red(`  ✗ ${failure.header}: ${failure.reason}`));
  });

  const merger = new ModuleMerger(config.options);
  loaded.forEach(module => {
    const sections = SectionParser.parse(module.content, {
      header: module.header,
      stripComments: config.options.stripComments
    });
    sections.forEach(section => merger.addSection(section));
  });

  // 3. 合并
  console.log(picocolors.cyan('\nMerging sections...'));
  const { sections, hostnames } = merger.merge();

  // 4. 渲染模板
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
      day: '2-digit'
    }),
    hostname_append: hostnames.join(', ')
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
      ...stats
    },
    failures
  };
}

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
  TemplateData
} from './types';
export { SectionParser } from './section-parser';
export { ModuleMerger } from './merger';
export { TemplateEngine } from './template-engine';
