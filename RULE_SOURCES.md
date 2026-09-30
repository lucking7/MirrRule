# 规则源迁移与验证

核对日期：2026-10-01。本次调整针对规则下载与四平台格式转换，保留现有订阅文件名。功能分支的构建验收不代表生产发布或客户端实测，也不代表插件、模块转换恢复。

## 服务规则

配置在 [rule-sources.ts](Build/lib/rule-sources.ts)。blackmatrix7 使用 `master/rule/Surge/<分类>/<分类>.list`；MetaCubeX 使用 `meta/geo/geosite/<分类>.list`。这些是互补来源，合并后去重，任一必需来源下载失败会阻止该 ruleset 发布，不是互相替代的 fallback。

| 输出 basename | blackmatrix7 分类 | Meta geosite | 额外来源                                        |
| ------------- | ----------------- | ------------ | ----------------------------------------------- |
| netflix       | Netflix           | netflix      | Meta `meta/geo/geoip/netflix.list`              |
| disney        | Disney            | disney       | 无                                              |
| spotify       | Spotify           | spotify      | 无                                              |
| primevideo    | AmazonPrimeVideo  | primevideo   | 无                                              |
| youtube       | YouTube           | youtube      | 无                                              |
| bilibili      | BiliBili          | bilibili     | 无                                              |
| tiktok        | TikTok            | tiktok       | 无                                              |
| wechat        | WeChat            | 无           | Meta 没有专用 WeChat 分类，不引入更宽的 Tencent |
| google        | Google            | google       | 不合并范围更宽的 Google geoip                   |
| github        | GitHub            | github       | 无                                              |

AI 保留 Sukka、ConnersHua、dler 来源，用 blackmatrix7 `OpenAI` 替换 Kelee AI，并使用 Meta `category-ai-!cn.list` 文本输入，补充 Sukka `List/ip/ai.conf`。PrimeVideo 不使用整个 Amazon 分类。上述分类与 Kelee 的覆盖范围不完全相同，尤其 WeChat 的 keyword 与 IPv6、不同来源的分类粒度可能影响客户端分流，迁移者应实测自己的应用。

Surge 与 Loon 保留 `.list`，Clash 输出 classical `.txt`，sing-box 输出 `.json`。转换先处理 `DOMAIN`、`DOMAIN-SUFFIX` 等标准规则，再把裸域名、`+.`、`full:`、`domain:`、`keyword:` 与裸 IPv4/IPv6 CIDR 转成内部规则。数字开头的合法域名（如 `2mdn.net`）不再误删；CIDR 必须通过现有 IP validator。纯数字、无前缀 IP、超出范围的 CIDR 会被丢弃。服务规则移除上游 policy，IP 类添加 `no-resolve`。平台不支持的规则按既有 writer 行为丢弃，不能认为四个平台语义完全相同。

不读取二进制 `.mrs`、`.srs`。这次绕开旧 sing-box JSON 输入路径，没有修复其所有字段解析能力，也没有改变既有平台支持矩阵。

## CDN、Download 与 Speedtest

| 用途                                         | 采用来源                                           | 选择依据与限制                                                                                 |
| -------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `download_cn`                                | Repcz/Tool `X/Surge/Rules/DownloadCDN_CN.list`     | 与本次取得的 Kelee 中国下载 CDN 去注释、去空白后集合相同，17 条                                |
| `download_global`                            | Repcz/Tool `X/Surge/Rules/DownloadCDN_Global.list` | 与本次取得的 Kelee 国际下载 CDN 集合相同，178 条唯一规则；含 2 条 AND，sing-box 按既有行为丢弃 |
| `cdn`                                        | Sukka domainset + non_ip + ip CDN                  | 已有聚合源，继续使用；Repcz 通用 CDN 与其高度重叠，暂不叠加                                    |
| `download`                                   | Sukka domainset + non_ip + ip Download             | 补齐 IP 部分；此分类不限于游戏或单个测速服务                                                   |
| `speedtest`                                  | Sukka domainset Speedtest                          | 已有全球测速集合，继续使用                                                                     |
| `speedtest_china`、`speedtest_international` | Kelee SpeedtestChina、SpeedtestInternational       | 保留地域语义，CI 通过下述 browser gateway 下载                                                 |

