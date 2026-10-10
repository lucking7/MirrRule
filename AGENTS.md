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
- 规则分版（追加输出，见第 7 节）：`public/<平台目录>/{domainset,non_ip,ip}/*`
- 机器可读报告：`public/Internal/*.json`（输出审计、来源 delta、发布清单、退休登记、覆盖审查）

公开服务基础地址见 `README.md`：`https://nrrule.pages.dev`。

> 注意：`public/`、`.cache/`、`.BUILD_FINISHED` 等为生成物或缓存，不应手动维护。

## 2. 运行环境与依赖管理

- Node.js：`26.x`
  - 证据：`.node-version`、`package.json#engines.node`
- pnpm：`10.x`
  - 证据：`package.json#packageManager`、`package.json#engines.pnpm`
- 包类型：CommonJS
  - 证据：`package.json` 中 `"type": "commonjs"`

`.ts` 脚本通过 `@swc-node/register` 运行，不产出 JS 编译文件。`typescript` 保留 TypeScript 6 的 JavaScript Compiler API，供 SWC 注册器和 ESLint typed rules 使用；`typescript-compiler` alias 安装 TypeScript 7 native compiler，负责 `pnpm run typecheck`。该脚本显式调用 alias 包中的 `bin/tsc`，避免两个包的同名 `.bin/tsc` 造成编译器选择歧义。

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
  audit-rule-coverage.ts           跨订阅覆盖审查 CLI（解析 RULE-SET／DOMAIN-SET 与分版引用）
  prepare-publication.ts           组装完整发布候选、核对保留目录与退休登记、生成 publication manifest
  verify-publication.ts            核对 NRRule commit 的 Cloudflare check、immutable URL 与正式域名内容
  __tests__/                       Node test 测试
  constants/                       路径、描述、UA、数据源常量
  core/output/writing-strategy/    各平台输出策略
  integration/mirror-sync/         GitHub Release/镜像同步实现
  integration/plugin-converter/    插件下载、转换、镜像实现
  lib/                             规则处理、输出、解析、模块合并等核心逻辑
  lib/rule-output-variants.ts      分版（domainset/non_ip/ip）分类、路径与格式契约
  lib/output-audit.ts              各 ruleset×分版×平台的实际输出审计、来源快照与 delta
  lib/publication-manifest.ts      发布清单（路径、字节数、SHA256、generated/preserved 来源）
  lib/publication-receipt.ts       GitHub Deployments 验收 receipt 的读写与基线选择
  lib/publication-check.ts         Cloudflare Pages check 身份与 immutable URL 解析
  lib/publication-github.ts        发布流程使用的最小 GitHub REST 客户端
  lib/publication-stage.ts         staging tree 组装、保留目录、baseline drift 判断
  lib/publication-outputs.ts       必需报告与输出审计的 bytes/sha256 核对
  lib/publication-verify.ts        两个 origin 的内容与 404 验收、退出码
  lib/publication-baseline.ts      已验收基线 tree 的核验
  lib/publication-bootstrap.ts     legacy inventory 生成与核验
  lib/publication-{git,http,cli}.ts NRRule push、HTTP 探测、CLI 公共函数
  lib/artifact-lifecycle.ts        deprecated/retired 订阅登记及清理
  lib/rule-coverage-audit.ts       跨订阅域名覆盖计算
  assets/ruleset-index.css         原生目录索引的参考站样式
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
6. 按目标平台创建输出策略，写入 flat 合并版 `public/List`、`public/Clash`、`public/Loon`、`public/sing-box`，并在同一次 canonical 处理结果上分类写入 `<平台目录>/{domainset,non_ip,ip}/` 分版（不重新下载）。
7. 生成 `Internal/rule-output-audit.json`（每个 ruleset×分版×平台的格式、路径、状态、有效条数、字节数、SHA256）、`Internal/source-snapshots/<sourceId>.json.gz` 与 `Internal/source-delta.json`（相对 `PUBLICATION_BASELINE_DIR` 中已验收 tree 的来源条件增删，并记录基线 receiptId；无基线为 baseline-unavailable，版本或处理选项变化为 not-comparable，基线中有、本次不再构建的规则集为 removed）。
8. 执行跨订阅覆盖审查，写入 `Internal/rule-coverage.json`；缺失示例订阅时该步骤失败。
9. 执行 `buildPublic` 生成 `index.html`、`_headers`、`404.html`、`README.md` 等 public 辅助文件，并按退休登记清除 retired 文件。
10. 如果全部成功，写入 `.BUILD_FINISHED`；否则设置非 0 退出码。报告写入失败同样阻止完成标记。

关键文件：

