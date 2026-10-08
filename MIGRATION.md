# MirrRule 迁移与从零搭建手册

本文面向拿到源码、准备在自己环境和账号下运行 MirrRule 的维护者。最初的隔离验收基线为 `01d348314f41f471390b804d235e4437f7311971`，后续源码与 CI 核对日期为 2026-09-30。版本、上游内容与云平台设置可能变化，升级后应重新核对对应源码与 workflow。

先完成本地规则构建，再准备镜像、插件和模块，最后接入自己的发布账号。本文记录当前代码的真实限制；文中的配置替换由迁移者在自己的副本完成。本文的验收不包含生产发布。

## 1. 功能与交付物

MirrRule 是构建型规则聚合项目：下载上游成品规则，清洗、转换、去重和排序，再生成静态文件。它没有常驻业务后端、用户数据库或登录系统；SQLite 用于下载缓存。当前代码不解析原始 adblock 过滤表。

| 能力                    | 入口 / 主要实现                                                                                                                                                | 输出与边界                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 规则聚合、多平台输出    | [Build/index.ts](Build/index.ts)、[rule-source-processor.ts](Build/lib/rule-source-processor.ts)、[enhanced-file-output.ts](Build/lib/enhanced-file-output.ts) | `public/List/*.list`、`Clash/*.txt`、`Loon/*.list`、`sing-box/*.json`；不同平台会丢弃不支持或非法规则，查看构建日志 |
| GeoIP 下载              | [download-geoip.ts](Build/download-geoip.ts)                                                                                                                   | `public/GeoIP/*.mmdb`；临时文件验证大小后替换                                                                       |
| Release 镜像            | [sync-mirrors.ts](Build/sync-mirrors.ts)、[mirror-config.ts](Build/integration/mirror-sync/mirror-config.ts)                                                   | `public/Mirror/{iRingo,DualSubs,BiliUniverse}`                                                                      |
| Sukka、fmz200 镜像      | [download-mock-modules.ts](Build/download-mock-modules.ts)、[download-fmz200-split.ts](Build/download-fmz200-split.ts)                                         | `public/Mirror/Sukka/{mock,sgmodule}`、`public/Mirror/fmz200/sgmodule`                                              |
| Loon 插件转换与脚本镜像 | [convert-plugins.ts](Build/convert-plugins.ts)、[plugin-converter](Build/integration/plugin-converter)                                                         | `public/Modules/Converted`、`public/Scripts`；Script-Hub 转换、本地 fallback、依赖脚本发布检查                      |
| Surge 模块合并          | [merge-modules.ts](Build/merge-modules.ts)、[module-merger](Build/lib/module-merger)                                                                           | `public/Modules/Merged/All-in-One-Pro.sgmodule`、`public/Modules/Rules/reject-pro.list`                             |
| 静态索引                | [build-public.ts](Build/build-public.ts)、[ruleset-index.css](Build/assets/ruleset-index.css)                                                                   | `public/index.html`、`_headers`、`404.html`、生成的 README；原生折叠目录树与实际文件链接                          |
| 构建状态                | [status-manifest.ts](Build/lib/status-manifest.ts)                                                                                                             | 成功主构建生成 `public/status.json` 和根目录 `.BUILD_FINISHED`                                                      |
| 上游健康检查            | [validate-domain-alive.ts](Build/validate-domain-alive.ts)、[check-source-domain.yml](.github/workflows/check-source-domain.yml)                               | JSON 报告、定时状态分支与 Issue 告警；不等于生产构建成功                                                            |

源码仓库 `lucking7/MirrRule`、产物仓库 `lucking7/NRRule`、Pages 项目 `nrrule` 是三个独立对象。源码仓不跟踪 `public/`。产物仓存放展开后的公开文件，根目录直接是 `List/`、`Modules/` 等；Pages 上传的是整个 `public/`。

索引按实际产物显示 `List`、`Clash`、`Loon`、`sing-box` 等目录。顶层默认展开，`Mock` 和 `Internal` 默认折叠，嵌套目录默认折叠；访问者打开文件或通过浏览器复制链接地址。页面使用系统字体和自动 light / dark 配色，不依赖应用 JavaScript。订阅用途、分流顺序和 MITM 配置见 [README](README.md)。

## 2. 技术栈、目录与数据流

### 2.1 固定运行环境

以 [.node-version](.node-version)、[package.json](package.json) 和 [pnpm-lock.yaml](pnpm-lock.yaml) 为准。以下依赖版本是基线锁文件安装结果，不是 npm 最新版本。

| 组件         | 版本 / 用途                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| Node.js      | 要求 `26.x`；本次实测 `26.8.1`                                                                         |
| pnpm         | `packageManager` 固定 `10.15.0`，engines 允许 `10.x`                                                   |
| TypeScript   | 锁定 `6.0.3`，package 范围 `^6.0.2`；严格类型检查，`noEmit`                                            |
| SWC          | `@swc-node/register 1.12.1`、`@swc/core 1.16.2`；运行 TS，项目为 CommonJS                              |
| 网络与缓存   | `undici 8.7.0`、`undici-cache-store-better-sqlite3 1.1.0`、`better-sqlite3 12.11.1`                    |
| 数据处理     | `yaml 2.9.0`、`fast-cidr-tools 0.3.2`、`foxts 5.8.0`、`tar-fs 3.1.3`                                   |
| 质量检查     | Node 内置 `node:test`、ESLint `9.39.1`、Sukka config `8.9.3`、Knip `6.35.1`、Prettier `3.9.6`          |
| 发布工具     | workflow 固定 Wrangler `4.114.0`；无需为本地规则构建安装 Wrangler                                      |
| 插件转换服务 | Docker 镜像 `xream/script-hub@sha256:4e9e5055157d2d85f9c03abd045a0016fe594adc44d27410019cdb4818961f45` |

本地需要 Git、Node、pnpm 和网络；复现 CI 的 Script-Hub 转换路径还需要可运行 Docker 的环境。源码包含本地转换 fallback，但不能据此保证缺少 Script-Hub 时所有插件都能转换。`better-sqlite3` 和 SWC 有原生二进制依赖，换 Node 大版本或 CPU 架构后不要复用旧 `node_modules`。预编译包不可用时，需要 Python 和系统 C/C++ 编译工具链。`pnpm test` 固定逐个运行测试文件，避免干净克隆首次创建共享 SQLite 缓存时多个测试进程争用锁。

### 2.2 目录职责

| 路径                                                | 维护内容                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------- |
| `Build/*.ts`                                        | CLI 和流程入口，统一从仓库根目录执行                                 |
| `Build/lib/rule-sources.ts`、`rule-source-types.ts` | 规则源、fallback、目标平台和处理选项                                 |
| `Build/core/output/writing-strategy/`               | Surge、Clash、Loon、sing-box 四种输出适配                            |
| `Build/integration/`                                | Release 镜像、插件转换和脚本镜像                                     |
| `Build/lib/module-merger/`                          | YAML 配置、参数处理、模板和双文件发布                                |
| `Build/utils/network/`                              | 下载重试、HTTP 缓存和 Worker URL 候选                                |
| `Build/constants/`、`Build/trace/`                  | 路径、User-Agent、构建追踪                                           |
| `Build/__tests__/`                                  | 回归测试                                                             |
| `.github/workflows/`                                | 任务编排、发布、上游健康检查、Dependabot 自动合并                    |
| `public/`、`.cache/`、`.BUILD_FINISHED`             | 生成物、下载缓存和成功标记，均不手动维护                             |
| `ARCHITECTURE.md`、`PRODUCT.md`、`DESIGN.md`        | 架构与索引页设计说明；`PLAN.md` 是历史维护计划，版本与状态以代码为准 |

### 2.3 执行顺序

