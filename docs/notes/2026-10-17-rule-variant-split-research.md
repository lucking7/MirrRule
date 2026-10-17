# 规则分版调研与决定（2026-10-17）

本文记录对 Sukka（ruleset.skk.moe）、blackmatrix7 和其他规则转换项目的对比，以及据此对 NRRule 分版做出的修改和仍未解决的问题。分版契约以 `AGENTS.md` 第 7 节和 `Build/lib/rule-output-variants.ts` 为准；本文只说明为什么这样改。

## 结论

- 采用 Sukka 的思路：把会触发 DNS 解析的 IP 规则单独放在 `ip` 分版，用户把所有 `ip` 规则组放在所有域名规则之后。规则按顺序匹配，客户端只有匹配到不带 `no-resolve` 的 IP 规则、GEOIP、FINAL 或 DIRECT 时才解析域名，所以这个顺序能避免在域名规则匹配完之前发起 DNS 查询。
- 拆分的价值在于控制 DNS 解析的时机，不在于 Surge 的匹配性能。Surge 手册（https://manual.nssurge.com/rules/ruleset.html ，"Performance" 一节）说明 RULE-SET 加载时会把 DOMAIN 和 DOMAIN-SUFFIX 编进域名索引，超过 1000 条用磁盘数据库，超过 50 条 IP-CIDR 编成二进制 IP 库。手册只说纯域名列表用 DOMAIN-SET "更易维护"，没有说它比 RULE-SET 更快。因此"DOMAIN-SET 比 RULE-SET 快"不能作为保留 `domainset` 分版的理由。

## 已做的修改

| 变更 | 内容 |
|---|---|
| PR #428 | cdn 规则集的 IP 规则保留上游是否带 `no-resolve` 的选择 |
| PR #429 | 带 `no-resolve` 的目标 IP 规则归入 `non_ip`，因为它们不触发解析 |
| PR #430 | `domainset` 分版并入 `non_ip`，只发布 `non_ip` 和 `ip` |
| PR #431 | 退休登记支持目录前缀 `pathPrefixes`，用 `variant:domainset` 让四个平台的 `domainset/` 目录经 `_worker.js` 返回 404 |
| PR #432、#433 及后续 | `_worker.js` 接管四个平台的 `ip/` 与 `non_ip/` 目录，只放行本次 tree 中的文件；验收报告把不在退休登记里的失败标为 `absent-present`；sing-box 的目标 IP 规则全部归入 `ip` |

## 上游调研要点

### Sukka

- README 要求所有 `domainset`、`non_ip` 和自写的域名规则，必须放在所有 `ip` 规则组、IP-CIDR、IP-ASN、GEOIP 之前。
- 但 Sukka 的目录并不严格按"是否触发解析"划分：
  - `ip/telegram`、`ip/stream`、`ip/domestic`、`ip/teleproto` 全部带 `no-resolve`。
  - `non_ip/reject` 含 47 条、`non_ip/apple_services` 含 1 条带 `no-resolve` 的 IP 规则。
  - `ip/reject` 有 722 条不带 `no-resolve` 的 IP-CIDR。
- 所以 NRRule 把带 `no-resolve` 的 IP 规则放进 `non_ip`，比 Sukka 的目录划分更严格，与 Sukka 并不完全相同。`AGENTS.md` 与 README 原先写的"与 Sukka 的 non_ip 文件一致"已改为这一说法。
- 每个文件都带一行防抄袭标记 `DOMAIN,7h15.ru1353t.1s.m4d3.by.5ukk4w.skk.moe`，已由 `Build/utils/validation/validators.ts` 过滤。
- Sukka 建议 Telegram 只用官方 CIDR，ASN 规则只作补充。NRRule 的 `telegram` 合并了 `ip/telegram_asn`，因此 `ip/telegram` 只剩 5 条不带 `no-resolve` 的 IP-ASN。

### blackmatrix7

- 每个服务一个文件，域名、DOMAIN-KEYWORD、PROCESS-NAME、IP-CIDR、IP-ASN、OR 规则混在一起。整个 RULE-SET 只能放在一个位置，无法把其中的 IP 部分移到最后。
- 存在过宽条目。仓库的 `serviceRules`（Netflix、Disney、YouTube 等，见 `Build/lib/rule-sources.ts`）直接合并 blackmatrix7，因此 NRRule 也会输出这些条目。例如 Netflix 有 `DOMAIN-SUFFIX,us-west-2.amazonaws.com`，会把整个 AWS us-west-2 区域的流量导向 Netflix 策略；还有 `onetrust.com`、`cookielaw.org`。
- Telegram 使用 `91.108.0.0/16` 等比官方 CIDR 更宽的网段，另加 5 个 ASN。
- 文件头的 `UPDATED` 每天重新生成，但内容改动不频繁，Telegram 列表内容停在 2025-09-10。

### 其他项目

- MetaCubeX meta-rules-dat、DustinWin：域名（geosite）和 IP（geoip）分开发布，没有 `non_ip` 这一层。Telegram 数据与官方 CIDR 一致。
- Loyalsoldier clash-rules：域名集与 CIDR 集分开，示例配置把 `cncidr`、`telegramcidr`、GEOIP 放在最后，与 Sukka 思路相同。
- Repcz/Tool、ConnersHua RuleGo、ACL4SSR：单文件混合，与 blackmatrix7 同类。ACL4SSR 的 Telegram 网段较旧。

## 未解决的问题

1. **已删除的 `ip/` 分版文件在正式域名上仍返回 200（已处理）。** PR #429 之后，很多规则集不再生成 `ip` 分版，但 `https://nrrule.pages.dev` 仍从 Cloudflare 边缘缓存返回旧文件（`cf-cache-status: HIT`），定时构建 39029739278 因此以 `production-lagging` 失败，共 78 个 URL。逐条登记会超过 `_routes.json` 的 100 条上限，所以改为由 `_worker.js` 接管 `/<平台目录>/ip/*` 和 `/<平台目录>/non_ip/*` 八条路由，只放行本次 tree 中存在的文件。最初只接管了 `ip/`，随后 sing-box 的 `non_ip/apple_services_ip.json` 在规则集只剩 IP 后消失，同样因缓存导致 run 39049320715 验收失败，于是一并接管。代价是分版的每个请求都计入 Functions 调用次数；生产环境 `fail_open: false`，额度用完时分版订阅会下载失败。
2. **旧订阅不兼容。** 订阅了 `domainset/` 或已为空的 `ip/` 地址的用户会得到 404。Surge 会报规则集下载失败，Clash 可能报错。如果要照顾旧用户，可以考虑在 README 写明迁移方法。
3. **Mihomo 性能。** Sukka README 指出 Mihomo 只对 `behavior: domain` 和 `behavior: ipcidr` 的规则集做了匹配优化，`classical` 没有。NRRule 的 Clash 分版全部是 classical，并入前的 Clash `domainset` 也是 classical，所以合并没有让 Mihomo 用户损失性能。如果以后要为 Mihomo 提供优化格式，应另外发布 `behavior: domain` 的纯域名文件和 `behavior: ipcidr` 的纯 CIDR 文件。
4. **blackmatrix7 过宽条目。** 可以考虑为 `serviceRules` 增加排除列表，或改用 Sukka 已有的对应规则集（Sukka 的 `stream_us` 等按地区分组，不按单个服务分组）。修改前需要确认对现有订阅者的影响。
