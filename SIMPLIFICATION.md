# 全项目简化与验收记录

目标：在保留功能、四平台语义、订阅地址、CLI/env、校验、缓存、原子发布及回滚的前提下，减少重复状态、无消费者接口和重复流程。基线为 `e03e34f5`，先独立修复插件转换，再按职责边界实施候选。当前记录为进行中，未完成项不能视为已验收。

## 覆盖与外部边界

| 范围 | 入口和责任 | 保留的可观察契约 |
| --- | --- | --- |
| 构建与规则 | `Build/index.ts`、`rule-sources`、`RuleSourceProcessor`、`EnhancedFileOutput` | 来源失败阻止发布；成功后写 manifest/标记；地区独立订阅和总聚合并存 |
| 四平台与索引 | `writing-strategy`、support matrix、`public-index-model`、`build-public` | Surge/Clash/Loon/sing-box 差异、链接、顺序及可用性展示 |
| 网络和状态 | `utils/network`、Trace、Trie/validators、source-health/state | retry/cache/fallback 顺序、脱敏、三次失败和 unknown 不改 streak |
| 镜像与模块 | mirror sync、插件、module-merger | last-known-good、canonical identity、47 个启用模块、参数与脚本隔离、双文件回滚 |
| 入口与运维 | CLI、package/Knip、三个 workflow、README/MIGRATION/RULE_SOURCES | 公开命令、固定 runtime/image、失败传播、产物仓和 Pages 发布 |

以上领域已完成第一轮只读调查。仓库为 private package；不能从静态搜索证明无人从仓库外直接 import 内部源码。保留有文档/CLI/持久化意义的接口。客户端导入和实际分流、新账号 Worker/Secret/域名仍是外部验收边界；源码检查、HTTP 200 和 Actions 成功不能替代这些验证。

## P0，先修复插件转换（待 runner 全量验收）

候选/位置：`plugin-converter`、Python gateway、`main.yml`。旧流程目录失败却上传 marker，合并再取历史 NRRule，形成假成功。新路径先校验/刷新插件，再供 loopback Script-Hub 转换，校验依赖并原子发布；下载失败不能通过旧缓存成为 fresh。CLI 非零、零转换 artifact 及本轮转换缺失均阻断后续发布。

消费者：`convert-plugins` CLI、完整/插件 Actions、模块合并及公开输出。canonical source ID、旧缓存和发布格式保持；行为变化是让真实失败如实失败。回滚：revert 本批提交；生成物不手改。

本批删除 `mirrorPluginsBatch` 的死批处理和原转换函数的外部 export。全仓 rg 仅存在声明/内部调用，Knip 确认；package 无发布 API，无 CLI 或文档消费者。私有化后保留实际内部转换。收紧当前未发布 transport 的必需映射，删除无调用者校验覆盖参数和 server barrel export；共享 Python 请求/校验/错误/关闭流程，保留直连 catalog 与 Worker URL 的差异。

验证（2026-10-03）：Node 26 的 validate、157 项 Node tests、Knip，13 项 Python tests；最终提交前再次核对退出码。实网 gateway catalog HTTP 200、207215 bytes，Node 提取 275 插件；YouTube `.lpx` HTTP 200、2625 bytes。发现 catalog 全为 `loon://` 后补解码回归，修复前该资源返回 502。当前机器无 Docker，完整 Script-Hub、脚本依赖和模块合并仍须 feature branch runner 验证。

ce-simplify-code 复查：复用 0 项直接应用；质量 4 项应用；效率未追加改动。第三路受 harness thread limit 限制，按完整效率 persona 在父线程完成。保留 cache 读取、HEAD 的 GET 正文验证、各资源不同 validator 和原子清理，它们有实际契约。

## 候选队列（实施前再次核对调用方）

所有候选拓扑字段为不适用，按源码职责划分；未创建关系图。每批独立验证并可用单独 commit revert 回滚。风险与收益分开评估，不以行数为验收。