```text
上游规则 + GeoIP
  → pnpm run build
  → 清洗 / 平台输出 → public/{List,Clash,Loon,sing-box,GeoIP}
  → buildPublic → index.html / _headers / 404.html / README.md
  → 全部成功 → status.json + .BUILD_FINISHED

GitHub Release / Sukka / fmz200 → 各自镜像命令 → public/Mirror
插件列表 → 本轮插件下载/校验 → loopback 服务 → Script-Hub / 本地转换 → 脚本镜像 → public/Modules/Converted + Scripts
已转换模块 → merge-modules → public/Modules/{Merged,Rules}
上述可选产物就绪 → build-web → 更新完整文件索引

CI 聚合 public artifact → Cloudflare Pages + 产物 Git 仓库
```

`pnpm run build` 只执行规则、GeoIP 和网页构建，不调用镜像、插件转换或模块合并。`pnpm run build-web` 只重建索引，不更新 `status.json` 或成功标记。`status.json` 中 `mirrors` 当前由主入口写为空数组，不能用它证明镜像已同步；本地未设置 `GITHUB_SHA` 时 `commit` 为 `null`。

## 3. 干净环境安装与首次规则构建

以下使用 macOS / Linux shell，在一个全新目录执行，不复制旧 `.cache`、`node_modules` 或 `public`。先通过自己的 Node 版本管理器安装并激活 Node 26，再安装固定 pnpm。仓库开发依赖参与运行，不要使用 `--prod` 安装。

```bash
git clone https://github.com/lucking7/MirrRule.git mirrrule-new
cd mirrrule-new
git rev-parse HEAD
node --version
npm install --global pnpm@10.15.0
pnpm --version
pnpm install --frozen-lockfile
pnpm run validate
pnpm test
pnpm run knip
pnpm run build
```

记录 commit 便于复现本次运行；正式接管时从自己的源码仓 checkout 已审核版本并建立工作分支。已有 pnpm 10.15.0 时省略全局安装。本次验证使用预装的 mise 执行 `mise exec node@26 -- pnpm ...`，未重复安装系统运行时。

主构建会访问上游并写入当前克隆的 `public/` 与 `.cache/`。每条命令必须退出码为 0 才进入下一步；使用 `tee` 保存日志时启用 `set -o pipefail`，防止掩盖前一个命令的失败。

成功后验证真实输出：

```bash
test -s .BUILD_FINISHED
test -s public/index.html
test -s public/_headers
test -s public/GeoIP/ipinfo.mmdb
test -s public/List/reject.list
test -s public/Clash/reject.txt
test -s public/Loon/reject.list
node -e 'const fs=require("node:fs"); for (const p of ["public/status.json","public/sing-box/reject.json"]) JSON.parse(fs.readFileSync(p,"utf8")); console.log("JSON OK")'
```

如有 Python 3，可用 `python3 -m http.server 8080 --bind 127.0.0.1 --directory public` 本地预览，然后访问 `http://127.0.0.1:8080`；结束时按 Ctrl-C。这个服务器不会应用 Pages 的 `_headers`，本地预览不代表客户端规则语义或线上缓存策略已验证。

## 4. 配置、环境变量与外部服务

### 4.1 可配置入口

规则源在 [rule-sources.ts](Build/lib/rule-sources.ts) 的 `ruleGroups` 与 `specialRules` 中声明。`url`、`fallbackUrls`、`targets`、`defaultPolicy`、`keepComments`、`formatConversion`、`applyNoResolve`、`validate` 等字段决定处理结果。`allowEmpty`、`keepInlineComments`、`keepEmptyLines` 等字段见 [rule-source-types.ts](Build/lib/rule-source-types.ts)。只选代码支持的 `surge`、`clash`、`loon`、`singbox`，未知平台会失败。规则源没有可用的 `enabled`、`dedup` 或 `sort` 开关；去重和输出顺序由处理器与平台 writer 固定处理。模块 YAML 中的 `enabledByDefault` 是另一套有效配置。

2026-10 的服务规则迁移与下载验证见 [RULE_SOURCES.md](RULE_SOURCES.md)。Netflix、Disney 等独立服务使用 blackmatrix7 Surge 规则与 MetaCubeX `meta` 分支的文本 geosite 合并；Netflix 还合并 geoip，WeChat 只有 blackmatrix7 来源。`specialRules.sourceFiles` 中任一必需来源失败会阻止该合并文件发布，不能把它当成备用 URL。裸域名、`+.` 后缀域名、数字开头合法域名和裸 IPv4/IPv6 CIDR 统一转换后再输出四个平台；`.mrs`、`.srs` 不属于文本输入。旧来源健康状态 ID 不沿用到新 URL，应在首次验收后检查历史告警。模块列表、插件和脚本下载仍需单独验收，规则构建成功不代表模块转换恢复。

镜像源在 [mirror-config.ts](Build/integration/mirror-sync/mirror-config.ts)；GeoIP URL 在 [download-geoip.ts](Build/download-geoip.ts)。插件列表与额外插件在 [plugin-list.ts](Build/integration/plugin-converter/plugin-list.ts)。模块选择和输出在 [pro-merge-config.yaml](Build/lib/module-merger/configs/pro-merge-config.yaml)。此项目没有一个能覆盖所有设置的 `.env` 文件，也没有统一的部署域名环境变量。

### 4.2 环境变量

通过 shell 或 GitHub Actions 的 `env` 注入；代码没有自动加载 `.env` 的入口。

| 变量                      | 默认与作用                                                   | 迁移注意                                                                                                                                |
| ------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_DIR`              | `ROOT_DIR/public`，由 `Build/constants/dir.ts` 读取          | **不是全局重定向开关**。主规则构建、GeoIP、status、Release 镜像、模块 YAML 等仍有固定 `public` 路径；首次搭建保留默认并使用独立克隆隔离 |
| `PROXY_BASE`              | 不设则直连；由 `Build/utils/network/proxy.ts` 拼接 URL       | 项目特定的 HTTP 转发入口，不是通用 `HTTP_PROXY`。新账号需要自行提供兼容服务或验证直连可用                                               |
| `PLUGIN_LIST_URL`         | 默认 `https://hub.kelee.one/list.json`；支持逗号分隔多个候选 | 替换列表源，不自动取消代码里的额外插件 `blockAds`                                                                                       |
| `PLUGIN_LIST_FORCE_PROXY` | 默认 `true`，仅字符串 `false` 关闭强制代理候选               | 没设置 `PROXY_BASE` 时仍只有直连；列表采用直连优先的候选顺序                                                                            |
| `GITHUB_TOKEN`            | Release API 客户端可选令牌                                   | CI 镜像步骤使用自动令牌；本地无令牌可能限流。fmz200 的独立目录下载器未读取该变量                                                        |
| `CI`                      | Script-Hub 客户端按非空值选择 `script.hub`，否则 `localhost` | 本地应不设置，连 `CI=false` 也会选 `script.hub`；其他代码用 `ci-info` 判定 CI                                                           |
| `GITHUB_SHA`              | CI 注入，写入 `status.json`；本地默认 `null`                 | 可在本地以 `GITHUB_SHA="$(git rev-parse HEAD)" pnpm run build` 记录来源                                                                 |
| `GITHUB_STEP_SUMMARY`     | Actions 注入的 summary 路径                                  | 插件 provenance 报告使用，不必在本地设置                                                                                                |
| `DEBUG`                   | 额外统计 / 调试                                              | 上游检查可用 `DEBUG=domain-alive:dead-domain`                                                                                           |
| `RUNNER_DEBUG`            | CI 中 `1` 开启额外追踪                                       | 通常由 runner 控制                                                                                                                      |
| `SWC_NODE_IGNORE_DYNAMIC` | `pnpm run node` 自动设为 `true`                              | 沿用项目脚本即可                                                                                                                        |

发布步骤另把 Secrets 映射为 `GH_EMAIL`、`GH_USER`、`GH_TOKEN`，见第 7 节。不要把密钥写到 YAML、命令示例或文档里。

### 4.3 必要网络依赖

