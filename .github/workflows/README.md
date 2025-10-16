# GitHub Actions 工作流文档

## 📋 工作流概览

本项目使用 GitHub Actions 实现完整的 CI/CD 自动化流程，包含以下工作流：

| 工作流       | 文件                      | 触发条件                     | 功能描述                |
| ------------ | ------------------------- | ---------------------------- | ----------------------- |
| **主构建**   | `main.yml`                | Push/PR/定时(每天 2 次)      | 构建所有规则和模块      |
| **规则转换** | `rule-conversion.yml`     | 定时(每 2 小时)/手动         | 跨平台规则格式转换      |
| **规则合并** | `rule-merge.yml`          | 定时(每 4 小时)/依赖转换完成 | 多源规则智能合并去重    |
| **模块合并** | `merge-modules.yml`       | 定时(每 6 小时)/手动         | 多模块合并为 All-in-One |
| **镜像同步** | `mirror-sync.yml`         | 定时(每小时)/手动            | GitHub Release 同步     |
| **插件转换** | `convert-plugins.yml`     | 定时(每小时)/手动            | Loon → Surge 插件转换   |
| **域名检查** | `check-source-domain.yml` | 手动                         | 检查域名有效性          |
| **部署**     | `deploy.yml`              | 构建成功后/手动              | 部署到 Pages/CDN        |

## 🚀 快速开始

### 本地运行工作流脚本

```bash
# 安装依赖
pnpm install

# 运行单个工作流
pnpm run convert-rules    # 规则转换
pnpm run merge-rules      # 规则合并
pnpm run merge-modules    # 模块合并
pnpm run convert-plugins  # 插件转换
pnpm run sync-mirrors     # 镜像同步

# 运行组合工作流
pnpm run workflow:all     # 运行所有工作流
pnpm run workflow:rules   # 仅运行规则相关工作流
pnpm run workflow:modules # 仅运行模块相关工作流
```

### 手动触发工作流

在 GitHub Actions 页面，选择对应的工作流，点击 "Run workflow" 按钮。

## 📝 工作流详细说明

### 1. 主构建工作流 (main.yml)

**功能**：

- 构建所有规则文件
- 生成清单文件
- 缓存管理
- 构建验证

**触发条件**：

- Push 到 main/master 分支
- Pull Request
- 定时：每天 05:00 和 17:00 UTC

**输入参数**（workflow_dispatch）：

- `skip_cache`: 跳过缓存恢复
- `full_build`: 运行完整构建

### 2. 规则转换工作流 (rule-conversion.yml)

**功能**：

- 支持 Surge/Clash/QuantumultX/Shadowrocket 格式转换
- 分类管理（广告拦截/隐私保护/流媒体/社交/通用）
- 智能去重
- 增量更新

**触发条件**：

- 定时：每 2 小时
- 手动触发
- Push 到相关文件

**输入参数**：

- `platform`: 目标平台 (all/surge/clash/quantumultx/shadowrocket)
- `category`: 规则类别 (all/ad-block/privacy/streaming/social)

**输出文件**：

```
public/Rules/
├── Surge/
│   ├── ad-block.list
│   ├── privacy.list
│   └── ...
├── Clash/
│   ├── ad-block.yaml
│   └── ...
├── QuantumultX/
│   └── ...
└── Shadowrocket/
    └── ...
```

### 3. 规则合并工作流 (rule-merge.yml)

**功能**：

- 多源规则聚合
- 三种合并策略：
  - `smart`: 智能去重（默认）
  - `aggressive`: 激进合并（保留更多规则）
  - `conservative`: 保守合并（只保留确定规则）
- 自动去重和优化

**触发条件**：

- 定时：每 4 小时
- 规则转换工作流完成后
- 手动触发

**输入参数**：

- `merge_strategy`: 合并策略

**输出文件**：

```
public/Rules/Merged/
├── merged-all.list       # 所有规则
├── merged-domain.list    # 域名规则
├── merged-ip.list        # IP 规则
├── merged-keyword.list   # 关键词规则
└── metadata.json         # 元数据
```

### 4. 模块合并工作流 (merge-modules.yml)

**功能**：

- 合并多个模块为 All-in-One
- 支持 Surge 模块和 Stash 覆写
- 冲突规则处理
- 自动生成目录

