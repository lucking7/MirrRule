import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Buffer } from 'node:buffer';
import { task } from './trace';
import { extract as tarExtract } from 'tar-fs';
import type { Headers as TarEntryHeaders } from 'tar-fs';
import zlib from 'node:zlib';
import undici from 'undici';
import picocolors from 'picocolors';
import { OUTPUT_MOCK_DIR, OUTPUT_MODULES_DIR, OUTPUT_SUKKA_MIRROR_DIR } from './constants/dir';
import { requestWithLog } from './utils/network/fetch-retry';
import { shouldUpdateFile } from './integration/mirror-sync/checksum';

const GITHUB_CODELOAD_URL = 'https://codeload.github.com/SukkaLab/ruleset.skk.moe/tar.gz/master';
const GITLAB_CODELOAD_URL =
  'https://gitlab.com/SukkaLab/ruleset.skk.moe/-/archive/master/ruleset.skk.moe-master.tar.gz';

/**
 * 为 Surge Module 文件添加 category 标签
 * 如果文件已有 #!category= 标签，则不修改
 */
function addCategoryTag(content: Buffer, filePath: string): Buffer {
  // 只处理 .sgmodule 文件
  if (!filePath.endsWith('.sgmodule')) {
    return content;
  }

  const text = content.toString('utf-8');

  // 检查是否已有 category 标签
  if (text.includes('#!category=')) {
    return content;
  }

  // 在文件开头添加 category 标签
  const newContent = '#!category=[Sukka]\n' + text;
  return Buffer.from(newContent, 'utf-8');
}

/**
 * 下载 mock 和 sgmodule 目录（输出到 public/Mirror/Sukka/ 下）
 * - 使用临时目录解压
 * - 逐个文件 checksum 比对，仅复制变化的文件
 * - 为 sgmodule 文件添加 #!category=[Sukka] 标签
 * - 提供详细日志（新增/更新/跳过/总数）
 */
