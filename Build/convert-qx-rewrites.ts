/**
 * QX Rewrite 转换命令行工具
 * 可独立运行或被其他脚本调用
 */

import process from 'node:process';
import { task } from './trace';
import { convertQXRewrites } from './integration/qx-converter';
import { QX_CONVERSION_CONFIGS } from './integration/qx-converter/qx-config';
import picocolors from 'picocolors';

/**
 * 主函数
 */
export const runQXConversion = task(
  require.main === module,
  __filename
)(async _span => {
  console.log(picocolors.cyan('🔄 QX Rewrite Conversion Tool\n'));

  try {
    const result = await convertQXRewrites(QX_CONVERSION_CONFIGS);

    // 检查是否有失败
    if (result.failed > 0) {
      console.log(picocolors.yellow('\n⚠\uFE0F  Conversion completed with errors'));
      process.exit(1);
    }

    // 检查是否有成功
    if (result.success > 0) {
      console.log(picocolors.green('\n✅ Conversion completed successfully'));
    } else {
      console.log(picocolors.gray('\n✅ Conversion completed - no changes detected'));
    }
  } catch (error) {
    console.error(picocolors.red('\n❌ Conversion failed with error:'));
    console.error(error);
    process.exit(1);
  }
});

// 如果直接运行此文件
if (require.main === module) {
  runQXConversion().catch(error => {
    console.error(picocolors.red('Fatal error:'), error);
    process.exit(1);
  });
}
