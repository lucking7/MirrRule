#!/usr/bin/env tsx

import { HostnameTrie, HostnameSmolTrie } from '../lib/trie.js';
import picocolors from 'picocolors';

console.log(picocolors.bold('🧪 测试 Trie 优化行为\n'));

// 测试数据
const testDomains = [
  { domain: 'cn', isSuffix: true }, // .cn
  { domain: 'baidu.cn', isSuffix: true }, // .baidu.cn
  { domain: 'test.cn', isSuffix: true }, // .test.cn
  { domain: 'alibaba', isSuffix: true }, // .alibaba
  { domain: 'taobao', isSuffix: true }, // .taobao
];

// 测试 HostnameTrie
console.log(picocolors.cyan('=== 测试 HostnameTrie ==='));
const trie1 = new HostnameTrie();
for (const { domain, isSuffix } of testDomains) {
  trie1.add(domain, isSuffix);
}

const result1: string[] = [];
trie1.dump((domain, isIncludeSubdomain) => {
  result1.push(isIncludeSubdomain ? `.${domain}` : domain);
});

console.log('输入域名数:', testDomains.length);
console.log('输出域名数:', result1.length);
console.log('输出结果:', result1.sort());

// 测试 HostnameSmolTrie
console.log('\n' + picocolors.cyan('=== 测试 HostnameSmolTrie ==='));
const trie2 = new HostnameSmolTrie();
for (const { domain, isSuffix } of testDomains) {
  trie2.add(domain, isSuffix);
}

const result2: string[] = [];
trie2.dump((domain, isIncludeSubdomain) => {
  result2.push(isIncludeSubdomain ? `.${domain}` : domain);
});

console.log('输入域名数:', testDomains.length);
console.log('输出域名数:', result2.length);
console.log('输出结果:', result2.sort());

// 对比结果
console.log('\n' + picocolors.cyan('=== 对比结果 ==='));
console.log('HostnameTrie 优化效果:', testDomains.length - result1.length);
console.log('HostnameSmolTrie 优化效果:', testDomains.length - result2.length);

// 测试更复杂的场景
console.log('\n' + picocolors.cyan('=== 测试复杂场景 ==='));
const complexDomains = [
  { domain: 'example.com', isSuffix: true },
  { domain: 'sub.example.com', isSuffix: false },
  { domain: 'test.example.com', isSuffix: true },
  { domain: 'a.test.example.com', isSuffix: false },
];

const trie3 = new HostnameSmolTrie();
for (const { domain, isSuffix } of complexDomains) {
  console.log(`添加: ${isSuffix ? '.' : ''}${domain}`);
  trie3.add(domain, isSuffix);
}

const result3: string[] = [];
trie3.dump((domain, isIncludeSubdomain) => {
  result3.push(isIncludeSubdomain ? `.${domain}` : domain);
});

console.log(
  '\n输入:',
  complexDomains.map(d => (d.isSuffix ? '.' : '') + d.domain)
);
console.log('输出:', result3.sort());

// 测试顺序影响
console.log('\n' + picocolors.cyan('=== 测试添加顺序的影响 ==='));

// 先添加子域名，再添加父域名
const trie4 = new HostnameSmolTrie();
trie4.add('test.cn', true); // 先添加 .test.cn
trie4.add('baidu.cn', true); // 再添加 .baidu.cn
trie4.add('cn', true); // 最后添加 .cn

const result4: string[] = [];
trie4.dump((domain, isIncludeSubdomain) => {
  result4.push(isIncludeSubdomain ? `.${domain}` : domain);
});

console.log('顺序1 (子→父) 结果:', result4);

// 先添加父域名，再添加子域名
const trie5 = new HostnameSmolTrie();
trie5.add('cn', true); // 先添加 .cn
trie5.add('test.cn', true); // 再添加 .test.cn
trie5.add('baidu.cn', true); // 最后添加 .baidu.cn

const result5: string[] = [];
trie5.dump((domain, isIncludeSubdomain) => {
  result5.push(isIncludeSubdomain ? `.${domain}` : domain);
});

console.log('顺序2 (父→子) 结果:', result5);
