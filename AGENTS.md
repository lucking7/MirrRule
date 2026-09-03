# AGENTS.md

本文件是给 AI coding agents / 自动化维护者使用的项目指南。请在修改本仓库前完整阅读，并优先遵循本文件与现有代码风格。

## 1. 项目概览

MirrRule 是一个 **Node.js + TypeScript 的网络代理规则聚合、转换与分发仓库**。

它从多个上游规则源、GitHub Release、插件列表和模块源下载内容，经过清洗、去重、排序、格式转换与平台适配后，生成可供以下客户端使用的规则文件：

- Surge：`public/List/*.list`
- Clash classical ruleset：`public/Clash/*.txt`
- Loon：`public/Loon/*.list`
- sing-box rule-set：`public/sing-box/*.json`
- Surge modules / plugins / mirrors：`public/Mirror/**`

公开服务基础地址见 `README.md`：`https://nrrule.pages.dev`。

> 注意：`public/`、`.cache/`、`.BUILD_FINISHED` 等为生成物或缓存，不应手动维护。

## 2. 运行环境与依赖管理

- Node.js：`26.x`
  - 证据：`.node-version`、`package.json#engines.node`
- pnpm：`10.x`
  - 证据：`package.json#packageManager`、`package.json#engines.pnpm`
- 包类型：CommonJS
  - 证据：`package.json` 中 `"type": "commonjs"`
- TypeScript 通过 `@swc-node/register` 运行 `.ts` 脚本，不产出 JS 编译文件。

安装依赖：

```bash
pnpm install
```

CI 中通常使用：

```bash
pnpm install --frozen-lockfile
```

## 3. 常用命令

所有命令均在仓库根目录执行。

### 质量检查

```bash
pnpm run lint
pnpm run lint:fix
pnpm run typecheck
pnpm run validate
pnpm test
```

说明：

- `pnpm run validate` = `pnpm run lint && pnpm run typecheck`
- `pnpm test` 使用 Node 内置 test runner，并通过 SWC 注册器运行 `Build/__tests__/*.test.ts`
- `pnpm run format` / `pnpm run format:check` 使用 `prettier`（已在 `devDependencies` 中显式声明）。

### 构建与生成

```bash
pnpm run build
pnpm run build-web
pnpm run download-geoip
pnpm run sync-mirrors
pnpm run convert-plugins
pnpm run merge-modules
pnpm run workflow:modules
```

脚本含义：

- `build`：执行主构建入口 `Build/index.ts`，包括 GEOIP 下载、规则处理、网页索引生成。
- `build-web`：只重新生成 `public/index.html`、`_headers`、`404.html` 等公开目录辅助文件。
- `sync-mirrors`：同步 iRingo、DualSubs、BiliUniverse 等上游模块镜像。
- `convert-plugins`：从 Script-Hub/插件列表下载并转换插件。
- `merge-modules`：执行 Surge module 合并流程。
- `workflow:modules`：先转换插件，再合并模块。

也可只同步指定镜像组：

```bash
pnpm run mirror:iringo
pnpm run mirror:dualsubs
pnpm run mirror:biliuniverse
```

## 4. 重要目录与文件

```text
Build/
  index.ts                         主构建入口
  build-public.ts                  生成 public 文件索引与部署辅助文件
  download-geoip.ts                GEOIP 数据下载
  sync-mirrors.ts                  镜像同步 CLI
  convert-plugins.ts               插件转换 CLI
  merge-modules.ts                 模块合并 CLI
  validate-domain-alive.ts         上游域名可用性检查
  __tests__/                       Node test 测试
  constants/                       路径、描述、UA、数据源常量
  core/output/writing-strategy/    各平台输出策略
  integration/mirror-sync/         GitHub Release/镜像同步实现
  integration/plugin-converter/    插件下载、转换、镜像实现
  lib/                             规则处理、输出、解析、模块合并等核心逻辑
  lib/public-index-model.ts        public 索引的规则实体、客户端元数据与可见文件语义
  trace/                           构建追踪与耗时输出
  utils/                           网络、域名、数据结构、校验工具

.github/workflows/
  main.yml                         构建、测试、同步、部署主 workflow
  check-source-domain.yml          手动检查上游域名可用性
  dependabot-auto-merge.yml        Dependabot 自动合并相关 workflow

README.md                          用户向说明与订阅示例
PRODUCT.md                         NRRule 索引页产品事实（Impeccable，2026-07 起）
DESIGN.md                          索引页设计系统规则（Impeccable，2026-07 起）
package.json                       脚本、依赖、运行时约束
pnpm-lock.yaml                     pnpm 锁文件
tsconfig.json                      TypeScript 配置
eslint.config.js                   ESLint 配置
```

