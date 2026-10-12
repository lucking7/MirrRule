# AGENTS.md

MirrRule 下载上游代理规则、GitHub Release 镜像和插件，经清洗、去重、转换后发布到 `https://nrrule.pages.dev`（推送到 NRRule 仓库，由 Cloudflare Pages 提供服务）。产物包括：Surge `List/`、Clash `Clash/`、Loon `Loon/`、sing-box `sing-box/` 的规则集；`Mirror/`、`Modules/`、`Scripts/` 的 Surge 模块与脚本；`GeoIP/` 数据库；`Internal/` 下的机器可读报告。

## 文档地图

本文件只记录跨文件的约束和从代码看不出的原因。按任务先读对应文档：

- `ARCHITECTURE.md`：构建管线与模块边界。改构建主流程、writer 或 canonical 状态前读。
- `README.md`：对外契约。订阅 URL 与分版用法（Subscription Variants）、`Internal/` 报告字段（Build Reports）、发布与回滚（Publication and Rollback）、退休订阅（Retired Subscriptions）、模块开关（Development）。对外行为变化必须同步它。
- `RULE_SOURCES.md`：各规则集的来源选择理由、sing-box JSON 输入子集、GeoIP 校验条件、Kelee 下载与 gateway 排查。改规则源、GeoIP 或插件下载前读。
- `MIGRATION.md`：从零搭建、环境变量（4.2）、外部服务、故障排查。
- `PRODUCT.md`、`DESIGN.md`：`public/index.html` 索引页的产品事实与设计规则。改 `Build/build-public.ts` 或 `Build/assets/ruleset-index.css` 前读。
- `SIMPLIFICATION.md`、`PLAN.md`、`docs/`：历史清理记录与研究笔记，追溯某个取舍时才查。

## 环境

- Node 26.x、pnpm 10.x、CommonJS。`.ts` 由 `@swc-node/register` 直接运行（`pnpm run node <file>`），不产出 JS。
- 两个 TypeScript 包：`typescript`（TS 6）供 SWC 注册器和 ESLint typed rules 使用；alias `typescript-compiler`（TS 7 native）只负责 `pnpm run typecheck`。该脚本显式调用 alias 的 `bin/tsc`，因为两个包都提供同名 `.bin/tsc`。
- 部分运行时 `require('./x')` 是有意的懒加载，保持原样。
- 代码风格以 `pnpm run lint`（eslint-config-sukka）为准，Node 内置模块用 `node:` 前缀。

## 工作守则

1. 开始前运行 `git status --short`，保留与任务无关的已有改动。
2. `public/**`、`.cache/**`、`.BUILD_FINISHED` 是生成物，只能通过修改 `Build/**` 后运行脚本来改变。
3. 只在任务要求时修改 `package.json`、`pnpm-lock.yaml`。
4. 网络代码沿用 `Build/utils/network/**` 的重试、HTTP 缓存、fallback 和代理候选机制。
5. 影响产物正确性的错误必须让进程以非 0 退出。主构建只在全部成功时写 `.BUILD_FINISHED`，CI 依赖这个标记。
6. 行为变化补 `Build/__tests__/*.test.ts`（`node:test` 与 `node:assert/strict`，可用 `require()` 加载目标模块）。
7. 改规则格式、策略字段、扩展名或 JSON 结构时，逐一检查 Surge、Clash、Loon、sing-box 四个平台。
8. 许可证为 AGPL-3.0（代码源自 SukkaW/Surge），引入的代码必须兼容。
9. 源码注释和内部文档可用中文；README 以英文为主。

## 验证

| 改动 | 运行 |
|---|---|
| 只改 Markdown | 可以不运行，回复中说明 |
| TypeScript 逻辑 | `pnpm run validate`（lint + typecheck）、`pnpm test` |
| 规则源或构建流程 | 上一行，再加 `pnpm run build` |
| 镜像、插件、模块 | 上上行，再加 `pnpm run sync-mirrors`、`pnpm run convert-plugins`、`pnpm run merge-modules -- --dry-run` |

`build`、`sync-mirrors`、`convert-plugins` 会访问大量外部网络并写入 `public/`、`.cache/`，本地运行前先征得用户同意。`pnpm run knip` 检查未使用的代码和依赖。

## 规则构建

