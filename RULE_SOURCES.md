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

## Sukka 补充分类

在同一功能分支新增 13 个独立订阅，沿用现有 `specialRules` 下载、去重、格式转换与发布流程，不复制 Sukka 构建器。不把新集合并入已有 `apple`、`download`、`stream`、`reject` 等聚合文件，客户端可单独选择策略。目标文件和来源如下，来源基址是 `https://ruleset.skk.moe/List/`：

| 输出 basename        | 上游路径（省略 `.conf`）            | 输出平台 | 用途与限制                                                                 |
| -------------------- | ----------------------------------- | -------- | -------------------------------------------------------------------------- |
| `apple_intelligence` | `non_ip/apple_intelligence`         | 四平台   | Apple Intelligence / Apple Relay 单独出口；与现有 Apple 或 AI 集合可能重叠 |
| `game_download`      | `domainset/game-download`           | 四平台   | Steam、Epic、暴雪、Xbox、PlayStation 等游戏下载 CDN，不含中国 CDN          |
| `stream_us`          | `non_ip/stream_us` + `ip/stream_us` | 四平台   | 北美流媒体域名和 IP                                                        |
| `stream_hk`          | `non_ip/stream_hk` + `ip/stream_hk` | 四平台   | 香港流媒体域名和 IP                                                        |
| `stream_jp`          | `non_ip/stream_jp` + `ip/stream_jp` | 四平台   | 日本流媒体域名和 IP                                                        |
| `stream_tw`          | `non_ip/stream_tw` + `ip/stream_tw` | 四平台   | 台湾流媒体域名和 IP                                                        |
| `stream_kr`          | `non_ip/stream_kr` + `ip/stream_kr` | 四平台   | 韩国流媒体域名和 IP                                                        |
| `stream_eu`          | `non_ip/stream_eu` + `ip/stream_eu` | 四平台   | 欧洲流媒体域名和 IP                                                        |
| `reject_phishing`    | `domainset/reject_phishing`         | 四平台   | 独立钓鱼网站拦截，客户端通常绑定 REJECT；不强制修改现有广告拦截集合        |
| `domestic_cdn`       | `non_ip/domestic_cdn`               | 四平台   | 境外回国场景，可在回国代理规则之前绑定 DIRECT；其内容也在 domestic 中      |
| `gitlab`             | `non_ip/gitlab`                     | 四平台   | 单独指定 GitLab 出口；可能与 global 重叠                                   |
| `sogouinput`         | `non_ip/sogouinput`                 | 四平台   | 输入法隐私拦截，通常绑定 REJECT，可能影响账号同步、词库更新和反馈          |
| `cloudmounter`       | `non_ip/cloudmounter`               | 仅 Surge | CloudMounter/RaiDrive 云盘分流，保留完整 AND 条件                          |

本次核对时，六个 `ip/stream_<region>.conf` 都只含注释与归属水印，暂无实际 CIDR。配置保留两类来源，未来上游补充 IP 时可经现有转换自动合并；本轮地域分流覆盖主要来自 non_ip，测试中的 IPv4/IPv6 样例只验证转换能力，不是实际新增地域 IP。

六个地域集合配置 `allowEmpty: true`，允许水印清理后为空的输入来源参与合并。所有来源仍须下载成功，合并后仍须至少有一条规则；如果域名来源与 IP 来源都为空则报错，保留旧产物。其他新增集合不启用空来源许可。共享清理逻辑精确识别 Sukka 当前归属水印域名，同时保留合法数字开头域名与旧水印过滤。

四平台输出为 `List/<basename>.list`、`Clash/<basename>.txt`、`Loon/<basename>.list`、`sing-box/<basename>.json`。所有新增集合清理上游策略字段，IP 规则添加 `no-resolve`；同一文件的域名和 IP 顺序由既有 writer 决定。这里的“接入”是生成可订阅产物，不会自动修改客户端配置或启用拦截。在发布到自己的服务后使用对应路径，并按需要选择出口、拦截策略及匹配顺序。此功能分支尚未发布到生产，不能假设现有 `nrrule.pages.dev` 已提供新增路径。