## 5. 核心构建流程

主入口：`Build/index.ts`

构建大致流程：

1. 删除旧的 `.BUILD_FINISHED` 标记。
2. 执行 `downloadGEOIP` 下载 GEOIP/GeoSite 等数据。
3. 创建 `RuleSourceProcessor`，读取 `ruleGroups` 与 `specialRules`。
4. 逐个下载上游规则源。
5. 通过 `EnhancedFileOutput` 清洗、转换、去重、排序、分类规则。
6. 按目标平台创建输出策略并写入 `public/List`、`public/Clash`、`public/Loon`、`public/sing-box`。
7. 执行 `buildPublic` 生成 `index.html`、`_headers`、`404.html`、`README.md` 等 public 辅助文件。
8. 如果全部成功，写入 `.BUILD_FINISHED`；否则设置非 0 退出码。

关键文件：

- `Build/index.ts`
- `Build/lib/rule-sources.ts`
- `Build/lib/rule-source-processor.ts`
- `Build/lib/enhanced-file-output.ts`
- `Build/lib/platform-config.ts`
- `Build/core/output/writing-strategy/*.ts`
- `Build/build-public.ts`

## 6. 规则源配置方式

规则源集中定义在 `Build/lib/rule-sources.ts`：

- `ruleGroups`：普通规则组，每组包含多个文件源。
- `specialRules`：把多个源合并为一个目标规则文件。
- 两类配置共享 `RuleProcessingOptions`，并通过同一 ruleset publication 路径输出。
- `DEFAULT_FILE_CONFIG`：默认处理选项。
- `applyDefaultConfig`：合并默认配置与单个源配置。

常见配置字段见 `Build/lib/rule-source-types.ts`：

- `path`：逻辑目标路径，最终通常取 basename 生成各平台文件名。
- `url` / `fallbackUrls`：主下载地址与备用地址。
- `targets`：目标平台，当前有效平台见 `Build/lib/platform-config.ts`：`surge`、`clash`、`singbox`、`loon`。
- `defaultPolicy`：默认策略；设为 `null` 时会清理规则中的策略字段，输出纯规则格式。
- `dedup`：是否去重，默认 `true`。
- `sort`：是否排序，默认 `true`。
- `keepComments`：是否保留行首注释，默认 `false`。
- `keepInlineComments`：是否保留行内注释，默认 `false`。
- `keepEmptyLines`：是否保留空行，默认 `false`。
- `formatConversion`：是否启用格式转换，默认 `true`。
- `applyNoResolve`：是否为 IP 类规则添加 `no-resolve`。
- `validate`：是否启用规则合法性校验，默认 `false`。
- `deleteSourceFiles`：处理后删除中间源文件。

规则源配置不支持自定义 `header`；模块合并流程中的同名字段是独立配置，仍然有效。

添加新规则源时，优先在现有同类 `RuleGroup` 中追加 `applyDefaultConfig({ ... })`，并明确是否需要多平台输出。

## 7. 多平台输出约定

平台配置位于 `Build/lib/platform-config.ts`。

默认输出目录：

```text
surge   -> public/List
clash   -> public/Clash
singbox -> public/sing-box
loon    -> public/Loon
```

对应策略类：

