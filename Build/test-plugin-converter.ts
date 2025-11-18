#!/usr/bin/env node
/**
 * 测试插件转换器 (方案 B - 先下载后转换)
 *
 * 用法:
 *   pnpm run node ./Build/test-plugin-converter.ts
 */

import process from 'node:process';
import picocolors from 'picocolors';
import { convertAndMirrorPlugins } from './integration/plugin-converter';

async function main() {
  console.log(picocolors.cyan('\n🧪 Testing Plugin Converter (Local Download Mode)\n'));
  console.log(picocolors.gray('This test will:'));
  console.log(picocolors.gray('  1. Download plugin list from hub.kelee.one'));
  console.log(picocolors.gray('  2. Download all plugins to local (.cache/plugins)'));
  console.log(picocolors.gray('  3. Convert plugins using Script-Hub (from local files)'));
  console.log(picocolors.gray('  4. Extract and mirror JavaScript files'));
  console.log(picocolors.gray('  5. Clean up temporary files\n'));

  const startTime = Date.now();

  try {
    // 不等待 Script-Hub 服务 (假设在本地测试时没有运行)
    // 如果在 GitHub Actions 中测试，设置为 true
    const waitForService = process.env.CI === 'true';

    console.log(picocolors.yellow(`Wait for Script-Hub: ${waitForService}\n`));

    const results = await convertAndMirrorPlugins(waitForService);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(picocolors.cyan('\n📊 Test Results:\n'));
    console.log(picocolors.gray(`Total plugins: ${results.length}`));
    console.log(picocolors.green(`✓ Success: ${results.filter(r => r.success).length}`));
    console.log(picocolors.red(`✗ Failed: ${results.filter(r => !r.success).length}`));
    console.log(picocolors.gray(`Duration: ${duration}s\n`));

    if (results.some(r => !r.success)) {
      console.log(picocolors.red('Failed plugins:'));
      for (const result of results.filter(r => !r.success)) {
        console.log(picocolors.red(`  - ${result.pluginName}: ${result.error}`));
      }
    }

    console.log(picocolors.green('\n✅ Test completed!\n'));
    process.exit(0);
  } catch (error) {
    console.log(picocolors.red('\n❌ Test failed!\n'));
    console.error(error);
    process.exit(1);
  }
}

main();
