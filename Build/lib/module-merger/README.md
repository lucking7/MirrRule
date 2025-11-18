# Module Merger - 模块合并工具

## 概述

模块合并工具用于将多个 `.sgmodule` 文件合并为一个统一的 All-in-One 模块，支持本地文件和远程 URL。

## 功能特性

✅ **已实现功能：**

- 合并多个 `.sgmodule` 文件
- 支持 6 种 Section 类型（Rule、URL Rewrite、Map Local、Script、MITM、General）
- 自动去重 MITM hostnames
- 移除注释（支持 `#`、`!`、`//`、`;` 四种格式）
- 清理策略组（支持 REJECT、REJECT-DROP、REJECT-TINYGIF、REJECT-NO-DROP、DIRECT）
- 添加模块来源分隔符
- 本地和远程文件混合加载
- 模板化输出
- 统计信息输出

## 使用方法

### 1. 基本用法

```bash
# 使用默认配置（pro-merge-config.yaml）
npm run node ./Build/merge-modules.ts

# 使用自定义配置
npm run node ./Build/merge-modules.ts -- --config ./Build/lib/module-merger/configs/custom-config.yaml

# 干运行模式（不实际执行）
npm run node ./Build/merge-modules.ts -- --dry-run

# 详细输出
npm run node ./Build/merge-modules.ts -- --verbose
```

### 2. 配置文件

配置文件使用 YAML 格式，包含以下部分：

```yaml
# 基本信息
name: 'All-in-One Pro Ad Blocker'
version: '2.x'
description: 'Professional Ad-free Experience'
category: '🚫 AD Block Pro'
author: '@hututu0 & Community'

# 模块列表
modules:
  - url: 'https://example.com/module.sgmodule'
    header: 'Module Name'
  - url: 'file://local/path/module.sgmodule'
    header: 'Local Module'

# 输出配置
output:
  sgmodule: 'public/Modules/All-in-One-Pro.sgmodule'
  rulelist: 'public/Modules/Rules/reject-pro.list'
  template: 'Build/lib/module-merger/templates/all-in-one.template'

# 合并选项
options:
  deduplicateHostnames: true # 去重 MITM hostnames
  stripComments: true # 移除注释
  addDividers: true # 添加分隔符
  dividerLength: 30 # 分隔符长度
```

### 3. 可用配置文件

- **pro-merge-config.yaml**: 默认配置，使用本地 Mirror sgmodule（专业版模块集合）

## 最近改进

### 2024-11-09 更新

参考 Mirrored 项目的实现，进行了以下改进：

1. **创建 pro-merge-config.yaml**

   - 支持 49 个远程模块的合并
   - 使用 nrrule.pages.dev 作为模块源

2. **改进策略清理**

   - 添加 `cleanPolicyFast()` 函数
   - 使用正则表达式快速清理策略组
   - 支持 REJECT-DROP、REJECT-TINYGIF、REJECT-NO-DROP 等变体
   - 正则表达式：`/(?:,\s*|-\s*)(REJECT(?:-(?:DROP|TINYGIF|NO-DROP))?|DIRECT)\b/gi`

3. **改进注释处理**
   - 优化 section-parser.ts 的注释过滤逻辑
   - 更清晰的代码结构和注释

## 输出文件

合并完成后会生成两个文件：

1. **All-in-One-Pro.sgmodule** (127KB)

   - 位置: `public/Modules/All-in-One-Pro.sgmodule`
   - 包含所有 Section 的合并内容
   - 带有元数据和分隔符
   - MITM hostnames 已去重（288 个）

2. **reject-pro.list** (15KB)
   - 位置: `public/Modules/Rules/reject-pro.list`
   - 仅包含 Rule Section 的内容（455 行）
   - 用于 Surge 的 RULE-SET 引用

## 统计信息

最近一次合并（2024-11-09）：

```
✓ Merge completed
  - Modules processed: 49
  - Sections extracted: 113
  - Hostnames deduplicated: 288
  - Duration: 2.98s
```

## 技术栈

- **语言**: TypeScript
- **运行时**: Node.js
- **依赖库**:
  - `yaml` - YAML 解析
  - `undici` - HTTP 请求
  - `picocolors` - 终端颜色输出
  - `node:fs/promises` - 异步文件操作

## 架构设计

```
module-merger/
├── index.ts              # 主入口，orchestrates 整个流程
├── merger.ts             # 核心合并引擎
├── section-parser.ts     # Section 解析器
├── template-engine.ts    # 模板渲染引擎
├── types.ts              # TypeScript 类型定义
├── configs/
│   ├── merge-config.yaml      # 默认配置
│   └── pro-merge-config.yaml  # 专业版配置
└── templates/
    └── all-in-one.template    # 输出模板
```

## 工作流程

1. **加载配置** - 读取 YAML 配置文件
2. **下载模块** - 支持本地文件和远程 URL
3. **解析 Section** - 提取各个 Section 类型
4. **合并 Section** - 去重、清理、添加分隔符
5. **渲染模板** - 填充元数据和内容
6. **输出文件** - 生成 .sgmodule 和 .list 文件

## 故障排除

### 问题：模块下载失败

**解决方案**：

- 检查网络连接
- 验证 URL 是否正确
- 单个模块失败不会中断整个流程

### 问题：输出目录不存在

**解决方案**：

```bash
mkdir -p public/Modules
```

### 问题：依赖未安装

**解决方案**：

```bash
npm install
```

## 参考项目

- **Mirrored**: https://github.com/bunizao/Mirrored
  - Python 实现的模块合并工具
  - 提供了策略清理的正则表达式参考

## 许可证

MIT License