客户端按先匹配先执行安排订阅顺序：`game_download` 放在 `download` 前，地域 `stream_*` 放在总 `stream` 前，`apple_intelligence` 放在覆盖这些域名的 Apple/AI 规则前，`domestic_cdn` 放在 `domestic` 前。本次样本中 game-download 的 52 条都在 download 中，地域分类也与总 stream 大量重叠；若通用规则先匹配，独立策略不会生效。GitLab 样本仅有 `gitlab.com` 的 DOMAIN-SUFFIX，不能据此保证所有 GitLab 托管站点与 registry 都被覆盖。

CloudMounter 的规则包含 AND、`PROCESS-NAME,*CloudMounter`、`SRC-IP` 和嵌套 `DOMAIN-WILDCARD` 条件。sing-box 当前不输出 AND，Loon/Clash 的顶层类型支持也不能证明嵌套条件等价。因此这份订阅只发布 Surge 格式，不生成空文件或扩大成无条件云盘域名。其他新增订阅中平台不支持的类型仍按现有矩阵计数丢弃，验收记录应列明具体情况，不能宣称四个平台语义完全一致。

`non_ip/global_plus.conf` 和 `non_ip/apple_cdn.conf` 已废弃，分别合并进 `non_ip/global.conf` 和 `domainset/apple_cdn.conf`，不重复接入。私有偏好的 `my_*`、`reject_sukka` 与未列入本次清单的模块、MITM URL 拦截、teleproto 也不在本次新增范围。

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