| 来源                                               | 用途 / 是否可替换                                                                      |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| npm registry                                       | 首次安装锁定依赖                                                                       |
| GitHub API、raw、Release、codeload                 | 规则、GeoIP、Release 镜像与脚本；部分下载使用 GitLab fallback                          |
| `kelee.one`、`hub.kelee.one` 等配置上游            | 两个地域 Speedtest 规则与插件列表，源文件完整清单以配置为准                            |
| Script-Hub 的 `localhost:9101` / `script.hub:9101` | 插件远程转换；容器同时暴露 9100、9101                                                  |
| `cloudflare-proxy.lucking.workers.dev`             | 原维护者的公开转发 Worker，workflow 三处注入；源码仓不包含其服务实现或部署配置         |
| 原 NRRule 产物仓                                   | workflow 补齐缺失目录、单独合并时读取已转换模块、PR 对比；新账号应改为自己的公开产物仓 |
| Cloudflare API / GitHub Git 写入                   | 仅发布阶段需要                                                                         |

规则 Build 与 source-health 现通过 Python 3.11 browser gateway 使用自己的 Worker；安装锁定依赖、启动与退出命令见 [RULE_SOURCES.md](RULE_SOURCES.md)。只接受 HTTPS Kelee `.lsr`、`.plugin`、`.lpx`、`.js` 及固定插件目录；目录直连 browser session，其他资源经 Worker。插件转换也设置同一 Node `PROXY_BASE`。Node `PROXY_BASE` 设置为 `http://127.0.0.1:13193?url=`，gateway 上游设置为自有 HTTPS Worker；新账号必须独立验证，不能沿用原维护者 Worker 作为长期依赖。

Worker 的普通基址会被补成 `?url=`，随后直接拼接原始 URL；已有 `/`、`?` 或 `?url=` 的基址会按源码规则保留。loopback gateway 使用编码后的 `url` 查询参数，保留源地址内部的查询参数。自建服务需要兼容实际拼接、响应状态和二进制/文本内容。不要仅把 `PROXY_BASE` 改成不支持此协议的代理地址。规则下载和健康检查应使用一致的请求语义与 User-Agent；诊断时不要把浏览器能访问视为构建可访问的证据。

## 5. 镜像、插件和模块搭建

### 5.1 镜像同步

从仓库根目录按需执行：

```bash
pnpm run sync-mirrors
pnpm run node Build/download-mock-modules.ts
pnpm run download-fmz200-split
pnpm run build-web
```

第一条只同步 Release 镜像组，不包括后两条。也可用 `pnpm run mirror:iringo`、`mirror:dualsubs`、`mirror:biliuniverse` 分组运行。iRingo 模块会将 `Proxy` 参数改为 `🇺🇸`，迁移时确认这是否符合自己的策略组命名。Siri 读取 Release 中 `iRingo.Siri`、`iRingo.Search`、`iRingo.Spotlight` 资产，不构建上游 dev 分支。

遇到限流或上游失效，保留日志和已下载的文件，停止把本次输出视为完整快照。Release 下载具备校验与保留旧文件逻辑，但第一次运行没有旧文件可以兜底。

### 5.2 插件转换

先完成第 6 节的脚本 URL 替换，否则新生成模块仍会引用原服务。启动上述 gateway，然后在与 CI 一致的 Linux Docker 环境运行。Script-Hub 必须能访问 runner 的 loopback 插件服务，因此使用 host network；普通 Docker 端口映射不能满足这一要求。macOS 上未验证这条容器网络路径，建议先在 Linux 环境验收：

```bash
docker create --name mirrrule-script-hub \
  --network host \
  xream/script-hub@sha256:4e9e5055157d2d85f9c03abd045a0016fe594adc44d27410019cdb4818961f45
docker cp mirrrule-script-hub:/app/Rewrite-Parser.beta.js /tmp/mirrrule-script-hub-original.js
pnpm run node Build/patch-script-hub.ts \
  /tmp/mirrrule-script-hub-original.js /tmp/mirrrule-script-hub-patched.js
docker cp /tmp/mirrrule-script-hub-patched.js mirrrule-script-hub:/app/Rewrite-Parser.beta.js
docker start mirrrule-script-hub
curl --fail http://localhost:9101/
env -u CI PROXY_BASE='http://127.0.0.1:13193?url=' \
  PLUGIN_CONVERSION_REPORT="$PWD/plugin-conversion-report.json" \
  pnpm run convert-plugins --wait-service
```

等待容器就绪后再执行转换。转换器下载并校验本轮插件，再将允许的正文通过临时 loopback 服务交给 Script-Hub；服务在转换结束或异常时关闭。镜像固定为 2026-10-08 核对的最新 digest，parser 对应上游 `1ab8fd775a9028b70ede9009d0540818edd5882c`。Body/Header Rewrite、静态 mock 和参数包装使用上游原生实现；受限补丁处理剩余正则与捕获兼容，以及文本 mock_file 的下载、校验和内嵌发布。测试使用该版本的完整 parser fixture，直接执行相关解析与转换函数，并覆盖 patch CLI；容器 HTTP 路径以 CI 验收为准。

Script 条件中的捕获绑定、动态或无法等价转换的 Action 会失败；补丁锚点不匹配会中止。Kelee `Resource/JQLang/*.jq` 和 mock_file 的 `Resource/JavaScript/*.js` 依赖同样经网关读取，HTML challenge 和空响应会失败；转换后丢失源脚本依赖会被拒绝，本地 fallback 不能将未支持的 v2 脚本静默丢弃后标为成功。转换后只有元数据或空功能节会失败。

通用 fallback 仍拒绝 Loon 原生 `PROXY` 规则。指定来源 `Prevent_DNS_Leaks` 使用独立的严格适配：必须是仅含 `DOMAIN` / `DOMAIN-SUFFIX`、全部绑定 `PROXY` 的非空正文；转换为 `#!arguments=policy:Proxy` 和 `{{{policy}}}`，生成 `DNS防泄露.sgmodule`。参数值必须是主配置中已有的策略或策略组。该模块只控制上游列出的 DNS/IP 检测站点，不等于解决所有 DNS 泄露。官方 module 文档仍写内置策略限制；本机 Surge 6.10 已启用的参数模块实际将 `{{{Policy}}}` 替换为 `Proxy`，对应规则也由 engine 匹配到了该策略组。新 DNS 模块本身尚未加载到该客户端，不能据此声称它的实际出口已验证。

`--wait-service` / `-w` 是 CLI 支持的开关。`PLUGIN_CONVERSION_REPORT` 可将结果写到指定 JSON 文件，包含名称、sourceId、状态、产物名及错误，不包含源 URL。

转换器可能使用本地 fallback；只有依赖脚本具备可用镜像或缓存 URL 后才发布插件。默认 CLI 要求全部插件 `ready`，部分失败或使用旧缓存会返回非零，即使已有其他输出。CI 显式传入 `--required-config Build/lib/module-merger/configs/pro-merge-config.yaml`，要求默认启用的 47 项全部匹配本轮 `ready` 结果，且通过 dry-run 合并。任一必需项缺失、降级或参数无效仍阻断发布；非必需插件失败保留报告与 warning，不改成成功，也不生成空模块。已引用本仓 `Scripts/` 的脚本也必须在本轮下载、校验并写入产物，不能仅因 URL 指向自己的域名便判定可发布。检查转换统计、失败清单、脚本依赖与 provenance，不把“目录存在”视为完成。完成后 `docker rm --force mirrrule-script-hub`，并在 gateway 终端按 Ctrl-C。

本轮全部必需模块通过合并后，CI 才从原产物仓补回缺失的历史可选模块及脚本，保留现有订阅。该步骤不能覆盖本轮文件或补齐缺失的必需模块，也不改变 conversion report 的失败状态；无功能节的旧模块、失效脚本和缺失脚本依赖会跳过并记录 warning。接管时替换 workflow 中此步骤的 `lucking7/NRRule`。