入口 `Build/index.ts`：下载 GeoIP，`RuleSourceProcessor` 读取 `Build/lib/rule-sources.ts`，`EnhancedFileOutput` 清洗、转换并用 Trie/Set 去重，四个平台 writer 写合并版和分版，然后生成输出审计、来源快照与 delta，执行覆盖审查，最后由 `buildPublic` 生成索引页和部署辅助文件。

- `GeoIP/country.mmdb` 不由 `pnpm run build` 生成，CI 在它之前运行 `Build/build-geoip-country.py`。该脚本失败时复用 `--fallback-tree` 中已验收的旧库；没有可用旧库时不写这个文件。两种情况都只发 warning 并退出 0，所以这个库可能在无人察觉时变旧或缺失；检查条件见 `RULE_SOURCES.md` 的 GeoIP 国家库一节。
- 规则源字段的定义与含义在 `Build/lib/rule-source-types.ts`。新增上游时优先在现有 `RuleGroup.files` 中追加配置，现有字段不够用时才扩展类型。字段名看不出的约束：
  - ruleset id 取 `path` 的小写 basename，决定所有平台的文件名。
  - 未设置的处理选项由 `EnhancedFileOutput` 填默认值。去重和排序始终由 Trie/Set 和 writer 决定，没有 `dedup`、`sort`、`header` 开关。
  - `targets` 缺省时只输出 Surge；包含未知平台时报错。
  - `allowEmpty` 放行空来源及 `sourcePolicies`、`excludedRuleTypes`、`excludedRules` 筛选后为空的结果，但不绕过 sing-box 的有效匹配条件门槛。
  - `excludedRuleTypes` 丢弃含该类型的整条 logical 规则；`excludedRules` 只匹配独立规则。只删子条件会扩大 logical 规则的匹配范围。
  - `frozen` 规则只读 `Build/assets/frozen-rules/<文件名>.gz`，来源健康检查跳过它的历史 URL。
- 规则类型与别名统一由 `Build/core/output/rule-support-matrix.ts` 的 `normalizeRuleType` 识别，平台支持能力在同一文件单独判断。改转换逻辑必须补测试，复合规则等用例见 `Build/__tests__/reliability.test.ts`。
- `status.json` 的 `ruleCount` 是 canonical 条件数，不是各平台实际输出数；后者以 `Internal/rule-output-audit.json` 为准。

## 分版输出契约

路径、扩展名、格式和分类规则唯一定义在 `Build/lib/rule-output-variants.ts`。修改时同时核对 `Build/lib/output-audit.ts`、`Build/lib/pages-internal-gate.ts`（Pages 放行路由）、`Build/audit-rule-coverage.ts`、`Build/check-profile-variants.ts` 和 README 的 Subscription Variants。

| 分版 | Surge | Clash | sing-box | Loon |
|---|---|---|---|---|
| 合并版 | `List/<id>.list` | `Clash/<id>.txt` | `sing-box/<id>.json` | `Loon/<id>.list` |
| `non_ip`、`ip` | `List/<分版>/<id>.list`，另有同内容的 `.conf` | classical `.txt` | JSON v2 | classical `.list` |
| `domainset` | `List/domainset/<id>.conf`（`DOMAIN-SET`） | `.txt`（`behavior: domain`） | JSON v2 | 不提供 |

- 默认按条件分类：目标 IP 条件（不论有无 `no-resolve`）和含目标 IP 子条件的 logical 规则进 `ip`，其余进 `non_ip`，两者并集等于合并版。`domainset` 是 `non_ip` 中精确域名与后缀的子集。
- 例外一：`specialRules` 设置 `sourceVariants` 时，按来源文件整体分版，不按类型分类，也不跨分版去重（当前只有 `reject`）。
- 例外二：规则集含 `extended-matching` 时，Surge 把含域名或 URL-REGEX 子条件的目标 IP logical 规则留在 `non_ip`，以保留文件级标志，审计记为 `reroutedFromIp`。
- 平台损失记录在审计的 `outputs[].drops` 与 `outputs[].losses` 中，文档里不能写成"保留"：sing-box 不能表达 `no-resolve`，丢弃全部 AND/OR/NOT 复合规则以及 PROCESS-NAME、USER-AGENT、URL-REGEX、IP-ASN、GEOIP、端口、PROTOCOL 等类型（只含这些规则的规则集会碰到有效匹配条件门槛）；Clash 不支持 USER-AGENT、URL-REGEX，并丢弃 TCP/UDP 以外的 `PROTOCOL` 值；Loon 不支持 PROCESS-NAME、DOMAIN-WILDCARD、SRC-IP-CIDR；Surge 以外的平台忽略 `extended-matching`。
- 空分版不写文件，审计记为 `absent-empty` 或 `absent-unsupported`；成功构建会删除以前存在、现已合法消失的分版文件。
- 下载失败不能当作空分版处理：该规则集用 `PUBLICATION_BASELINE_DIR` 中已验收的来源快照原样重发（`sources[].selection` 为 `baseline-snapshot`，日志带 `::warning::`），其他规则集照常更新。没有可用快照、设置了 `sourceVariants`，或快照在当前处理选项下不能复现时，构建失败。
- 两个冻结的地域测速订阅（`speedtest_china`、`speedtest_international`）只发布原有路径，没有 `domainset`，也没有 Surge 分版的 `.conf`。

