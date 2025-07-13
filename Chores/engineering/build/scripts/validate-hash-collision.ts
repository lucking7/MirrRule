/**
 * 域名规则哈希碰撞检测脚本
 *
 * 功能：
 * 1. 扫描 domainset 和 non_ip 目录下的域名规则
 * 2. 使用 xxhash3 算法计算域名哈希值
 * 3. 检测并报告哈希碰撞
 *
 * 技术栈：
 * - xxhash-wasm: xxhash3 算法
 * - fdir: 高效文件遍历
 * - @henrygd/queue: 并发处理
 * - cli-progress: 进度显示
 * - foxts: 工具函数
 */

import picocolors from 'picocolors';
import { readFileByLine, readFileIntoProcessedArray } from '../lib/fetch-text-by-line.js';
import path from 'node:path';
import { SOURCE_DIR } from '../constants/dir.js';
import { type Span } from '../trace/index.js';
import { fdir } from 'fdir';
import { newQueue } from '@henrygd/queue';
import cliProgress from 'cli-progress';
import xxhashWasm from 'xxhash-wasm';

let xxhashInstance: Awaited<ReturnType<typeof xxhashWasm>> | null = null;

async function getXXHash() {
  if (!xxhashInstance) {
    xxhashInstance = await xxhashWasm();
  }
  return xxhashInstance;
}

interface HashInfo {
  hash: string;
  domains: Set<string>;
}

async function processFile(
  filePath: string,
  hashMap: Map<string, HashInfo>,
  progressBar?: cliProgress.SingleBar
): Promise<void> {
  const xxhash = await getXXHash();

  try {
    // 处理规则文件，提取域名
    for await (const line of readFileByLine(filePath)) {
      const trimmedLine = line.trim();

      // 跳过空行和注释
      if (!trimmedLine || trimmedLine.startsWith('#') || trimmedLine.startsWith('//')) {
        continue;
      }

      // 处理不同格式的域名规则
      let domain: string | undefined;

      if (trimmedLine.includes(',')) {
        // 混合规则集格式：DOMAIN,example.com 或 DOMAIN-SUFFIX,example.com
        const parts = trimmedLine.split(',');
        if (parts[0] === 'DOMAIN' || parts[0] === 'DOMAIN-SUFFIX') {
          domain = parts[1]?.trim();
        }
      } else if (!trimmedLine.includes(' ') && trimmedLine.includes('.')) {
        // 纯域名格式：example.com 或 .example.com
        domain = trimmedLine.startsWith('.') ? trimmedLine.slice(1) : trimmedLine;
      }

      if (domain) {
        // 计算 xxhash3
        const hash = xxhash.h64ToString(domain);

        if (!hashMap.has(hash)) {
          hashMap.set(hash, {
            hash,
            domains: new Set([domain]),
          });
        } else {
          hashMap.get(hash)!.domains.add(domain);
        }
      }
    }

    if (progressBar) {
      progressBar.increment();
    }
  } catch (error) {
    console.error(`❌ 处理文件失败: ${filePath}`, error);
  }
}

export async function validateHashCollision(parentSpan: Span) {
  console.log(picocolors.blue('🔍 检查域名规则哈希碰撞...'));

  const span = parentSpan.traceChild('validate-hash-collision');

  try {
    // 使用 fdir 高效遍历文件
    const crawler = new fdir()
      .withBasePath()
      .filter(path => path.endsWith('.txt') || path.endsWith('.conf') || path.endsWith('.list'));

    const files: string[] = [];

    // 尝试扫描各个目录，优雅处理不存在的情况
    const dirsToScan = [
      path.join(path.dirname(SOURCE_DIR), 'Surge', 'Rulesets'),
      path.join(path.dirname(SOURCE_DIR), 'Chores', 'ruleset'),
    ];

    for (const dir of dirsToScan) {
      try {
        const dirFiles = await crawler.crawl(dir).withPromise();
        files.push(...dirFiles);
      } catch (error) {
        console.log(picocolors.gray(`  跳过不存在的目录: ${dir}`));
      }
    }

    if (files.length === 0) {
      console.log(picocolors.yellow('⚠️ 未找到域名规则文件'));
      return;
    }

    // 创建进度条
    const progressBar = new cliProgress.SingleBar({
      format: '处理进度 |' + picocolors.cyan('{bar}') + '| {percentage}% | {value}/{total} 文件',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
    });

    progressBar.start(files.length, 0);

    // 使用队列并发处理文件
    const queue = newQueue(32);
    const hashMap = new Map<string, HashInfo>();

    // 添加所有文件处理任务到队列
    const tasks = files.map((file: string) =>
      queue.add(() => processFile(file, hashMap, progressBar))
    );

    // 等待所有任务完成
    await Promise.all(tasks);

    progressBar.stop();

    // 检测碰撞
    const collisions: Array<[string, Set<string>]> = [];
    let totalCollisions = 0;

    hashMap.forEach((info, hash) => {
      if (info.domains.size > 1) {
        collisions.push([hash, info.domains]);
        totalCollisions += info.domains.size - 1;
      }
    });

    // 输出结果
    if (collisions.length === 0) {
      console.log(picocolors.green('✅ 未发现域名哈希碰撞'));
      return;
    }

    console.log(
      picocolors.yellow(
        `\n⚠️ 发现 ${collisions.length} 个哈希值存在碰撞，涉及 ${totalCollisions} 个域名:\n`
      )
    );

    // 按碰撞域名数量排序
    collisions.sort((a, b) => b[1].size - a[1].size);

    // 显示前10个最严重的碰撞
    const showCount = Math.min(10, collisions.length);
    for (let i = 0; i < showCount; i++) {
      const [hash, domains] = collisions[i];
      console.log(picocolors.red(`哈希 ${hash} => ${domains.size} 个域名:`));

      const domainList = Array.from(domains);
      const displayCount = Math.min(5, domainList.length);

      for (let j = 0; j < displayCount; j++) {
        console.log(`  - ${domainList[j]}`);
      }

      if (domainList.length > displayCount) {
        console.log(`  ... 还有 ${domainList.length - displayCount} 个域名`);
      }
      console.log();
    }

    if (collisions.length > showCount) {
      console.log(
        picocolors.yellow(`... 还有 ${collisions.length - showCount} 个哈希碰撞未显示\n`)
      );
    }

    // 统计信息
    console.log(picocolors.blue('📊 统计信息:'));
    console.log(`  - 处理文件数: ${files.length}`);
    console.log(`  - 唯一哈希数: ${hashMap.size}`);
    console.log(`  - 碰撞哈希数: ${collisions.length}`);
    console.log(`  - 碰撞域名数: ${totalCollisions}`);
  } finally {
    span.stop();
  }
}

// 如果直接运行脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  import('../trace/index.js').then(({ createSpan }) => {
    const rootSpan = createSpan('root');
    validateHashCollision(rootSpan).catch(error => {
      console.error(picocolors.red('❌ 验证失败:'), error);
      process.exit(1);
    });
  });
}
