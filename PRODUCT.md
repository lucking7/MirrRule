# PRODUCT.md · NRRule

## 服务与任务

NRRule 是 MirrRule 构建脚本生成的静态规则文件服务，公开地址为 `https://nrrule.pages.dev`。服务发布 Surge、Clash、Loon、sing-box 规则、GeoIP 数据，以及模块、脚本和上游镜像。

访问者可以直接展开对应客户端目录浏览文件、用命令面板搜索（`⌘K` / `Ctrl+K` 或 `/`）按客户端/分版/规则名快速定位，或直接点击文件打开与复制完整订阅 URL。目录与文件名直接对应实际产物；客户端格式、来源与分流顺序见 [README](README.md) 和 [RULE_SOURCES](RULE_SOURCES.md)。

## 页面结构

页面依次呈现吸顶顶栏（品牌标识与规范域名 `nrrule.pages.dev`、搜索触发按钮、GitHub 源码入口），以及一个 Frame 外框：头部为 UTC 更新时间与规则集、文件数量，中间为原生折叠目录树，底部为归属页脚。视觉与交互细节见 [DESIGN](DESIGN.md)。

| 页面内容 | NRRule 值 |
|---|---|
| 浏览器 title | `NRRule · nrrule.pages.dev` |
| H1 | `NRRule`（同基线展示 `nrrule.pages.dev`） |
| 维护者 | `Maintained by Luck`，链接到 `https://github.com/lucking7` |
| 源码 | `GitHub` / `Source on GitHub`，链接到 `https://github.com/lucking7/MirrRule` |
| 许可证 | `AGPL-3.0`，链接到本站 `/LICENSE` |
| 样式归属 | 页脚 `Styled with coss ui (MIT)`，链接到 `https://coss.com/ui` |
| Canonical 与服务地址 | `https://nrrule.pages.dev/` |
| 构建时间 | 本次构建的 UTC 时间（`<time datetime>` 保留精确 ISO 时间戳） |

页面只列出当前构建中实际可见的文件，不为缺失的平台格式生成入口。规则目录保持 `List`、`Loon`、`Clash`、`sing-box` 的实际路径；`GeoIP`、`Mirror`、`Modules`、`Scripts`、`Internal` 等产物同样按真实目录层级展示。

| 目录 | 客户端与格式 |
|---|---|
| `List/` | Surge。合并版用 `.list`，`non_ip`、`ip` 用 `.conf` 或兼容的 `.list`，`domainset/*.conf` 用 DOMAIN-SET |
| `Loon/` | Loon，`.list` |
| `Clash/` | Clash 文本提供者。`domainset/*.txt` 用 domain，其他规则用 classical |
| `sing-box/` | sing-box rule-set，`.json` |

目录用原生 `<details>` / `<summary>` 折叠。顶层目录默认展开，`Mock` 和 `Internal` 默认折叠；所有嵌套分版目录默认折叠，客户端根目录下的合并版文件折叠收纳在 `Merged files` 分组下（不影响实际文件 URL）。原生域名集仅展示通过当前输出审计校验的文件。

## 构建与归属

`Build/build-public.ts` 从公开产物目录生成单文件 `index.html`，内联基于 coss ui（MIT）设计参数手写的样式、Tabler Icons（MIT）SVG 精灵与轻量渐进增强脚本，无外部资源请求，禁用 JavaScript 时所有静态目录与文件链接保持完整可用。详见 [Build/assets/README](Build/assets/README.md)。