## 发布

流程和用户可见行为见 README 的 Publication and Rollback。CLI 是 `Build/prepare-publication.ts` 与 `Build/verify-publication.ts`（未知子命令打印 usage 并退出 2），实现在 `Build/lib/publication-*.ts`。修改时守住这些约束：

- 只有 `main` 上的 `publish` job 发布：生成完整 staging tree，push 到 NRRule，等待该 commit 的 Cloudflare Pages check，再让 immutable URL 和正式域名都按 manifest 的 SHA-256 通过验收，最后写 GitHub Deployment receipt。直接 Wrangler 上传已移除，保持移除。
- 基线是最近一个状态为 success 的 receipt，不是 NRRule 的 HEAD。
- stage 要求 `Internal/` 下的 `rule-output-audit.json`、`source-delta.json`、`rule-coverage.json`、`artifact-lifecycle.json` 和根目录的 `status.json` 齐全，每个 published 输出的字节数和 SHA-256 与审计一致，单文件不超过 25 MiB。
- 本轮未运行的任务对应的 `Mirror/`、`Modules/`、`Scripts/` 从基线按摘要复制，在 manifest 中标为 `preserved`。`deploy-modules` 复制的 `Modules/Converted` 必须与基线摘要一致；构建期间基线 receipt 变化，或依赖审计删了其中的行，stage 都会在 push 前失败，需要重新构建。
- `_worker.js` 与 `_routes.json` 由 `pages-internal-gate.ts` 生成。分版目录和 `Mirror/` 只放行本次 tree 中存在的文件，其余返回 404，因为这些文件会随上游出现和消失，而 Pages 边缘缓存会继续返回已删除的文件。路由总数不能超过 Pages 的 100 条（代码中有断言）；`/Internal/*`、每个门控目录、每个退休目录前缀和每条不在这些目录内的退休精确路径各占一条。Pages 项目必须设置 `fail_open: false`，否则 Functions 额度耗尽后会跳过检查。
- `Modules/Converted/` 与 `Scripts/` 不经 worker（避免每次下载都计入 Functions 调用），其中被删除且未退休的文件只要求 immutable URL 返回 404。
- `verify` 退出码：0 accepted，10 check-failed，11 check-timeout，12 immutable-mismatch，13 production-lagging。`record-receipt` 退出 14 表示网站已验收但 receipt 未持久化。

## 退休登记

`Build/lib/artifact-lifecycle.ts` 是 deprecated 与 retired 订阅的唯一登记，当前清单看该文件。缓存恢复、`build-public`、`prepare-publication` 和回滚都调用它，retired 文件不能从历史产物、缓存或基线复活。

- 精确路径不能落在其他记录的 `pathPrefixes` 内。
- 退休一个 ruleset 时，合并版和全部分版都要登记。
- 新增退休记录需要上游停止维护等明确依据，一次空响应不够。
- 删除共享的 `Scripts/` 文件需要有引用或独占证据。

## 镜像、插件与模块