export const downloadMockAndModules = task(
  require.main === module,
  __filename
)(async span => {
  console.log(picocolors.cyan('🪞 Sukka Mirror Sync - Mock & sgmodule\n'));
  console.log(picocolors.gray(`Output: ${OUTPUT_SUKKA_MIRROR_DIR}`));
  console.log(picocolors.gray(`  mock: ${OUTPUT_MOCK_DIR}`));
  console.log(picocolors.gray(`  sgmodule: ${OUTPUT_MODULES_DIR}\n`));

  const tarGzUrl = await span.traceChildAsync('获取 tar.gz URL', async () => {
    const resp = await requestWithLog(GITHUB_CODELOAD_URL, { method: 'HEAD' });
    if (resp.statusCode !== 200) {
      console.warn(picocolors.yellow('从 GitHub 下载失败！状态码:'), resp.statusCode);
      console.warn(picocolors.yellow('切换到 GitLab'));
      return GITLAB_CODELOAD_URL;
    }
    return GITHUB_CODELOAD_URL;
  });

  await span.traceChildAsync('下载并解压 mock 和 sgmodule', async () => {
    try {
      // 1) 创建临时目录
      const tempDir = path.join(OUTPUT_SUKKA_MIRROR_DIR, '.temp');
      await fsp.mkdir(tempDir, { recursive: true });

      console.log(picocolors.cyan('📥 下载 tar.gz 文件...'));
      const respBody = undici
        .pipeline(
          tarGzUrl,
          {
            method: 'GET',
            headers: {
              'User-Agent': 'Surge-Ruleset-Mirror/1.0',
              'sec-fetch-mode': 'same-origin'
            }
          },
          ({ statusCode, body }) => {
            if (statusCode !== 200) {
              console.warn(picocolors.red('下载失败！状态码:'), statusCode);
              if (statusCode === 404) {
                throw new Error('下载失败！404');
              }
            }
            return body;
          }
        )
        .end();

      const pathPrefix = 'ruleset.skk.moe-master/';
      const extractedFiles: string[] = [];

      console.log(picocolors.cyan('📦 解压文件到临时目录...'));

      // 2) 解压到临时目录，仅收集 Mock/ 与 Modules/ 下的文件
      await pipeline(
        respBody,
        zlib.createGunzip(),
        tarExtract(tempDir, {
          ignore(_: string, header?: TarEntryHeaders) {
            if (!header) return true;
            if (header.type !== 'file' && header.type !== 'directory') return true;

            const actualPath = header.name.replace(pathPrefix, '');
            const isMock = actualPath.startsWith('Mock/') || actualPath === 'Mock';
            const isModules = actualPath.startsWith('Modules/') || actualPath === 'Modules';

            if (header.type === 'file' && (isMock || isModules)) {
              extractedFiles.push(actualPath);
            }

            return !isMock && !isModules;
          },
          map(header) {
            header.name = header.name.replace(pathPrefix, '');
            return header;
          }
        })
      );

      console.log(picocolors.cyan(`\n🔍 检查文件变化 (共 ${extractedFiles.length} 个文件)...`));

      // 3) 确保输出目录存在
      await fsp.mkdir(OUTPUT_MOCK_DIR, { recursive: true });
      await fsp.mkdir(OUTPUT_MODULES_DIR, { recursive: true });

      let newCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;

      // 4) 逐个文件 checksum 比较并复制
      for (const filePath of extractedFiles) {
        const tempFilePath = path.join(tempDir, filePath);

        // 将上游路径（Mock/, Modules/）映射为输出目录的小写规范（mock/, sgmodule/）
        // 注意：category 标签的判断仍基于上游原始路径 filePath
        const relPath = filePath
          .replace(/^Mock(\/|$)/, 'mock$1')
          .replace(/^Modules(\/|$)/, 'sgmodule$1');

        const targetFilePath = path.join(OUTPUT_SUKKA_MIRROR_DIR, relPath);

        try {
          let fileBuffer = await fsp.readFile(tempFilePath);

          // 为 sgmodule 文件添加 category 标签（基于上游原始路径判断）
          if (filePath.startsWith('Modules/')) {
            fileBuffer = addCategoryTag(fileBuffer, filePath);
          }

          const needsUpdate = await shouldUpdateFile(targetFilePath, fileBuffer);

          if (needsUpdate) {
            const isNew = !fs.existsSync(targetFilePath);

            // 确保目标目录存在
            await fsp.mkdir(path.dirname(targetFilePath), { recursive: true });

            // 复制文件（已添加 category 标签）
            await fsp.writeFile(targetFilePath, fileBuffer);

            if (isNew) {
              newCount++;
              if (newCount <= 5) console.log(picocolors.green(`  ✓ 新增: ${relPath}`));
            } else {
              updatedCount++;
              if (updatedCount <= 5) console.log(picocolors.blue(`  ↻ 更新: ${relPath}`));
            }
          } else {
            skippedCount++;
            if (skippedCount <= 3) console.log(picocolors.gray(`  ○ 跳过: ${relPath}`));
          }
        } catch (error) {
          console.error(picocolors.red(`  ✗ 处理失败: ${filePath}`), error);
        }
      }

      // 5) 清理临时目录
      await fsp.rm(tempDir, { recursive: true, force: true });

      // 6) 打印摘要
      console.log(picocolors.cyan('\n📊 同步完成:'));
      console.log(picocolors.green(`  ✓ 新增文件: ${newCount}`));
      console.log(picocolors.blue(`  ↻ 更新文件: ${updatedCount}`));
      console.log(picocolors.gray(`  ○ 跳过文件: ${skippedCount}`));
      console.log(picocolors.cyan(`  📁 总文件数: ${extractedFiles.length}`));

      if (newCount + updatedCount === 0) {
        console.log(picocolors.blue('\n✨ 所有文件都是最新的，无需更新'));
      } else {
        console.log(picocolors.green(`\n✨ 成功同步 ${newCount + updatedCount} 个文件`));
      }
    } catch (error) {
      console.error(picocolors.red('❌ 下载过程中发生错误:'), error);
      throw error;
    }
  });
});