[blackmatrix7](https://github.com/blackmatrix7/ios_rule_script) 声明 GPL-2.0，[MetaCubeX](https://github.com/MetaCubeX/meta-rules-dat) 声明 GPL-3.0，[SukkaW/Surge](https://github.com/SukkaW/Surge) 主要使用 AGPL-3.0，其 `List/ip/china_ip.conf` 单独采用 CC BY-SA 2.0，[Repcz/Tool](https://github.com/Repcz/Tool/tree/X) 声明 MIT。保留本项目及上游归属、许可证，分发时核对各分类的来源说明。

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

## Sukka 补充分类验收

本轮配置与测试提交为 `4ebd3708f4274f5d78a91f32be048cb091a1f893`。本地沿用隔离 workspace，不重复声明全新安装；在 Node `26.8.1`、pnpm `10.15.0` 下执行 `pnpm run validate`、`pnpm test`、`pnpm run knip`、`pnpm run build`（均通过 mise Node 26）。全部退出 0，146/146 tests 通过，lint 0 errors、保留既有 111 warnings。新增两个测试覆盖输出身份、废弃来源排除、domainset/IPv4/IPv6 转换，以及 CloudMounter 复合条件不被扩大、不产生其他平台文件。

实际构建处理 19 个普通 ruleset 与 39 个特殊 ruleset，共 58 个独立订阅。输出 Surge 58 文件，Clash/Loon/sing-box 各 57 文件，另有 4 个 GeoIP 文件、status、索引与完成标记。新增 49 个规则文件全部非空，新增 12 个 sing-box JSON 均解析成功；CloudMounter 的 40 条 AND 完整保留。此处为本地生成目录数量，CI 如从原产物仓补齐其他旧文件，应另计，不能混作本轮新增。

新增集合的已知平台丢弃如下，未发现新增 malformed 或 unknown：

| 集合           | Clash 丢弃   | sing-box 丢弃                 | Loon 丢弃         |
| -------------- | ------------ | ----------------------------- | ----------------- |
| `stream_us`    | 9 USER-AGENT | 9 USER-AGENT + 1 PROCESS-NAME | 1 PROCESS-NAME    |
| `stream_hk`    | 2 USER-AGENT | 2 USER-AGENT + 5 PROCESS-NAME | 5 PROCESS-NAME    |
| `stream_jp`    | 2 USER-AGENT | 2 USER-AGENT                  | 无                |
| `stream_tw`    | 4 USER-AGENT | 4 USER-AGENT + 1 PROCESS-NAME | 1 PROCESS-NAME    |
| `stream_kr`    | 1 USER-AGENT | 1 USER-AGENT                  | 无                |
| `stream_eu`    | 2 USER-AGENT | 2 USER-AGENT                  | 无                |
| `sogouinput`   | 2 USER-AGENT | 2 USER-AGENT + 3 PROCESS-NAME | 3 PROCESS-NAME    |
| `domestic_cdn` | 无           | 无                            | 1 DOMAIN-WILDCARD |

其他新增集合在配置的目标平台未出现类型丢弃，CloudMounter 根本不请求其他三个 writer。以上证明生成与转换路径运行成功，不证明客户端已订阅、策略匹配、云盘挂载、游戏实际下载或地区解锁。新增规则来源继续滚动更新，条数和丢弃数应以各次构建日志为准。本轮核对的 Sukka 发布仓 HEAD 为 `ff57325d2494d72ba0a234184d4e3a988d9847b2`，来源配置没有锁定该 commit。

GitHub runner 的 [Build 36880826814](https://github.com/lucking7/MirrRule/actions/runs/36880826814) 与 [source-health 36880833202](https://github.com/lucking7/MirrRule/actions/runs/36880833202) 均 success，验收 head 与上述配置提交一致。runner 的 146/146 Node tests、5/5 Python gateway tests、lint/typecheck、Knip 和完整构建通过；健康检查 116/116 ok，0 dead、0 unknown。两个部署 job、插件转换与模块合并均 skipped。

下载并直接读取 `build-artifact-4ebd3708f4274f5d78a91f32be048cb091a1f893-6784` 的原始 ZIP，完整性检查通过；新增 49 文件全部存在且非空，12 个新增 sing-box JSON 成功解析，CloudMounter 40 条 AND 与仅 Surge 输出再次确认。CI 目录总计 Surge 60、其他平台各 59，分别包含 2 个从原产物仓保留的 fmz 文件，实际本轮配置的输出仍为 58/57/57/57。status 包含 58 个 ruleset。日志、ZIP、输出大小清单保存在隔离 workspace 的 `acceptance/sukka-additions/`。随后提交仅补录本文验收数据，不改运行代码。

最终审计发现上述成功构建仍混入 Sukka 新归属水印域名，已有测试只覆盖旧水印，因此不能把前述 success 当作水印清理通过。新增真实水印 fixture 后，过滤与产物测试均先失败；修正共享识别后，又在完整构建中发现六个仅含水印的地域 IP 来源清理后为空，导致构建失败。随后只对六个地域合并启用既有空来源选项，保持全部下载成功与合并结果非空的要求。回归覆盖旧水印、真实数字域名、相似域名边界、四平台产物无新水印、空 IP 仍输出域名，以及全部来源为空时报错并保留旧产物。

修正后再次执行 `mise exec node@26 -- pnpm run validate`、`mise exec node@26 -- pnpm test`、`mise exec node@26 -- pnpm run knip`、`mise exec node@26 -- pnpm run build`，均退出 0。148/148 tests 通过，lint 0 errors、既有 111 warnings。本地产物重新核对为 58/57/57/57 文件，全部规则文件不含该新水印，57 个 sing-box JSON 成功解析，新增 49 文件存在且非空，CloudMounter 恰有 40 条 AND、没有其他规则行，status 为 58 个集合，仓库根目录 `.BUILD_FINISHED` 存在。失败与修复日志分别保留在 `watermark-red.log`、`build-watermark.log` 与 `*-watermark-final.log`，输出核对清单为 `outputs-watermark.json`。

最终代码提交 `478078dccb996b6cf7465cc73059a8131f3d5b1e` 的 [Build 36882205589](https://github.com/lucking7/MirrRule/actions/runs/36882205589) 为 success：148/148 Node tests、5/5 Python gateway tests、lint/typecheck、Knip 和完整构建通过。普通集合 19 个、特殊集合 39 个，处理错误为 0。Cloudflare Pages 与 GitHub Repository 部署、插件转换、模块合并和差异预览均 skipped，未更新生产。

再次直接核对 `build-artifact-478078dccb996b6cf7465cc73059a8131f3d5b1e-6785` 原始 ZIP，完整性通过；全部规则文件不含新水印，新增 49 文件存在且非空，所有 sing-box JSON 可解析，CloudMounter 恰有 40 条 AND，其他三个平台没有 CloudMounter 文件，status 为 58 个集合。CI 目录仍为 60/59/59/59，各保留两个 fmz 文件。核对脚本为 `acceptance/sukka-additions/verify-watermark-artifact.py`，记录为 `outputs-watermark-ci.json`，ZIP 与 CI 日志同目录保留。source-health 继续引用本轮此前的 116/116 来源检查，过滤修正没有改动 URL，未重复健康检查。随后提交仅补齐验收记录。
