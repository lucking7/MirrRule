# PRODUCT.md · NRRule

## What this is

NRRule 是一个个人代理规则镜像与索引站（`nrrule.pages.dev`），由 MirrRule 仓库的构建脚本生成。产物：Surge / Clash / Loon / sing-box 四平台的规则文件 + GeoIP 数据 + 上游模块镜像。

## Audience

- 主用户：站长本人（power user），高频动作 = 搜规则名 → 复制对应客户端的订阅 URL。
- 次用户：偶然到访的同好，需要不看源码也能完成同上动作。

## The one task

**找到规则 → 选对客户端格式 → 复制绝对 URL 进代理客户端。**

失败模式只有一种是致命的：复制了错误客户端的格式（.list/.txt/.json 混淆），客户端静默导入失败。界面的一切优先级服从于让格式选择显式化。

## Facts the UI may rely on

- 规则以 basename 跨平台一一对应（本地实测 47 条规则 × 4 平台，全覆盖）。
- 平台 → 客户端映射：`List`→Surge(.list)、`Loon`→Loon(.list)、`Clash`→Clash(.txt)、`sing-box`→sing-box(.json)。
- `GeoIP/` 是 .mmdb 数据文件，不是规则，不参与卡片模型。
- 生产环境额外有 `Mirror/`、`Modules/` 等深层目录，非规则内容，走通用树渲染。
- 站点是纯静态单文件 `index.html`（内联 CSS/JS，零框架），由 `pnpm run build-web` 生成。

## Brand commitments

- 个人工具，不做营销叙事；语言中英混排，控制键文案用英文（Copy / clear / find），说明文案用中文。
- Warm paper + IBM Plex 的 austere workbench 气质为既定方向（2026-07 用户确认：Workbench 进化，不换品牌）。