**触发条件**：

- 定时：每 6 小时
- 手动触发

**输入参数**：

- `module_groups`: 模块组 (all/base/premium/custom)
- `output_format`: 输出格式 (surge/stash/both)

**输出文件**：

```
public/Modules/Merged/
├── all-in-one.sgmodule
├── all-in-one.stoverride
└── README.md
```

### 5. 部署工作流 (deploy.yml)

**功能**：

- 部署到 GitHub Pages
- 部署到 Cloudflare Pages（需配置）
- 部署到 NRRule Repository（自动归档）
- 部署状态通知

**✨ 新特性 - 独立构建策略**：

- ✅ 每个平台独立构建，互不影响
- ✅ 针对不同平台的定制化优化
- ✅ 支持平台特定的环境变量
- ✅ 灵活的构建配置

**触发条件**：

- 主构建工作流成功后
- 手动触发

**输入参数**：

- `target`: 部署目标 (all/github/cloudflare)
- `environment`: 部署环境 (production/staging)

**平台定制化**：

| 平台                 | 构建目标           | 特性                    | 优化                       |
| -------------------- | ------------------ | ----------------------- | -------------------------- |
| **GitHub Pages**     | `github-pages`     | Jekyll 支持、SEO 优化   | 静态资源压缩、Sitemap 生成 |
| **Cloudflare Pages** | `cloudflare-pages` | Edge 优化、Workers 集成 | Brotli 压缩、HTTP/2 Push   |
| **NRRule Repo**      | `nrrule-repo`      | 自动归档、CDN 友好      | 文件去重、大小优化         |

详细配置请参考 [平台定制化指南](./PLATFORM_CUSTOMIZATION.md)

## ⚙️ 配置要求

### 必需的 Secrets

在仓库设置中配置以下 Secrets：

| Secret 名称            | 说明                 | 是否必需 |
| ---------------------- | -------------------- | -------- |
| `GITHUB_TOKEN`         | GitHub 默认提供      | ✅ 必需  |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token | ⚠️ 可选  |
| `GITLAB_TOKEN`         | GitLab 访问令牌      | ⚠️ 可选  |
| `GITLAB_EMAIL`         | GitLab 邮箱          | ⚠️ 可选  |
| `GITLAB_USER`          | GitLab 用户名        | ⚠️ 可选  |
| `GITLAB_TOKEN_NAME`    | GitLab Token 名称    | ⚠️ 可选  |

### 必需的 Variables

| Variable 名称           | 说明               | 是否必需 |
| ----------------------- | ------------------ | -------- |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID | ⚠️ 可选  |

## 🔧 故障排除

### 常见问题

1. **工作流未触发**

   - 检查分支名称是否正确（main/master）
   - 检查 cron 表达式是否正确
   - 确认有相应的权限

2. **缓存问题**

   - 使用 `skip_cache` 参数跳过缓存
   - 手动清理 Actions 缓存

3. **部署失败**
   - 检查 Secrets 配置
   - 确认目标服务可用
   - 查看详细错误日志

## 📊 性能优化

### 缓存策略

- 使用分层缓存键，优先恢复最近的缓存
- pnpm store 缓存，加速依赖安装
- 构建产物缓存，支持增量构建

### 并发控制

- 使用 `concurrency` 避免重复运行
- 合理设置定时任务间隔，避免冲突

### 资源优化

- 使用 ARM 运行器降低成本
- 合理设置 artifact 保留时间
- 压缩级别优化

## 📈 监控和通知

### 查看运行状态

1. 访问仓库的 Actions 页面
2. 选择对应的工作流查看历史运行
3. 点击具体运行查看详细日志

### 部署状态

部署工作流会生成详细的部署摘要，包括：

- 各平台部署状态
- 部署时间
- 相关链接

## 🤝 贡献指南

1. 修改工作流前，先在分支测试
2. 添加新工作流时，更新本文档
3. 保持工作流的幂等性
4. 添加适当的错误处理

## 📚 参考资源

- [GitHub Actions 文档](https://docs.github.com/actions)
- [Cloudflare Pages 文档](https://developers.cloudflare.com/pages)
- [GitLab CI/CD 文档](https://docs.gitlab.com/ee/ci/)

---

更新时间：2024-10-14