| ID | 精确切除/合并与消费者证据 | 收益、风险和反证检查 | 当前结论 |
| --- | --- | --- | --- |
| R1 | `Build/index.ts` 的 step.name 与固定 outputDir 参数仅写入，入口函数仅一个固定调用 | 少一层步骤元数据/参数；低风险；完整 build 和测试 | 已实施，完整 build 待最终 runner |
| R2 | `rule-source-processor.ts` processingTime 仅赋值，追踪已有耗时 | 去重复计时状态；内部返回 shape 变化；测试/manifest/构建核对 | 已实施，构建待最终 runner |
| R3 | Clash/Loon writer 的 other-rule passthrough 同序逻辑 | 去双份转换步骤；中低风险；固定输入四平台 golden 比较 | 待实施 |
| R4 | `RuleFormat.short` 仅复制，UI 使用 CLIENT_DIRS.short | 去无消费者数据字段；低风险；固定 public index HTML 比较 | 待实施 |
| N1 | Trace.tracePromise/traceChildPromise 仅 test fake 声明 | 去无消费者接口；低风险；typecheck/全部 tests | 待实施 |
| N2 | task 的 onCleanup 无任何 callback 消费，独立真实 cleanup 仍有效 | 去闲置生命周期抽象；中低风险；成功/失败入口 trace 验证 | 待实施 |
| N3 | deprecated requestWithLog 仅 headStatus，后者供两个 tarball CLI | 可能少一套请求 API；实测 wire headers 和 ResponseError.res 不同 | 拒绝直接替换 |
| N4 | TS issueAction 与 workflow deadStreak 判断重复 | 收敛三次失败决策；中风险；持久故障与当次 transition 不同 | 拒绝原切法 |
| N7 | source inventory 与 health 的 URL 脱敏重复 | 去安全规则双维护；中低风险；source ID/报告值等价比较 | 待核对 |
| N10 | IPValidator.isIpCidr 仅 tests 使用 | 小收益；内部 API shape 变化；保留 IPv4/IPv6 验证测试 | 待核对 |
| C1 | previous-build/mock modules 重复 tarball transport，两个 CLI 均保留 | 去双份下载状态机；中低风险；HTTP/tar fixture 和两入口验收 | 待实施 |

## 明确保留或拒绝

- C2：gateway 跨 workflow action 曾被明确拒绝；三个 job 的失败传播/cleanup/artifact 不同，未证明共享后的净简化，保留。
- C3/C4：`download-previous-build.ts` 有 Knip entry 和迁移文档，fmz200 空 registry 标识专用 adapter，保留。
- C5：TemplateEngine、ModuleMerger/Loader 各拥有单次模板替换、聚合、重试与稳定顺序，合并只是转移职责，保留。
- proxy-first 健康检查与 direct-first 下载、boundedMap 与 ModuleLoader、四个平台 writer、大量地区/总聚合重复 URL 均有不同契约，保留。
- Trie 泛型/构造输入、Surge stripPolicy、support matrix 元数据、malformed policy、build-public re-export：缺少足以删除已存在可用接口的证据，拒绝本轮切除。没有授权删除现有可用能力。
- CLI aliases、workflow:modules、缓存/原子写、rule-loader/remote module 路径、state 审计字段、平台 UI 元数据和 runtime 类型保留。
- 依赖有实际生产消费者，未发现可删除依赖，不改 lockfile。文档保留历史验收及限制，只修正被新实现取代的当前操作说明。

## 完成判据

候选逐项进入已实施/已拒绝/有明确缺失事实的未决状态；高置信可执行队列清零；最终三路复查及固定输入比较完成；Node/Python 检查、实际转换/合并/构建通过后推送 main，核对 Actions 与线上产物。当前未达到这一判据。

## R1/R2 批次回执

Before：内部步骤结果维护未读取的 name；处理器单独保存耗时但追踪系统已计时。历史 owner 分别为旧入口（89d21460）及初始处理器（938c33f），当前入口和 manifest 无消费者。

Cut/After：删除六处步骤名称、入口固定 outputDir 转发和 processingTime 字段/计时赋值；RuleSourceProcessor 可注入目录、其余 stats、执行顺序、错误、manifest 和 trace 保留。净减少一份步骤身份、一份计时状态及固定参数转发，没有新增协调层。内部返回 shape 不再包含无消费者字段，不改变已记录的 CLI/公开产物。

Verify：隔离目录 Node 26 下 frozen-lockfile install 退出 0；R1/R2 相关 processor、四平台 golden、status-manifest 测试全部通过；typecheck 退出 0。8 个既有 golden 逐字通过，未设置 UPDATE_GOLDEN。完整真实 build、部署及客户端属于后续层，不能由本层替代。日志 /tmp/mirrrule-simplify-r1-r2.log、/tmp/mirrrule-simplify-r1-r2-types.log；本批独立 commit 可 revert。

N3 拒绝证据：本地 HTTP HEAD fixture 对照 /ok、/missing，状态与错误文本相同，但 requestWithLog 无默认 UA/Accept，$$fetch 为 undici/*；404 ResponseError.res 分别为有 statusCode/body 字段的 Object 与 Fetch Response。直接替换改变 wire/error 契约，若补适配则净收益不足，保留（/tmp/mirrrule-head-characterization.log）。

N4 拒绝证据：workflow 从全部持久 state 查 deadStreak>=3，包括当次 unknown 和未重新观察的来源；transition.issueAction 只描述当次变化。只序列化 transition 会漏持续故障并改变 close 条件。完整 action projection 需新增状态机而非删除重复，本轮保留三次失败和持续告警，不修改 state schema。
