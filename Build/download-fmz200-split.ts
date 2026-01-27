import path from 'node:path';
import fsp from 'node:fs/promises';
import process from 'node:process';
import { task } from './trace';
import picocolors from 'picocolors';
import { OUTPUT_SUKKA_MIRROR_DIR } from './constants/dir';
import { UA_MIRROR } from './constants/user-agents';

const GITHUB_API_BASE = 'https://api.github.com/repos/fmz200/wool_scripts/contents';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/fmz200/wool_scripts/main';
const SPLIT_DIR_PATH = 'Surge/module/split';
const OUTPUT_BASE_DIR = path.join(OUTPUT_SUKKA_MIRROR_DIR, '../fmz200/sgmodule');
const OUTPUT_CATEGORIES_DIR = path.join(OUTPUT_BASE_DIR, 'categories');

const ROOT_MODULES = [
  'https://raw.githubusercontent.com/fmz200/wool_scripts/main/Surge/module/blockAds.module',
  'https://raw.githubusercontent.com/fmz200/wool_scripts/main/Surge/module/cookies.module',
  'https://raw.githubusercontent.com/fmz200/wool_scripts/main/Surge/module/weibo.module',
];

/**
 * 目录名映射规则
 * part!! → !!
 * partU → U
 * partA → A
 * part1 → 1
 */
function mapDirectoryName(dirName: string): string {
  if (dirName.startsWith('part')) {
    return dirName.slice(4); // 移除 "part" 前缀
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
    const equalIndex = nameLine.indexOf('=');
    if (equalIndex !== -1) {
      const value = nameLine.slice(equalIndex + 1).trim();
      if (value) {
        return value;
      }
    }
  }

  return null;
}

/**
 * 清理文件名（移除不安全字符）
 */
function sanitizeFileName(name: string): string {
  return name
    .replaceAll(/["*/:<>?\\|]/g, '_') // 替换不安全字符
    .replaceAll(/\s+/g, '_') // 空格替换为下划线
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
        'User-Agent': UA_MIRROR,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      console.warn(picocolors.yellow(`[WARN] Failed to fetch ${dirPath}: ${response.status}`));
      return [];
    }

    return (await response.json()) as any[];
  } catch (error) {
    console.error(picocolors.red(`[ERROR] Error fetching ${dirPath}:`), error);
    return [];
  }
}

/**
 * 下载并处理根目录模块文件
 */
async function downloadRootModule(
  moduleUrl: string
): Promise<{ success: boolean; fileName?: string }> {
  const originalFileName = path.basename(moduleUrl);

  try {
    console.log(picocolors.cyan(`  Downloading: ${originalFileName}`));

    const response = await fetch(moduleUrl);

    if (!response.ok) {
      console.warn(
        picocolors.yellow(`[WARN] Failed to download ${originalFileName}: ${response.status}`)
      );
      return { success: false };
    }

    const content = await response.text();

    // 提取模块名称
    const moduleName = extractModuleName(content);

    if (!moduleName) {
      console.warn(
        picocolors.yellow(`[WARN] No #!name= found in ${originalFileName}, using original name`)
      );
      const baseName = path.basename(originalFileName, '.module');
      const newFileName = `${baseName}.sgmodule`;
      const outputPath = path.join(OUTPUT_BASE_DIR, newFileName);

      await fsp.mkdir(path.dirname(outputPath), { recursive: true });
      await fsp.writeFile(outputPath, content, 'utf-8');

      console.log(picocolors.green(`  ✓ ${originalFileName} → ${newFileName}`));
      return { success: true, fileName: newFileName };
    }

    // 使用提取的模块名作为文件名
    const sanitizedName = sanitizeFileName(moduleName);
    const newFileName = `${sanitizedName}.sgmodule`;
    const outputPath = path.join(OUTPUT_BASE_DIR, newFileName);

    await fsp.mkdir(path.dirname(outputPath), { recursive: true });
    await fsp.writeFile(outputPath, content, 'utf-8');

    console.log(
      picocolors.green(`  ✓ ${originalFileName} → ${newFileName} (from #!name=${moduleName})`)
    );
    return { success: true, fileName: newFileName };
  } catch (error) {
    console.error(picocolors.red(`[ERROR] Error processing ${originalFileName}:`), error);
    return { success: false };
  }
}

/**
 * 下载并处理单个 sgmodule 文件（用于 categories 子目录）
 */
