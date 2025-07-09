import { FileOutput } from '../lib/rules/base.js';
import { SurgeRuleset } from '../lib/writing-strategy/surge.js';
import { createSpan } from '../trace/index.js';
import picocolors from 'picocolors';

async function testDeduplication() {
  console.log(picocolors.blue('🧪 测试规则去重机制...\n'));

  const span = createSpan('test-deduplication');
  const strategy = new SurgeRuleset();

  // 创建测试输出
  const output = new FileOutput(span, 'test-dedup');
  output.withStrategies([strategy]);

  console.log('1️⃣ 测试 ASN 去重...');
  // 添加重复的 ASN
  await output.addFromRuleset([
    'IP-ASN,13335',
    'IP-ASN,13335', // 重复
    'IP-ASN,13335,no-resolve', // 不同参数
    'IP-ASN,20473',
    'IP-ASN,20473', // 重复
  ]);

  console.log('2️⃣ 测试 GEOIP 去重...');
  // 添加重复的 GEOIP
  await output.addFromRuleset([
    'GEOIP,CN',
    'GEOIP,CN', // 重复
    'GEOIP,CN,no-resolve', // 不同参数
    'GEOIP,US',
    'GEOIP,US', // 重复
  ]);

  console.log('3️⃣ 测试端口去重...');
  // 添加重复的端口
  await output.addFromRuleset([
    'SRC-PORT,443',
    'SRC-PORT,443', // 重复
    'SRC-PORT,80',
    'DEST-PORT,443',
    'DEST-PORT,443', // 重复
    'DEST-PORT,80',
  ]);

  console.log('4️⃣ 测试 USER-AGENT 去重...');
  // 添加重复的 User-Agent
  await output.addFromRuleset([
    'USER-AGENT,Mozilla*',
    'USER-AGENT,Mozilla*', // 重复
    'USER-AGENT,Chrome*',
  ]);

  console.log('5️⃣ 测试域名去重（Trie 结构）...');
  // 添加域名
  output.addDomain('example.com');
  output.addDomain('example.com'); // 重复
  output.addDomain('sub.example.com');
  output.addDomainSuffix('google.com');
  output.addDomainSuffix('google.com'); // 重复
  output.addDomainSuffix('sub.google.com'); // 被父域名包含

  console.log('6️⃣ 测试 PROTOCOL 大写转换...');
  // 添加协议
  await output.addFromRuleset([
    'PROTOCOL,http',
    'PROTOCOL,HTTP', // 应该被认为是重复
    'PROTOCOL,https',
    'PROTOCOL,HTTPS', // 应该被认为是重复
  ]);

  // 完成并输出结果
  await output.done();

  // 检查内部 Set 的大小
  console.log('\n📊 去重结果统计：');
  console.log(`  - IP-ASN: ${output['ipasn'].size} 个（添加了 3 个，期望 2 个）`);
  console.log(`  - IP-ASN (no-resolve): ${output['ipasnNoResolve'].size} 个（添加了 1 个）`);
  console.log(`  - GEOIP: ${output['geoip'].size} 个（添加了 3 个，期望 2 个）`);
  console.log(`  - GEOIP (no-resolve): ${output['geoipNoResolve'].size} 个（添加了 1 个）`);
  console.log(`  - SRC-PORT: ${output['sourcePort'].size} 个（添加了 3 个，期望 2 个）`);
  console.log(`  - DEST-PORT: ${output['destPort'].size} 个（添加了 3 个，期望 2 个）`);
  console.log(`  - USER-AGENT: ${output['userAgent'].size} 个（添加了 3 个，期望 2 个）`);
  console.log(`  - PROTOCOL: ${output['protocol'].size} 个（添加了 4 个，期望 2 个）`);

  // 显示实际内容
  console.log('\n📝 实际存储内容：');
  console.log(`  - IP-ASN: ${Array.from(output['ipasn']).join(', ')}`);
  console.log(`  - GEOIP: ${Array.from(output['geoip']).join(', ')}`);
  console.log(`  - SRC-PORT: ${Array.from(output['sourcePort']).join(', ')}`);
  console.log(`  - DEST-PORT: ${Array.from(output['destPort']).join(', ')}`);
  console.log(`  - USER-AGENT: ${Array.from(output['userAgent']).join(', ')}`);
  console.log(`  - PROTOCOL: ${Array.from(output['protocol']).join(', ')}`);

  span.stop();

  console.log(picocolors.green('\n✅ 去重测试完成！'));
}

// 执行测试
testDeduplication().catch(error => {
  console.error(picocolors.red('❌ 测试失败:'), error);
  process.exit(1);
});