调查过 blackmatrix7 Download、Speedtest，Meta `category-cdn-cn`、`category-cdn-!cn`、游戏下载与 Speedtest，以及 Moli-X 镜像。blackmatrix7 Download 包含进程名等应用规则，不等价于下载 CDN；Meta 游戏下载不覆盖全部软件与对象存储；全球 Speedtest 集合不能直接替换中国/国际两个文件。Moli-X 下载 CDN 样本与 Repcz 相同，本次选用许可证与来源更明确的 Repcz。UsbEAm 备份是 hosts 编辑器 XML，没有当作 Surge ruleset 导入。

本次实际下载为 HTTP 200 的其他候选（样本条数只表示覆盖规模，不是质量排序）：

| 候选         | 已验证路径                                                          | 样本与处理决定                                                                   |
| ------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| blackmatrix7 | `rule/Surge/Speedtest/Speedtest.list`                               | 9 条通用规则；包含 UA，不能等价替换两个地域列表                                  |
| Meta `meta`  | `geo/geosite/category-speedtest.list`、`category-speedtest@cn.list` | 76、17 条；原始文本可经现有转换，classical 版本含不支持的 DOMAIN-REGEX，暂不导入 |
| Meta `meta`  | `geo/geosite/category-cdn-!cn.list`、`category-cdn-cn.list`         | 195、93 条，小型地域分类，不能与完整下载 CDN 等同                                |
| Sukka        | `List/domainset/speedtest.conf`                                     | 3408 条全球 endpoint；本项目已有使用                                             |
| Repcz        | `Surge/Rules/CDN.list`                                              | 4756 条，与 Sukka 高度重叠，暂不另加                                             |

SukkaW/Surge 的源码生成 domainset、non_ip、ip 等类别，发布到 ruleset.skk.moe。本项目已使用其 CDN、Download、Reject、AI、Apple、Streaming、Domestic、Telegram、LAN 等产物，继续复用这些生成结果。本次补齐 AI 与 Download 的 IP 文件，没有复制 Sukka 的整套构建器。源码和产物提交分别核对为 `4ce04be3cc548c672e3350afd47ded7089ccb7ab`、`21060773c1f3c88fbf2da211aff1a5b74236917a`。

## TutuBetterRules 的方法与本项目接入

