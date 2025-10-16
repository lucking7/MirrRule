/**
 * 模块合并器主入口
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import picocolors from 'picocolors';
import YAML from 'yaml';
import { fetch } from 'undici';
import type { MergeConfig, MergeResult, TemplateData } from './types';
import { SectionParser } from './section-parser';
import { ModuleMerger } from './merger';
import { TemplateEngine } from './template-engine';

/**
 * 合并模块
 * @param configPath 配置文件路径
 * @returns 合并结果
 */
export async function mergeModules(configPath: string): Promise<MergeResult> {
  console.log(picocolors.cyan('\n📦 Module Merger\n'));

  // 1. 加载配置
  console.log(picocolors.gray('Loading configuration...'));
  const configContent = await fs.readFile(configPath, 'utf-8');
  const config: MergeConfig = YAML.parse(configContent);
  console.log(picocolors.green(`✓ Loaded config: ${config.name}`));

  // 2. 下载模块
  console.log(picocolors.cyan('\nDownloading modules...'));
  const merger = new ModuleMerger(config.options);
  let modulesProcessed = 0;

  for (const module of config.modules) {
    try {
      let content: string;

      // 判断是本地文件还是远程 URL
      if (module.url.startsWith('file://')) {
        // 本地文件
        const filePath = module.url.replace('file://', '');
        content = await fs.readFile(filePath, 'utf-8');
      } else {
        // 远程 URL
        const response = await fetch(module.url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        content = await response.text();
      }

      const sections = SectionParser.parse(content, module.header);

      sections.forEach(section => merger.addSection(section));
      modulesProcessed++;

      console.log(picocolors.green(`  ✓ ${module.header}`));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(picocolors.red(`  ✗ ${module.header}: ${errorMessage}`));
    }
  }

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
  const rulelist = sections.get('Rule' as any) || '';

  // 6. 写入文件
  console.log(picocolors.cyan('\nWriting output files...'));
  await fs.mkdir(path.dirname(config.output.sgmodule), { recursive: true });
  await fs.writeFile(config.output.sgmodule, sgmodule, 'utf-8');
  await fs.writeFile(config.output.rulelist, rulelist, 'utf-8');

  console.log(picocolors.green(`  ✓ Saved: ${config.output.sgmodule}`));
  console.log(picocolors.green(`  ✓ Saved: ${config.output.rulelist}`));

  const stats = merger.getStats();
  console.log(picocolors.green('\n✓ Merge completed'));
  console.log(picocolors.gray(`  - Modules processed: ${modulesProcessed}`));
  console.log(picocolors.gray(`  - Sections extracted: ${stats.sectionsExtracted}`));
  console.log(picocolors.gray(`  - Hostnames deduplicated: ${stats.hostnamesDeduplicated}`));

  return {
    sgmodule,
    rulelist,
    stats: {
      modulesProcessed,
      ...stats
    }
  };
}

// 导出所有类型和类
export * from './types';
export { SectionParser } from './section-parser';
export { ModuleMerger } from './merger';
export { TemplateEngine } from './template-engine';
