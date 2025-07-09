import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import picocolors from 'picocolors';
import { getDeadDomains } from '../lib/is-domain-alive.js';
import { SOURCE_DIR } from '../constants/dir.js';
import { type Span } from '../trace/index.js';
import cliProgress from 'cli-progress';

// 提取域名的正则表达式
const DOMAIN_REGEX = /^DOMAIN(?:-SUFFIX)?,([\w.-]+)$/;

/**
 * 从文件中提取域名
 */
async function extractDomainsFromFile(filePath: string): Promise<string[]> {
  const content = await readFile(filePath, 'utf-8');
  const domains = new Set<string>();

  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();

    // 跳过空行和注释
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
      continue;
    }

    // 匹配 DOMAIN 和 DOMAIN-SUFFIX 规则
    const match = trimmed.match(DOMAIN_REGEX);
    if (match) {
      domains.add(match[1]);
    } else if (!trimmed.includes(',') && trimmed.includes('.')) {
      // 纯域名格式（domainset 目录中的文件）
      domains.add(trimmed);
    }
  }

  return Array.from(domains);
}

/**
 * 扫描目录并提取所有域名
 */
async function scanDirectory(dir: string, fileTypes: string[]): Promise<Map<string, string[]>> {
  const domainsByFile = new Map<string, string[]>();

  try {
    const files = await readdir(dir);

    for (const file of files) {
      // 检查文件扩展名
      const ext = path.extname(file);
      if (!fileTypes.includes(ext)) {
        continue;
      }

      const filePath = path.join(dir, file);
      const domains = await extractDomainsFromFile(filePath);

      if (domains.length > 0) {
        domainsByFile.set(filePath, domains);
      }
    }
  } catch (error) {
    console.warn(`⚠️ 无法读取目录 ${dir}: ${error}`);
  }

  return domainsByFile;
}

/**
 * 域名验证主函数
 */
export async function validateDomainAlive(parentSpan: Span) {
  console.log(picocolors.blue('🔍 开始验证域名活跃性...\n'));

  const span = parentSpan.traceChild('validate-domain-alive');
  try {
    // 需要扫描的目录和文件类型
    const scanConfigs = [
      { dir: path.join(SOURCE_DIR, 'domainset'), types: ['.txt', '.conf'] },
      { dir: path.join(SOURCE_DIR, 'non_ip'), types: ['.txt', '.conf'] },
    ];

    console.log(`SOURCE_DIR: ${SOURCE_DIR}`);

    // 收集所有需要验证的域名
    const allDomainsByFile = new Map<string, string[]>();
    let totalDomains = 0;

    console.log('📁 扫描源文件...');
    for (const config of scanConfigs) {
      console.log(`  检查目录: ${config.dir}`);
      const domainsByFile = await scanDirectory(config.dir, config.types);

      for (const [file, domains] of domainsByFile) {
        allDomainsByFile.set(file, domains);
        totalDomains += domains.length;
        console.log(
          `  ${picocolors.gray(path.relative(SOURCE_DIR, file))}: ${domains.length} 个域名`
        );
      }
    }

    if (totalDomains === 0) {
      console.log(picocolors.yellow('\n⚠️ 未找到需要验证的域名'));
      return;
    }

    console.log(`\n📊 总计找到 ${totalDomains} 个域名需要验证\n`);

    // 收集所有域名（去重）
    const allDomains = new Set<string>();
    for (const domains of allDomainsByFile.values()) {
      domains.forEach(d => allDomains.add(d));
    }

    // 验证域名活跃性
    const deadDomains = await getDeadDomains(span, Array.from(allDomains), {
      concurrency: 32,
      showProgress: true,
    });

    if (deadDomains.length === 0) {
      console.log(picocolors.green('\n✅ 所有域名都是活跃的！'));
      return;
    }

    // 按文件分组死域名
    const deadDomainsByFile = new Map<string, string[]>();

    for (const [file, domains] of allDomainsByFile) {
      const fileDead = domains.filter(d => deadDomains.includes(d));
      if (fileDead.length > 0) {
        deadDomainsByFile.set(file, fileDead);
      }
    }

    // 输出结果
    console.log(picocolors.red(`\n❌ 发现 ${deadDomains.length} 个死域名:\n`));

    const result: Record<string, string[]> = {};

    for (const [file, domains] of deadDomainsByFile) {
      const relPath = path.relative(SOURCE_DIR, file);
      console.log(picocolors.yellow(`📄 ${relPath}:`));

      domains.forEach(d => {
        console.log(`  - ${d}`);
      });
      console.log();

      result[relPath] = domains;
    }

    // 输出 JSON 结果（供其他脚本使用）
    console.log(JSON.stringify(result));
  } finally {
    span.stop();
  }
}

// 如果直接运行脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  import('../trace/index.js').then(({ createSpan }) => {
    const rootSpan = createSpan('root');
    validateDomainAlive(rootSpan).catch(error => {
      console.error(picocolors.red('❌ 验证失败:'), error);
      process.exit(1);
    });
  });
}
