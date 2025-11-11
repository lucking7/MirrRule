import path from 'node:path';
import fsp from 'node:fs/promises';
import { task } from './trace';
import picocolors from 'picocolors';
import { OUTPUT_SUKKA_MIRROR_DIR } from './constants/dir';

const GITHUB_API_BASE = 'https://api.github.com/repos/fmz200/wool_scripts/contents';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/fmz200/wool_scripts/main';
const SPLIT_DIR_PATH = 'Surge/module/split';
const OUTPUT_DIR = path.join(OUTPUT_SUKKA_MIRROR_DIR, '../fmz200/sgmodule/categories');

/**
 * 目录名映射规则
 * part!! → !!
 * partU → U
 * partA → A
 * part1 → 1
 */
function mapDirectoryName(dirName: string): string {
  if (dirName.startsWith('part')) {
    return dirName.substring(4); // 移除 "part" 前缀
  }
  return dirName;
}

/**
 * 从 sgmodule 内容中提取 #!name= 的值
 */
function extractModuleName(content: string): string | null {
  const lines = content.split(/\r?\n/);
  const nameLine = lines.find(line => /^#!name\s*=/.test(line.trim()));

  if (nameLine) {
    const match = nameLine.match(/^#!name\s*=\s*(.+)$/);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
}

/**
 * 清理文件名（移除不安全字符）
 */
function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_') // 替换不安全字符
    .replace(/\s+/g, '_') // 空格替换为下划线
    .trim();
}

/**
 * 获取目录内容
 */
async function fetchDirectoryContents(dirPath: string): Promise<any[]> {
  const url = `${GITHUB_API_BASE}/${dirPath}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Surge-Ruleset-Mirror/1.0',
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      console.warn(picocolors.yellow(`⚠️  Failed to fetch ${dirPath}: ${response.status}`));
      return [];
    }

    return await response.json();
  } catch (error) {
    console.error(picocolors.red(`❌ Error fetching ${dirPath}:`), error);
    return [];
  }
}

/**
 * 下载并处理单个 sgmodule 文件
 */
async function downloadAndProcessFile(
  fileUrl: string,
  originalDirName: string,
  fileName: string
): Promise<{ success: boolean; newName?: string }> {
  try {
    const response = await fetch(fileUrl);

    if (!response.ok) {
      console.warn(picocolors.yellow(`⚠️  Failed to download ${fileName}: ${response.status}`));
      return { success: false };
    }

    const content = await response.text();

    // 提取模块名称
    const moduleName = extractModuleName(content);

    if (!moduleName) {
      console.warn(picocolors.yellow(`⚠️  No #!name= found in ${fileName}, using original name`));
      // 使用原文件名（不带扩展名）
      const baseName = path.basename(fileName, '.sgmodule');
      const mappedDir = mapDirectoryName(originalDirName);
      const outputPath = path.join(OUTPUT_DIR, mappedDir, fileName);

      await fsp.mkdir(path.dirname(outputPath), { recursive: true });
      await fsp.writeFile(outputPath, content, 'utf-8');

      return { success: true, newName: fileName };
    }

    // 使用提取的模块名作为文件名
    const sanitizedName = sanitizeFileName(moduleName);
    const newFileName = `${sanitizedName}.sgmodule`;
    const mappedDir = mapDirectoryName(originalDirName);
    const outputPath = path.join(OUTPUT_DIR, mappedDir, newFileName);

    // 确保目录存在
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });

    // 写入文件
    await fsp.writeFile(outputPath, content, 'utf-8');

    return { success: true, newName: newFileName };
  } catch (error) {
    console.error(picocolors.red(`❌ Error processing ${fileName}:`), error);
    return { success: false };
  }
}

/**
 * 处理单个子目录
 */
async function processSubDirectory(dirName: string): Promise<{
  processed: number;
  failed: number;
  files: string[];
}> {
  const result = {
    processed: 0,
    failed: 0,
    files: [] as string[],
  };

  console.log(picocolors.cyan(`\n📁 Processing directory: ${dirName}`));

  const dirPath = `${SPLIT_DIR_PATH}/${dirName}`;
  const contents = await fetchDirectoryContents(dirPath);

  if (contents.length === 0) {
    console.log(picocolors.gray(`  ⏭️  Empty or inaccessible directory`));
    return result;
  }

  // 过滤出 .sgmodule 文件
  const sgmoduleFiles = contents.filter(
    (item: any) => item.type === 'file' && item.name.endsWith('.sgmodule')
  );

  console.log(picocolors.gray(`  Found ${sgmoduleFiles.length} .sgmodule files`));

  for (const file of sgmoduleFiles) {
    const fileUrl = `${GITHUB_RAW_BASE}/${dirPath}/${file.name}`;
    const downloadResult = await downloadAndProcessFile(fileUrl, dirName, file.name);

    if (downloadResult.success) {
      result.processed++;
      const mappedDir = mapDirectoryName(dirName);
      const displayName = downloadResult.newName || file.name;
      result.files.push(`${mappedDir}/${displayName}`);
      console.log(picocolors.green(`  ✓ ${file.name} → ${mappedDir}/${displayName}`));
    } else {
      result.failed++;
      console.log(picocolors.red(`  ✗ ${file.name}`));
    }
  }

  return result;
}

/**
 * 主函数：下载并处理所有 split 目录
 */
export const downloadFmz200Split = task(
  require.main === module,
  __filename
)(async span => {
  console.log(picocolors.cyan('🪞 fmz200 Split Modules Sync\n'));
  console.log(picocolors.gray(`Output: ${OUTPUT_DIR}\n`));

  await span.traceChildAsync('Download and process split modules', async () => {
    try {
      // 获取 split 目录下的所有子目录
      const splitContents = await fetchDirectoryContents(SPLIT_DIR_PATH);

      const subDirs = splitContents.filter((item: any) => item.type === 'dir');

      console.log(picocolors.cyan(`📦 Found ${subDirs.length} subdirectories\n`));

      let totalProcessed = 0;
      let totalFailed = 0;
      const allFiles: string[] = [];

      // 处理每个子目录
      for (const dir of subDirs) {
        const result = await processSubDirectory(dir.name);
        totalProcessed += result.processed;
        totalFailed += result.failed;
        allFiles.push(...result.files);
      }

      // 打印摘要
      console.log(picocolors.cyan('\n📊 Sync Summary:'));
      console.log(picocolors.green(`  ✓ Processed: ${totalProcessed} files`));
      console.log(picocolors.red(`  ✗ Failed: ${totalFailed} files`));
      console.log(picocolors.cyan(`  📁 Total directories: ${subDirs.length}`));

      if (totalProcessed > 0) {
        console.log(picocolors.green(`\n✨ Successfully synced ${totalProcessed} modules`));
      } else {
        console.log(picocolors.yellow('\n⚠️  No files were processed'));
      }
    } catch (error) {
      console.error(picocolors.red('❌ Sync failed:'), error);
      throw error;
    }
  });
});

// 如果直接运行此文件
if (require.main === module) {
  downloadFmz200Split().catch(error => {
    console.error(picocolors.red('Fatal error:'), error);
    process.exit(1);
  });
}