fmz200 广告拦截合集使用上游 `Surge/module/blockAds.module` 原生文件，保留原生 Header/Body Rewrite、脚本和参数，经过相同的下载、依赖镜像及发布校验后输出 `广告拦截&净化合集.sgmodule`；不再将 Loon 版本的 `PROXY` 规则复制到 Surge 模块。原生输入刷新失败也不算本轮成功。当前上游带有 `#!system=ios`，本项目保留该限制，未验证在 Surge Mac 上移除限制后的行为。

两个挖财插件的 `#!name` 相同但内容不同：`Wacai_remove_ads` 保留 `挖财记账去广告.sgmodule`，`WaCaiJiZhang_remove_ads` 发布为 `WaCaiJiZhang_remove_ads.sgmodule`。其他未知的同名内容冲突会阻断对应输出，不能按执行顺序覆盖。

### 5.3 模块合并

默认配置有 48 项、启用 47 项。腾讯视频在配置中因上游停止维护及脚本失效被显式禁用，这是 2026-09-07 的记录，不代表本文再次验证了该 URL。重新启用前先恢复依赖和转换文件。

```bash
pnpm run node Build/merge-modules.ts --dry-run
pnpm run merge-modules
pnpm run build-web
```

首次克隆缺少 `public/Modules/Converted/*.sgmodule` 时，第一条会失败，这是依赖检查生效。`--dry-run` 仍加载和验证所有选中源，只是不发布输出。可用 `--config <path>`、`--only <key1,key2>`、`--enable <keys>`、`--disable <keys>`；没有显式 `key` 时用配置的 `header`。不要为了通过检查静默删掉失败模块。

YAML 输出路径以 `./` 或 `../` 开头时相对于配置目录，普通相对路径则相对于进程工作目录。默认 `file://public/...` 依赖根目录执行。两个输出文件必须不同，模板必须保留参数所需的 `header_extra`。

合并器保留并隔离源参数名、重命名脚本并调整 Panel 引用；未定义参数、缺失源、未知 key 等会中止。写入先暂存两份输出，再替换；后续替换失败会尝试恢复，不能理解为断电情况下的跨文件事务。生成模块的脚本开关以空值启用、`#` 禁用，保留源模块自身开关语义。

### 5.4 使用既有产物作为迁移输入

如果需要先验证合并流程，可从一个已审核的产物仓快照读取 `Modules/Converted` 与 `Scripts`。这验证的是“既有模块再合并”，不能代替插件重新转换验收。以下在源码仓根目录运行；`SEED_REPO`、`SEED_COMMIT` 先填入自己批准的仓库 URL 和完整 commit：

```bash
MIGRATION_SEED_DIR="$(mktemp -d)"
git clone --filter=blob:none --sparse "$SEED_REPO" "$MIGRATION_SEED_DIR/artifacts"
git -C "$MIGRATION_SEED_DIR/artifacts" checkout "$SEED_COMMIT"
git -C "$MIGRATION_SEED_DIR/artifacts" sparse-checkout set Modules/Converted Scripts
mkdir -p public/Modules/Converted public/Scripts
cp -R "$MIGRATION_SEED_DIR/artifacts/Modules/Converted/." public/Modules/Converted/
cp -R "$MIGRATION_SEED_DIR/artifacts/Scripts/." public/Scripts/
pnpm run node Build/merge-modules.ts --dry-run
pnpm run merge-modules
pnpm run build-web
```

只在新的 `public` 或明确确认目标输入为空时拷贝，避免混合两个快照。已有模块可能内嵌旧域名，正式切换应在改好脚本基址后重新转换并验证引用；不要手改生成物。完整迁移必须让自己的服务提供这些脚本，不能依赖原维护者域名长期存续。

## 6. 原账号、仓库与域名替换清单

建议先记录新的源码仓、公开产物仓、Pages 项目名、实际分配的域名和可选 Worker 地址，再逐项修改自己的副本。Secrets 名称可以保持不变，仅替换值；若改名，需要同步 workflow 引用。

| 当前值 / 标识                                              | 需要核对的位置                                                                                                          | 替换要求                                                                         |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `lucking7/MirrRule`                                        | `package.json` repository、`Build/build-public.ts` 的来源链接/OG URL、模块模板的 homepage、README 和项目说明            | 改为自己的源码仓；保留原项目与 SukkaW/Surge 的归属说明                           |
| `lucking7/NRRule`                                          | `main.yml` 的模块补齐、缺失目录补齐、PR diff、部署 clone、archive/unarchive；`Build/build-public.ts` canonical 与 badge | 全部指向自己的**产物仓**，不要指向源码仓                                         |
| `nrrule` / `nrrule.pages.dev`                              | `main.yml` 的 `--project-name` 和成功提示、README 订阅示例、package name                                                | 项目名和实际 Pages 域名分别核实，不假设名称一定可用                              |
| `nrrule.pages.dev/Scripts`                                 | `Build/integration/plugin-converter/script-location.ts` 的 `SCRIPT_MIRROR_LOCATION`                                     | 改为自己的 Pages 域名和脚本路径；生成 URL 与已镜像识别共用此值                   |
| `cloudflare-proxy.lucking.workers.dev`                     | `main.yml` 的 gateway 上游、`check-source-domain.yml` 的 gateway 上游                                 | 换兼容的自有 Worker；直连已验证时可移除配置                                      |
| `lucking7/NRRule` 的 GitHub/GitLab tarball、`NRRule-main/` | `Build/download-previous-build.ts`                                                                                      | 此独立 helper 未由当前主构建调用；若继续使用需同时改 URL、分支与压缩包根目录前缀 |
| `lucking7/ASN-China`                                       | `Build/download-geoip.ts`                                                                                               | 这是外部 GeoIP 数据源，不能机械改用户名；选择继续依赖、维护镜像或替换有效 URL    |
| `NRRule`、`@lucking7`、`Luck`、`MirrRule`                  | `Build/build-public.ts` 的标题/作者链接/元数据/404；模块 YAML author/category；package author；产品说明                 | 替换自己的展示身份，历史来源和许可证署名继续保留                                 |
| `main`                                                     | workflow 部署条件、push 目标、Pages `--branch`、产物读取 URL                                                            | 最省改动的方式是两仓和 Pages 都用 `main`；改分支时逐一同步                       |

修改后用搜索收口，逐个判定残留属于历史署名、主动保留的上游还是遗漏：

```bash
rg -n 'lucking7|nrrule\.pages\.dev|NRRule-main|cloudflare-proxy\.lucking|project-name=nrrule' \
  Build .github package.json README.md
rg -n 'nrrule\.pages\.dev|cloudflare-proxy\.lucking' public
```

第二条针对新生成物检查运行时引用。产物中的上游链接是否迁移由对应来源决定，不对全仓做盲目字符串替换。源码保留 [LICENSE](LICENSE) 和 README 中的 AGPL-3.0、SukkaW/Surge attribution。

## 7. 在自己的账号中接入发布

本节是迁移者的操作步骤，本次没有创建云资源、设置 Secrets、推送分支或部署。启用自动发布前，先完成第 6 节并审查目标。

### 7.1 创建两个仓库并准备权限

1. 在自己的账号中 fork/import 源码仓，先暂停主发布 workflow，避免推送 `main` 自动发布。
2. 创建独立的公开产物仓，初始化 `main`（例如建一个 README commit）。不要把业务源码放在产物仓，发布脚本会替换目录并清理不在发布结构中的顶层目录。
3. 修改所有旧仓库引用。当前补齐与 diff 使用无认证的公开 clone；仅设置 `GITHUB_TOKEN` 环境变量不会自动使这些 URL 获得私有仓访问权。私有产物仓需要额外设计认证，不属于原样迁移路径。
4. 为源码仓配置下表 Secrets。令牌只授予需要的仓库/账号，使用 GitHub UI 或安全的密钥输入方式，不把值写进 Git。
5. 源码仓需要允许所用 Actions。若启用 Dependabot auto-merge，还需启用仓库 auto-merge、相应机器人权限，并设置必需检查 `Build`；workflow 注释本身不会创建分支保护。

