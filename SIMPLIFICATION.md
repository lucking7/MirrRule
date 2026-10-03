# 全项目简化与验收记录

目标：在保留功能、四平台语义、订阅地址、CLI/env、校验、缓存、原子发布及回滚的前提下，减少重复状态、无消费者接口和重复流程。基线为 `e03e34f5`，先独立修复插件转换，再按职责边界实施候选。源码简化队列及最终三路复查已完成；发布验收必须核对 main Actions 与线上相同 SHA，未验证项不能视为已验收。

## 覆盖与外部边界

| 范围 | 入口和责任 | 保留的可观察契约 |
| --- | --- | --- |
| 构建与规则 | `Build/index.ts`、`rule-sources`、`RuleSourceProcessor`、`EnhancedFileOutput` | 来源失败阻止发布；成功后写 manifest/标记；地区独立订阅和总聚合并存 |
| 四平台与索引 | `writing-strategy`、support matrix、`public-index-model`、`build-public` | Surge/Clash/Loon/sing-box 差异、链接、顺序及可用性展示 |
| 网络和状态 | `utils/network`、Trace、Trie/validators、source-health/state | retry/cache/fallback 顺序、脱敏、三次失败和 unknown 不改 streak |
| 镜像与模块 | mirror sync、插件、module-merger | last-known-good、canonical identity、47 个启用模块、参数与脚本隔离、双文件回滚 |
| 入口与运维 | CLI、package/Knip、三个 workflow、README/MIGRATION/RULE_SOURCES | 公开命令、固定 runtime/image、失败传播、产物仓和 Pages 发布 |

以上领域已完成调查、候选实施及终轮复查。仓库为 private package；不能从静态搜索证明无人从仓库外直接 import 内部源码。保留有文档/CLI/持久化意义的接口。客户端导入和实际分流、新账号 Worker/Secret/域名仍是外部验收边界；源码检查、HTTP 200 和 Actions 成功不能替代这些验证。

## P0，先修复插件转换（验收按提交记录）

候选/位置：`plugin-converter`、Python gateway、`main.yml`。旧流程目录失败却上传 marker，合并再取历史 NRRule，形成假成功。新路径先校验/刷新插件，再供 loopback Script-Hub 转换，校验依赖并原子发布；下载失败不能通过旧缓存成为 fresh。默认严格模式中任一非 ready 插件使 CLI 非零；CI 的 required-config 模式必须让默认启用的 47 个模块全部来自本轮 ready 产物并通过实际 dry-run，其他失败单独报告。零转换 artifact、必需输出缺失或降级均阻断发布。

消费者：`convert-plugins` CLI、完整/插件 Actions、模块合并及公开输出。canonical source ID、旧缓存和发布格式保持；行为变化是让真实失败如实失败。回滚：revert 本批提交；生成物不手改。

本批删除 `mirrorPluginsBatch` 的死批处理和原转换函数的外部 export。全仓 rg 仅存在声明/内部调用，Knip 确认；package 无发布 API，无 CLI 或文档消费者。私有化后保留实际内部转换。收紧当前未发布 transport 的必需映射，删除无调用者校验覆盖参数和 server barrel export；共享 Python 请求/校验/错误/关闭流程，保留直连 catalog 与 Worker URL 的差异。

验证（2026-10-03）：Node 26 的 validate、157 项 Node tests、Knip，13 项 Python tests；最终提交前再次核对退出码。实网 gateway catalog HTTP 200、207215 bytes，Node 提取 275 插件；YouTube `.lpx` HTTP 200、2625 bytes。发现 catalog 全为 `loon://` 后补解码回归，修复前该资源返回 502。当前机器无 Docker，完整 Script-Hub、脚本依赖和模块合并仍须 feature branch runner 验证。

ce-simplify-code 复查：复用 0 项直接应用；质量 4 项应用；效率未追加改动。第三路受 harness thread limit 限制，按完整效率 persona 在父线程完成。保留 cache 读取、HEAD 的 GET 正文验证、各资源不同 validator 和原子清理，它们有实际契约。

## 候选队列（实施前再次核对调用方）

