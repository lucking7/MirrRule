/**
 * 统一命令行参数解析器
 * 提供标准化的参数解析和验证功能
 *
 * @module cli/argument-parser
 */

/**
 * 参数选项定义
 */
export interface ArgumentOption<T = unknown> {
  /** 参数名称 */
  name: string,
  /** 参数别名 */
  alias?: string,
  /** 参数描述 */
  description?: string,
  /** 参数类型 */
  type: 'string' | 'number' | 'boolean' | 'array',
  /** 默认值 */
  defaultValue?: T,
  /** 是否必需 */
  required?: boolean,
  /** 可选值列表（用于枚举验证） */
  choices?: T[],
  /** 自定义验证函数 */
  validate?: (value: T) => boolean | string
}

/**
 * 解析结果
 */
export interface ParsedArguments {
  [key: string]: string | number | boolean | string[] | undefined
}

/**
 * 参数解析错误
 */
export class ArgumentParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArgumentParseError';
  }
}

/**
 * 命令行参数解析器类
 */
export class ArgumentParser {
  private readonly optionsMap = new Map<string, ArgumentOption>();
  private readonly aliases = new Map<string, string>();

  /**
   * 注册参数选项
   * @param option - 参数选项定义
   * @returns this（链式调用）
   */
  option<T>(option: ArgumentOption<T>): this {
    this.optionsMap.set(option.name, option as ArgumentOption);

    if (option.alias) {
      this.aliases.set(option.alias, option.name);
    }

    return this;
  }

  /**
   * 批量注册参数选项
   * @param options - 参数选项数组
   * @returns this（链式调用）
   */
  options(options: ArgumentOption[]): this {
    for (const option of options) {
      this.option(option);
    }
    return this;
  }

  /**
   * 解析命令行参数
   * @param argv - 参数数组（默认使用 process.argv.slice(2)）
   * @returns 解析后的参数对象
   * @throws {ArgumentParseError} 参数解析或验证失败
   */
  parse(argv: string[] = process.argv.slice(2)): ParsedArguments {
    const result: ParsedArguments = {};

    // 初始化默认值
    for (const [name, option] of this.optionsMap) {
      if (option.defaultValue !== undefined) {
        result[name] = option.defaultValue;
      }
    }

    // 解析参数
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];

      if (arg.startsWith('--')) {
        // 长格式参数：--name 或 --name=value
        const parsed = this.parseLongOption(arg, argv[i + 1]);
        if (parsed) {
          const { name, value, consumed } = parsed;
          result[name] = value;
          if (consumed) {
            i++; // 跳过已消费的下一个参数
          }
        }
      } else if (arg.startsWith('-') && arg.length === 2) {
        // 短格式参数：-n 或 -n value
        const alias = arg.slice(1);
        const name = this.aliases.get(alias);

        if (!name) {
          throw new ArgumentParseError(`Unknown option: ${arg}`);
        }

        const option = this.optionsMap.get(name)!;

        if (option.type === 'boolean') {
          result[name] = true;
        } else {
          const value = argv[i + 1];
          if (!value || value.startsWith('-')) {
            throw new ArgumentParseError(`Missing value for option: ${arg}`);
          }
          result[name] = this.convertValue(value, option);
          i++; // 消费下一个参数
        }
      }
    }

    // 验证必需参数
    for (const [name, option] of this.optionsMap) {
      if (option.required && result[name] === undefined) {
        throw new ArgumentParseError(`Missing required option: --${name}`);
      }

      // 验证枚举值
      if (option.choices && result[name] !== undefined && !option.choices.includes(result[name] as never)) {
        throw new ArgumentParseError(
          `Invalid value for --${name}. Expected one of: ${option.choices.join(', ')}`
        );
      }

      // 自定义验证
      if (option.validate && result[name] !== undefined) {
        const validationResult = option.validate(result[name] as never);
        if (validationResult !== true) {
          const errorMessage = typeof validationResult === 'string'
            ? validationResult
            : `Invalid value for --${name}`;
          throw new ArgumentParseError(errorMessage);
        }
      }
    }

    return result;
  }

  /**
   * 解析长格式选项
   */
  private parseLongOption(
    arg: string,
    nextArg?: string
  ): { name: string, value: unknown, consumed: boolean } | null {
    let name: string;
    let value: string | undefined;

    // 处理 --name=value 格式
    if (arg.includes('=')) {
      const parts = arg.slice(2).split('=');
      name = parts[0];
      value = parts.slice(1).join('=');
    } else {
      // 处理 --name value 格式
      name = arg.slice(2);
      value = nextArg;
    }

    // 解析别名
    const realName = this.aliases.get(name) || name;
    const option = this.optionsMap.get(realName);

    if (!option) {
      throw new ArgumentParseError(`Unknown option: ${arg}`);
    }

    let parsedValue: unknown;
    let consumed = false;

    if (option.type === 'boolean') {
      // 布尔值选项
      if (value === undefined || value.startsWith('-')) {
        parsedValue = true;
      } else {
        parsedValue = value === 'true' || value === '1';
        consumed = !arg.includes('=');
      }
    } else {
      // 其他类型需要值
      if (value === undefined) {
        throw new ArgumentParseError(`Missing value for option: ${arg}`);
      }

      parsedValue = this.convertValue(value, option);
      consumed = !arg.includes('=');
    }

    return {
      name: realName,
      value: parsedValue,
      consumed
    };
  }

  /**
   * 转换参数值类型
   */
  private convertValue(value: string, option: ArgumentOption): unknown {
    switch (option.type) {
      case 'number':
        const num = Number(value);
        if (isNaN(num)) {
          throw new ArgumentParseError(
            `Invalid number value for --${option.name}: ${value}`
          );
        }
        return num;

      case 'boolean':
        return value === 'true' || value === '1';

      case 'array':
        return value.split(',').map(v => v.trim());

      case 'string':
      default:
        return value;
    }
  }

  /**
   * 生成帮助信息
   * @returns 格式化的帮助文本
   */
  help(): string {
    const lines: string[] = ['Options:'];

    for (const [name, option] of this.optionsMap) {
      let line = '  ';

      if (option.alias) {
        line += `-${option.alias}, `;
      }

      line += `--${name}`;

      if (option.type !== 'boolean') {
        line += ` <${option.type}>`;
      }

      if (option.required) {
        line += ' (required)';
      }

      if (option.description) {
        line += `\n    ${option.description}`;
      }

      if (option.defaultValue !== undefined) {
        line += `\n    Default: ${option.defaultValue}`;
      }

      if (option.choices) {
        line += `\n    Choices: ${option.choices.join(', ')}`;
      }

      lines.push(line);
    }

    return lines.join('\n');
  }
}

/**
 * 快速创建参数解析器的工厂函数
 * @param options - 参数选项数组
 * @returns 配置好的参数解析器实例
 */
export function createArgumentParser(options: ArgumentOption[]): ArgumentParser {
  const parser = new ArgumentParser();
  return parser.options(options);
}
