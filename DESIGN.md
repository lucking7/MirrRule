# DESIGN.md · NRRule index page

既有视觉世界的成文规则。适用于 `Build/build-public.ts` 生成的 `public/index.html`。

## World: Austere Workbench (evolved 2026-07)

工作台，不是画册。信息密度服务于"找规则 → 复制 URL"的单任务；装饰让位于扫描速度。

### Color

- 策略：**Restrained**（中性暖纸 + 单 accent）。使用场景：个人桌面浏览器，室内光，light 为主、dark 跟随系统。
- 硬规则：**light 与 dark 两套 token 都必须独立通过 WCAG AA**（正文/功能文本 ≥4.5:1）。历史事故：light 的 muted 2.41:1 全线失败而 dark 通过，改 token 时两套都要复测。
- 角色：`paper` 底 / `surface` 卡片 / `ink` 主文本 / `muted` 次要文本 / `line` 发丝分隔 / `accent` 链接与确认态 / `hot` hover 底。

### Type

- IBM Plex 双族：`--font-ui` (Sans) 承担 UI 与中文回退；`--font-mono` 承担数据。中文无 Plex 覆盖，自然回退系统字体，不为中文指定 webfont。
- **数据用 Mono，动作用 Sans**：规则名、文件名、路径、URL、客户端标识（chips）、计数、时间戳、搜索输入、kbd 用 Mono；Copy URL / Expand all / clear 等动作动词用 Sans。section header 作为数据组标签保留 Mono（incumbent workbench 身份）。
- 功能性文本（按钮、链接、计数、标签）**≥13px**；正文 15-16px。历史事故：12px 按钮 + 13px 文件链接被 detector 全线标出。
- 13px 是**无例外地板**：`kbd`、`root-badge` 等 chrome 也在其上，`--text-2xs` token 已移除，避免再被引用。
- tracking 地板 -0.03em；display 字号仅 h1 一处。

### Components

- **Rule card（核心）**：accordion。折叠行 = 规则名 + 四客户端可用性字母（S·C·L·X）；展开 = 每客户端一行：客户端名 + 文件名 + 打开链接 + Copy。一行一格式，格式永不并列隐藏。
- **Copy feedback**：复制后在卡片内驻留确认条（状态 + 可选中的绝对 URL + 关闭），不用纯闪现动画；clipboard 失败时同一确认条降级为手动复制路径。
- **Buttons**：ghost（1px 边框 + ink 文本）为默认；ink 实底仅留给当前确认态。不在列表里铺满实底黑按钮。
- **Chips**：client filter（All/Surge/Clash/Loon/sing-box）+ quick search，圆角 2px、mono 13px、min-height 44px 触控基线。
- **Other roots**（GeoIP / Mirror / Modules）：不参与卡片模型，用通用树或扁平行渲染，样式同 token；树上方带与 Rules 同形的 section header（标题 + 计数），让两块内容读作同一层级的两组，而不是一块无名附属物。

### Layout

- 单列窄 measure（≤52rem），controls sticky；移动端 chips 横向滚动而非换行堆叠。
- 触控目标 ≥44px；焦点环 2px accent + offset，keyboard 全程可达。

### Motion

- 仅 transform/color/background 类 140ms ease-out；`prefers-reduced-motion` 全局关停。accordion 展开不做过场动画（details 原生切换即可）。

### Refused（本页明确拒绝）

- 实底主按钮在列表行内重复出现（按钮墙）。
- 用扩展名让用户的记忆承担格式语义（.txt/.json 必须有客户端名陪同）。
- 纯 toast/闪现作为唯一操作反馈。

### Implementation status（2026-07）

- rule cards + 卡片内 copied strip + ghost buttons 已在 `Build/build-public.ts` 落地。
- 客户端顺序单一真源为 `CLIENT_DIRS`（`List` / `Clash` / `Loon` / `sing-box`），chips、可用性字母、展开格式行三处共用，渲染恒为 S·C·L·X；顺序由 `Build/__tests__/build-public.test.ts` 锁定。
- `.copy-btn:hover` 仅换 `--color-hot` 底，不做 ink 实底；实底/accent 仅用于确认态。
- 门禁（每次改动后复测，非可选）：功能性文本 ≥13px、触控目标 ≥44px、light 与 dark 两套 token 各自 ≥4.5:1。
- 触控地板的实现有两种：常规控件用 `min-height: 2.75rem`；`clear` 这类不能撑高所在行的控件用 `::after` 扩展命中区，视觉尺寸不变。
- Other roots 的 section header 与 Rules 共用 `.section-h`，两段 section 统一 `display: grid` + `--space-3` 间距。
