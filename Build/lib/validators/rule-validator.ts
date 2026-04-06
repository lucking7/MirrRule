import * as fs from 'node:fs';
import * as path from 'node:path';
import process from 'node:process';
import picocolors from 'picocolors';

interface ValidationResult {
  file: string;
  errors: string[];
  warnings: string[];
  passed: boolean;
}

interface ValidationSummary {
  totalFiles: number;
  passedFiles: number;
  failedFiles: number;
  totalErrors: number;
  totalWarnings: number;
  results: ValidationResult[];
}

class RuleFileValidator {
  private readonly results: ValidationResult[] = [];

  validateFile(filePath: string): ValidationResult {
    const result: ValidationResult = {
      file: filePath,
      errors: [],
      warnings: [],
      passed: true,
    };

    try {
      if (!fs.existsSync(filePath)) {
        result.errors.push('文件不存在');
        result.passed = false;
        return result;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      if (content.trim().length === 0) {
        result.warnings.push('文件为空');
      }
      lines.forEach((line, index) => {
        const lineNumber = index + 1;
        const trimmedLine = line.trim();

        if (trimmedLine === '' || trimmedLine.startsWith('#') || trimmedLine.startsWith('//')) {
          return;
        }

        if (line.includes('\r')) {
          result.errors.push(`行 ${lineNumber}: 检测到 CRLF 行尾符,应使用 LF`);
          result.passed = false;
        }

        // eslint-disable-next-line sukka/unicorn/number-literal-case -- hex literal for ASCII boundary is intentionally written in lowercase
        if ([...line].some(char => char.charCodeAt(0) > 0x7f)) {
          result.warnings.push(`行 ${lineNumber}: 包含非 ASCII 字符,可能导致兼容性问题`);
        }

        if (line.endsWith(' ') || line.endsWith('\t')) {
          result.warnings.push(`行 ${lineNumber}: 存在尾随空格`);
        }

        if (this.isRuleLine(trimmedLine)) {
          this.validateRuleSyntax(trimmedLine, lineNumber, result);
        }
      });

      this.checkDuplicateLines(lines, result);
    } catch (error) {
      result.errors.push(`读取文件失败: ${(error as Error).message}`);
      result.passed = false;
    }

    this.results.push(result);
    return result;
  }

  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- pure predicate does not depend on instance state
  private isRuleLine(line: string): boolean {
    const ruleTypes = [
      'DOMAIN',
      'DOMAIN-SUFFIX',
      'DOMAIN-KEYWORD',
      'IP-CIDR',
      'IP-CIDR6',
      'GEOIP',
      'USER-AGENT',
      'URL-REGEX',
      'PROCESS-NAME',
      'AND',
      'OR',
      'NOT',
      'DEST-PORT',
      'SRC-IP',
    ];

    return ruleTypes.some(type => line.toUpperCase().startsWith(type));
  }

  private validateRuleSyntax(line: string, lineNumber: number, result: ValidationResult): void {
    const parts = line.split(',');

    if (parts.length < 2) {
      result.errors.push(`行 ${lineNumber}: 规则格式不正确,缺少必要的参数`);
      result.passed = false;
      return;
    }

    const ruleType = parts[0].trim().toUpperCase();

    // 复合规则 (AND/OR/NOT) 的语法为 AND,((SUB),(SUB)),POLICY,
    // 逗号分割无法正确解析嵌套结构,跳过字段级校验避免误报
    if (ruleType === 'AND' || ruleType === 'OR' || ruleType === 'NOT') {
      return;
    }

    const value = parts[1]?.trim();
    const policy = parts[2]?.trim();

    if (!this.isRuleLine(ruleType)) {
      result.errors.push(`行 ${lineNumber}: 未知的规则类型 "${ruleType}"`);
      result.passed = false;
    }

    if (!value) {
      result.errors.push(`行 ${lineNumber}: 规则值为空`);
      result.passed = false;
    }

    if (
      (ruleType === 'DOMAIN' || ruleType === 'DOMAIN-SUFFIX') &&
      value &&
      !this.isValidDomain(value)
    ) {
      result.warnings.push(`行 ${lineNumber}: 域名格式可能不正确 "${value}"`);
    }

    if (ruleType === 'IP-CIDR' && value && !this.isValidIPCIDR(value)) {
      result.warnings.push(`行 ${lineNumber}: IP-CIDR 格式可能不正确 "${value}"`);
    }

    if (policy && policy.length > 0) {
      const validPolicies = ['DIRECT', 'PROXY', 'REJECT', 'REJECT-TINYGIF', 'REJECT-DROP'];
      const isValidPolicy = validPolicies.includes(policy.toUpperCase()) || /^[\w-]+$/.test(policy);

      if (!isValidPolicy) {
        result.warnings.push(`行 ${lineNumber}: 策略名称可能不正确 "${policy}"`);
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- pure validation helper does not depend on instance state
  private isValidDomain(domain: string): boolean {
    const domainRegex = /^[\da-z](?:[\da-z-]{0,61}[\da-z])?(?:\.[\da-z](?:[\da-z-]{0,61}[\da-z])?)*$/i;
    return domainRegex.test(domain);
  }

  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- pure validation helper does not depend on instance state
  private isValidIPCIDR(cidr: string): boolean {
    const parts = cidr.split('/');
    if (parts.length !== 2) return false;

    const ip = parts[0];
    const mask = Number.parseInt(parts[1], 10);

    const ipv4Regex = /^(?:\d{1,3}\.){3}\d{1,3}$/;
    if (ipv4Regex.test(ip)) {
      return mask >= 0 && mask <= 32;
    }

    const ipv6Regex = /^(?:[\da-f]{0,4}:){2,7}[\da-f]{0,4}$/i;
    if (ipv6Regex.test(ip)) {
      return mask >= 0 && mask <= 128;
    }

    return false;
  }

  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- pure validation helper does not depend on instance state
  private checkDuplicateLines(lines: string[], result: ValidationResult): void {
    const seen = new Map<string, number>();
    const duplicates: string[] = [];

    lines.forEach((line, index) => {
      const trimmedLine = line.trim();

      if (trimmedLine === '' || trimmedLine.startsWith('#') || trimmedLine.startsWith('//')) {
        return;
      }

      if (seen.has(trimmedLine)) {
        const firstLine = seen.get(trimmedLine)! + 1;
        const currentLine = index + 1;
        duplicates.push(`行 ${currentLine} 与行 ${firstLine} 重复`);
      } else {
        seen.set(trimmedLine, index);
      }
    });

    if (duplicates.length > 0) {
      result.warnings.push(`发现 ${duplicates.length} 处重复规则:`);
      duplicates.slice(0, 5).forEach(dup => {
        result.warnings.push(`  ${dup}`);
      });
      if (duplicates.length > 5) {
        result.warnings.push(`  ... 还有 ${duplicates.length - 5} 处重复`);
      }
    }
  }

  validateDirectory(dirPath: string, pattern = '*.list'): ValidationSummary {
    const files = this.findFiles(dirPath, pattern);

    console.log(picocolors.blue('\nValidating rule files...'));
    console.log(picocolors.gray(`找到 ${files.length} 个文件\n`));

    if (files.length === 0) {
      this.results.push({
        file: dirPath,
        errors: ['未找到任何匹配的规则文件'],
        warnings: [],
        passed: false,
      });
      return this.getSummary();
    }

    files.forEach(file => {
      console.log(picocolors.gray(`验证: ${file}`));
      this.validateFile(file);
    });

    return this.getSummary();
  }

  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- file discovery helper does not depend on instance state
  private findFiles(dirPath: string, pattern: string): string[] {
    const files: string[] = [];
    const ext = pattern.replace('*.', '');

    const walk = (dir: string) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            // 跳过 node_modules, .git 等目录
            if (!['node_modules', '.git', '.cache', 'public'].includes(entry.name)) {
              walk(fullPath);
            }
          } else if (entry.isFile() && entry.name.endsWith(`.${ext}`)) {
            files.push(fullPath);
          }
        }
      } catch {
        // 忽略无法访问的目录
      }
    };

    walk(dirPath);
    return files;
  }

