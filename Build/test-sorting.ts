import { TreeFileType } from './lib/tree-dir';
import type { TreeType } from './lib/tree-dir';
import { fastStringCompare } from './lib/misc';

// 复制排序逻辑用于测试
const priorityOrder: Record<'default' | (string & {}), number> = {
  LICENSE: 0,
  domainset: 10,
  non_ip: 20,
  ip: 30,
  List: 40,
  Loon: 50,
  QuantumultX: 60,
  Clash: 70,
  'sing-box': 80,
  GEOIP: 90,
  Surge: 100,
  Surfboard: 110,
  LegacyClashPremium: 111,
  Script: 130,
  Mock: 140,
  Assets: 150,
  Internal: 160,
  // 低优先级条目（排在最后）
  Modules: 200,
  Scripts: 210,
  Mirror: 220,
  default: Number.MAX_VALUE
};

function prioritySorter(a: TreeType, b: TreeType) {
  // 1. 类型优先：目录 > 文件
  if (a.type !== b.type) {
    return a.type === TreeFileType.DIRECTORY ? -1 : 1;
  }
  
  // 2. 优先级数值排序
  const priorityDiff = (priorityOrder[a.name] || priorityOrder.default)
    - (priorityOrder[b.name] || priorityOrder.default);
  
  if (priorityDiff !== 0) {
    return priorityDiff;
  }
  
  // 3. 同优先级内按字母序
  return fastStringCompare(a.name, b.name);
}

// 测试用例
function runTests() {
  console.log('🧪 Running sorting tests...\n');
  
  // Test 1: 类型优先（目录 > 文件）
  console.log('Test 1: Directory vs File priority');
  const test1: TreeType[] = [
    { type: TreeFileType.FILE, name: 'aaa.txt', path: '/aaa.txt' },
    { type: TreeFileType.DIRECTORY, name: 'zzz', path: '/zzz', children: [] }
  ];
  test1.sort(prioritySorter);
  const result1 = test1.map(t => `${t.type === TreeFileType.DIRECTORY ? '📁' : '📄'} ${t.name}`);
  console.log(`  Result: ${result1.join(', ')}`);
  console.log(`  Expected: 📁 zzz, 📄 aaa.txt`);
  console.log(`  ${result1[0] === '📁 zzz' ? '✅ PASS' : '❌ FAIL'}\n`);
  
  // Test 2: 优先级排序
  console.log('Test 2: Priority order');
  const test2: TreeType[] = [
    { type: TreeFileType.DIRECTORY, name: 'Modules', path: '/Modules', children: [] },
    { type: TreeFileType.DIRECTORY, name: 'List', path: '/List', children: [] },
    { type: TreeFileType.DIRECTORY, name: 'Scripts', path: '/Scripts', children: [] },
    { type: TreeFileType.DIRECTORY, name: 'GEOIP', path: '/GEOIP', children: [] },
    { type: TreeFileType.DIRECTORY, name: 'Clash', path: '/Clash', children: [] }
  ];
  test2.sort(prioritySorter);
  const result2 = test2.map(t => t.name);
  console.log(`  Result: ${result2.join(', ')}`);
  console.log(`  Expected: List, Clash, GEOIP, Modules, Scripts`);
  const expected2 = ['List', 'Clash', 'GEOIP', 'Modules', 'Scripts'];
  console.log(`  ${JSON.stringify(result2) === JSON.stringify(expected2) ? '✅ PASS' : '❌ FAIL'}\n`);
  
  // Test 3: 字母序（同优先级）
  console.log('Test 3: Alphabetical order (same priority)');
  const test3: TreeType[] = [
    { type: TreeFileType.DIRECTORY, name: 'Zebra', path: '/Zebra', children: [] },
    { type: TreeFileType.DIRECTORY, name: 'Apple', path: '/Apple', children: [] },
    { type: TreeFileType.DIRECTORY, name: 'banana', path: '/banana', children: [] }
  ];
  test3.sort(prioritySorter);
  const result3 = test3.map(t => t.name);
  console.log(`  Result: ${result3.join(', ')}`);
  console.log(`  Expected: Apple, Zebra, banana (大写优先)`);
  const expected3 = ['Apple', 'Zebra', 'banana'];
  console.log(`  ${JSON.stringify(result3) === JSON.stringify(expected3) ? '✅ PASS' : '❌ FAIL'}\n`);
  
  // Test 4: Modules 精确匹配
  console.log('Test 4: Modules exact match only');
  const test4: TreeType[] = [
    { type: TreeFileType.DIRECTORY, name: 'Modules', path: '/Modules', children: [] },
    { type: TreeFileType.DIRECTORY, name: 'modules', path: '/modules', children: [] },
    { type: TreeFileType.DIRECTORY, name: 'Modules_v2', path: '/Modules_v2', children: [] },
    { type: TreeFileType.DIRECTORY, name: 'List', path: '/List', children: [] }
  ];
  test4.sort(prioritySorter);
  const result4 = test4.map(t => t.name);
  console.log(`  Result: ${result4.join(', ')}`);
  console.log(`  Expected: List 在前，只有 Modules 被降级`);
  console.log(`  Modules position: ${result4.indexOf('Modules') + 1}`);
  console.log(`  modules position: ${result4.indexOf('modules') + 1}`);
  console.log(`  Modules_v2 position: ${result4.indexOf('Modules_v2') + 1}`);
  console.log(`  ${result4.indexOf('Modules') > result4.indexOf('List') ? '✅ PASS' : '❌ FAIL'}\n`);
  
  // Test 5: 完整场景
  console.log('Test 5: Complete scenario');
  const test5: TreeType[] = [
    { type: TreeFileType.FILE, name: 'README.md', path: '/README.md' },
    { type: TreeFileType.DIRECTORY, name: 'Modules', path: '/Modules', children: [] },
    { type: TreeFileType.DIRECTORY, name: 'Scripts', path: '/Scripts', children: [] },
    { type: TreeFileType.DIRECTORY, name: 'List', path: '/List', children: [] },
    { type: TreeFileType.DIRECTORY, name: 'GEOIP', path: '/GEOIP', children: [] },
    { type: TreeFileType.DIRECTORY, name: 'CustomFolder', path: '/CustomFolder', children: [] },
    { type: TreeFileType.FILE, name: 'index.html', path: '/index.html' }
  ];
  test5.sort(prioritySorter);
  const result5 = test5.map(t => `${t.type === TreeFileType.DIRECTORY ? '📁' : '📄'} ${t.name}`);
  console.log(`  Result:`);
  result5.forEach((item, idx) => console.log(`    ${idx + 1}. ${item}`));
  console.log(`  Expected order:`);
  console.log(`    1. 📁 List (优先级 40)`);
  console.log(`    2. 📁 GEOIP (优先级 90)`);
  console.log(`    3. 📁 Modules (优先级 200)`);
  console.log(`    4. 📁 Scripts (优先级 210)`);
  console.log(`    5. 📁 CustomFolder (默认 MAX_VALUE, 排最后)`);
  console.log(`    6. 📄 README.md`);
  console.log(`    7. 📄 index.html`);
  
  const expected5Order = [
    '📁 List',
    '📁 GEOIP',
    '📁 Modules',
    '📁 Scripts',
    '📁 CustomFolder',
    '📄 README.md',
    '📄 index.html'
  ];
  
  const matches = result5.every((item, idx) => item === expected5Order[idx]);
  console.log(`  ${matches ? '✅ PASS' : '❌ FAIL'}\n`);
  
  console.log('✅ All sorting tests completed!');
}

runTests();
