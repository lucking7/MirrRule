/**
 * 镜像同步命令行工具
 * 可独立运行或被其他脚本调用
 */

import process from 'node:process';
import { task } from './trace';
import { syncAllMirrors, syncMirrorGroup } from './integration/mirror-sync';
import picocolors from 'picocolors';

export const runMirrorSync = task(
  require.main === module,
  __filename
)(async _span => {
  console.log(picocolors.cyan('Mirror Sync Tool\n'));

  const args = process.argv.slice(2);
  const groupName = args[0];

  try {
    let result;

    if (groupName) {
      console.log(picocolors.gray(`Target group: ${groupName}\n`));
      result = await syncMirrorGroup(groupName);

      if (!result) {
        console.log(picocolors.red('\n[ERROR] Sync failed: Group not found'));
        throw new Error('Sync failed: Group not found');
      }
    } else {
      console.log(picocolors.gray('Target: All mirror groups\n'));
      result = await syncAllMirrors();
    }

    if (result.failedFiles.length > 0) {
      console.log(picocolors.yellow('\n[WARN] Sync completed with errors'));
      throw new Error(`Sync completed with ${result.failedFiles.length} errors`);
    }

    if (result.hasChanges) {
      console.log(picocolors.green('\n[OK] Sync completed successfully with changes'));
    } else {
      console.log(picocolors.gray('\n[OK] Sync completed - no changes detected'));
    }
  } catch (error) {
    console.error(picocolors.red('\n[ERROR] Sync failed with error:'));
    console.error(error);
    process.exit(1);
  }
});

if (require.main === module) {
  runMirrorSync().catch(error => {
    console.error(picocolors.red('Fatal error:'), error);
    process.exit(1);
  });
}