async function downloadAndProcessFile(
  fileUrl: string,
  originalDirName: string,
  fileName: string
): Promise<{ success: boolean; newName?: string }> {
  try {
    const response = await fetch(fileUrl);

    if (!response.ok) {
      console.warn(
        picocolors.yellow(`[WARN] Failed to download ${fileName}: ${response.status}`)
      );
      return { success: false };
    }

    const content = await response.text();

    // 提取模块名称
    const moduleName = extractModuleName(content);

    if (!moduleName) {
      console.warn(
        picocolors.yellow(`[WARN] No #!name= found in ${fileName}, using original name`)
      );
      // 使用原文件名
      const mappedDir = mapDirectoryName(originalDirName);
      const outputPath = path.join(OUTPUT_CATEGORIES_DIR, mappedDir, fileName);

      await fsp.mkdir(path.dirname(outputPath), { recursive: true });
      await fsp.writeFile(outputPath, content, 'utf-8');

      return { success: true, newName: fileName };
    }

    // 使用提取的模块名作为文件名
    const sanitizedName = sanitizeFileName(moduleName);
    const newFileName = `${sanitizedName}.sgmodule`;
    const mappedDir = mapDirectoryName(originalDirName);
    const outputPath = path.join(OUTPUT_CATEGORIES_DIR, mappedDir, newFileName);

    await fsp.mkdir(path.dirname(outputPath), { recursive: true });
    await fsp.writeFile(outputPath, content, 'utf-8');

    return { success: true, newName: newFileName };
  } catch (error) {
    console.error(picocolors.red(`[ERROR] Error processing ${fileName}:`), error);
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

  console.log(picocolors.cyan(`\nProcessing directory: ${dirName}`));

  const dirPath = `${SPLIT_DIR_PATH}/${dirName}`;
  const contents = await fetchDirectoryContents(dirPath);

  if (contents.length === 0) {
    console.log(picocolors.gray('  ⏭\uFE0F  Empty or inaccessible directory'));
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
 * 主函数：下载并处理所有模块
 */
export const downloadFmz200Split = task(
  require.main === module,
  __filename
)(async span => {
  console.log(picocolors.cyan('fmz200 Modules Sync\n'));
  console.log(picocolors.gray(`Output Base: ${OUTPUT_BASE_DIR}`));
  console.log(picocolors.gray(`Output Categories: ${OUTPUT_CATEGORIES_DIR}\n`));

  await span.traceChildAsync('Download and process all modules', async () => {
    try {
      let totalRootProcessed = 0;
      let totalRootFailed = 0;
      let totalCategoriesProcessed = 0;
      let totalCategoriesFailed = 0;

      console.log(picocolors.cyan('Step 1: Downloading root modules\n'));

      for (const moduleUrl of ROOT_MODULES) {
        const result = await downloadRootModule(moduleUrl);
        if (result.success) {
          totalRootProcessed++;
        } else {
          totalRootFailed++;
        }
      }

      console.log(
        picocolors.cyan(
          `\n✓ Root modules: ${totalRootProcessed} processed, ${totalRootFailed} failed\n`
        )
      );

      console.log(picocolors.cyan('Step 2: Downloading split modules (categories)\n'));

      const splitContents = await fetchDirectoryContents(SPLIT_DIR_PATH);
      const subDirs = splitContents.filter((item: any) => item.type === 'dir');
      console.log(picocolors.cyan(`Found ${subDirs.length} subdirectories\n`));

      for (const dir of subDirs) {
        const result = await processSubDirectory(dir.name);
        totalCategoriesProcessed += result.processed;
        totalCategoriesFailed += result.failed;
      }

      console.log(picocolors.cyan('\nOverall Sync Summary:'));
      console.log(picocolors.cyan('\n  Root Modules:'));
      console.log(picocolors.green(`    ✓ Processed: ${totalRootProcessed} files`));
      console.log(picocolors.red(`    ✗ Failed: ${totalRootFailed} files`));

      console.log(picocolors.cyan('\n  Categories Modules:'));
      console.log(picocolors.green(`    ✓ Processed: ${totalCategoriesProcessed} files`));
      console.log(picocolors.red(`    ✗ Failed: ${totalCategoriesFailed} files`));
      console.log(picocolors.cyan(`    Total directories: ${subDirs.length}`));

      const totalProcessed = totalRootProcessed + totalCategoriesProcessed;
      const totalFailed = totalRootFailed + totalCategoriesFailed;

      console.log(picocolors.cyan('\n  Total:'));
      console.log(picocolors.green(`    ✓ Processed: ${totalProcessed} files`));
      console.log(picocolors.red(`    ✗ Failed: ${totalFailed} files`));

      if (totalProcessed > 0) {
        console.log(picocolors.green(`\nSuccessfully synced ${totalProcessed} modules`));
      } else {
        console.log(picocolors.yellow('\n[WARN] No files were processed'));
      }
    } catch (error) {
      console.error(picocolors.red('[ERROR] Sync failed:'), error);
      throw error;
    }
  });
});

if (require.main === module) {
  downloadFmz200Split().catch(error => {
    console.error(picocolors.red('Fatal error:'), error);
    process.exit(1);
  });
}