- `Build/index.ts`
- `Build/lib/rule-sources.ts`
- `Build/lib/rule-source-processor.ts`
- `Build/lib/enhanced-file-output.ts`
- `Build/lib/platform-config.ts`
- `Build/lib/rule-output-variants.ts`
- `Build/lib/output-audit.ts`
- `Build/core/output/writing-strategy/*.ts`
- `Build/build-public.ts`

来源比较快照写为 `Internal/source-snapshots/*.json.gz`，读取兼容历史 `.json`；相同 source id 的两种编码不能同时存在。发布暂存检查单文件 25 MiB 上限，超限在 Git 推送前失败。

`status.json` 的 `ruleCount` 保持 canonical 逻辑数量的旧含义，不等于各平台实际输出数量；平台实际数量以 `Internal/rule-output-audit.json` 为准。`semanticScope: normalized-source` 与 `effectiveOutputs` 分别比较标准化来源和平台实际输出；`optimizations` 记录 canonical 到 writer 路由间的 keyword/domain coverage，不代表早期 Trie/CIDR 归一化的逐条原因。旧 converter 或缺少有效输出快照时，相关比较标为不可比。

## 6. 规则源配置方式

规则源集中定义在 `Build/lib/rule-sources.ts`：

- `ruleGroups`：普通规则组，每组包含多个文件源。
- `specialRules`：把多个源合并为一个目标规则文件。
- 两类配置共享 `RuleProcessingOptions`，并通过同一 ruleset publication 路径输出。

未设置的处理选项由 `EnhancedFileOutput` 在输出时应用默认值，不需要在规则源对象里预填。

常见配置字段见 `Build/lib/rule-source-types.ts`：

- `path`：逻辑目标路径，取 basename（小写）作为 ruleset id，生成各平台 flat 文件名与分版文件名。
- `url` / `fallbackUrls`：主下载地址与备用地址。
- `targets`：目标平台，当前有效平台见 `Build/lib/platform-config.ts`：`surge`、`clash`、`singbox`、`loon`。
- `defaultPolicy`：默认策略；设为 `null` 时会清理规则中的策略字段，输出纯规则格式。
- `allowEmpty`：允许空来源或策略筛选后为空的文本规则；不能绕过 sing-box 的有效匹配条件发布检查。
- `keepComments`：是否保留行首注释，默认 `false`。
- `keepInlineComments`：是否保留行内注释，默认 `false`。
- `keepEmptyLines`：是否保留空行，默认 `false`。
- `formatConversion`：是否启用格式转换，默认 `true`。
- `applyNoResolve`：是否为 IP 类规则添加 `no-resolve`。
- `validate`：是否启用规则合法性校验，默认 `false`。
- `sourcePolicies`：可选的上游策略白名单，在移除策略前按第三个逗号字段匹配（忽略大小写）。用于从混合 QX 规则源中提取 `direct` 或 `reject`，不把上游 `proxy` 例外误转为直连。筛选后为空会终止该订阅发布，除非显式设置 `allowEmpty: true`。
- `excludedRuleTypes`：可选的规则类型排除列表，忽略大小写；在转换后筛选，包含被排除类型的复合规则整体丢弃，避免删减子条件扩大匹配。筛选后为空同样受 `allowEmpty` 发布边界约束。
- `deleteSourceFiles`：特殊规则完成后，按来源 URL 的 basename 尝试删除输出根目录中的同名文件。当前下载器只把来源保存在内存中，不会自行创建这些根目录文件；外部预置的同名文件仍可能被删除。

规则输出始终按 `EnhancedFileOutput` 的 Trie/Set 与平台 writer 处理去重和顺序，规则源配置没有单独的 `dedup` 或 `sort` 开关。

规则源配置不支持自定义 `header`；模块合并流程中的同名字段是独立配置，仍然有效。

添加新规则源时，优先在现有同类 `RuleGroup` 的 `files` 中追加配置对象，并明确是否需要多平台输出。

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

### 分版输出

flat 合并版 URL 保持不变；分版是追加输出，契约在 `Build/lib/rule-output-variants.ts`：

