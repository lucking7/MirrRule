# DESIGN.md · NRRule index page

## 概览与范围

NRRule 索引页由 `Build/build-public.ts` 生成，内联 `Build/assets/ruleset-index.css`、官方 Tabler Icons（MIT，`24×24` 网格、`1.5px` 细描边）SVG `<symbol>` 精灵与 `Build/lib/ruleset-index-script.ts` 渐进增强脚本。页面零外部字体、零外部样式与脚本依赖。

视觉系统移植自 [coss ui](https://coss.com/ui)（MIT）：设计参数（颜色、圆角、边框、焦点环）与 Button、Badge、Kbd、Input、Frame、Command 的外观用纯 CSS 重写，不引入 React、Base UI 或 Tailwind。选型实验（行高密度、搜索形式、CSS 来源、字体）的测量数据记录在本地 `design-plans/coss-index/report.md`，未纳入版本库。

## 布局

页面采用 coss ui 的应用外壳结构：

- **吸顶顶栏（`.site-header`）**：半透明背景加 `8px` 背景模糊，左侧为 Tabler `route` 图标、`NRRule` 标题与等宽规范域名 `nrrule.pages.dev`，右侧为 `Search files…` 触发按钮（outline 小号按钮，带 `⌘` `K` 键帽）与 ghost 样式的 `GitHub` 链接。窄屏时操作区换到下一行。
- **Frame 外框（`.coss-frame`）**：灰底外框包住三层内容。头部（`.coss-frame-header`）放更新时间与规则集、文件数量的 secondary 小号 Badge；中间白底面板（`.coss-frame-panel`）放目录树；底部（`.coss-frame-footer`）放页脚链接。

| 视口宽度 | 容器 max-width |
|---|---:|
| <576px | 100% |
| ≥576px | 540px |
| ≥768px | 740px |
| ≥992px | 920px |
| ≥1200px | 1040px |

- **密度**：目录与文件行使用 coss 的 `text-sm`（`14px`），目录行高约 `32px`，对应 coss `CommandItem` / `SidebarMenuButton` 的 `h-8`。粗指针设备（`pointer: coarse`）保留 `44px` 最小点击高度。
- **字体栈**：系统无衬线（`--font-sans`）用于界面与目录，系统等宽（`--font-mono`）只用于域名与键帽。不加载 coss ui 文档站使用的 Cal Sans 与 Paper Mono，以保持零外部依赖。

## 颜色与主题

采用 coss ui 的中性色系统，两层 CSS 变量（coss 语义变量 → NRRule 语义别名），通过 `prefers-color-scheme` 跟随系统切换（切换瞬间临时禁用过渡），并适配 `prefers-contrast: more` 与 `forced-colors: active`。

| Token | Light | Dark |
|---|---|---|
| `--color-bg-page` | `#fafafa` | `#111111` |
| `--background` / `--card` | `#ffffff` | `#141414` |
| `--foreground` | `#262626` | `#f5f5f5` |
| `--muted-foreground` | `#686868` | `#bcbcbc` |
| `--border` | `oklab(0 0 0 / 0.08)` | `oklab(1 0 0 / 0.06)` |
| `--ring` | `#a1a1a1` | `#737373` |
| `--color-accent-text` | `#262626` | `#f5f5f5` |
| `--success` / `--success-foreground` | `#00bc7d` / `#007a55` | `#00bc7d` / `#00d492` |

强调色与正文同为中性黑白，只有更新状态圆点与复制成功反馈使用 `--success` 绿色。链接靠下划线与字重区分。

## 图标、目录树与交互

- **Tabler Icons（`1.5px` 描边，`currentColor`）**：目录闭合/展开（`folder` / `folder-open`）、合并集合（`stack-2` + `chevron-right`）、文件按扩展名区分文本规则（`file-text`）、JSON（`file-code`）与二进制数据库/压缩快照（`database`），以及搜索、关闭、复制与勾选。
- **目录结构**：顶层目录默认展开，`Mock` 和 `Internal` 默认折叠；嵌套分版目录（`domainset`、`non_ip`、`ip`）默认折叠；Clash、Loon、sing-box 根目录下的合并版文件收纳在 `Merged files` 分组中并显示文件计数。
- **复制按钮**：脚本为每个文件行注入 coss outline 超小号 `Copy` 按钮，复制完整订阅 URL 后切换为 `Copied`，图标以 `scale`、`opacity` 与 `blur` 交叉过渡（包裹在 `prefers-reduced-motion: no-preference` 内），并通过 `role="status"` 播报。本地预览（`file:`、`localhost`、`127.0.0.1`）时 URL 拼接 canonical 域名。
- **命令面板搜索（`#cmd-dialog`）**：原生 `<dialog>`，按 `⌘K` / `Ctrl+K` 或 `/` 打开，也可点击顶栏触发按钮。输入框按规则名、路径、客户端、分版多词过滤，结果按客户端分组，列出全部匹配文件，状态区显示匹配总数。支持 `↑` / `↓` 移动高亮、`Enter` 打开、`⌘C` / `Ctrl+C` 复制高亮行 URL、`Esc` 关闭并把焦点还给触发按钮。
- **无 JS**：触发按钮保持 `hidden`，不注入复制按钮，全部静态目录与文件链接正常可访问。

图标与样式归属说明见 [Build/assets/README](Build/assets/README.md)。