- `Build/core/output/writing-strategy/surge.ts`
- `Build/core/output/writing-strategy/clash.ts`
- `Build/core/output/writing-strategy/singbox.ts`
- `Build/core/output/writing-strategy/loon.ts`

注意事项：

- `normalizeTargets` 在配置缺省或为空时默认回退到 `surge`；显式配置包含未知平台时会报错并终止处理。
- `RuleGroup.targets` / `SpecialRuleConfig.targets` 仅接受上述四个平台；`surfboard` 不受支持。
- Surge 与 Loon 支持策略字段的语义更强；Clash 与 sing-box 主要输出纯规则结构。

## 8. 规则清洗与转换约定

核心类：`Build/lib/enhanced-file-output.ts`

处理逻辑包括：

- 空行、注释、行内注释处理。
- 通过 `smartConvertRule` 将常见简写转换为标准规则，例如：
  - `.example.com` -> `DOMAIN-SUFFIX,example.com`
  - `example.com` -> `DOMAIN,example.com`
  - `+.amazon` -> `DOMAIN-SUFFIX,amazon`
  - `full:example.com` -> `DOMAIN,example.com`
  - `domain:example.com` -> `DOMAIN-SUFFIX,example.com`
  - `keyword:amazon` -> `DOMAIN-KEYWORD,amazon`
- 可选规则校验：`RuleLineUtils.isValidRule`。
- 可选 `no-resolve` 添加。
- 当 `defaultPolicy === null` 时通过 `cleanPolicy` 移除策略字段。
- 将规则分发到 domain trie、wildcard trie、CIDR set、ASN set、process/user-agent/url-regex/other 等结构。

测试中已覆盖复合规则、MetaCubeX geosite 语法等场景，见 `Build/__tests__/reliability.test.ts`。

修改转换逻辑时必须补充或更新测试，并运行：

```bash
pnpm test
pnpm run typecheck
```

## 9. 镜像、插件与模块流程

### 镜像同步

相关文件：

- `Build/sync-mirrors.ts`
- `Build/integration/mirror-sync/mirror-config.ts`
- `Build/integration/mirror-sync/sync-engine.ts`
- `Build/integration/mirror-sync/github-api.ts`

当前镜像组包括：

- iRingo / NSRingo 系列
- DualSubs
- BiliUniverse
- fmz200（split 目录由专用脚本处理）

Mirror sync 只处理有生产配置的 release adapter，使用 `Build/lib/atomic-file.ts` 完成原子替换并保留 last-known-good。`NSRingo/Siri` 仅同步当前 release 中的 `iRingo.Siri`、`iRingo.Search` 与 `iRingo.Spotlight` 资产，不读取 `dev/debug` 文件。新增 adapter 前必须先有真实生产 source。

iRingo `.sgmodule` 有后处理逻辑，会替换 `#!arguments=` 中的 `Proxy` 参数为 `🇺🇸`。

### 插件转换

相关文件：

- `Build/convert-plugins.ts`
- `Build/integration/plugin-converter/plugin-list.ts`
- `Build/integration/plugin-converter/*`

插件列表默认从 `https://hub.kelee.one/list.json` 获取，可通过环境变量覆盖：

- `PLUGIN_LIST_URL`：逗号分隔的插件列表 URL。
- `PLUGIN_LIST_FORCE_PROXY`：默认视为启用代理候选；设为 `false` 可关闭强制代理候选。

CI 中会启动固定 digest 的 `xream/script-hub` image 用于插件转换。

转换结果在依赖脚本具有镜像或缓存 URL 后才原子发布；插件缓存文件名包含 canonical source URL 的摘要，不能改回仅按插件名称缓存。

### 模块合并

相关文件：

- `Build/merge-modules.ts`
- `Build/lib/module-merger/**`

CLI 参数：

```bash
pnpm run node ./Build/merge-modules.ts --dry-run
pnpm run node ./Build/merge-modules.ts --config <path>
pnpm run node ./Build/merge-modules.ts --only a,b
pnpm run node ./Build/merge-modules.ts --enable a,b
pnpm run node ./Build/merge-modules.ts --disable a,b
```