- 镜像同步（`Build/integration/mirror-sync/**`）只处理有生产配置的 release adapter，新增 adapter 前必须有真实的生产来源。替换经 `Build/lib/atomic-file.ts` 原子完成并保留 last-known-good。GetSomeFries 上游没有 Release，用 `branchFiles` 按 `main` 分支读取配置中列出的文件，任一路径缺失或类型不在允许范围内即同步失败。iRingo 的 `.sgmodule` 会把 `#!arguments=` 中 `Proxy` 参数的值替换为 `🇺🇸`。
- 插件转换（`Build/integration/plugin-converter/**`）：kelee.one 的 WAF 只放行以 `Surge Mac/` 开头的 UA，应用标识放在括号里。插件目录 `hub.kelee.one/list.json` 先直连；其他 kelee.one 请求在设置了 `PROXY_BASE` 时先走代理再直连，CI 把 `PROXY_BASE` 指向本地的 `Build/browser-rule-gateway.py`。细节与排查步骤见 `RULE_SOURCES.md`。
  - 退出码 3：插件目录不可用，或缺失的必需模块全部因上游暂时不可用（网络错误、5xx、401、403、408、429）而失败。workflow 据此跳过合并并沿用已验收的 `Modules`、`Scripts`。退出码 1：必需脚本返回 404/410、模块改名导致缺失、转换或合并 dry-run 出错。分类逻辑在 `upstream-failure.ts` 与 `readiness.ts`，回归测试在 `Build/__tests__/plugin-readiness.test.ts`。
  - 插件缓存文件名包含 canonical source URL 的摘要，不能改回按插件名缓存。依赖脚本有了镜像或缓存 URL 后，转换结果才原子发布。
- 可选产物恢复（`Build/restore-optional-artifacts.ts`，必须传 `--conversion-report`）只恢复本轮转换报告能解释其缺失的模块，以及本 tree 中任一模块引用的脚本；已从目录移除或改名的旧模块被丢弃。
- 模块依赖审计（`Build/lib/module-dependency-audit.ts`）：外部脚本返回 404/410，或 NRRule 托管的脚本不在 tree 中，算一次缺失；连续 3 次缺失才删除加载它的行，且只修改本轮刷新的目录；网络错误、5xx、限流不计数。`Mirror/` 文件的脚本行删光时删除整个文件，`Modules/` 只删行，因为合并配置要求这些模块存在。
- 模块合并（`Build/lib/module-merger/**`，配置 `configs/pro-merge-config.yaml`，唯一输出 `Modules/Merged/All-in-One-Pro.sgmodule`）：
  - 模块 `id` 以字母开头，只含字母、数字和下划线（Surge 参数名的限制）。它同时是 `--only`、`--enable`、`--disable` 的取值和模块开关名。
  - MITM 主机名始终取所有模块的并集。Surge 只能用 `-host` 排除主机名，而同一主机名可能被仍启用的其他模块使用。
  - 规则只在同一模块内去重。跨模块去重后，关闭一个模块会丢掉另一个模块仍需要的规则。
  - 字面量的非内置策略（如 `PROXY`、策略组名）会让 Surge 报错，因此删除该规则并输出 `::warning::`。
  - 配置中出现已移除的 `output.rulelist`、`scriptToggle`、`scriptDefaultOn` 会报错。

## CI

`.github/workflows/main.yml`：push 到 `main` 或 `master` 运行完整流程（只有 `main` 发布）；PR 只构建；schedule 分别触发快速更新、完整构建、镜像同步和插件转换。`workflow_dispatch` 的 `task` 选项在文件开头的 inputs 中，任务选择逻辑在 `prepare` job，只有 `verify-kelee` 不经过 `prepare`，由同名 job 直接判断 `inputs.task`；`deploy-modules`、`bootstrap-baseline`、`rollback` 的用法见 README。`check-source-domain.yml` 手动检查上游域名可用性（`Build/validate-domain-alive.ts`）。

## 环境变量

通用变量见 `MIGRATION.md` 4.2，其中两个容易误解：`PUBLIC_DIR` 不能重定向所有输出，部分流程固定写 `public/`；`CI` 只要非空（包括 `CI=false`）就让 Script-Hub 客户端选 `script.hub`。发布相关的两个变量 MIGRATION.md 没有列出：

- `PUBLICATION_BASELINE_DIR`：已验收 tree 的绝对路径，相对路径会报错。构建用它的 `Internal/source-snapshots` 计算来源 delta，并在上游下载失败时重发对应规则集；`Build/audit-module-dependencies.ts` 也从它延续脚本缺失次数。未设置时 delta 为 `baseline-unavailable`。
- `PUBLICATION_BASELINE_RECEIPT_ID`：该基线的 receipt id，写入 `source-delta.json` 的 `baseline.receiptId`；stage 用它判断构建后基线是否变化。