- 路径：`<平台目录>/<variant>/<id>.<扩展名>`，平台目录与扩展名同上表（`List/.list`、`Clash/.txt`、`Loon/.list`、`sing-box/.json`），`id` 为配置路径 basename 的小写形式。
- 三类互斥，同一平台三者并集等于合并版：`domainset` 为可无损表达的独立 DOMAIN／DOMAIN-SUFFIX；`non_ip` 为其余不依赖目标 IP 的条件，SRC-IP 等源地址条件属于此类；`ip` 为 IP-CIDR／IP-CIDR6／IP-ASN／GEOIP 及含这些条件的完整 logical 规则。logical 规则不拆分子条件；不能无损表达的域名条件留在 `non_ip`。
- Surge 的 extended-matching 例外：规则集含 `extended-matching` 时，Surge 域名条件留在 `non_ip`（DOMAIN-SET 不能携带该标志），`domainset` 记为 `absent-empty`、reason `extended-matching`；含域名子条件的目标 IP logical 规则也留在 Surge `non_ip` 以保留文件级标志，审计记为 `reroutedFromIp`。其他平台仍归入 `ip`。
- 转换损失记录在 `outputs[].losses`（`droppedValues`、`ignoredModifiers`）：sing-box 不能表达 `no-resolve`，Surge 以外忽略 `extended-matching`，Clash 丢弃 TCP/UDP 以外的 `PROTOCOL` 值。不要把这些损失写成"保留"。
- 格式：Surge `List/domainset/*.list` 是 native DOMAIN-SET（`example.com` 精确、`.example.com` 后缀），由 `Build/core/output/writing-strategy/surge-domainset.ts` 写出，不得写入 classical 规则；`List/non_ip`、`List/ip` 是 classical RULE-SET。Clash、Loon 分版使用 classical 编码，sing-box 使用 JSON v2。消费者格式以审计报告的 `format` 字段为准，不按目录名猜测。
- 空分版或平台全部不支持的分版不写文件，在审计报告中记为 `absent-empty`／`absent-unsupported`；成功构建会清除以前存在、现已合法消失的分版文件。下载失败属于构建失败，不得解释为空分版。sing-box 仍执行有效匹配条件门槛。
- 覆盖审查（`Build/audit-rule-coverage.ts`）按引用关键字选择解析器：`DOMAIN-SET` 对应 `List/domainset/<id>.list`，`RULE-SET` 对应 flat 与 `List/{non_ip,ip}/<id>.list`。缺失分版、格式不符、未知路径与远端引用都记为 `reviewStatus: not-covered` 并给出 `notCoveredReason`，不能计为已审查。

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

`Prevent_DNS_Leaks` 的指定 canonical source 使用严格、只读取 fresh 正文的参数模块适配，不放宽通用 `PROXY` 规则拒绝。腾讯视频的指定上游已停止维护，转换目录与历史产物恢复均排除它。哈罗依赖失败仍应留在报告中。

### 退休登记

`Build/lib/artifact-lifecycle.ts` 是 deprecated／retired 订阅的唯一登记，发布为 `Internal/artifact-lifecycle.json`。每条记录有稳定 id、原公开路径、原因、依据和可选 replacement。缓存恢复（`restore-optional-artifacts.ts`、`download-previous-build.ts`）、`build-public`、`prepare-publication` 与回滚候选都调用同一登记，retired 文件不能从历史产物、缓存或保留目录复活。退休 ruleset 登记同时覆盖合并版和三个分版。清理只作用于已登记的公开路径，拒绝绝对路径和路径穿越；共享 Scripts 需有引用或独占证据才能删除。不要凭一次上游空响应新增退休记录。当前 retired：腾讯视频去广告模块、`container`／`discord`／`scholar` 四平台规则、`sing-box/china_asn.json`（replacement 为 `sing-box/china_ip.json` 与 `china_ip_ipv6.json`，IP 覆盖不等同于 ASN）。

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

- push 到 `main` / `master`：完整流程；只有 `main` 发布。
- pull_request：执行构建，不发布。
- schedule：按不同 cron 执行快速更新、完整构建、镜像同步、插件转换等。
- workflow_dispatch：可选择任务 `all`、`build`、`convert-plugins`、`merge-modules`、`mirror-sync`、`deploy`、`bootstrap-baseline`、`rollback`。`build`、镜像和插件单独任务不自动发布；`deploy` 由本次 run 重新构建候选后发布。`deploy_target` 的 `all`、`github`、`cloudflare` 是兼容旧值，统一规范化为 production 并输出迁移说明。

主构建 job 会：

1. checkout
2. setup pnpm / Node
3. 恢复 `.cache`
4. `pnpm install --frozen-lockfile`
5. `pnpm run validate`
6. `pnpm test`
7. 按条件执行镜像同步、mock/module 下载、fmz200 split 下载、插件转换、模块合并、规则构建
8. 保存缓存与候选产物

### 发布

生产只有 `publish` job（仅 `refs/heads/main`，并发组 `nrrule-production`，不取消），路径为：候选 artifact → `prepare-publication.ts stage` 生成完整 staging tree，最后写 `Internal/publication-manifest.json` → `push` 到 NRRule → 该 commit 的 Cloudflare Pages check（核验 app identity 与 head_sha）→ immutable URL 与 `https://nrrule.pages.dev` 内容验收（`verify-publication.ts verify`，15 分钟截止）→ `record-receipt`。直接 Wrangler 上传已移除，不要恢复。

