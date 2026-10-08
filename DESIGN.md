# DESIGN.md · NRRule index page

## 参考与范围

本页采用 2026-10-08 核对的 [Sukka Ruleset Server](https://ruleset.skk.moe/) 目录树设计。样式来源为 [SukkaW/Surge 的 `Build/build-public.ts`](https://github.com/SukkaW/Surge/blob/6373d9aca136bf6b8f4ad091baebf50a8f088d4a/Build/build-public.ts)，页面身份与文件集合按 [PRODUCT](PRODUCT.md) 替换。

保留参考的系统字体、蓝灰配色、响应式容器、排版、图标与原生折叠行为。字体、颜色、命中区和间距以参考 CSS 为准，不添加独立的字号或触控尺寸下限。

## 布局与排版

页面为一个居中的 `main.container`。正文左右留白由容器控制，主区域上下 padding 为 `2rem`；在 576px 起的断点取消容器左右 padding。

| 视口宽度 | 容器 max-width | 正文字号 | 容器左右 padding |
|---|---:|---:|---:|
| <576px | 100% | 16px | 1rem |
| ≥576px | 510px | 17px | 0 |
| ≥768px | 700px | 18px | 0 |
| ≥992px | 920px | 19px | 0 |
| ≥1200px | 1130px | 20px | 0 |

字体栈为 `system-ui, -apple-system, "Segoe UI", "Roboto", "Ubuntu", "Cantarell", "Noto Sans", sans-serif`，随后为参考中的系统 emoji 回退字体。目录、文件名和正文共用这个字体栈，不下载 webfont。正文 font-weight 为 400，line-height 为 1.5；H1 为 700、2rem，下边距为 3rem。普通段落下边距为 1.5rem。

目录行使用原生文本行高与链接命中区。16px 正文字号对应 24px line box，20px 对应 30px；`li` 下边距为 `0.375rem`，分别为 6px 和 7.5px。不要通过固定行高、额外按钮或扩大的点击层改变参考的目录密度。

## 颜色与主题

主题由 `prefers-color-scheme` 跟随系统，不增加主题切换器。

| CSS token | Light | Dark |
|---|---|---|
| `--background-color` | `#fff` | `#11191f` |
| `--color` | `#415462` | `#bbc6ce` |
| `--h1-color` | `#1b2832` | `#edf0f3` |
| `--h3-color` | `#2c3d49` | `#d5dce2` |
| `--muted-color` | `#73828c` | `#73828c` |
| `--primary` | `#1095c1` | `#1095c1` |
| `--primary-hover` | `#08769b` | `#1ab3e6` |
| `--secondary` | `#596b78` | `#596b78` |
| `--secondary-hover` | `#415462` | `#73828c` |

作者、源码和许可证链接使用 primary 色。文件链接使用正文色与 1px secondary 下边框，hover 时使用 h3 色和 secondary-hover 边框；不要将全部文件链接改成 primary 色。图标按参考的 light / dark 内联 SVG 切换。

## 目录树与交互

树的 DOM 为 `ul.tree`，目录为 `li.folder > details > summary + ul`，文件为 `li.file > a.file-link`。顶层默认展开，`Mock`、`Internal` 默认折叠，所有嵌套目录默认折叠。目录标签是实际名称，文件标签是带扩展名的实际文件名。

- `--tree-spacing: 1.5rem`，`--radius: 10px`。
- 子级 `li` 的左 padding 为 `calc(2 * var(--tree-spacing) - var(--radius) - 2px)`；子 `ul` 左 margin 为 `calc(var(--radius) - var(--tree-spacing))`，左 padding 为 0。
- 文件与目录图标框为 20px × 20px，右 margin 为 10px，背景图尺寸为 `75% auto`。目录展开时替换为参考的 open-folder SVG。
- 隐藏默认 summary marker，以图标表达目录状态。summary 使用 pointer cursor，`focus-visible` 保留参考的 `1px dotted #000` outline。
- 文件链接采用参考的 `all 0.2s ease` transition；`details` 直接由浏览器展开与收起，不添加高度动画。

页面不需要应用 JavaScript。键盘操作使用原生 summary 和链接行为；长文件名按参考的 `overflow-wrap: break-word` 换行。订阅格式、规则用途和 MITM 配置说明保留在 README，不放入额外卡片或提示面板。

## 验收

使用相同浏览器、视口与系统配色对照参考，检查标题区、容器宽度、系统字体、正文行高、目录缩进、图标、链接与默认折叠状态。覆盖移动端和桌面端的 light / dark；在需要时展开同名目录比较其子级结构。

NRRule 的标题、作者链接、构建时间、真实目录与文件数量会与参考不同，因此页面总高度和内容换行随实际数据变化。每个文件链接必须落到 NRRule 自身的正确路径，四个客户端目录的可见文件必须与本次产物一致。CSS 来源与许可见 [Build/assets/README](Build/assets/README.md)。
