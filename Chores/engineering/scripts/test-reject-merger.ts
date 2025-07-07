#!/usr/bin/env tsx

import { mergeRejectRules } from '../sync/rule-reject-merger.js';
import picocolors from 'picocolors';

console.log(picocolors.bold('🧪 测试 Reject 规则合并功能\n'));

(async () => {
  try {
    console.log('开始测试合并功能...\n');

    const result = await mergeRejectRules();

    if (result) {
      console.log(picocolors.green('\n✅ 测试成功！'));
      console.log('请检查生成的文件: Surge/Rulesets/reject/block-optimized.list');
    } else {
      console.log(picocolors.red('\n❌ 测试失败！'));
    }
  } catch (error) {
    console.error(picocolors.red('\n❌ 测试出错:'), error);
  }
})();
