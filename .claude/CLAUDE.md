# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个高质量、自动化维护的**网络代理规则集生成系统**,支持多种客户端平台:

- **Surge** (macOS/iOS/tvOS) - 原生格式
- **Clash Meta** (mihomo) - YAML 格式
- **sing-box** - 二进制 JSON 格式
- **Loon** - 兼容格式
- **Surfboard** (Android) - 基于 Surge 格式

主要功能包括广告拦截、隐私保护、流媒体分流、地理位置路由等。

## 技术栈

- **运行环境**: Node.js (CommonJS 模块系统)
- **包管理器**: pnpm 10.15.0 (必须使用,已在 package.json 中锁定)
- **编译器**: @swc-node/register (高性能 TypeScript 编译)
- **数据库**: better-sqlite3 (用于 HTTP 缓存和规则存储)
- **类型检查**: TypeScript 5.9+ (严格模式)

## 常用命令

### 构建和部署

```bash
# 完整构建(规则集 + 前端网页)
pnpm build

# 仅构建前端网页
pnpm build-web

# 部署准备
pnpm deploy
```

### 开发工具

```bash
# 代码检查(lint + typecheck) - 提交前必须运行
pnpm validate

# 修复代码风格问题
pnpm lint:fix

# 类型检查
pnpm typecheck

# 格式化代码
pnpm format
```

### 辅助工具

```bash
# 下载 GeoIP 数据库
pnpm download-geoip

# 下载 fmz200 分流模块
pnpm download-fmz200-split

# 同步镜像(iRingo/DualSubs/BiliUniverse)
pnpm sync-mirrors

# 转换插件(需要 Script-Hub 服务)
pnpm convert-plugins

# 合并模块
pnpm merge-modules
```

### Script-Hub 服务管理

```bash
# 启动服务(用于插件转换)
pnpm script-hub:start

# 停止服务
pnpm script-hub:stop

# 查看状态
pnpm script-hub:status

# 移除服务
pnpm script-hub:remove
```

## 项目架构

### 核心构建流程

主入口: `Build/index.ts`

构建系统采用统一的规则处理管道:

1. **下载 GeoIP 数据** (`Build/download-geoip.ts`)

   - 下载 MaxMind GeoLite2 Country MMDB 文件
   - 用于地理位置规则生成

2. **规则源处理系统** (`Build/lib/rule-source-processor.ts`)

   - **RuleSourceProcessor**: 统一处理所有规则源
   - 支持多源合并、去重、排序、格式转换
   - 跨平台输出策略(Surge/Clash/sing-box 等)

3. **规则配置定义** (`Build/lib/rule-sources.ts`)

   - **ruleGroups**: 规则组配置(如 Streaming、Reject 等)
   - **specialRules**: 特殊规则配置(需要多源合并的规则)
   - 每个规则组包含:
     - `name`: 规则组名称
     - `description`: 描述
     - `targets`: 目标平台列表
     - `files`: 文件配置数组(路径、URL、处理选项)

4. **前端构建** (`Build/build-public.ts`)
   - 生成 `public/index.html` 展示页面
   - 列出所有可用的规则集文件

### 目录结构

```
Build/
├── index.ts              # 主入口
├── build-public.ts       # 前端网页构建
├── download-geoip.ts     # GeoIP 数据下载
├── sync-mirrors.ts       # 镜像同步
├── convert-plugins.ts    # 插件转换
├── merge-modules.ts      # 模块合并
├── constants/            # 常量定义
├── core/                 # 核心功能
│   ├── output/          # 输出格式处理
│   └── parsers/         # 规则解析器
├── lib/                  # 工具库
│   ├── rule-sources.ts           # 规则源配置
│   ├── rule-source-processor.ts  # 统一规则处理器
│   ├── rule-source-types.ts      # 类型定义
│   ├── platform-config.ts        # 平台配置
│   ├── enhanced-file-output.ts   # 增强文件输出
│   ├── module-merger/            # 模块合并工具
│   ├── parse-filter/             # 过滤规则解析
│   └── validators/               # 规则验证器
└── utils/                # 实用工具

public/                   # 构建输出目录
├── List/                # Surge 格式规则
├── Clash/               # Clash Meta 格式规则
├── sing-box/            # sing-box 格式规则
├── Loon/                # Loon 格式规则
├── Surfboard/           # Surfboard 格式规则
├── GeoIP/               # GeoIP 数据库
├── Modules/             # Surge 模块
│   ├── Converted/       # 从 Loon 插件转换的模块
│   └── Merged/          # 合并后的模块
├── Mirror/              # 镜像仓库
│   ├── iRingo/
│   ├── DualSubs/
│   └── BiliUniverse/
└── index.html           # 展示页面
```

### 规则处理管道

所有规则经过以下标准化处理:

