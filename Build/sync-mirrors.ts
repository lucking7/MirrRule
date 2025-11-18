/**
 * 镜像同步命令行工具
 * 可独立运行或被其他脚本调用
 */

import process from 'node:process';
import { task } from './trace';
import { syncAllMirrors, syncMirrorGroup } from './integration/mirror-sync';
import picocolors from 'picocolors';

/**
 * 主函数
 */
export const runMirrorSync = task(
  require.main === module,
  __filename
)(async _span => {
  console.log(picocolors.cyan('🪞 Mirror Sync Tool\n'));

  // 检查命令行参数
  const args = process.argv.slice(2);
  const groupName = args[0];

  try {
    let result;

    if (groupName) {
      // 同步指定组
      console.log(picocolors.gray(`Target group: ${groupName}\n`));
      result = await syncMirrorGroup(groupName);

      if (!result) {
        console.log(picocolors.red('\n❌ Sync failed: Group not found'));
        process.exit(1);
      }
    } else {
      // 同步所有组
      console.log(picocolors.gray('Target: All mirror groups\n'));
      result = await syncAllMirrors();
    }

    // 检查是否有失败
    if (result.failedFiles.length > 0) {
      console.log(picocolors.yellow('\n⚠\uFE0F  Sync completed with errors'));
      process.exit(1);
    }

    // 检查是否有变更
    if (result.hasChanges) {
      console.log(picocolors.green('\n✅ Sync completed successfully with changes'));
    } else {
      console.log(picocolors.gray('\n✅ Sync completed - no changes detected'));
    }
  } catch (error) {
    console.error(picocolors.red('\n❌ Sync failed with error:'));
    console.error(error);
    process.exit(1);
  }
});

// 如果直接运行此文件
if (require.main === module) {
  runMirrorSync().catch(error => {
    console.error(picocolors.red('Fatal error:'), error);
    process.exit(1);
  });
}