所有候选拓扑字段为不适用，按源码职责划分；未创建关系图。每批独立验证并可用单独 commit revert 回滚。风险与收益分开评估，不以行数为验收。

| ID | 精确切除/合并与消费者证据 | 收益、风险和反证检查 | 当前结论 |
| --- | --- | --- | --- |
| R1 | `Build/index.ts` 的 step.name 与固定 outputDir 参数仅写入，入口函数仅一个固定调用 | 少一层步骤元数据/参数；低风险；完整 build 和测试 | 已实施，本地及 feature 完整 build 通过 |
| R2 | `rule-source-processor.ts` processingTime 仅赋值，追踪已有耗时 | 去重复计时状态；内部返回 shape 变化；测试/manifest/构建核对 | 已实施，本地及 feature 完整 build 通过 |
| R3 | Clash/Loon writer 的 other-rule passthrough 同序逻辑 | 去双份转换步骤；中低风险；固定输入四平台 golden 比较 | 已实施，content/drop summary 等价 |
| R4 | `RuleFormat.short` 仅复制，UI 使用 CLIENT_DIRS.short | 去无消费者数据字段；低风险；固定 public index HTML 比较 | 已实施，HTML 等价 |
| N1 | Trace.tracePromise/traceChildPromise 仅 test fake 声明 | 去无消费者接口；低风险；typecheck/全部 tests | 已实施 |
| N2 | task 的 onCleanup 无任何 callback 消费，独立真实 cleanup 仍有效 | 去闲置生命周期抽象；中低风险；成功/失败入口 trace 验证 | 已实施 |
| N3 | deprecated requestWithLog 仅 headStatus，后者供两个 tarball CLI | 可能少一套请求 API；实测 wire headers 和 ResponseError.res 不同 | 拒绝直接替换 |
| N4 | TS issueAction 与 workflow deadStreak 判断重复 | 收敛三次失败决策；中风险；持久故障与当次 transition 不同 | 拒绝原切法 |
| N8 | 脚本 validator 长度判断在 010bdaf 只有一个 gated 调用方 | 后续修复新增缓存/restore 消费者，没有前置 gate；不能继续删除 | 已恢复，保留校验 |
| N7 | source inventory 与 health 的 URL 脱敏重复 | 去安全规则双维护；中低风险；source ID/报告值等价比较 | 已实施 |
| N10 | IPValidator.isIpCidr 仅 tests 使用 | 小收益；内部 API shape 变化；完整 IPValidator 接口/测试仍可用 | 拒绝，小收益且切除可用 API |
| C1 | previous-build/mock modules 重复 tarball transport，两个 CLI 均保留 | 去双份下载状态机；中低风险；HTTP/tar fixture；两入口 live 待验收 | 已实施，两入口隔离实网验收通过 |

## 明确保留或拒绝

- C2：gateway 跨 workflow action 曾被明确拒绝；三个 job 的失败传播/cleanup/artifact 不同，未证明共享后的净简化，保留。
- C3/C4：`download-previous-build.ts` 有 Knip entry 和迁移文档，fmz200 空 registry 标识专用 adapter，保留。
- C5：TemplateEngine、ModuleMerger/Loader 各拥有单次模板替换、聚合、重试与稳定顺序，合并只是转移职责，保留。
- proxy-first 健康检查与 direct-first 下载、boundedMap 与 ModuleLoader、四个平台 writer、大量地区/总聚合重复 URL 均有不同契约，保留。
- Trie 泛型/构造输入、Surge stripPolicy、support matrix 元数据、malformed policy、build-public re-export：缺少足以删除已存在可用接口的证据，拒绝本轮切除。没有授权删除现有可用能力。
- CLI aliases、workflow:modules、缓存/原子写、rule-loader/remote module 路径、state 审计字段、平台 UI 元数据和 runtime 类型保留。
- 依赖有实际生产消费者，未发现可删除依赖，不改 lockfile。文档保留历史验收及限制，只修正被新实现取代的当前操作说明。

## 完成判据

候选逐项进入已实施/已拒绝/有明确缺失事实的未决状态；高置信可执行队列清零；最终三路复查及固定输入比较完成；Node/Python 检查、实际转换/合并/构建通过后推送 main，核对 Actions 与线上产物。各阶段证据按下文具体提交与 runner 核对；生产结果必须以最终 main Actions 和相同 SHA 的线上 status.json 为准。