默认配置路径在 `Build/merge-modules.ts` 中为 `Build/lib/module-merger/configs/pro-merge-config.yaml`。修改该区域前请确认配置文件是否存在且被纳入仓库。

## 10. GitHub Actions / CI 行为

主 workflow：`.github/workflows/main.yml`

触发方式：

- push 到 `main` / `master`：完整流程并部署。
- pull_request：执行构建，不部署。
- schedule：按不同 cron 执行快速更新、完整构建、镜像同步、插件转换等。
- workflow_dispatch：可选择任务 `all`、`build`、`convert-plugins`、`merge-modules`、`mirror-sync`、`deploy`。

主构建 job 会：

1. checkout
2. setup pnpm / Node
3. 恢复 `.cache`
4. `pnpm install --frozen-lockfile`
5. `pnpm run validate`
6. `pnpm test`
7. 按条件执行镜像同步、mock/module 下载、fmz200 split 下载、插件转换、模块合并、规则构建
8. 保存缓存与部署产物

手动域名检查 workflow：`.github/workflows/check-source-domain.yml`

```bash
pnpm run node Build/validate-domain-alive.ts
```

可使用：

```bash
DEBUG=domain-alive:dead-domain pnpm run node Build/validate-domain-alive.ts
```

## 11. 代码风格与约定

### TypeScript / Node 风格

- 代码运行在 CommonJS 项目中，但大量源码使用 TypeScript `import` 语法，并由 SWC 注册器执行。
- `tsconfig.json` 使用：
  - `strict: true`
  - `strictNullChecks: true`
  - `module: node16`
  - `moduleResolution: node16`
  - `allowImportingTsExtensions: true`
  - `allowJs: true`
  - `noEmit: true`
- 部分运行时 `require('./file.ts')` 是有意为之，用于懒加载或兼容 SWC/CommonJS；不要无理由改写为静态 import。
- Node 内置模块通常使用 `node:` 前缀，例如 `node:path`、`node:fs`、`node:process`。
- 保持现有分号、单引号、尾逗号等风格，最终以 `pnpm run lint` 为准。

### ESLint

配置文件：`eslint.config.js`

- 使用 `eslint-config-sukka` / `@eslint-sukka/node`。
- `Build/**` 允许 CLI 脚本使用 `console`。
- 忽略：`**/*.conf`、`**/*.txt`、`other-repo-mirrors/**`。

### 测试风格

测试位于 `Build/__tests__/*.test.ts`。

- 使用 Node 内置 `node:test`。
- 使用 `node:assert/strict`。
- 在 CommonJS/SWC 兼容场景中，测试里可使用 `require()` 加载目标模块。

## 12. Agent 修改守则

1. **先检查工作区状态**

   ```bash
   git status --short
   ```

   当前仓库可能存在用户未提交改动。不要覆盖与当前任务无关的改动。

2. **不要手改生成物**

   不要直接编辑：

   - `public/**`
   - `.cache/**`
   - `.BUILD_FINISHED`
   - `node_modules/**`
   - 临时日志与测试输出

   如需改变产物，请修改 `Build/**` 源逻辑后运行对应脚本生成。

3. **不要随意改锁文件或依赖**

   除非任务明确要求依赖升级/新增，否则不要修改：

   - `package.json`
   - `pnpm-lock.yaml`

4. **新增规则源优先改配置，不要复制处理逻辑**

   新增上游规则通常只需修改 `Build/lib/rule-sources.ts`。只有当现有 `FileConfig` / `SpecialRuleConfig` 能力不足时，才扩展类型和处理逻辑。

5. **修改平台输出必须同时考虑四个平台**

   涉及规则格式、策略字段、文件扩展名、JSON 结构时，应检查：

   - Surge
   - Clash
   - Loon
   - sing-box

6. **网络相关代码要保留重试、缓存、fallback 思路**

   网络工具集中在 `Build/utils/network/**`。不要绕过现有 `fetch-retry`、`fetch-assets`、HTTP cache、proxy candidate 等机制，除非有明确原因。

