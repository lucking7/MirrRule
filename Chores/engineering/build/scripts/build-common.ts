import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fdir as Fdir } from 'fdir';
import { createSpan, task } from '../trace/index.js';
import { DomainsetOutput } from '../lib/rules/domainset.js';
import { RulesetOutput } from '../lib/rules/ruleset.js';
import { readFileIntoProcessedArray } from '../lib/fetch-text-by-line.js';
import picocolors from 'picocolors';
import fs from 'node:fs/promises';

// 获取当前文件所在目录
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 项目根目录 - 从 Chores/engineering/build/scripts 回到根目录
const REPO_PATH = path.resolve(__dirname, '../../../..');
const SOURCE_DIR = path.join(REPO_PATH, 'Source');

// 共享描述
const SHARED_DESCRIPTION = [
  'License: AGPL 3.0',
  'Homepage: https://github.com/SukkaW/Surge',
  '',
  'This file contains rules maintained by the community.',
];

interface SourceFile {
  path: string;
  type: 'domainset' | 'non_ip' | 'ip';
  id: string;
}

// 扫描源文件
async function scanSourceFiles(): Promise<SourceFile[]> {
  const files: SourceFile[] = [];

  console.log(`扫描目录: ${SOURCE_DIR}`);

  // 检查 SOURCE_DIR 是否存在
  try {
    await fs.access(SOURCE_DIR);
  } catch {
    console.warn(picocolors.yellow('⚠️  Source 目录不存在，跳过通用规则集构建'));
    return files;
  }

  // 扫描 domainset 目录
  try {
    const domainsetDir = path.join(SOURCE_DIR, 'domainset');
    console.log(`扫描 domainset: ${domainsetDir}`);

    const domainsetFiles = await new Fdir()
      .withFullPaths()
      .filter(p => p.endsWith('.conf'))
      .crawl(domainsetDir)
      .withPromise();

    console.log(`找到 domainset 文件: ${domainsetFiles.length}`);

    for (const file of domainsetFiles) {
      const basename = path.basename(file, '.conf');
      files.push({
        path: file,
        type: 'domainset',
        id: basename,
      });
    }
  } catch (err) {
    console.warn(picocolors.yellow('⚠️  domainset 目录不存在'), err);
  }

  // 扫描 non_ip 目录
  try {
    const nonIpFiles = await new Fdir()
      .withFullPaths()
      .filter(p => p.endsWith('.conf'))
      .crawl(path.join(SOURCE_DIR, 'non_ip'))
      .withPromise();

    for (const file of nonIpFiles) {
      const basename = path.basename(file, '.conf');
      files.push({
        path: file,
        type: 'non_ip',
        id: basename,
      });
    }
  } catch (err) {
    console.warn(picocolors.yellow('⚠️  non_ip 目录不存在'));
  }

  // 扫描 ip 目录
  try {
    const ipFiles = await new Fdir()
      .withFullPaths()
      .filter(p => p.endsWith('.conf'))
      .crawl(path.join(SOURCE_DIR, 'ip'))
      .withPromise();

    for (const file of ipFiles) {
      const basename = path.basename(file, '.conf');
      files.push({
        path: file,
        type: 'ip',
        id: basename,
      });
    }
  } catch (err) {
    console.warn(picocolors.yellow('⚠️  ip 目录不存在'));
  }

  return files;
}

// 处理单个文件
async function processFile(span: any, file: SourceFile) {
  console.log(`📄 处理文件: ${file.id} (${file.type})`);

  const content = await readFileIntoProcessedArray(file.path);

  let output;
  switch (file.type) {
    case 'domainset':
      output = new DomainsetOutput(span, file.id)
        .withTitle(`Sukka's Ruleset - ${file.id}`)
        .withDescription(SHARED_DESCRIPTION);
      await output.addFromDomainset(content);
      break;

    case 'non_ip':
      output = new RulesetOutput(file.id)
        .withTitle(`Sukka's Ruleset - ${file.id} (Non-IP)`)
        .withDescription(SHARED_DESCRIPTION);
      await output.addFromRuleset(content);
      break;

    case 'ip':
      output = new RulesetOutput(file.id)
        .withTitle(`Sukka's Ruleset - ${file.id} (IP)`)
        .withDescription(SHARED_DESCRIPTION);
      await output.addFromRuleset(content);
      break;
  }

  await output.write();
  console.log(picocolors.green(`✅ 完成: ${file.id}`));
}

// 构建通用规则集
export const buildCommon = task(
  false,
  import.meta.url
)(async span => {
  console.log(picocolors.bold('🚀 开始构建通用规则集...'));

  const files = await scanSourceFiles();
  console.log(`📊 找到 ${files.length} 个源文件`);

  if (files.length === 0) {
    console.warn(picocolors.yellow('⚠️  没有找到任何源文件'));
    return;
  }

  // 并行处理所有文件
  await Promise.all(files.map(file => processFile(span, file)));

  console.log(picocolors.green('\n✅ 通用规则集构建完成！'));
});

// 如果直接运行此脚本
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const rootSpan = createSpan('build-common');
  buildCommon(rootSpan).finally(() => {
    rootSpan.stop();
  });
}