- stage 要求 `Internal/rule-output-audit.json`、`source-delta.json`、`rule-coverage.json`、`status.json` 与 `Internal/artifact-lifecycle.json`，且每个 published 输出的 bytes 与 sha256 必须和审计一致；核心目录（List、Clash、Loon、sing-box、GeoIP、Internal）缺失或复制失败直接失败。未运行任务的 Mirror、Modules、Scripts 从已验收 baseline 按摘要复制；恢复进新鲜目录的可选文件记录在 `Internal/preserved-artifacts.json`，manifest 中标为 `preserved`。
- 验收要求两个 origin 都按 manifest sha256 返回每个文件，并对审计 absent 的分版、退休登记路径和基线中已不再发布的路径返回 404。push 成功但验收失败报告“Git published, website not accepted”。
- 基线是最近一个 success 状态的 GitHub Deployments receipt（`publication-receipt.ts`），不是 NRRule HEAD。生产锁内重新解析基线：若与构建时 source-delta 记录的 receiptId 不同，stage 使用候选的标准化快照重算 delta，重新核对保留目录和历史恢复文件，生成 index 与 manifest；不重新下载上游。快照或恢复摘要不满足校验时失败。若新 receipt 正是本候选已验收的结果，则 no-op。
- receipt 写入幂等：相同证据复用已有 deployment；写入失败退出码 14（网站已验收，验收记录未持久化）。
- 上线顺序：合并后，自动 push/schedule 构建但以 `publication skipped: bootstrap required` 警告跳过发布，手动 deploy/rollback 直接失败；运行 `workflow_dispatch` task=`bootstrap-baseline`，填当前 NRRule commit（`bootstrap_revision`）与其 immutable URL（`bootstrap_immutable_url`），写入 `legacy-bootstrap` receipt；下一次 run 正常发布。bootstrap artifact 保留 90 天，过期后重新运行 bootstrap-baseline 会生成替代旧 receipt 的新 receipt。
- 回滚：task=`rollback` 加 `rollback_receipt_id`（必须是 manifest receipt，不能是 bootstrap）。以该 tree 为候选，stage 应用当前退休登记，投影历史输出审计到当前退休登记清理后的 tree，作为新 commit 沿同一链发布并验收；不得复活 retired 文件。

CLI 子命令（未知命令打印 usage 并退出 2）：

- `Build/prepare-publication.ts`：`select-baseline`、`resolve-baseline`、`restore-preserved`、`stage`、`purge --root <dir>`（清除并断言无退休文件）、`push`、`bootstrap`、`render-public`（stage 内部子进程使用）。
- `Build/verify-publication.ts`：`verify` 退出码 0 accepted、10 check-failed、11 check-timeout、12 immutable-mismatch、13 production-lagging；`record-receipt --kind manifest|legacy-bootstrap`，14 表示 receipt 未持久化。

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
  - `strict: true`（包含严格空值检查）
  - `module: node16`
  - `moduleResolution: node16`
  - `allowImportingTsExtensions: true`
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
- `PUBLICATION_BASELINE_DIR`：主构建读取的已验收 tree 绝对路径，用其 `Internal/source-snapshots` 计算 source delta；未设置时 delta 为 baseline-unavailable，相对路径报错。
- `PUBLICATION_BASELINE_RECEIPT_ID`：该基线的 receipt id，写入 `source-delta.json` 的 `baseline.receiptId`；stage 用它判断 baseline drift。

部署主要由 GitHub Actions 负责。`package.json` 中 `deploy` 脚本只执行构建并输出提示：

```bash
pnpm run deploy
```

实际发布逻辑以 `.github/workflows/main.yml`、`Build/prepare-publication.ts` 与 `Build/verify-publication.ts` 为准，流程见第 10 节“发布”。

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
| 修改分版输出 | `Build/lib/rule-output-variants.ts`, `Build/core/output/writing-strategy/*.ts`, `Build/lib/output-audit.ts` |
| 修改发布/回滚 | `Build/prepare-publication.ts`, `Build/verify-publication.ts`, `Build/lib/publication-*.ts`, `.github/workflows/main.yml` |
| 修改退休登记 | `Build/lib/artifact-lifecycle.ts` |
| 修改覆盖审查 | `Build/audit-rule-coverage.ts`, `Build/lib/rule-coverage-audit.ts` |
| 修改 CI | `.github/workflows/main.yml`, `.github/workflows/check-source-domain.yml` |
| 修改测试 | `Build/__tests__/*.test.ts` |

## 16. 已知注意点

- 本文件已被 Git 正常跟踪；修改后请与相关代码变更一并提交。
- 本仓库构建高度依赖外部网络，上游不可用可能导致 `pnpm run build` 失败。
- `public/` 是构建产物目录，不在源码中长期维护。
- 部分源码注释为中文，新增说明可继续使用中文；公开用户文档可视上下文使用英文或中英混排。
