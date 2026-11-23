# DESIGN.md · NRRule index page

## 概览与范围

NRRule 索引页由 `Build/build-public.ts` 生成，内联 `Build/assets/ruleset-index.css`、官方 Tabler Icons（MIT，`24×24` 网格、`1.5px` 细描边）SVG `<symbol>` 精灵与 `Build/lib/ruleset-index-script.ts` 渐进增强脚本。页面零外部字体、零外部样式与脚本依赖。

## 布局与排版

居中 `main.container` 随视口自适应宽度，顶部分为两行式紧凑页头（`.masthead`），下方以 `1px solid var(--color-separator)` 分隔目录树与页脚（`.page-foot`）。

| 视口宽度 | 容器 max-width | 基准字号 | 容器左右 padding |
|---|---:|---:|---:|
| <576px | 100% | 16px | 1rem |
| ≥576px | 520px | 16.5px | 0 |
| ≥768px | 720px | 17px | 0 |
| ≥992px | 900px | 17.5px | 0 |
| ≥1200px | 1040px | 18px | 0 |

- **页头第一行**：无底盒 Tabler `route` 图标 + `NRRule` 主标题（`-0.03em` 字距）+ 同基线等宽规范域名 `nrrule.pages.dev`；右侧为无框轻量 `GitHub` 链接（Tabler `brand-github`）。
- **页头第二行**：左侧为静态翠绿状态圆点 + 易读 UTC 更新时间（`Nov 20, 2026 · 09:15 UTC`，完整 ISO 保留在 `<time datetime>` 与 `title`）及 `tabular-nums` 统计（规则集数与文件数）；右侧为常驻内联搜索框（同心圆角：`8px` 外框与 `4px` 内置 `/` 提示及清空 `×` 按钮，移动端输入框保持 `16px` 防 iOS 缩放）。
- **字体栈**：系统无衬线用于界面与目录列表，系统等宽仅用于域名 `nrrule.pages.dev` 与快捷键标识；全站根元素统一启用抗锯齿。

## 颜色与主题

采用两层 CSS 变量（原始色阶 -> 语义 token），仅通过 `prefers-color-scheme` 跟随系统切换（切换瞬间临时禁用过渡避免换肤拖影），并适配 `prefers-contrast: more` 与 `forced-colors: active`。

| Semantic token | Light | Dark |
|---|---|---|
| `--color-bg-page` | `#ffffff` | `#10171d` |
| `--color-bg-surface` | `#f7f9fb` | `#162028` |
| `--color-bg-row-hover` | `#f3f6f8` | `#18222a` |
| `--color-text-heading` | `#152028` | `#eef3f6` |
| `--color-text-primary` | `#334552` | `#cdd7df` |
| `--color-text-muted` | `#526370` | `#adbac4` |
| `--color-accent-text` | `#09698c` | `#5ac4ea` |
| `--color-success-bg` / `--color-success-text` | `#eaf7ef` / `#0d663b` | `#102c1c` / `#82cfa0` |

所有正文与次级文字均满足 WCAG 2.1 AA 与 APCA 阈值（正文 ≥ Lc 75，次级/强调 ≥ Lc 60）。

## 图标、目录树与交互

- **统一 Tabler Icons（`1.5px` 描边，`currentColor`）**：目录闭合/展开（`folder` / `folder-open`）、合并集合（`stack-2` + `chevron-right`）、文件按扩展名区分文本规则（`file-text`）、JSON（`file-code`）与二进制数据库/压缩快照（`database`）。
- **目录结构**：顶层目录默认展开，`Mock` 和 `Internal` 默认折叠；嵌套分版目录（`domainset`、`non_ip`、`ip`）默认折叠；各客户端根目录下的合并版文件折叠收纳在 `Merged files` 分组中并显示实时文件计数徽标。
- **悬挂对齐与引导线**：目录与文件行使用 flex 悬挂对齐，长文件名换行不回折到图标下方；子目录附带极淡垂直引导线（`--color-guide`），精细指针悬停时浮现柔和底色与就近复制按钮。
- **渐进增强交互**：支持实时多词搜索、`/` 快捷聚焦、`Esc` 清空/失焦、文件行一键复制完整订阅 URL（带 `scale(0.25 -> 1)`、`opacity` 与 `blur(4px -> 0)` 图标交叉过渡，包裹在 `prefers-reduced-motion: no-preference` 内，并通过 `role="status"` 播报）；关闭 JavaScript 时搜索框隐藏、不注入复制按钮，全部静态链接正常可访问。

图标与样式归属说明见 [Build/assets/README](Build/assets/README.md)。