  getSummary(): ValidationSummary {
    const summary: ValidationSummary = {
      totalFiles: this.results.length,
      passedFiles: 0,
      failedFiles: 0,
      totalErrors: 0,
      totalWarnings: 0,
      results: this.results,
    };

    this.results.forEach(result => {
      if (result.passed) {
        summary.passedFiles++;
      } else {
        summary.failedFiles++;
      }
      summary.totalErrors += result.errors.length;
      summary.totalWarnings += result.warnings.length;
    });

    return summary;
  }

  printReport(): void {
    const summary = this.getSummary();

    console.log('\n' + picocolors.bold('Validation Report'));
    console.log(picocolors.gray('─'.repeat(50)));

    console.log(`总文件数: ${summary.totalFiles}`);
    console.log(picocolors.green(`Passed: ${summary.passedFiles}`));
    if (summary.failedFiles > 0) {
      console.log(picocolors.red(`Failed: ${summary.failedFiles}`));
    }
    console.log(picocolors.yellow(`Warnings: ${summary.totalWarnings}`));
    console.log(picocolors.red(`Errors: ${summary.totalErrors}`));

    // 打印详细结果
    if (summary.failedFiles > 0 || summary.totalWarnings > 0) {
      console.log('\n' + picocolors.bold('详细信息:'));
      console.log(picocolors.gray('─'.repeat(50)));

      this.results.forEach(result => {
        if (result.errors.length > 0 || result.warnings.length > 0) {
          console.log(`\n${picocolors.cyan(result.file)}:`);

          result.errors.forEach(error => {
            console.log(picocolors.red(`  [ERROR] ${error}`));
          });

          result.warnings.forEach(warning => {
            console.log(picocolors.yellow(`  [WARN] ${warning}`));
          });
        }
      });
    }

    console.log('\n' + picocolors.gray('─'.repeat(50)));

    // 退出码
    if (summary.failedFiles > 0) {
      console.log(picocolors.red('\n[FAIL] Validation failed!'));
      process.exit(1);
    } else {
      console.log(picocolors.green('\n[OK] Validation passed!'));
      process.exit(0);
    }
  }
}

// CLI 入口
if (require.main === module) {
  const validator = new RuleFileValidator();

  // 从命令行参数获取目录,默认为当前目录
  const targetDir = process.argv[2] || process.cwd();

  validator.validateDirectory(targetDir);
  validator.printReport();
}

export { RuleFileValidator, type ValidationResult, type ValidationSummary };
