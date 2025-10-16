#!/usr/bin/env node
/**
 * 文件变更检测脚本
 */

import { execSync } from 'node:child_process';
import picocolors from 'picocolors';
import { fetch } from 'undici';

/**
 * 检测指定文件是否有变更
 * @param files 要检测的文件列表
 * @returns 是否有变更
 */
export function checkFileChanges(files: string[]): boolean {
  try {
    // 检查是否有未提交的变更
    const status = execSync('git status --porcelain', { encoding: 'utf-8' });

    if (!status.trim()) {
      return false;
    }

    // 检查指定文件是否在变更列表中
    const changedFiles = status
      .split('\n')
      .map((line) => line.trim().split(/\s+/)[1])
      .filter(Boolean);

    return files.some((file) => changedFiles.some((changed) => changed.includes(file)));
  } catch (error) {
    console.error(picocolors.red('Error checking changes:'), error);
    return false;
  }
}

/**
 * 触发外部仓库 Repository Dispatch
 * @param repo 仓库名称 (格式: owner/repo)
 * @param eventType 事件类型
 * @param token GitHub Token
 * @returns 是否成功
 */
export async function triggerRepositoryDispatch(
  repo: string,
  eventType: string,
  token: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/dispatches`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github.everest-preview+json',
          Authorization: `token ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ event_type: eventType })
      }
    );

    if (response.status === 204) {
      console.log(picocolors.green(`✓ Triggered ${repo} dispatch`));
      return true;
    }
    console.log(
      picocolors.red(`✗ Failed to trigger ${repo}: HTTP ${response.status}`)
    );
    return false;
  } catch (error) {
    console.error(picocolors.red(`Error triggering ${repo}:`), error);
    return false;
  }
}

/**
 * 主函数 - CLI 入口
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(
      picocolors.yellow('Usage: check-changes.ts <file1> <file2> ...')
    );
    process.exit(1);
  }

  const hasChanges = checkFileChanges(args);

  if (hasChanges) {
    console.log(picocolors.green('✓ Changes detected'));
    process.exit(0);
  } else {
    console.log(picocolors.gray('No changes detected'));
    process.exit(1);
  }
}

// 如果直接运行此脚本,执行主函数
if (require.main === module) {
  main();
}
