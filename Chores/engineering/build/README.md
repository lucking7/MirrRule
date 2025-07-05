# Build 工具集

本目录包含了用于处理和优化规则文件的各种工具和模块。

## 目录结构

```
build/
├── constants/          # 常量定义
│   ├── dir.ts         # 目录路径常量
│   ├── priority.ts    # 优先级配置
│   └── loose-tldts-opt.ts # TLD 解析选项
├── lib/               # 核心库模块
│   ├── parse-filter/  # 解析器模块
│   │   ├── filters.ts     # AdGuard 过滤规则解析
│   │   ├── hosts.ts       # Hosts 文件解析
│   │   └── domainlists.ts # 域名列表解析
│   ├── rules/         # 规则处理
│   │   └── base.ts    # FileOutput 基类
│   ├── build-common.ts    # 通用构建功能
│   ├── cidr-optimizer.ts  # CIDR IP段优化
│   ├── keyword-filter.ts  # 关键词过滤器
│   ├── process-line.ts    # 行处理器
│   ├── trie.ts           # Trie树实现
│   └── utils.ts          # 通用工具函数
├── validate/          # 验证规则相关脚本
│   ├── clean-dead-domains.ts       # 清理失效域名
│   ├── validate-domains.ts         # 域名验证
│   ├── validate-global-tld.ts      # 验证全球TLD
│   ├── validate-hash-collision.ts  # 哈希冲突检测
│   ├── validate-illegal-tld.ts     # 非法TLD检测
│   ├── validate-ip-rules.ts        # IP规则验证
│   ├── validate-rule-statistics.ts # 规则统计分析
│   ├── validate-rule-syntax.ts     # 语法验证
│   └── validate-rules.ts           # 规则验证
├── types/            # TypeScript 类型定义
│   ├── dns2.d.ts
│   └── whoiser.d.ts
├── trace/            # 追踪相关功能
│   └── index.ts      # 追踪入口
├── lib/
│   └── rule-optimizer.ts    # 规则优化模块
├── scripts/
│   └── build-web-page.ts    # 前端页面构建脚本
├── tools/
│   └── dedupe-src.ts        # 域名去重工具

```

## 核心模块说明

### 1. Trie 树模块 (`lib/trie.ts`)

- 实现域名的 Trie 树结构
- 自动合并子域名
- 支持白名单功能

### 2. CIDR 优化器 (`lib/cidr-optimizer.ts`)

- 自动合并相邻的 IP 段
- 分离处理 IPv4 和 IPv6
- 支持 CIDR 排除操作

### 3. FileOutput 基类 (`lib/rules/base.ts`)

提供自动化的规则处理功能：

- Trie 树优化域名
- CIDR 合并 IP 段
- 关键词过滤
- 自动去重和排序

### 4. 解析器模块 (`lib/parse-filter/`)

- **filters.ts**: 解析 AdGuard/uBlock Origin 格式
- **hosts.ts**: 解析 hosts 文件格式
- **domainlists.ts**: 处理纯域名列表

### 5. 构建通用模块 (`lib/build-common.ts`)

- 自动扫描源文件
- 批量处理
- 元数据提取
- 进度报告

### 6. 验证模块 (`validate/`)

所有规则验证相关的脚本都在这个目录中：

- 域名活性检测
- TLD 合法性验证
- 语法检查
- 哈希冲突检测
- IP 规则验证

## 使用方法

### 使用独立工具

```bash
# 域名去重
tsx tools/dedupe-src.ts input.txt output.txt --no-merge-subdomains

# 优化规则文件
tsx lib/rule-optimizer.ts

# 验证规则语法
tsx validate/validate-rule-syntax.ts

# 生成规则统计
tsx validate/validate-rule-statistics.ts
```

### 在代码中使用

```typescript
import { HostnameTrie } from './lib/trie.js';
import { optimizeCidrList } from './lib/cidr-optimizer.js';
import { FileOutput } from './lib/rules/base.js';

// 使用示例见 examples/use-modules.ts
```

## 集成到 GitHub Actions

这些工具已集成到 GitHub Actions 工作流中：

### `.github/workflows/main.yml`

- 规则优化：`tsx lib/rule-optimizer.ts`
- 语法验证：`tsx validate/validate-rule-syntax.ts`
- TLD 验证：`tsx validate/validate-illegal-tld.ts`
- 哈希冲突：`tsx validate/validate-hash-collision.ts`
- 规则统计：`tsx validate/validate-rule-statistics.ts`

### `.github/workflows/check-domain.yml`

- 域名活性检测：`tsx validate/clean-dead-domains.ts`