7. **构建脚本失败要显式暴露错误**

   主构建依赖 `.BUILD_FINISHED` 判断成功。不要吞掉会影响产物正确性的错误。

8. **为行为变化补测试**

   规则转换、校验、GitHub API 错误映射、入口路径可靠性等都应补充 `Build/__tests__/*.test.ts`。

9. **尊重 AGPL-3.0 许可证**

   `README.md` 指向 `LICENSE`，许可证为 GNU Affero General Public License v3.0。复制或引入代码时必须兼容。

## 13. 建议验证矩阵

根据改动范围选择最小但充分的验证：

### 只改文档

```bash
pnpm run typecheck
```

如仅改 Markdown 且无代码变更，可说明未运行代码验证。

### 改 TypeScript 逻辑

```bash
pnpm run lint
pnpm run typecheck
pnpm test
```

### 改规则源或构建流程

```bash
pnpm run validate
pnpm test
pnpm run build
```

注意：`pnpm run build` 会访问大量外部网络并写入 `public/`、`.cache/`、`.BUILD_FINISHED`，本地执行前确认是否可接受。

### 改镜像/插件/模块逻辑

```bash
pnpm run validate
pnpm test
pnpm run sync-mirrors
pnpm run convert-plugins
pnpm run merge-modules -- --dry-run
```

注意：这些命令依赖外部网络、GitHub API、Script-Hub 或本地/CI 服务环境。

## 14. 环境变量与部署注意事项

常见环境变量：

- `PUBLIC_DIR`：覆盖公开产物目录，默认是仓库根目录下 `public`。
- `GITHUB_TOKEN`：镜像同步访问 GitHub API 时在 CI 中提供。
- `CI=true`：CI 环境标记，workflow 中多处设置。
- `DEBUG=domain-alive:dead-domain`：域名可用性检查调试输出。
- `PLUGIN_LIST_URL`：覆盖插件列表 URL，支持逗号分隔多个源。
- `PLUGIN_LIST_FORCE_PROXY=false`：关闭插件列表强制代理候选。

部署主要由 GitHub Actions 负责。`package.json` 中 `deploy` 脚本只执行构建并输出提示：

```bash
pnpm run deploy
```

实际 Pages / 产物仓库发布逻辑请以 `.github/workflows/main.yml` 为准。

## 15. 快速定位表

| 任务 | 优先查看 |
|---|---|
| 新增/调整规则源 | `Build/lib/rule-sources.ts`, `Build/lib/rule-source-types.ts` |
| 修改规则转换/清洗 | `Build/lib/enhanced-file-output.ts`, `Build/lib/misc.ts`, `Build/utils/validation/validators.ts` |
| 修改平台输出格式 | `Build/lib/platform-config.ts`, `Build/core/output/writing-strategy/*.ts` |
| 修改构建主流程 | `Build/index.ts`, `Build/build-public.ts` |
| 修改 public 索引排序 | `Build/lib/public-index-sort.ts`, `Build/build-public.ts` |
| 修改网络下载/重试 | `Build/utils/network/*.ts` |
| 修改镜像同步 | `Build/sync-mirrors.ts`, `Build/integration/mirror-sync/**` |
| 修改插件转换 | `Build/convert-plugins.ts`, `Build/integration/plugin-converter/**` |
| 修改模块合并 | `Build/merge-modules.ts`, `Build/lib/module-merger/**` |
| 修改 CI | `.github/workflows/main.yml`, `.github/workflows/check-source-domain.yml` |
| 修改测试 | `Build/__tests__/*.test.ts` |

## 16. 已知注意点

- 本文件已被 Git 正常跟踪；修改后请与相关代码变更一并提交。
- 本仓库构建高度依赖外部网络，上游不可用可能导致 `pnpm run build` 失败。
- `public/` 是构建产物目录，不在源码中长期维护。
- 部分源码注释为中文，新增说明可继续使用中文；公开用户文档可视上下文使用英文或中英混排。
