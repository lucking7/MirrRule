import { glob } from 'glob';
import { readFile } from 'fs/promises';
import path from 'node:path';
import { type Span } from '../trace/index.js';
import picocolors from 'picocolors';
import { StrictTldValidator } from '../lib/strict-tld-validator.js';

// 创建严格的 TLD 验证器实例
const tldValidator = new StrictTldValidator();

// 定义要跳过的目录和文件
const SKIP_DIRECTORIES = [
  'Surge/Rulesets/direct/',
  'Surge/Rulesets/lan/',
  'Surge/Rulesets/proxy/',
  'Surge/Rulesets/reject/',
];

const SKIP_FILES = [
  'Surge/Rulesets/stream/video/emby.list',
  'Surge/Rulesets/stream/video/emby_all.list',
  'Surge/Rulesets/domestic/cn_lmfirefly.list',
  'Surge/Rulesets/stream/global_media.list',
  'Surge/Rulesets/global.list',
  'Surge/Rulesets/direct.list',
];

interface ValidationResult {
  filePath: string;
  errors: ValidationError[];
}

interface ValidationError {
  line: number;
  domain: string;
  reason: string;
}

// 辅助函数：清理域名中的注释
function cleanDomainFromComments(domain: string): string {
  // 移除 // 注释
  let cleaned = domain.split('//')[0].trim();
  // 移除 # 注释
  cleaned = cleaned.split('#')[0].trim();
  return cleaned;
}

// 检查文件路径是否应该被跳过
function shouldSkipFile(filePath: string): boolean {
  // 标准化路径分隔符
  const normalizedPath = filePath.replace(/\\/g, '/');

  // 检查是否在跳过的目录中
  for (const dir of SKIP_DIRECTORIES) {
    if (normalizedPath.includes(dir)) {
      return true;
    }
  }

  // 检查是否是跳过的文件
  for (const file of SKIP_FILES) {
    if (normalizedPath.endsWith(file)) {
      return true;
    }
  }

  return false;
}

async function validateFile(filePath: string): Promise<ValidationResult> {
  const errors: ValidationError[] = [];

  try {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // 跳过空行和注释行
      if (!line || line.startsWith('#') || line.startsWith('//')) {
        continue;
      }

      let domain = '';

      // 处理不同类型的规则
      if (line.startsWith('DOMAIN-SUFFIX,')) {
        const rawDomain = line.substring('DOMAIN-SUFFIX,'.length);
        domain = cleanDomainFromComments(rawDomain);

        // 特殊处理：如果域名只是一个单词（没有点），可能是 TLD 本身
        if (!domain.includes('.') && domain.length > 0) {
          // 单个 TLD 作为 DOMAIN-SUFFIX 是合法的
          continue;
        }
      } else if (line.startsWith('DOMAIN,')) {
        const rawDomain = line.substring('DOMAIN,'.length);
        domain = cleanDomainFromComments(rawDomain);
      } else {
        // 其他类型的规则（如 IP 规则）跳过
        continue;
      }

      // 验证域名
      if (domain && !tldValidator.isValidDomain(domain)) {
        const reason = tldValidator.getValidationError(domain);
        errors.push({
          line: i + 1,
          domain,
          reason: reason || '无效的域名',
        });
      }
    }
  } catch (error) {
    console.error(`读取文件 ${filePath} 时出错:`, error);
  }

  return { filePath, errors };
}

export async function validateRules(parentSpan: Span) {
  const span = parentSpan.traceChild('validate-rules');

  try {
    // 查找所有规则文件
    const ruleFiles = await glob(['Surge/Rulesets/**/*.list', 'Chores/ruleset/**/*.list']);

    console.log(`🔍 检查规则文件的 TLD 有效性...`);
    console.log(`  总文件数: ${ruleFiles.length}`);

    // 过滤出需要验证的文件
    const filesToValidate = ruleFiles.filter(file => !shouldSkipFile(file));
    const skippedFiles = ruleFiles.filter(file => shouldSkipFile(file));

    console.log(`  跳过文件数: ${skippedFiles.length}`);
    console.log(`  实际验证: ${filesToValidate.length}`);

    const results = await Promise.all(filesToValidate.map(validateFile));

    // 收集所有错误
    let totalErrors = 0;
    const filesWithErrors: ValidationResult[] = [];

    for (const result of results) {
      if (result.errors.length > 0) {
        totalErrors += result.errors.length;
        filesWithErrors.push(result);
      }
    }

    // 输出结果
    if (totalErrors > 0) {
      console.log(picocolors.red(`\n❌ 发现 ${totalErrors} 个 TLD 相关错误:\n`));

      for (const { filePath, errors } of filesWithErrors) {
        console.log(picocolors.yellow(`\n${filePath}:`));
        const errorsByReason: { [key: string]: ValidationError[] } = {};

        // 按错误原因分组
        for (const error of errors) {
          const reason = error.reason;
          if (!errorsByReason[reason]) {
            errorsByReason[reason] = [];
          }
          errorsByReason[reason].push(error);
        }

        // 输出分组后的错误
        for (const [reason, groupedErrors] of Object.entries(errorsByReason)) {
          console.log(`  ${picocolors.red(reason)} (${groupedErrors.length}次):`);

          // 显示前5个例子
          const examples = groupedErrors.slice(0, 5);
          for (const error of examples) {
            console.log(`    行 ${error.line}: ${error.domain}`);
          }

          if (groupedErrors.length > 5) {
            console.log(`    ... 还有 ${groupedErrors.length - 5} 个类似错误`);
          }
        }
      }

      process.exit(1);
    } else {
      console.log(picocolors.green('\n✅ 所有文件的 TLD 验证通过！'));
    }
  } finally {
    span.stop();
  }
}

// 如果直接运行此脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  import('../trace/index.js').then(({ createSpan }) => {
    const rootSpan = createSpan('validate-rules-main');
    validateRules(rootSpan).finally(() => {
      rootSpan.stop();
    });
  });
}
