# 🌐 Sukka Ruleset

> 高质量、自动化维护的网络代理规则集，支持多种客户端平台

[![🚀 Deploy to GitHub Pages](https://github.com/SukkaW/Surge/actions/workflows/deploy.yml/badge.svg)](https://github.com/SukkaW/Surge/actions/workflows/deploy.yml)
[![License](https://img.shields.io/github/license/SukkaW/Surge)](./LICENSE)

## 📋 功能特性

### 🎯 多平台支持

- **Surge** (Mac/iOS/tvOS) - 原生优化支持
- **Clash Meta (mihomo)** - 完整兼容
- **sing-box** - 专门优化的 headless 规则格式
- **Surfboard** (Android) - 基于 Surge 格式
- **Clash Premium (Dreamacro)** - 传统 Clash 支持

### 🏗️ 自动化构建系统

- 📥 **数据源聚合** - 从 GitHub、主流过滤列表、官方 API 等获取最新规则
- 🔧 **智能处理** - 自动去重、域名标准化、规则格式转换
- 📤 **多格式输出** - 针对不同客户端生成相应格式的规则文件
- ✅ **质量保证** - 内置验证机制确保规则有效性

### 📋 规则分类系统

1. **domainset** - 纯域名规则，不触发 DNS 解析，性能最优
2. **non_ip** - 非 IP 规则，不触发 DNS 解析，适用于域名和关键词匹配
3. **ip** - IP/CIDR 规则，会触发 DNS 解析，用于地理位置和 IP 段匹配

### 🛡️ 功能类别覆盖

- 🚫 **广告拦截** - 基础 12 万+扩展 20 万拦截域名
- 🔒 **隐私保护** - 反追踪、反挖矿、反钓鱼
- 📺 **流媒体分流** - 按地区精确分流(美国、欧洲、日本、韩国、香港、台湾)
- ⚡ **服务优化** - Apple CDN、Microsoft CDN、Telegram、AI 服务
- 📊 **网络测速** - Speedtest、网络质量测试工具
- 🌍 **地理路由** - 中国大陆 IP、ASN 规则

## 🚀 快速开始

### 安装依赖

```bash
# 安装 pnpm (推荐)
npm install -g pnpm

# 安装项目依赖
pnpm install
```

### 构建规则集

```bash
# 完整构建（包含前端网页）
pnpm build

# 仅构建前端网页
pnpm build-web

# 部署准备
pnpm deploy
```

### 开发环境

```bash
# 运行测试
pnpm test

# 代码检查
pnpm lint

# 性能测试
pnpm bench
```

### 🎨 前端 UI 开发

项目提供两种前端界面方案：

#### 方案 1: React 管理界面 (推荐)

```bash
# 安装UI依赖
pnpm ui:install

# 启动开发服务器 (http://localhost:3000)
pnpm ui:dev

# 或使用快速启动脚本
./start-ui-dev.sh

# 构建生产版本
pnpm ui:build
```

#### 方案 2: 静态 HTML 页面

```bash
# 构建静态HTML (public/index.html)
pnpm build-web
```

**特性对比:**

- **React 界面**: 交互式管理界面，实时构建监控，规则管理
- **静态页面**: 简单的文件浏览器，适用于快速访问规则文件

## 🌐 在线访问

- **官方网站**: [ruleset.skk.moe](https://ruleset.skk.moe)
- **镜像站点**: [ruleset-mirror.skk.moe](https://ruleset-mirror.skk.moe)

## 📖 使用指南

### Surge 用户

```ini
# 在 Surge 配置文件中添加
[Rule]
RULE-SET,https://ruleset.skk.moe/List/non_ip/reject.conf,REJECT

[Host]
*.example.com = server:1.1.1.1
```

### Clash Meta 用户

```yaml
# 在 Clash Meta 配置文件中添加
rule-providers:
  reject:
    type: http
    behavior: domain
    url: 'https://ruleset.skk.moe/Clash/non_ip/reject.txt'
    path: ./ruleset/reject.yaml
    interval: 86400

rules:
  - RULE-SET,reject,REJECT
```

### sing-box 用户

```json
{
  "route": {
    "rule_set": [
      {
        "tag": "reject",
        "type": "remote",
        "format": "binary",
        "url": "https://ruleset.skk.moe/sing-box/non_ip/reject.json"
      }
    ],
    "rules": [
      {
        "rule_set": "reject",
        "outbound": "block"
      }
    ]
  }
}
```

## 🔧 技术架构

### 核心技术栈

- **Node.js** + **TypeScript** - 主要运行环境
- **pnpm** - 包管理器
- **SWC** - 高性能编译器
- **better-sqlite3** - 缓存数据库

### 构建系统

- **多平台输出策略** - 统一的规则处理和格式转换
- **智能缓存系统** - HTTP 缓存 + SQLite 存储
- **并行处理** - 多源规则并行获取和处理
- **增量构建** - 基于配置哈希的智能跳过机制

### 输出格式

- `List/` - Surge 原生格式
- `Clash/` - Clash Meta 格式
- `sing-box/` - sing-box 专用格式
- `Surfboard/` - Surfboard 兼容格式

## 📊 项目统计

- **规则组**: 15+ 个
- **特殊规则**: 14+ 个
- **支持平台**: 7 个
- **处理规则**: 168,000+ 条
- **构建时间**: < 60 秒

## 🤝 参与贡献

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开 Pull Request

## 📄 许可协议

- 大部分文件使用 **AGPL-3.0** 开源协议
- `List/ip/china_ip.conf` 使用 **CC BY-SA 2.0** 协议
- 项目不提供任何技术支持保证

## 🙏 致谢

感谢以下数据源提供商和开源项目：

- [AdGuard](https://github.com/AdguardTeam/AdguardFilters)
- [EasyList](https://easylist.to/)
- [Peter Lowe's Ad and tracking server list](https://pgl.yoyo.org/adservers/)
- [Loyalsoldier](https://github.com/Loyalsoldier)
- 以及众多规则维护者和贡献者

---

<div align="center">

**[🌟 Star](https://github.com/SukkaW/Surge)** | **[🐛 Report Issues](https://github.com/SukkaW/Surge/issues)** | **[📝 Documentation](https://blog.skk.moe)**

Made with ❤️ by [Sukka](https://skk.moe)

</div>
