# PRODUCT.md · NRRule

## 服务与任务

NRRule 是 MirrRule 构建脚本生成的静态规则文件服务，公开地址为 `https://nrrule.pages.dev`。服务发布 Surge、Clash、Loon、sing-box 规则、GeoIP 数据，以及模块、脚本和上游镜像。

访问者先进入对应客户端的目录，再打开文件或使用浏览器复制链接地址，将订阅 URL 配置到客户端。目录与文件名直接对应实际产物；客户端格式、来源与分流顺序见 [README](README.md) 和 [RULE_SOURCES](RULE_SOURCES.md)。

## 页面结构

索引按 2026-10-08 核对的 [Sukka Ruleset Server](https://ruleset.skk.moe/) 复刻。页面依次显示标题、作者与源码及许可证链接、`Last Build` 时间、文件目录树。视觉尺寸和原生交互见 [DESIGN](DESIGN.md)。

| 页面内容 | NRRule 值 |
|---|---|
| 浏览器 title | NRRule Ruleset Server \| Luck (@lucking7) |
| H1 | `NRRule Ruleset Server` |
| 作者 | `Made by Luck`，链接到 `https://github.com/lucking7` |
| 源码 | `Source @ GitHub`，链接到 `https://github.com/lucking7/MirrRule` |
| 许可证 | `AGPL-3.0`，链接到本站 `/LICENSE` |
| Canonical 与服务地址 | `https://nrrule.pages.dev/` |
| 构建时间 | 本次构建的 ISO 时间 |

页面使用本仓库的文件集合和路径。规则目录保持 `List`、`Clash`、`Loon`、`sing-box` 的实际名称；`GeoIP`、`Mirror`、`Modules`、`Scripts` 等产物同样按真实目录层级展示。只列出当前构建中实际可见的文件，不为缺失的平台格式生成入口，不把上游目录或文件列表复制成本服务的目录。

| 目录 | 客户端与格式 |
|---|---|
| `List/` | Surge，`.list` RULE-SET |
| `Clash/` | Clash classical ruleset，`.txt` |
| `Loon/` | Loon，`.list` |
| `sing-box/` | sing-box rule-set，`.json` |

目录用原生 `details` / `summary` 折叠。顶层目录默认展开，`Mock` 和 `Internal` 如存在则默认折叠；所有嵌套目录默认折叠。文件行保留完整文件名与扩展名，并链接到本站相应文件。页面以这棵树提供浏览，不增加规则卡片、搜索、客户端筛选、复制按钮或展开全部控件。

## 构建与归属

`Build/build-public.ts` 从公开产物目录生成 `index.html`。输出使用系统字体、内联样式与浏览器原生折叠行为，不需要前端应用 JavaScript。参考站由 Cloudflare 注入的 challenge script 不属于索引实现，不复制到页面源码。

页面样式与树结构来自 [SukkaW/Surge 的索引生成器](https://github.com/SukkaW/Surge/blob/6373d9aca136bf6b8f4ad091baebf50a8f088d4a/Build/build-public.ts)。保留其 AGPL-3.0 归属说明，同时使用 NRRule / Luck 的页面身份、本站 URL 和 MirrRule 源码链接。详见 [样式来源](Build/assets/README.md)。