[TutuBetterRules](https://github.com/bunizao/TutuBetterRules) 主要从 GitHub 同步 [Mirrored](https://github.com/bunizao/Mirrored) 的成品，不是直接用 Surge UA 下载 Kelee 规则。Mirrored 使用 `cloudscraper` 模拟 Chrome/Windows，通过配置的 Worker 下载，再把插件暂存到本地 HTTP 服务交给 Script-Hub。Worker 服务实现没有在这两个仓库内提供，不能据此声称复制一个 UA 就能恢复。

在本仓 GitHub runner 的受控实验中，普通 requests、Node、Surge/CFNetwork UA 对照仍返回 403；本项目自己的 Worker 配合 cloudscraper 成功下载 15/15 个规则。随后经现有 fetchAssets 与四平台 writer 生成 60 个文件并检查 JSON。实验运行：[36756620028](https://github.com/lucking7/MirrRule/actions/runs/36756620028)、[36756838931](https://github.com/lucking7/MirrRule/actions/runs/36756838931)、[36757060330](https://github.com/lucking7/MirrRule/actions/runs/36757060330)。第二轮失败是 Node 对照失败，不能记作成功构建。实验不能证明 origin 最新性，Worker 可能缓存；TLS 指纹、headers 顺序等具体原因也未单独隔离。

因此规则构建与 source-health 接入 [browser-rule-gateway.py](Build/browser-rule-gateway.py)，仅代理 Kelee 的 HTTPS `.lsr`。它固定监听 `127.0.0.1`，每请求创建独立 browser session，要求 HTTP 200、非空 UTF-8 规则正文，拒绝 HTML/JSON，限制 8 MiB，关闭 redirect 并设置超时。HEAD 健康探针在上游使用 GET 并校验正文；`/health` 仅表示本地服务已启动。它不是通用代理，不接受插件列表、插件或脚本。

使用 Python 3.11，并安装精确锁定的 [requirements](Build/browser-rule-requirements.txt)。本地直连规则源可用时不必设置 gateway；需要复现 CI 的路径时，在仓库根目录运行：

```bash
python3 -m venv .venv-browser
.venv-browser/bin/python -m pip install -r Build/browser-rule-requirements.txt
PYTHONDONTWRITEBYTECODE=1 .venv-browser/bin/python Build/__tests__/browser-rule-gateway.test.py -v
# 此处必须替换为自己控制、兼容 ?url= 的 HTTPS Worker。
.venv-browser/bin/python Build/browser-rule-gateway.py --upstream-base https://YOUR-WORKER.workers.dev
```

在另一个终端运行：

```bash
# ?url= 必须保留；仅以 / 结尾的地址会被现有 Node proxy 拼成错误路径。
PROXY_BASE='http://127.0.0.1:13193?url=' pnpm run build
PROXY_BASE='http://127.0.0.1:13193?url=' pnpm run node Build/validate-domain-alive.ts source-health-report.json
```

完成后在 gateway 终端按 Ctrl-C。可用 `BROWSER_RULE_UPSTREAM_BASE` 配置上游，`BROWSER_RULE_GATEWAY_PORT` 或 `--port` 配置端口；更换端口时同步 Node 的 `PROXY_BASE`。Node.js 也是 cloudscraper 的 JavaScript interpreter，仍需 Node 26。不要把 localhost 基址作为 gateway 的上游，会被拒绝。CI 的 Build 与 source-health 启动并清理进程，插件转换 job 仍使用原 Worker。

403/502 表示上游下载或正文验证失败，504 表示超时；`/health` 成功不能解除这个故障。检查 gateway 日志中的公开 source URL/status、Worker 可用性和新账号权限，不要仅改 UA。gateway 不提供无限重试，Node 保留原有候选、重试与缓存行为。外部防护或 Worker 失效仍可能阻塞两个地域测速文件，需要由新账号再次验收。

模块转换没有随本次规则迁移修复。此前转换运行 [36704699346](https://github.com/lucking7/MirrRule/actions/runs/36704699346) 的插件目录下载失败，新增转换数为 0；后续合并取旧产物可以成功，不能代表重新转换成功。要采用 Mirrored 的插件方案，需另行处理目录、插件、脚本预下载和 Script-Hub 的暂存输入，以及失败状态传播。

## 来源、许可证与回滚

核对的 upstream snapshot：blackmatrix7 `c9b2158695596a1ba866adcf74def8d5ab348e25`；Meta `dff97e403383374dbfe39792d3dfdcf6717e385e`；Repcz `a209e056f977bb49f11cab7c13b5393fdbbba053`。配置仍跟随对应分支更新，以上提交只标识调查样本，不是生产锁定。

[blackmatrix7](https://github.com/blackmatrix7/ios_rule_script) 声明 GPL-2.0，[MetaCubeX](https://github.com/MetaCubeX/meta-rules-dat) 声明 GPL-3.0，[SukkaW/Surge](https://github.com/SukkaW/Surge) 声明 AGPL-3.0，[Repcz/Tool](https://github.com/Repcz/Tool/tree/X) 声明 MIT。保留本项目及上游归属、许可证，分发时核对各分类的来源说明。

撤销这次源码提交可以恢复旧来源配置，但不会解除 Kelee 的下载阻塞。生产回滚应恢复经审核的旧产物快照，不要依赖从受阻来源重新构建。功能分支手动执行 `task=build` 只产生验收 artifact；本次不发布 Pages 或 NRRule。

## 本次验收

代码验收提交：`2cf8d79b6cf654e02b9d80e52d121ed0f3646445`，功能分支 `work/replace-blocked-rule-sources-20261001`。本地使用 macOS、Node `26.8.1`、pnpm `10.15.0`。在 `/Users/luck/.codex/workspaces/mirrrule-rule-migration-twmdssg8/clean-acceptance.Apt5QaO4/repo` 创建独立克隆，没有继承 `node_modules`、`.cache`、`public`，仍共享本机 pnpm store，不能称为全新操作系统或离线安装。

```bash
git clone --no-local --no-hardlinks --branch work/replace-blocked-rule-sources-20261001 /Users/luck/.codex/workspaces/mirrrule-rule-migration-twmdssg8/repo /Users/luck/.codex/workspaces/mirrrule-rule-migration-twmdssg8/clean-acceptance.Apt5QaO4/repo
cd /Users/luck/.codex/workspaces/mirrrule-rule-migration-twmdssg8/clean-acceptance.Apt5QaO4/repo
mise exec node@26 -- pnpm install --frozen-lockfile
mise exec node@26 -- pnpm run validate
mise exec node@26 -- pnpm test
mise exec node@26 -- pnpm run build
```

以上命令全部退出 0；144/144 Node tests 通过。19 个普通 ruleset 与 26 个特殊 ruleset 处理无错误，四个平台各生成 45 文件，另有 4 个 GeoIP 文件、`status.json`（45 ruleset）、索引页与 `.BUILD_FINISHED`。45 个 sing-box JSON 都成功解析。本地完整构建走直连，不能单凭此结果证明数据中心 gateway 可用。

独立 gateway 测试命令 `PYTHONDONTWRITEBYTECODE=1 mise exec node@26 -- /tmp/mirrrule-method-check.l5k77c0j/venv/bin/python Build/__tests__/browser-rule-gateway.test.py -v` 为 5/5 通过，包含真实 loopback HTTP、fake browser、无外网。另启动 gateway，通过自己的 Worker 实网 GET 两个测速文件，分别取得 551 与 613635 bytes、HTTP 200；China 的 HEAD 为 200、Content-Length 551。实网首次发现逗号后空格被正文检查误拒绝，修复后增加对应 GET/HEAD 与空 operand 回归覆盖，再重新验证成功。

GitHub runner 构建 [36763750302](https://github.com/lucking7/MirrRule/actions/runs/36763750302) 与手动健康检查 [36763787102](https://github.com/lucking7/MirrRule/actions/runs/36763787102) 均 conclusion=success。runner 安装锁定 Python 依赖，5/5 Python tests、144/144 Node tests、typecheck、lint（0 errors）与 Knip 通过。gateway 下载日志记录两个测速 source status=200；健康检查 97/97 ok，0 dead、0 unknown，两个测速经 HEAD 正文检查为 200。手动健康检查没有写状态分支或 Issue。

Build artifact 名为 `build-artifact-2cf8d79b6cf654e02b9d80e52d121ed0f3646445-6773`；ZIP 完整性检查通过；artifact 每个平台目录各有 47 个文件，其中 45 个属于本轮构建，`direct-fmz` 与 `reject-fmz` 两个文件由原产物仓保留。4 个 GeoIP、45 条 status ruleset 和全部 sing-box JSON 均再次核对，不能把 47 个文件都记为本轮新生成。插件转换、模块合并与两个部署 job 均 skipped，artifact 的模块和镜像目录由原产物仓补齐，不能声称本轮重新转换或同步过。原始 ZIP 与日志保存在上述 workspace 的 `acceptance/`；macOS 解压历史镜像中大小写近似名称可能发生冲突，核对规则时直接读取 ZIP，不把解压失败误判为规则生成失败。

三轮简化审查采纳质量建议 2 项（统一 workflow 测试 helper、修正请求路径注释），复用与效率没有修改；跳过 3 项建议（新增跨 workflow action、改写正文扫描、扩大修改 IP validator），保留现有边界。首次 runner lint 比本地多出 2 个测试 optional-chain warning，后续仅清理测试中已被断言收窄的 optional chain，没有改变构建行为。

最终代码复核提交 `392dc09abb37b80399ddbf41af91aa700d7ab439` 的 [构建 36764346571](https://github.com/lucking7/MirrRule/actions/runs/36764346571) 同样成功：144/144 Node tests、5/5 Python tests、typecheck、Knip、规则构建均通过；lint 0 errors，剩余 111 条为既有 warning。gateway 日志再次记录两个测速 source status=200。随后提交只补齐本文验收记录，不改运行代码。

未验证：生产 Pages/NRRule 发布、Surge/Loon/Clash/sing-box 客户端实际分流、应用登录与播放、模块新转换、新账号 Worker/Secrets/部署权限，以及 upstream origin 最新性。CI 使用原有 HTTP 缓存恢复策略，健康检查额外通过 gateway GET 正文验证；若需要证明每个上游都是新下载，应在独立 runner 禁用 HTTP 缓存另做验收。
