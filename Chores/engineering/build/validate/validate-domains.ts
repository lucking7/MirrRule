/**
 * 现代化域名存活验证脚本
 *
 * 此脚本会：
 * 1. 使用 fdir 扫描规则文件中的所有域名
 * 2. 使用 @henrygd/queue 并发检查域名是否存活
 * 3. 使用 cli-progress 显示进度条
 * 4. 输出失效域名的 JSON 数组
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { fdir as Fdir } from 'fdir';
import { newQueue } from '@henrygd/queue';
import cliProgress from 'cli-progress';
import tldts from 'tldts-experimental';
import { isDomainAlive } from '../lib/is-domain-alive.js';
import runAgainstSourceFile from '../lib/run-against-source-file.js';
import { looseTldtsOpt } from '../constants/loose-tldts-opt.js';

// 获取脚本目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 根目录和缓存目录
const ROOT_DIR = path.resolve(__dirname, '../../../..');
const CACHE_DIR = path.join(ROOT_DIR, '.cache');

// 缓存文件
const DEAD_DOMAINS_CACHE = path.join(CACHE_DIR, 'dead-domains.json');

// 并发队列设置
const queue = newQueue(32);

// 存储失效域名
const deadDomains: string[] = [];

/**
 * 检查目录是否存在
 */
async function dirExists(dirPath: string): Promise<boolean> {
  try {
    await fs.access(dirPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 使用 fdir 扫描指定目录下的规则文件
 */
async function scanRuleFiles(): Promise<string[]> {
  const directories = [
    path.join(ROOT_DIR, 'Surge', 'Rulesets'),
    path.join(ROOT_DIR, 'Dial'),
    path.join(ROOT_DIR, 'Chores', 'ruleset')
  ];

  const allFiles: string[] = [];

  for (const dir of directories) {
    if (await dirExists(dir)) {
      console.log(`扫描目录: ${dir}`);
      
      const files = await new Fdir()
        .withFullPaths()
        .filter((filePath, isDirectory) => {
          if (isDirectory) return false;
          const extname = path.extname(filePath);
          return extname === '.txt' || extname === '.conf' || extname === '.list';
        })
        .crawl(dir)
        .withPromise();

      allFiles.push(...files);
      console.log(`发现 ${files.length} 个文件`);
    } else {
      console.log(`目录不存在，跳过: ${dir}`);
    }
  }

  return allFiles;
}

/**
 * 域名归一化处理
 */
function normalizeDomain(domain: string): string | null {
  if (!domain || domain.length === 0) return null;
  
  const parsed = tldts.parse(domain, looseTldtsOpt);
  if (!parsed.isIcann && !parsed.isPrivate) return null;
  
  return parsed.hostname;
}

/**
 * 处理单个规则文件，提取域名并进行存活检测
 */
async function processRuleFile(filePath: string, progressBar: cliProgress.SingleBar): Promise<void> {
  return new Promise((resolve) => {
    runAgainstSourceFile(
      filePath,
      (domain: string, includeAllSubdomain: boolean) => {
        // 增加进度条总数
        progressBar.setTotal(progressBar.getTotal() + 1);

        // 添加到队列进行异步检测
        queue.add(async () => {
          try {
            // 域名归一化
            const normalizedDomain = normalizeDomain(domain);
            if (!normalizedDomain) {
              progressBar.increment();
              return;
            }

            // 检测域名存活性
            const alive = await isDomainAlive(normalizedDomain, includeAllSubdomain);
            
            progressBar.increment();

            if (!alive) {
              const domainToAdd = includeAllSubdomain ? '.' + normalizedDomain : normalizedDomain;
              deadDomains.push(domainToAdd);
            }
          } catch (error: unknown) {
            console.error(`检测域名失败: ${domain}`, error);
            progressBar.increment();
          }
        });
      }
    ).then(() => {
      console.log(`[已处理] ${filePath}`);
      resolve();
    }).catch((error: unknown) => {
      console.error(`处理文件失败: ${filePath}`, error);
      resolve();
    });
  });
}

/**
 * 主函数
 */
async function main() {
  try {
    console.log('🔍 开始现代化域名存活验证...');

    // 确保缓存目录存在
    await fs.mkdir(CACHE_DIR, { recursive: true });

    // 扫描规则文件
    console.log('📁 扫描规则文件...');
    const ruleFiles = await scanRuleFiles();
    
    if (ruleFiles.length === 0) {
      console.log('⚠️  未找到任何规则文件');
      return;
    }

    console.log(`📄 共发现 ${ruleFiles.length} 个规则文件`);

    // 初始化进度条
    const progressBar = new cliProgress.SingleBar({
      format: '验证进度 |{bar}| {percentage}% | {value}/{total} | 速度: {speed} 域名/秒 | 剩余: {eta}s',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
    }, cliProgress.Presets.shades_classic);

    progressBar.start(0, 0);

    // 处理所有规则文件
    console.log('🔄 开始处理规则文件并检测域名...');
    await Promise.all(
      ruleFiles.map(filePath => processRuleFile(filePath, progressBar))
    );

    // 等待所有域名检测完成
    console.log('⏳ 等待所有域名检测完成...');
    await queue.done();

    progressBar.stop();

    // 输出结果
    console.log('\n✅ 域名验证完成！');
    console.log(`📊 检测结果: 发现 ${deadDomains.length} 个失效域名`);

    if (deadDomains.length > 0) {
      // 去重并排序
      const uniqueDeadDomains = [...new Set(deadDomains)].sort();
      
      // 保存到缓存文件
      await fs.writeFile(DEAD_DOMAINS_CACHE, JSON.stringify(uniqueDeadDomains, null, 2));
      console.log(`💾 失效域名已保存到: ${DEAD_DOMAINS_CACHE}`);

      // 控制台输出（限制显示数量）
      if (uniqueDeadDomains.length <= 20) {
        console.log('\n🔴 失效域名列表:');
        uniqueDeadDomains.forEach(domain => console.log(`  - ${domain}`));
      } else {
        console.log(`\n🔴 失效域名列表（前20个）:`);
        uniqueDeadDomains.slice(0, 20).forEach(domain => console.log(`  - ${domain}`));
        console.log(`  ... 还有 ${uniqueDeadDomains.length - 20} 个域名`);
      }

      // 最终 JSON 输出
      console.log('\n📋 JSON 格式输出:');
      console.log(JSON.stringify(uniqueDeadDomains));
    } else {
      console.log('🎉 所有域名都是存活的！');
    }

    // 设置 GitHub Actions 输出
    if (process.env.GITHUB_OUTPUT) {
      const outputPath = process.env.GITHUB_OUTPUT;
      await fs.appendFile(outputPath, `has_dead_domains=${deadDomains.length > 0}\n`);
      await fs.appendFile(outputPath, `dead_domains_count=${deadDomains.length}\n`);
    }

  } catch (error: unknown) {
    console.error('❌ 域名验证失败:', error);
    process.exit(1);
  }
}

// 执行主函数
main().catch((error: unknown) => {
  console.error('💥 未捕获的错误:', error);
  process.exit(1);
});