1. **获取规则源**: 从 URL 或本地文件读取
2. **解析规则**: 使用对应平台的解析器
3. **规则处理**:
   - 去重 (dedup)
   - 排序 (sort)
   - 格式转换 (formatConversion)
   - 验证 (validate, 默认禁用以提升性能)
4. **多平台输出**:
   - Surge: `.conf` 格式
   - Clash: `.txt` YAML 格式
   - sing-box: `.json` 二进制格式
   - Loon: `.conf` 格式

### 核心概念

#### RuleGroup vs SpecialRule

- **RuleGroup**: 单一数据源的规则组

  - 示例: `List/netflix.list` 来自单一 URL
  - 直接转换为多平台格式

- **SpecialRule**: 需要合并多个数据源的规则
  - 示例: `reject` 规则合并 AdGuard、EasyList、Peter Lowe 等多个源
  - 先合并去重,再输出多平台格式

#### 平台配置 (platform-config.ts)

定义了每个平台的:

- 文件扩展名
- 格式转换器
- 输出目录

支持的目标平台:

- `surge`: Surge 原生格式
- `clash`: Clash Meta YAML 格式
- `singbox`: sing-box JSON 格式
- `loon`: Loon 格式
- `surfboard`: Surfboard 格式

## 缓存系统

项目使用 `.cache/` 目录存储:

- HTTP 请求缓存 (better-sqlite3)
- GeoIP MMDB 文件缓存
- 构建中间结果

**注意**: `.cache/` 目录在 CI/CD 中通过 GitHub Actions Cache 持久化。

## GitHub Actions 工作流

定时构建策略:

- **完整构建**: 每天 2 次 (05:00, 17:00 UTC) - 包含镜像同步、插件转换、模块合并
- **快速更新**: 每 4 小时 - 仅规则构建
- **镜像同步**: 每天 3 次 (06:00, 14:00, 22:00 UTC)
- **插件转换**: 每天 2 次 (07:30, 19:30 UTC)

构建产物部署到:

1. **Cloudflare Pages**: https://nrrule.pages.dev (主站)
2. **GitHub Repository**: lucking7/NRRule (分发仓库)

## 开发注意事项

### 添加新规则源

1. 在 `Build/lib/rule-sources.ts` 中添加配置:

   ```typescript
   // 规则组示例
   {
     name: 'NewService',
     description: 'Description',
     targets: ['surge', 'clash', 'singbox'],
     files: [
       applyDefaultConfig({
         path: 'List/newservice.list',
         url: 'https://example.com/rules.txt'
       })
     ]
   }

   // 或特殊规则(多源合并)
   {
     name: 'newrule',
     description: 'Multi-source rule',
     targets: ['surge', 'clash'],
     type: 'non_ip',
     sources: [
       { url: 'https://source1.com/rules.txt' },
       { url: 'https://source2.com/rules.txt' }
     ]
   }
   ```

2. 运行构建:

   ```bash
   pnpm build
   ```

3. 验证输出:
   - 检查 `public/List/newservice.list` (Surge)
   - 检查 `public/Clash/newservice.txt` (Clash)
   - 检查 `public/sing-box/newservice.json` (sing-box)

### 修改规则处理逻辑

核心处理器在 `Build/lib/rule-source-processor.ts`:

- `processRuleGroups()`: 处理规则组
- `processSpecialRules()`: 处理特殊规则(多源合并)

规则解析器在 `Build/core/parsers/`:

- 每个平台有独立的解析器
- 支持域名、IP、关键词等多种规则类型

### 性能优化建议

1. **并行处理**: 规则处理使用 `worktank` 库并行化
2. **缓存**: HTTP 请求使用 better-sqlite3 缓存,减少重复下载
3. **增量构建**: CI/CD 中通过 Git 差异实现智能增量部署
4. **验证**: 规则验证默认禁用 (validate: false),仅在必要时启用

### 代码规范

- 使用 ESLint (eslint-config-sukka) 检查代码
- 使用 TypeScript 严格模式
- 提交前必须通过 `pnpm validate`
- 遵循 Conventional Commits 规范

### 调试技巧

1. **查看构建日志**:

   ```bash
   pnpm build 2>&1 | tee build.log
   ```

2. **性能分析**:

   ```bash
   pnpm build-profile  # 使用 dexnode 进行性能分析
   ```

3. **规则验证**:
   ```bash
   pnpm validate:rules
   ```

## 依赖管理

- 使用 pnpm 管理依赖
- 关键依赖已在 package.json 中锁定构建依赖:
  - `@swc/core`
  - `better-sqlite3`
- 使用 `pnpm install --frozen-lockfile` 确保依赖版本一致性

## 外部服务依赖

### Script-Hub

用于插件格式转换,需要 Docker 容器运行:

```bash
docker run -d -p 9100:9100 -p 9101:9101 xream/script-hub:latest
```

在 CI/CD 中通过 GitHub Actions service container 自动启动。

## 许可协议

- 主要代码: AGPL-3.0
- `List/ip/china_ip.conf`: CC BY-SA 2.0