## R1/R2 批次回执

Before：内部步骤结果维护未读取的 name；处理器单独保存耗时但追踪系统已计时。历史 owner 分别为旧入口（89d21460）及初始处理器（938c33f），当前入口和 manifest 无消费者。

Cut/After：删除六处步骤名称、入口固定 outputDir 转发和 processingTime 字段/计时赋值；RuleSourceProcessor 可注入目录、其余 stats、执行顺序、错误、manifest 和 trace 保留。净减少一份步骤身份、一份计时状态及固定参数转发，没有新增协调层。内部返回 shape 不再包含无消费者字段，不改变已记录的 CLI/公开产物。

Verify：隔离目录 Node 26 下 frozen-lockfile install 退出 0；R1/R2 相关 processor、四平台 golden、status-manifest 测试全部通过；typecheck 退出 0。8 个既有 golden 逐字通过，未设置 UPDATE_GOLDEN。完整真实 build、部署及客户端属于后续层，不能由本层替代。日志 /tmp/mirrrule-simplify-r1-r2.log、/tmp/mirrrule-simplify-r1-r2-types.log；本批独立 commit 可 revert。

N3 拒绝证据：本地 HTTP HEAD fixture 对照 /ok、/missing，状态与错误文本相同，但 requestWithLog 无默认 UA/Accept，$$fetch 为 undici/*；404 ResponseError.res 分别为有 statusCode/body 字段的 Object 与 Fetch Response。直接替换改变 wire/error 契约，若补适配则净收益不足，保留（/tmp/mirrrule-head-characterization.log）。

N4 拒绝证据：workflow 从全部持久 state 查 deadStreak>=3，包括当次 unknown 和未重新观察的来源；transition.issueAction 只描述当次变化。只序列化 transition 会漏持续故障并改变 close 条件。完整 action projection 需新增状态机而非删除重复，本轮保留三次失败和持续告警，不修改 state schema。

## R4 批次回执

Before/Cut/After：索引聚合模型自 cb70e14 起把 CLIENT_DIRS.short 复制到各 RuleFormat，但页面只读 CLIENT_DIRS；去掉该复制字段，保留页面字母、client/dir/filename/href 和格式顺序。没有新增映射状态。类型为内部模型，package 不发布；没有发现文档或仓内 field 消费者，仓外非约定源码 import 不在可证明范围。

Verify：固定包含中文、HTML 特殊字符、四客户端与 Scripts 的树，生成 ruleCardsHtml+treeHtml，前后 cmp 退出 0（/tmp/mirrrule-index-before.html、after.html）。build-public 测试通过；不需要因删除无消费者字段而改 fixture/assertion。最终 integrated validate/typecheck 仍为必要层。可独立 revert 本批提交。

## N1/N2 批次回执

Before：Trace 两个 Promise API 仅存在于自身和 test fake；task 第二个 onCleanup 参数及单个 callback slot 没有注册者（全 Build rg）。它们是旧追踪层遗留，不拥有任何实际 gateway、Docker、stream 或 durable 写入的资源。

Cut/After：移除 Promise API 与对应 fake；删除闲置注册 slot、无操作 await 和包装 finally，保留 traceChildAsync/Sync、task 成功/失败/exitCode、uncaught/unhandled handlers、进程退出和真实资源所有者的 finally。净减少两项 API 和一项无消费者 lifecycle contract，没有替换 coordinator。

Verify：相关 reliability/processor/golden tests 通过，新增导入调用 reject 与 CLI 抛错退出 1 且保留 trace 检查，既有 exitCode=7 和 CLI 单次执行检查保留；typecheck 退出 0；全仓残留搜索为空。日志 /tmp/mirrrule-simplify-trace.log、trace-types.log。trace 耗时数字本身会随运行变化，验证的是结构、错误传播和退出码。独立 commit 可 revert。

N10：isIpCidr 已有独立测试，可被调用，删除仅节省几行并切除一个有效校验 API；缺少收益足以承担内部源码消费者的兼容风险，因此保留，并保留全部 CIDR 边界测试。

## R3 批次回执

Before/Cut/After：Clash/Loon 的相同 passthrough 转换均被 EnhancedFileOutput 调用，收敛到 BaseWriteStrategy 默认 writeOtherRules，移除两个 override 和专用 imports。Surge/sing-box 专用处理保留。trim、skip/account、accepts、转换/清策略、result 写入的顺序及平台 drop summary 均保留；没有新增 wrapper。未来新 writer 可以继承此默认路径，当前四个平台无能力切除。

Verify：固定输入含注释/空/unknown/unsupported/malformed/逻辑规则/policy，两个 writer 的 content 与 ruleDropSummary 前后 cmp 退出 0（/tmp/mirrrule-r3-baseline.json、after.json）。writing-strategy 与 8 个四平台 golden 通过，typecheck/diff-check 通过，不更新 golden。全仓 lint 在该时点发现父任务新增 reliability tests 的格式错误，归父任务修复，不能标成历史错误。三个 writer 文件以独立 commit revert 回滚。

## N7 批次回执

Before/Cut/After：inventory identity 与 health report 分别维护同一敏感 query regex 和 credentials 处理。统一到 utils/network/url-redaction；health 仍 re-export 原函数名，原始 entry.url、source ID prefix、fragment 与无效 URL 的当前行为全部保留。净减少一份安全规则维护点，新增一个内部 helper，无配置/存储迁移。

Verify：固定 URL corpus 覆盖重复 query、大小写、credentials、fragment、无效 URL；8 项 redaction/health/inventory tests 通过。原实现与两调用方在固定 corpus 和调查期随机输入对照相同；持久化 ID 不变。typecheck、Knip 通过，最终 integrated suite 另跑；无生成物或 state 改写。四个源码/测试文件及 receipt 独立 commit 可 revert。

## C1 批次回执

Before：previous-build 与 mock-modules 两 CLI 各自维护 HEAD 源选择、相同 undici.pipeline GET/profile/status 分发。二者均有 CLI/文档消费者，必须保留；路径过滤、根前缀、category 后处理和 required failure 属于各入口。

Cut/After：选择和 GET body 初始化统一到 tarball-utils；每入口保留 UA、trace、日志/404 文案、过滤与生命周期。HEAD 继续 requestWithLog，>=400 抛错不改成 fallback；新 helper 不引入另一个 dispatcher/cache/retry。headStatus 原两个外部内部调用被 chooseTarballUrl 接管，rg/Knip 证实 export 无剩余消费者，仅将其私有化而不删除 HEAD 实现。净减少两份 transport 状态机，独特分支仍由各 CLI 所有。

Verify：真实 loopback HTTP + tar.gz fixture 检查 HEAD 200/304 fallback/404 无 fallback，GET 两种现有 UA、same-origin、200 解包原字节及 caller-specific 404。两个定向 tests 通过，typecheck/diff-check 通过。完整 tests 在批次整合中通过；Knip 曾发现 headStatus dead export，收窄后重新通过。生产 URL 未在本批访问，previous-build 与 mock 的实网执行留到最终独立目录/runner，不能用 fixture 冒充。源码与 fixture tests 独立 commit 可 revert。

## 最终三路复查与 C1 实网验收

复用、质量、效率三路独立只读复查已完成（0708974）。应用 1 项：Script-Hub 私有函数/类型改为 staged source 名称，纠正旧“远程转换”注释，URL、请求头、重试和日志值不变。其余未发现有证据的高收益行为保持切法。

效率建议 3 项不实施：localOnly 当前仅 1 个插件，传正文需新增接口与协调状态；旧脚本提前 readFile 同时证明可读缓存并取得本次快照，改为失败后 stat/access 会将不可读文件或并发修改视为同一缓存，改变 failed-cached 契约；UTF-8 前缀优化需额外处理任意前导空白、字符边界和全体合法性，不是直接字节 slice 的等价替换。保留简单路径，不能用新增适配复杂度充当净简化。

C1 实网命令（隔离 PUBLIC_DIR，CI 未设置）：

- `PUBLIC_DIR=/tmp/mirrrule-previous-acceptance-20261003 pnpm run node Build/download-previous-build.ts`：退出 0，GitHub tarball 解包成功，约 27.7 秒。
- `PUBLIC_DIR=/tmp/mirrrule-mock-acceptance-20261003 pnpm run node Build/download-mock-modules.ts`：退出 0，41 文件成功、0 失败，约 9.3 秒。

命令均经 `mise exec node@26 --` 执行；日志 `/tmp/mirrrule-previous-live.log`、`/tmp/mirrrule-mock-live.log`。fixture 与 live 各证明独立一层，不代表客户端或新账号部署验收。

整合 0708974：validate 退出 0（0 errors、113 warnings），166/166 Node tests，13/13 Python tests，Knip 退出 0。原 reliability lint 错误已经 d51e780 修复；writer 被现有 ESLint 默认忽略，靠 typecheck、定向输出比较及不更新的四平台 golden 验证，不能声称 scoped lint 已覆盖。最终 main 和部署仍待验证。

## 隔离目录完整规则构建

`PROXY_BASE='http://127.0.0.1:13195?url=' mise exec node@26 -- pnpm run build`：退出 0，约 32.9 秒。gateway 使用受限 loopback 端口 13195，本次启动与关闭均完成。6 个 groups、39 个 special rules；普通 19 文件、0 errors，特殊 39 文件、509170 条合并输入。public/status.json 有 58 个 rulesets，.BUILD_FINISHED 写入；public 共 238 文件，List 58、Clash/Loon/sing-box 各 57（按原配置不同 targets）。GEOIP、四平台文件、索引和部署辅助文件均由源码生成，没有手改产物。日志 `/tmp/mirrrule-cleanup-build.log`。

previous-build 目录 1507 文件/111374853 bytes，mock 目录 41 文件/179570 bytes。二者输出完全位于独立临时目录；完整 build 仅修改隔离 worktree 的生成物，不写原任务工作区或生产。

## 插件补充修复整合与复查

010bdaf 修复了 Loon v2 脚本/布尔参数、JS 正文内正常 HTML 字符串被误判、jq_file 的受限 gateway，以及 response.body.mock 的 text/Base64、状态与 Content-Type。固定 digest 的 Script-Hub 在 runner 内应用带精确锚点校验的补丁，不匹配则失败；unsupported action 保留诊断，不能当成功。CI required-config 复用合并器的默认筛选/路径解析，并要求 47 个启用输出实际对应本轮 ready 结果且 dry-run 通过。配置只有产物路径，不能从它反推 source URL，未声称具有该额外身份验证。

整合提交 0c796428：194/194 Node tests、14/14 Python tests、validate 0 errors/122 warnings、Knip 成功。新修复的三路补充复查均已结束；应用 2 项：删除私有脚本 validator 中已由唯一调用方保证的重复 Buffer 长度判断（保留专用过小日志与 UTF-8/challenge 检查），以及用 Object.hasOwn 明确限制 MIME own-key 白名单。后者是预发布实现的校验 bug 修复，同一 VM 的 Object.prototype.xml 字符串属性可使未知 xml 类型错误通过；新增回归先失败后修复，已支持类型的结果不变。

不实施 readiness 的重复读取切法：首次读取证明本轮 ready 路径和非空，第二次走实际 ModuleLoader/dry-run；去重需要扩充合并器接口并改变资源/失败顺序，当前 47 项不值得增加协调层。保留原 source identity、缓存/降级、参数和发布契约。新 required 规则与严格 CLI 模式的区别已经在迁移文档说明；两个失效外部脚本不能标为成功。

终轮三路复核：上述两项应用后均无新增值得实施的复用、质量或效率候选。195/195 Node tests；validate 首次在新增 VM fixture string 发现 singlequote lint 错误，修正后 validate/typecheck 退出 0，仍有 122 warnings。Knip 成功，diff-check 成功。高置信简化队列已清零，功能修复不以降低门槛结束。

runner 37080295586（010bdaf）未通过：265 ready、11 failed，其中 9 个 Loon v2 插件因 unsupported actions 被明确拒绝，另有 2 个失效脚本。默认可莉广告过滤器、知识星球有漏项，required 检查阻断了合并、Build、Pages/NRRule；当前没有把该 runner 标为通过，main 尚未合入清理分支。后续须补齐正则字面量/捕获组/文件 mock 等实际语义后重验，不能绕过 required 筛选。

N8 结论更新：后续插件修复正在让 script validator 供 warm-cache 和 optional artifact restoration 使用，新增调用方没有先行 byteLength gate，且需要拒绝过短/损坏旧文件。此前 sole-caller 删除证据不再适用于最终组合，已主动恢复长度判断，保留 MIME own-key 修复。原切法在当时前提成立，但不能跨新增消费者复用旧证明；该项进入有反证的保留状态，不计净实施候选。

## 最终整合批次（cd4f89d）

兼容修复补齐正则字面量、捕获组、mock_file、同名路径冲突和自有镜像脚本重新校验。required fresh 检查先于 optional 历史恢复，旧可选文件不构成本轮 ready。新缓存/恢复调用方需要脚本长度校验，因此 N8 保留，不计净简化。

C6：三个 Script-Hub 补丁阶段的非重叠锚点计数完全相同，统一使用 regex-compat 的 countOccurrences；精确锚点、次数检查、错误文本和阶段顺序不变，没有循环依赖。两份 replaceExactlyOnce 分别使用字符串和回调替换，对 `$` 的处理不同，保留。真实 beta parser 的前后补丁结果 cmp 相同，SHA256 均为 `54f65aea1cc04fe31f1fae539bcc6274bc7ca120977f6323dd5b3d635d5a20ad`，文件位于 `/tmp/mirrrule-parser-count-before.js` 与 after.js。本项可单独 revert，净减少两份计数实现。

质量复查补回归：旧 optional 模块的 `%ZZ` Script URL 原先抛 URIError 并中断整体恢复；现在仅隔离该坏模块，继续恢复健康模块。回归先失败后通过，required 输出保持原样，真实 I/O 错误仍传播。

最终三路独立只读复查覆盖整合提交和上述改动，均无新增值得实施项。optional 脚本重复读取的实际引用规模未证明值得引入缓存状态；stat.isFile 与 readFile 对目录和错误的契约不同，保留。高置信可执行队列清零，净实施 9 项（R1/R2/R3/R4/N1/N2/N7/C1/C6），N8 的旧切法已恢复。

隔离目录验收：222/222 Node tests、52 suites；validate/typecheck 退出 0，0 errors、132 warnings；Knip 退出 0；固定输入四平台 golden 未更新。日志 `/tmp/mirrrule-native-final-tests.log`、`/tmp/mirrrule-native-final-validate.log`。当前记录尚不代表清理分支已完成 main/生产验收。


## 6be19ba 实际转换验收

最新整合代码的 Node 26 validate/typecheck 退出 0（139 warnings、0 errors）、226/226 Node tests、52 suites、Knip 成功；Python gateway 14/14 tests。`f6c0e3d` 的空功能模块检查、裸 PROXY 拒绝及首部 Error 检查经补充三路复查，无新增值得实施项。

[清理分支 runner 37083428866](https://github.com/lucking7/MirrRule/actions/runs/37083428866) 转换与模块合并已成功；276 total、272 ready、0 degraded、4 failed，47 required ready。原插件分支 [37082874939](https://github.com/lucking7/MirrRule/actions/runs/37082874939) 的转换、合并及 Build 完整通过，部署按 feature branch 限制跳过。不能把 feature 成功写成生产发布成功。

实际产物核对：哔哩哔哩转换模块保留 4 Script、11 Body Rewrite、1 Header Rewrite；合并模块引用 64 次、29 个不同镜像脚本，产物中无缺失依赖。记录的是源码转换及产物完整性，未在实体 Surge/Loon 客户端逐项执行。

未通过项及解除步骤：blockAds 与 Prevent_DNS_Leaks 的 Loon PROXY 不能无绑定复制到 Surge，需原生 Surge 来源或接管者独立规则集绑定自己的策略后验收；EasyBike_remove_ads 的 mobileconfig-gateway.js、Tencent_Video_remove_ads 的 replace-body.js 上游不可用，需上游恢复或维护者提供等价脚本，再运行默认严格转换并核对依赖。它们不在 47 个启用输入内，不能当作 ready；历史 optional 保留也不更改失败报告。没有以忽略错误、启用旧产物充当 fresh 或改写 golden 换取通过。

## 原生 fmz200 与最终校验边界

77306e1 改用上游原生 `Surge/module/blockAds.module`，不再把含 PROXY 的 Loon 合集无绑定转换。native adapter 强制 fresh 下载、拒 degraded，并进入既有脚本镜像与原子发布链，保留 Header/Body Rewrite；历史恢复统一使用活动功能节校验。新来源的实网结果以最终 runner 报告为准，旧 6be19ba 的四项失败清单属于该提交的历史记录。

质量复查发现 native 仅含 Header/Body/URL Rewrite 或 Panel 时，下载层旧 Loon regex 会先拒绝。下载层现对 native 复用既有功能校验，Loon regex 不变；经过实际 getPluginContent 和 fetch seam 的回归先报 Invalid plugin format，再通过。空原生模块及缓存 degraded 均不得成为 ready。三路终轮复核已结束，无新增值得实施项。native adapter 保留自身校验，覆盖可注入 loader；当前只有一个 native 源，拆校验接口不构成净收益。

最终验收命令均在隔离 worktree 使用 Node 26：`pnpm run validate`、`pnpm test`、`pnpm run knip`。Python 14 项测试已通过，完整规则 build 和固定输入比较见上文。回滚以逐批 revert 或 main 合并提交 revert 为入口，保留原 main 基线 `e03e34f5`、NRRule 基线 `7b4d094d`；生产产物需分别按 MIGRATION 的 Pages/产物仓步骤恢复，源码回滚不能还原动态上游字节。

最终本地结果：229/229 Node tests、52 suites，validate/typecheck 退出 0（143 warnings、0 errors），Knip 退出 0；日志 `/tmp/mirrrule-native-validator-tests.log`、`/tmp/mirrrule-native-validator-validate.log`、`/tmp/mirrrule-native-validator-knip.log`。Native 下载校验红绿日志为 `/tmp/mirrrule-native-validator-red.log`、green.log。warnings 没有当成 errors 或静默忽略；未削弱校验/测试来降低数量。


## 最终 feature 产物审查（e96f5f6）

[37083987931](https://github.com/lucking7/MirrRule/actions/runs/37083987931) 的转换、合并已通过：276 total、273 ready、0 degraded、3 failed，47 required ready。blockAds 现已 ready，原生输出 `广告拦截&净化合集.sgmodule` 为 465763 bytes，保留 Rule、Header Rewrite、URL Rewrite、Body Rewrite、Map Local、Script、MITM 七个 section。哔哩哔哩仍保留 4 Script、11 Body Rewrite、1 Header Rewrite，可莉广告过滤器保留 24 Rule、2 Body Rewrite、80 Map Local。合并模块引用的 29 个不同脚本在 artifact 中全部存在。

剩余 3 项为 Prevent_DNS_Leaks 的策略绑定限制，以及 EasyBike/Tencent Video 的失效外部脚本。它们继续 failed，解除步骤见前述记录及 MIGRATION；本次没有声称这些功能或实体客户端已通过。

DNS 解除步骤补充：Surge module Rule 不接受 Loon 的 PROXY，也不能靠 module argument 任意绑定策略组。应将对应域名规则放入独立 RULE-SET，并在自己的主配置中选择策略，再做客户端验收。main 的并发修复只明确了这条诊断与操作说明，清理分支已合入该提交，并为整合提交再次核对 Build。


最终 feature [37083987931](https://github.com/lucking7/MirrRule/actions/runs/37083987931) 整体 success，Convert Plugins、Merge Modules、Build 均 success；两部署 job 按 feature 限制 skipped。main 并发提交 `0b15b46` 已整合，其生产变动仅更明确的 DNS 错误文本及对应 assertion，定向 local-converter characterization 通过；新增的 mirror own-section 校验、MIME own-key、脚本长度和坏 optional URL 隔离均保留。整合提交的 Build 与 main 的全任务发布分别验收，不把 skipped 写成部署成功。