| Secret 名称             | 用途 / 权限                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | 自己账号的 Pages 发布令牌，Account → Cloudflare Pages → Edit                             |
| `CLOUDFLARE_ACCOUNT_ID` | Pages 项目所在账号 ID，按 workflow 当前形式放在 Secret 中                                |
| `GIT_USER`              | 产物推送身份 / Git commit name                                                           |
| `GIT_EMAIL`             | 产物 Git commit email                                                                    |
| `GIT_TOKEN`             | 跨仓库推送令牌，需目标产物仓 Contents 写权限；若保留 archive/unarchive，还需仓库管理权限 |
| `GITHUB_TOKEN`          | Actions 自动提供，无需复制原维护者令牌；用于 Release 读取、健康状态/Issue 和自动合并     |

现有部署脚本会先尝试 unarchive，结束后再 archive 产物仓。这两步允许失败，因此部署成功并不证明最终归档成功。新部署若不需要归档，可在自己的 workflow 中去掉这两步，并缩小 `GIT_TOKEN` 权限。不要归档源码仓。

### 7.2 Cloudflare Pages

使用 Direct Upload 项目接收 GitHub Actions 构建好的目录，不需要 Pages 再执行 `pnpm build`。可由 Wrangler 创建空项目：

```bash
pnpm dlx wrangler@4.114.0 login
pnpm dlx wrangler@4.114.0 whoami
# 确认账号无误，将下值改为自己的项目名后再创建
PAGES_PROJECT_NAME=your-rules
pnpm dlx wrangler@4.114.0 pages project create "$PAGES_PROJECT_NAME" --production-branch=main
```

