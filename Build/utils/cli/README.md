# CLI 框架使用指南

统一的命令行应用开发框架，提供标准化的日志、参数解析和错误处理功能。

## 特性

- ✅ **统一日志输出** - 标准化的日志级别和彩色输出
- ✅ **参数解析** - 灵活的命令行参数解析和验证
- ✅ **错误处理** - 统一的错误处理和进程退出管理
- ✅ **可扩展** - 支持函数式和类继承两种使用方式

## 快速开始

### 方式 1：函数式（简单场景）

```typescript
import { createCLI, registerGlobalErrorHandlers } from './utils/cli';

registerGlobalErrorHandlers();

const cli = createCLI(
  {
    name: 'my-tool',
    description: '我的命令行工具',
    version: '1.0.0',
    options: [
      {
        name: 'input',
        alias: 'i',
        type: 'string',
        description: '输入文件',
        required: true
      },
      {
        name: 'output',
        alias: 'o',
        type: 'string',
        description: '输出文件',
        defaultValue: 'output.txt'
      }
    ]
  },
  async ({ logger, args }) => {
    logger.info(`处理文件: ${args.input}`);
    logger.success('处理完成！');
    return 0;
  }
);

cli.run();
```

### 方式 2：类继承（复杂场景）

```typescript
import { CLIFramework, registerGlobalErrorHandlers, type CLIContext } from './utils/cli';

class MyToolCLI extends CLIFramework {
  constructor() {
    super({
      name: 'my-tool',
      description: '我的命令行工具',
      version: '1.0.0',
      options: [
        {
          name: 'input',
          alias: 'i',
          type: 'string',
          description: '输入文件',
          required: true
        }
      ]
    });
  }

  protected async execute(context: CLIContext): Promise<number> {
    const { logger, args } = context;

    try {
      logger.info(`处理文件: ${args.input}`);

      // 执行业务逻辑
      await this.processFile(args.input as string);

      return this.success('处理完成！');
    } catch (error) {
      return this.failure('处理失败');
    }
  }

  private async processFile(input: string): Promise<void> {
    // 业务逻辑
  }

  protected getExamples(): string[] {
    return [
      'my-tool --input file.txt',
      'my-tool -i file.txt --verbose'
    ];
  }
}

registerGlobalErrorHandlers();

if (require.main === module) {
  new MyToolCLI().run();
}
```

## API 参考

### CLIConfig 配置选项

```typescript
interface CLIConfig {
  name: string;              // 命令名称
  description?: string;      // 命令描述
  version?: string;          // 版本号
  logger?: LoggerConfig;     // 日志配置
  options?: ArgumentOption[]; // 参数选项
}
```

### ArgumentOption 参数选项

```typescript
interface ArgumentOption<T = unknown> {
  name: string;              // 参数名称
  alias?: string;            // 参数别名（单字符）
  description?: string;      // 参数描述
  type: 'string' | 'number' | 'boolean' | 'array'; // 参数类型
  defaultValue?: T;          // 默认值
  required?: boolean;        // 是否必需
  choices?: T[];             // 可选值列表
  validate?: (value: T) => boolean | string; // 自定义验证
}
```

### CLIContext 执行上下文

```typescript
interface CLIContext {
  logger: Logger;            // 日志器实例
  args: ParsedArguments;     // 解析后的参数
  rawArgs: string[];         // 原始参数数组
}
```

## Logger 日志工具

### 日志级别

- `logger.debug()` - 调试信息（仅在 --verbose 时显示）
- `logger.info()` - 一般信息
- `logger.success()` - 成功信息
- `logger.warn()` - 警告信息
- `logger.error()` - 错误信息

### 特殊输出

```typescript
logger.title('主标题');              // 显示标题
logger.divider();                    // 显示分隔线
logger.progress('进度信息');          // 显示进度（灰色缩进）
logger.stats('统计信息', {          // 显示统计表格
  '总数': 100,
  '成功': 95,
  '失败': 5
});
```

## 内置参数

所有 CLI 应用自动支持以下参数：

- `--help, -h` - 显示帮助信息
- `--version, -v` - 显示版本信息
- `--verbose` - 显示详细日志（包含调试信息和时间戳）

## 参数解析示例

### 字符串参数

```bash
my-tool --input file.txt
my-tool --input=file.txt
my-tool -i file.txt
```

### 数字参数

```bash
my-tool --timeout 300
my-tool --timeout=300
```

### 布尔参数

```bash
my-tool --force
my-tool --force=true
my-tool --force=false
```

### 数组参数

```bash
my-tool --files file1.txt,file2.txt,file3.txt
```

### 枚举验证

```typescript
{
  name: 'platform',
  type: 'string',
  choices: ['surge', 'clash', 'loon'],
  defaultValue: 'surge'
}
```

## 错误处理

框架自动处理以下错误：

1. **参数解析错误** - 自动显示错误信息和帮助
2. **未捕获异常** - 全局错误处理器捕获
3. **Promise 拒绝** - 全局错误处理器捕获
4. **执行错误** - 统一错误日志和退出码

## 退出码约定

- `0` - 成功
- `1` - 失败

在 `execute` 方法中，可以使用辅助方法：

```typescript
return this.success('操作成功');  // 返回 0
return this.failure('操作失败');  // 返回 1
```

## 完整示例

参考以下重构示例：

- [`merge-modules-refactored.ts`](../../merge-modules-refactored.ts) - 函数式用法
- [`convert-plugins-refactored.ts`](../../convert-plugins-refactored.ts) - 类继承用法

## 迁移指南

### 从旧 CLI 迁移

**旧代码：**
```typescript
async function main() {
  console.log(picocolors.cyan('🚀 开始处理...'));

  try {
    // 处理逻辑
    console.log(picocolors.green('✅ 处理完成!'));
  } catch (error) {
    console.error(picocolors.red('❌ Fatal error:'), error);
    process.exit(1);
  }
}

process.on('unhandledRejection', (error) => {
  console.error(picocolors.red('❌ Unhandled error:'), error);
  process.exit(1);
});

main().catch(error => {
  console.error(picocolors.red('❌ Fatal error:'), error);
  process.exit(1);
});
```

**新代码：**
```typescript
import { createCLI, registerGlobalErrorHandlers } from './utils/cli';

registerGlobalErrorHandlers();

const cli = createCLI(
  {
    name: 'my-tool',
    description: '我的工具',
    version: '1.0.0'
  },
  async ({ logger }) => {
    logger.info('开始处理...');

    // 处理逻辑

    return logger.success('处理完成！') ? 0 : 1;
  }
);

cli.run();
```

## 最佳实践

1. ✅ 始终调用 `registerGlobalErrorHandlers()`
2. ✅ 使用日志器而非 `console.log`
3. ✅ 利用参数验证功能（required, choices, validate）
4. ✅ 在 `execute` 方法中返回明确的退出码
5. ✅ 提供清晰的使用示例（覆盖 `getExamples` 方法）
6. ✅ 使用 `this.success()` 和 `this.failure()` 辅助方法

## 性能优势

使用统一 CLI 框架后：

- ❌ 减少约 **50-80 行** 重复的样板代码
- ✅ 统一错误处理逻辑
- ✅ 标准化日志输出格式
- ✅ 自动参数验证和帮助生成
- ✅ 更好的可维护性和可测试性