`whoami` 用于确认当前登录账号；有多个账号时需明确选择目标账号，不能沿用不明身份。创建命令要求显式项目名，生产分支设为 `main`。记录实际分配的 Pages 域名，然后更新第 6 节中的脚本基址。Direct Upload 与 Git integration 的选择和创建方法见 [Cloudflare 官方说明](https://developers.cloudflare.com/pages/get-started/direct-upload/)；令牌权限与 GitHub Secrets 设置见 [CI 发布说明](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)。

workflow 的实际命令是 `pages deploy public --project-name=nrrule --commit-dirty=true --branch=main`，只修改项目名还不够，生成物内的脚本 URL 也必须迁移。需要自定义域名时先在 Pages 中配置并确认解析与 HTTPS，再切换订阅链接。

### 7.3 首次上线顺序

1. 完成本地规则构建及必要的转换、合并和镜像验证。全新产物仓没有旧文件可供 fallback，`merge-modules` 单独运行无法凭空产生转换模块。
2. 配好自己的产物仓、Pages 项目、Secrets、脚本 URL 和可选 Worker。若仍无法生成默认选中的模块，先解决来源或明确调整自己配置，不能宣称完整迁移。
3. 使用 PR 或手动 `task=build` 检查规则构建。PR 的生产对比 job 需要产物仓可以 clone；初始 README-only 仓库可用于启动，但还没有完整基线。
4. 准备正式发布时，在自己的 `main` 手动选择 `task=all` 和所需 `deploy_target`。选择 `all` 部署到两个目标；也可先选 `cloudflare`，检查站点后再执行一次 `all`/`github`。后一次会重新构建，不保证上游字节完全相同。
5. 检查两个部署 job 的结果，读取自己的 `status.json`，抽查四平台规则、合并模块及其 `script-path`，确认脚本 URL 返回实际 JS 而非 HTML/404，再让客户端导入。两个发布目标独立，可能一个成功、另一个失败。

`pnpm run deploy` 只构建并打印提示，不执行远端部署。workflow 的手动 `task=deploy` 会在本次运行重新构建、验收并发布，不复用上一轮 artifact；新的构建可能取得不同的上游内容，见下一节。

## 8. GitHub Actions 的真实行为

以 [main.yml](.github/workflows/main.yml) 的 `prepare` 输出、各 job 的 `if` 和 `needs` 为准，不只看注释。

| 触发 / 手动 task       | 转换 | 合并 | 镜像 | Build | 发布                     |
| ---------------------- | ---- | ---- | ---- | ----- | ------------------------ |
| push `main` / `master` | 是   | 是   | 是   | 是    | 仅 `main` 可发布         |
| pull_request           | 否   | 否   | 否   | 是    | 否；另做产物 diff        |
| 手动 `all`             | 是   | 是   | 是   | 是    | `main`，按 deploy_target |
| 手动 `build`           | 否   | 否   | 否   | 是    | 否                       |
| 手动 `convert-plugins` | 是   | 否   | 否   | 否    | 否，只有转换 artifact    |
| 手动 `merge-modules`   | 否   | 是   | 否   | 否    | 否，尝试读取已有转换产物 |
| 手动 `mirror-sync`     | 否   | 否   | 是   | 是    | 否                       |
| 手动 `deploy`          | 否   | 否   | 否   | 是    | `main`，按 deploy_target |

`prepare` 在本次运行计算 `tasks` 任务计划；镜像步骤属于 Build job，因此手动镜像会执行构建但不会发布。手动部署先完成本次 Build 的测试、Knip、构建和成功标记检查，再交给选定发布 job。任务计划映射可由仓库测试验证，但新账号中的真实 Actions、Cloudflare 和 Git 发布仍须单独验证。

定时规则采用 UTC：`0 5,17 * * *` 执行完整流程；`0 */4 * * *` 规则构建与发布；`0 6,14,22 * * *` 镜像、规则构建与发布；`30 7,19 * * *` 转换、合并、规则构建与发布。新仓还需确认 Actions 定时运行已启用。相同 workflow/ref 共用并发组，仅新 push 可以取消在途运行；schedule 和 workflow_dispatch 排队，不能抢占正在发布的完整构建。GitHub 默认只保留一个 pending run，后续排队事件可能替换尚未开始的 pending run，不应把取消状态误认为代码失败。

job 顺序为 `prepare → convert-plugins → merge-modules → build → 两个 deploy job`，转换或合并可按条件跳过。Build 依次运行 `validate`、测试、Knip，再处理镜像、artifact、缺失目录补齐、主构建与成功标记检查。PR 通过不证明插件转换、模块合并或部署可用。

部署和 PR 差异比较条件必须显式包含 `!cancelled()`，同时要求本轮 Build 成功，并保留任务、分支和目标限制。快速更新、镜像更新、手动 `deploy` 和 PR 会按计划跳过转换或合并；缺少状态函数时，GitHub 隐式添加的 `success()` 会使下游 job 继续跳过，即使 Build 已成功。因此验收增量发布必须查看两个 deploy job，不能仅凭 workflow 整体 success 判断已更新线上。参见 [GitHub 状态条件](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions#status-check-functions)。

需要特别区分：

- 插件 job 最多重试两次，最终非零退出会使 job 失败；显式按合并配置校验本轮必需输入，非必需失败另存报告并发 warning。只上传非空转换产物，不再上传 marker 冒充转换成功。模块合并进一步严格检查默认选中的输入。
- 本轮要求插件转换时，合并禁止从旧产物仓补齐转换模块。单独运行合并且转换目录完全没有 `.sgmodule` 时，才允许读取产物仓；已有一部分文件但缺少其他必需文件时，不会自动逐个补齐。
- Build 按顶层目录缺失/为空补齐旧产物，不校验整个目录是否完整。因此一个非空目录可能仍缺少必要文件。
- `.cache` 是可重建缓存，不是完整 `public` 备份。缓存采用 runner OS 与日期/run ID key；插件、模块、Build artifacts 仅保留 1 天，应另外保存上线快照。
- Pages 上传本次 artifact 的整份 `public`。Git 产物部署则替换选中的非空目录、保留缺失/空目录、复制根文件，并清理发布名单之外的顶层目录。它不是逐文件补丁更新，也不保证两个目标内容在部分构建时天然一致。

[check-source-domain.yml](.github/workflows/check-source-domain.yml) 每日 `03:17 UTC` 检查；定时运行维护 `source-health-state` 分支和三次连续失败告警。手动运行只生成报告和退出状态，不更新持久状态或 Issue。其权限是 `contents: write`、`issues: write`；保留该功能时需允许专用状态分支被 workflow 强制更新，并确认新账号可使用 `ubuntu-24.04-arm` runner。健康报告保留 14 天，不能用健康报告替代 Build 验收。

## 9. 故障排查与回滚

| 现象                     | 检查 / 处理                                                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Node / native ABI 错误   | 确认 `node --version` 为 26.x；在正确 runtime 下重装依赖，必要时 `pnpm rebuild better-sqlite3`；不要改锁文件规避                        |
| 首次测试 `SQLITE_BUSY`   | 确认使用当前 `pnpm test` 脚本，它以 `--test-concurrency=1` 串行运行测试文件，避免并发初始化共享 SQLite 缓存；不要把重跑通过当作首次通过 |
| `--frozen-lockfile` 失败 | 核对源码和 lock 是否来自同一 commit，pnpm 是否匹配；保留日志，不能把重新解析依赖当作等价复现                                            |
| 上游 403、404、超时      | 看具体 URL、状态、UA、直连/Worker 路径；限流等待恢复，授权问题修正权限，404 修正来源；不要无限重跑                                      |
| GitHub Release 限流      | 使用已授权的 `GITHUB_TOKEN` 或等重置；fmz200 独立脚本不读该变量，须等其无认证额度恢复或另行改造                                         |
| Script-Hub 连接失败      | 检查容器、9101 健康响应、`CI` 是否错误设置、容器出站网络；不能只检查主机浏览器                                                          |
| 合并缺文件 / 未定义参数  | 对照 YAML 与 Converted 目录；先修转换依赖，再 dry-run。检查 Header/key 与模板，不用空文件占位                                           |
| `PUBLIC_DIR` 后输出分散  | 使用默认 `public` 加独立克隆；当前代码不支持所有流程统一重定向                                                                          |
| 有 index 但构建失败      | 检查退出码与 `.BUILD_FINISHED`，主构建可能继续产出部分文件。旧 `status.json` 也不能独立证明本次成功                                     |
| 手动镜像/部署任务跳过    | 检查 `prepare.outputs.tasks`、Build job 的条件和结果、分支及 `deploy_target`；`deploy` 必须有本次 Build artifact                        |
| Pages 成功、脚本仍404    | 检查 `SCRIPT_MIRROR_LOCATION`，核对 artifact 的 Scripts 与实际 script-path                                                              |
| macOS 解压 artifact 报 `file exists` | fmz200 镜像同时包含 `WIFI万能钥匙.sgmodule` 和 `WiFi万能钥匙.sgmodule`。默认不区分大小写的文件系统无法完整保存两者；完整镜像使用 Linux 或区分大小写的卷，仅核验模块时可选择性解压 `Modules/`、`Scripts/` |
| Git 发布被拒绝           | 检查产物仓是否初始化 main、是否归档、令牌跨仓权限及分支保护；不要为排错 force-push                                                      |

上线前保存源码 commit、产物仓 commit、Pages deployment ID 和完整 artifact。失败时先停用自动发布，防止回滚后又被定时运行覆盖。

- **本地产物**：使用新的干净克隆重新执行；如需清理，只处理确认属于该验证目录的生成物，保留日志，不删除用户工作区。
- **源码**：在新分支 revert 问题提交，跑检查后按正常审核流程合并。只回滚源码不能还原实时上游字节。
- **产物仓**：从已知成功 commit 恢复文件树，创建新的恢复 commit 并按仓库策略推送。保留原历史，避免 reset 后 force-push；如果仓库已归档，先由有权限的人取消归档。
- **Pages**：在项目 Deployments 中选已成功的 production deployment，执行 “Rollback to this deployment”。Preview 不可作为该操作的回滚目标，见 [官方回滚说明](https://developers.cloudflare.com/pages/configuration/rollbacks/)。Pages 回滚不会同步恢复 Git 产物仓。
- **客户端切换**：新旧服务并行验证，确认新订阅与脚本地址可用再替换客户端配置；出错时恢复已保存的旧订阅。该客户端验收由接管者完成。

## 10. 本次隔离验收记录

这组历史验证的基线为 `01d348314f41f471390b804d235e4437f7311971`，使用 macOS、Node `26.8.1`、pnpm `10.15.0`。从已同步远端的干净源码通过 `git clone --no-local --no-hardlinks` 创建 `/tmp/mirrrule-migration-20260929`，未复制旧 `node_modules`、`.cache` 或 `public`。pnpm 使用本机共享包 store，因此这证明的是干净项目安装，不是离线或全新系统安装。下列 131 项测试数字仅属于该历史基线；当前工作分支的验收另见后文。

| 命令 / 项目                                                        | 结果                                                                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                   | 退出 0；原生依赖可加载，锁文件未变                                                                                  |
| `pnpm run validate`                                                | 退出 0；ESLint 0 errors、118 个既有 warnings；typecheck 通过                                                        |
| `pnpm test`                                                        | 退出 0；131 tests / 44 suites 全部通过                                                                              |
| `pnpm run knip`                                                    | 退出 0；12 条配置建议，无失败                                                                                       |
| `pnpm run build`                                                   | 退出 0；9 个普通规则组、29 个普通源文件、16 组合并规则处理完成，生成四平台规则、4 份 GeoIP、网页、status 和成功标记 |
| 空输入 `merge-modules --dry-run`                                   | 预期退出 1，缺少转换模块时不发布                                                                                    |
| 复用固定快照后 `merge-modules --dry-run`、`pnpm run merge-modules` | 均退出 0；47 个模块、145 个 sections、277 个去重 hostnames，生成 sgmodule 与 rulelist                               |
| `pnpm run build-web`                                               | 合并和镜像尝试结束后退出 0，索引反映当前实际文件；不表示失败的镜像已补齐                                            |
| 产物检查与本地 HTTP                                                | 45 个文件/规则平台，4 份 GeoIP；成功标记存在，两个 JSON 可解析；首页、status、reject 规则 HTTP 200 且与磁盘内容一致 |
| `pnpm run sync-mirrors`                                            | 退出 1；部分文件成功，BiliUniverse 3 个仓库遇到 GitHub API 限流，未认定完整通过                                     |
| `pnpm run node Build/download-mock-modules.ts`                     | 退出 0；41 个文件同步成功                                                                                           |
| `pnpm run download-fmz200-split`                                   | 退出 1；3 个根模块成功，split 目录阶段失败，未认定完整通过                                                          |
| Docker / Script-Hub / 全量插件转换                                 | 当前环境无 Docker 命令，未执行；需在具备 Docker 和上游访问条件的新环境验证                                          |
| Cloudflare / Git 产物仓发布                                        | 仅核对源码与官方配置说明，未创建资源、注入 Secrets 或发布                                                           |

模块合并的正向验证使用原产物仓 `lucking7/NRRule` 的固定快照 `42a8067d7adfaba73d523e92db8fa8dff06b7041`，只读取 `Modules/Converted` 和 `Scripts`，未推送原仓库。输入为 272 份已转换模块、175 个脚本文件，按默认配置选中其中 47 个模块。不能将复用旧产物写成全新插件转换成功。

fmz200 日志只暴露 split 阶段失败，没有输出底层 HTTP 状态，不能直接归因为限流。下次应在网络可用时单独验证目录 API 和该步骤；如仍失败，保留具体响应后定位。Release 镜像日志则明确报告 BiliUniverse/Redirect、Enhanced、ADBlock 的 API 限流，待额度恢复或配置已授权令牌后再验收。

本次原始日志位于 `/tmp/mirrrule-migration-{clean-install,validate,test,knip,build,merge-empty,mirrors,mock,fmz,merge-dry,merge,web}.log`，是交付机器上的临时证据，不是读者必须存在的路径。迁移者应在自己的运行中重新保存日志和版本号。

文档的本地链接、8 个 shell 示例语法和 MIGRATION.md 的 Prettier 检查通过；Wrangler 4.114.0 的创建参数已通过 `pages project create --help` 核对，未执行创建。

接管完成前仍需在新账号验证：Script-Hub 完整转换、限流解除后的完整镜像、新域名与所有脚本 URL、两个发布目标和真实客户端导入。上述未验证项不会被本文的本地测试结果替代。

## 11. 已完成架构整理分支的隔离验收

被验收源码提交为 `4f058204e7c96250c735b080fb8f731d412fb36b`，分支 `work/simplify-mirrrule-pipeline`。在 macOS 上使用 Node `26.8.1`、pnpm `10.15.0`，从本机仓库克隆到 `/tmp/mirrrule-goal-release.v8zq8v/repo`。该目录没有继承旧 `node_modules`、`.cache` 或 `public`，但仍复用本机 pnpm 包 store；没有验证全新操作系统或离线安装。以下命令按顺序执行，每一步退出码均为 0：

```bash
git clone --no-local --no-hardlinks --branch work/simplify-mirrrule-pipeline /Users/luck/MirrRule /tmp/mirrrule-goal-release.v8zq8v/repo
cd /tmp/mirrrule-goal-release.v8zq8v/repo
mise exec node@26 -- pnpm install --frozen-lockfile
mise exec node@26 -- pnpm run validate
mise exec node@26 -- pnpm test
mise exec node@26 -- pnpm run knip
mise exec node@26 -- pnpm run build
```

`mise` 是本机已有的 Node 运行时管理器。其他环境按第 3 节启用 Node 26 后直接运行同一组 `pnpm` 命令。

| 验收项           | 实际结果                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 锁文件安装       | 退出 0，未改锁文件；原生依赖可运行                                                                                                   |
| `validate`       | 退出 0；ESLint 0 errors、111 warnings；typecheck 通过                                                                                |
| 首次 `pnpm test` | 退出 0；139 tests / 44 suites，139 pass、0 fail                                                                                      |
| `knip`           | 退出 0，无未使用项或配置提示                                                                                                         |
| `build`          | 退出 0；普通规则源处理 `29 files, 0 errors`，四个平台各生成 45 份规则文件，下载 4 份 GeoIP                                           |
| 产物检查         | `.BUILD_FINISHED`、首页、`_headers`、GeoIP 与三平台 reject 文件非空；`status.json`、`sing-box/reject.json` 可解析；`public` 约 57 MB |

产物检查采用第 3 节列出的 `test -s` 和 JSON 解析命令，另统计 `public/{List,Clash,Loon,sing-box}` 每目录 45 个文件、`public/GeoIP` 4 个文件。克隆后的 Git 工作区保持干净。原始日志位于 `/tmp/mirrrule-goal-release.v8zq8v/{install,validate,test,knip,build}.log`；这些临时路径不是仓库交付物。

验收过程中曾在上一源码提交 `f8d4634` 的另一个干净克隆首次运行并行版 `pnpm test`，多个进程同时初始化 SQLite 缓存，出现 `SQLITE_BUSY` 并退出 1；重跑通过不能消除首次失败。随后测试脚本改为 `--test-concurrency=1`，独立新克隆首次运行 139/139 通过，以上最终克隆的首次 `pnpm test` 也 139/139 通过。本节仅将最终克隆的结果记为当前源码验收。

本节只验证本地安装、检查、测试、Knip、规则构建和产物结构。没有在新账号执行完整 Script-Hub 插件转换、解除限流后的全部镜像、真实 GitHub Actions runner、Cloudflare Pages 上传、产物仓推送或新域名及客户端导入。接管者应按第 5 至 8 节替换账号、仓库、域名和 Secrets，在自己的环境逐项验证并保存运行记录；本次没有发布到生产。

## 12. 后续规则来源迁移

2026-10-01 的 blackmatrix7 + Meta 服务合并、CDN 来源替换与地域测速 gateway 接入，详见 [RULE_SOURCES.md](RULE_SOURCES.md)。该文记录本次独立验收，不沿用第 10、11 节的历史测试数字；模块转换、生产发布和新账号部署仍需分别核对。

2026-10-01 后续补充了 13 个 Sukka 独立订阅，包括 Apple Intelligence、游戏下载、六个地区流媒体、钓鱼拦截、国内 CDN、GitLab、搜狗输入法和 CloudMounter。来源、输出路径和策略建议见 [Sukka 补充分类](RULE_SOURCES.md#sukka-补充分类)。CloudMounter 仅生成 Surge 输出，部署后再在客户端配置订阅；规则构建不修改现有客户端策略。

2026-10-02 补齐聚合：总 `stream` 合并全部六个地域的域名与 IP 来源，允许有效下载但清理后为空的来源；`reject_extra` 合并钓鱼集合，基础 `reject` 不变。独立订阅保留。聚合范围、来源失败行为、其他分类的覆盖关系和本轮验收见 [同类规则的聚合归属](RULE_SOURCES.md#同类规则的聚合归属)，旧验收条数不能代替本轮结果。

## 13. 2026-10-03 插件转换修复验收

此前 main 的 Actions 虽然显示成功，实际插件列表下载失败、转换数量为 0，上传物只有 marker；合并阶段读取旧产物完成了 47 项合并。这不能作为新转换成功的证据。本次参考 [TutuBetterRules](https://github.com/bunizao/TutuBetterRules) 的下载与转换分离方式，使用 runner 校验插件正文和依赖、host-network Script-Hub 转换，再检查真实产物。固定镜像与受限兼容补丁同时解决原生 Loon v2 Action、捕获组、正则字面量和 mock 响应问题。

修复源码 `77306e16f1e1dc1bea82d256e92a0e2aa8912b66` 的 [完整分支验收 37083775680](https://github.com/lucking7/MirrRule/actions/runs/37083775680) 为 success，安装、lint/typecheck、220 项 Node tests、14 项 Python gateway tests、Knip、镜像同步、插件转换、47 项模块合并和主规则构建通过。两个 deploy job 因分支条件 skipped，该 run 没有发布生产。后续收尾只补录本文、客户端范围与 DNS 错误文字；DNS 拒绝路径又经过 6 项定向测试。

| 核对项 | 本轮观察结果 |
|---|---|
| Conversion report | 276 项，273 ready、0 degraded、3 failed；required ready=47 |
| 本轮插件 artifact | 273 个 `.sgmodule`、188 个 `.js`，没有 metadata-only 模块或缺失的自有脚本引用 |
| 合并 artifact | 273 个 Converted 模块、1 个 All-in-One-Pro、189 个脚本；历史补回不计入 fresh report |
| 哔哩哔哩转换 | 4 条 Script、11 条 Body Rewrite、1 条 Header Rewrite、8 条 Map Local |
| 哔哩哔哩独立合并 | 用本轮输入在临时配置中单独合并，以上四类条数不变，pattern 均保留；它不在默认 47 项集合中 |
| fmz200 原生模块 | 2993 条 Rule、1 条 Header Rewrite、528 条 URL Rewrite、104 条 Body Rewrite、837 条 Map Local、255 条活动 Script；与下载的原生源逐节条数一致 |
| 小桔文件模拟响应 | 生成约 1.77 MB 模块，内联 JavaScript 的 `Error:`/`error:` 字符串不会再触发服务错误误判 |
| 当前规则来源 | [健康检查 37083860431](https://github.com/lucking7/MirrRule/actions/runs/37083860431) 为 success，116/116 OK；这不是所有插件依赖健康的替代证明 |

三个失败项不能宣称可用：`Prevent_DNS_Leaks` 使用不受 Surge module Rule 支持的 Loon `PROXY` 策略，应改为独立规则集并在主配置指定策略；`EasyBike_remove_ads` 的 `mobileconfig-gateway.js`、`Tencent_Video_remove_ads` 的 `replace-body.js` 上游返回 404，需上游恢复或选择经过内容与功能验收的替代脚本后重跑。腾讯视频在默认合并配置中仍禁用。它们均不属于本轮默认启用的 47 项。旧的 DNS 空模块也不会补回。

本机使用 `mise exec node@26 -- pnpm run validate`、`mise exec node@26 -- pnpm test`、`mise exec node@26 -- pnpm run knip` 和 `python -B Build/__tests__/browser-rule-gateway.test.py` 验收；完整上游 Parser 的 VM 检查共 34/34，包括真实失败插件及 Script 捕获绑定负例。本机没有 Docker，Docker 网络与完整转换的证据来自上述真实 GitHub runner，不能混写成本机容器验收。临时日志为 `/tmp/mirrrule-plugin-final-{validate6,tests6,knip6}.log`、`/tmp/mirrrule-plugin-final-python.log`、`/tmp/mirrrule-combined-native-strict-tests4.log`；下载及核对结果在 `/tmp/mirrrule-plugin-feature-native/`。这些路径不是迁移者的前置条件，重现时应按第 5、8 节保存自己的报告和产物。

以上使用现有维护账号。新账号的 Secrets、仓库权限、Cloudflare Pages 和域名仍需重新验证；未进行真实客户端导入、广告行为或地区解锁实测。fmz200 原生输入的 iOS 限制保持上游设置。生产发布应另外核对对应 main run 与公开文件，不能用分支成功代替发布成功。

### main 发布复核（2026-10-03）

源码 `fcff1e654a7390158c493e6dfb1e8339b813c47d` 的 [main Actions 37084950772](https://github.com/lucking7/MirrRule/actions/runs/37084950772) 为 success，转换、合并、Build、GitHub 发布与 Cloudflare Pages 发布全部通过。集成后的 Node tests 为 230/230，Python gateway tests 为 14/14；转换仍为 273 ready、3 failed，默认合并的 47 项全部为本次新输入。定时任务此前会取消正在发布的 push run，本次已改为仅新 push 取消旧 run，定时和手动任务按同一 concurrency group 排队。

产物仓固定提交为 [`9a62b995aec42e68751e68fed37b259dfa8caa34`](https://github.com/lucking7/NRRule/commit/9a62b995aec42e68751e68fed37b259dfa8caa34)，提交消息对应上述源码；Pages deployment 为 [`8558f669`](https://8558f669.nrrule.pages.dev)。通过 `gh run view 37084950772 --repo lucking7/MirrRule --log` 保存日志，下载报告、插件、合并和完整构建 artifacts 后核对产物。完整构建中的 `Modules/`、`Scripts/` 与合并 artifact 逐文件一致。公开访问核验覆盖其中全部 464 个文件（274 个模块、1 个规则附件、189 个脚本），内容与固定产物提交及本次构建逐字节一致；首轮 461 项通过，3 项网络超时经单独重试后通过。另有 55 项公开规则与页面核验通过，覆盖地域 stream、Netflix、Disney、测速、拦截规则、四平台格式、CloudMounter 和合并模块。

本机完整解压构建包遇到上表所列的大小写文件名冲突，随后通过 Python `zipfile` 选择性提取 `Modules/`、`Scripts/` 完成核验，未将完整 macOS 解压记为通过。证据保存在交付机 `/tmp/mirrrule-plugin-main-release/` 及 `/tmp/mirrrule-plugin-main-release-all.log`，迁移者应在自己的账号重新保存上述 run、artifact、固定提交及公开访问结果。该记录只证明现有账号的生成与发布流程，仍不替代新账号部署或真实客户端功能验收。

### 发布收尾复核（2026-10-04）

[PR #399](https://github.com/lucking7/MirrRule/pull/399) 已合并到 main，发布源码为 `71f810afdb40de0b2759db278cc7920896a29ab9`。此前增量任务跳过 Convert/Merge 后，GitHub Actions 的默认状态条件会连带跳过后续发布。本次已为 PR diff 和两个 deploy job 显式设置 `!cancelled()`，同时保留 Build 成功、分支、任务和发布目标限制。以下三条路径均有真实 runner 结果：

| 路径 | Actions | 实际结果 |
|---|---|---|
| PR 增量检查 | [37186920966](https://github.com/lucking7/MirrRule/actions/runs/37186920966) | Convert/Merge 按计划跳过；Build 和 Diff Build Output 成功；生产发布因非 main 跳过 |
| main 完整发布 | [37187058705](https://github.com/lucking7/MirrRule/actions/runs/37187058705) | Convert、Merge、Build、GitHub 和 Cloudflare Pages 发布全部成功 |
| main 手动增量发布 | [37187389125](https://github.com/lucking7/MirrRule/actions/runs/37187389125) | `task=deploy`、`target=all`；Convert/Merge 按计划跳过，Build 和两个发布目标全部成功 |

完整发布的 Node tests 为 230/230，Python gateway tests 为 14/14，lint/typecheck 与 Knip 通过。转换报告为 276 项中的 273 ready、0 degraded、3 failed；默认合并所需 47 项全部为本轮新输入。合并 artifact 含 274 个模块、189 个脚本，自有脚本引用没有缺失。增量发布复用既有模块输入，不能记作再次完成全量转换。

当前生产产物仓固定提交为 [`7897d04cb556d3349d880cce1527b12a39bea868`](https://github.com/lucking7/NRRule/commit/7897d04cb556d3349d880cce1527b12a39bea868)，Pages deployment 为 [`86cea544`](https://86cea544.nrrule.pages.dev)。2026-10-04 16:20 至 16:23（Asia/Shanghai）复核时，生产 `status.json` 对应源码 `71f810a`，构建时间为 `2026-10-04T07:59:54.325Z`，记录 58 个 ruleset。在线抽查 10 项全部返回 200，且与固定产物提交逐字节一致，覆盖 `status.json`、首页、All-in-One-Pro、一个自有脚本、`stream_hk` 四平台格式、Netflix 和 Disney。该抽查不代表本轮再次遍历所有公开文件，也不代表客户端广告行为或地区解锁实测。

重新执行的 [来源健康检查 37188652141](https://github.com/lucking7/MirrRule/actions/runs/37188652141) 为 success，下载的 `source-health-report` 显示 116 ok、0 dead、0 unknown。手动运行只检查来源并上传报告，定时任务专用的 durable state 和 issue 管理步骤按配置跳过。此结果不包含所有插件脚本依赖的健康保证，不能覆盖上述三个可选插件的失败。

复核命令为：

```bash
gh run view 37187058705 --repo lucking7/MirrRule --log
gh run view 37187389125 --repo lucking7/MirrRule --log
gh workflow run check-source-domain.yml --repo lucking7/MirrRule --ref main
gh run view 37188652141 --repo lucking7/MirrRule --log
gh run download 37188652141 --repo lucking7/MirrRule --name source-health-report
```

本次报告与公开抽查结果保存在交付机 `/tmp/mirrrule-closeout-20261004/`，完整发布和增量发布证据在 `/tmp/mirrrule-session-followup-20261004/`，均为临时证据。后续回滚应按第 9 节分别恢复源码、产物仓和 Pages，上述源码提交、产物提交与 deployment 可作为已验证基线。收尾仅补录文档，使用 `[skip ci]` 提交，不重新构建或发布；文档提交不应冒充已部署源码。

当前没有新的生产发布阻塞。三个可选插件仍需上游恢复或经功能验收的替代方案；真实客户端导入、广告行为、地区解锁和新账号迁移尚未验证。现有 11 个 Dependabot PR 属于独立依赖维护，需基于最新 main 重新检查，不纳入本次收尾合并。
