# GitHub Pages 部署修复说明

## 🔍 问题诊断

经过分析 `.github/workflows/main.yml` 文件，发现了导致 GitHub Pages 部署失败的主要问题：

### 1. **权限不足** ⚠️
原始配置只有：
```yaml
permissions:
  contents: write
```

**缺少的关键权限：**
- `pages: write` - 部署到 GitHub Pages 的权限
- `id-token: write` - OIDC 令牌权限，用于验证部署来源

### 2. **缺少环境配置** ⚠️
GitHub Pages 部署需要指定 `github-pages` 环境以确保安全性和可追踪性。

### 3. **RAM 机制被意外禁用** 🔥
**关键发现**：网站构建步骤中设置了 `export OUTPUT_DIR="$(pwd)/public"`，这完全覆盖了构建脚本中的 RAM 机制！

```bash
# build-web-page.ts 中的 RAM 机制：
const OUTPUT_DIR = isCI 
  ? process.env.RAM_DIR || '/dev/shm/esdeath'  # 应该使用 RAM
  : process.env.OUTPUT_DIR || path.join(ROOT_DIR, 'public');

# 但 GitHub Actions 中强制覆盖了：
export OUTPUT_DIR="$(pwd)/public"  # ❌ 直接写磁盘，绕过 RAM
```

这导致：
- ❌ 构建过程直接写入磁盘，失去 RAM 加速优势
- ❌ 可能导致构建结果不完整
- ❌ 性能下降，构建时间增加

## 🔧 修复方案

### 根据 PR #190 审查意见的修复：

1. **分离构建和部署作业** ✅
```yaml
jobs:
  main_build:    # 构建作业 - 只需要 contents: write
    permissions:
      contents: write
  
  deploy:        # 部署作业 - 需要 Pages 权限
    needs: main_build
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
```

2. **修复 OIDC 认证** ✅
```yaml
# 移除错误的 token 参数，让 OIDC 自动处理
- name: 部署到 GitHub Pages
  uses: actions/deploy-pages@v4  # 不再传递 token
```

3. **修复 RAM 机制被覆盖的问题** ✅
```bash
# 之前：错误地覆盖了 OUTPUT_DIR
export OUTPUT_DIR="$(pwd)/public"  # ❌ 禁用了 RAM 机制

# 修复后：保持 RAM 机制，手动复制结果
# 不设置 OUTPUT_DIR，让脚本使用内置 RAM 机制
cp -r /dev/shm/esdeath/* public/  # ✅ 从 RAM 复制到最终目录
```

## 📝 关键概念说明

### OIDC 权限 (`id-token: write`)
- **作用**: 生成 OIDC JWT 令牌，用于身份验证
- **重要性**: GitHub Pages 使用此令牌验证部署请求的合法性
- **安全性**: 确保只有授权的工作流可以部署到 Pages

### Pages 权限 (`pages: write`)
- **作用**: 允许创建 GitHub Pages 部署
- **必要性**: 调用 GitHub API 创建部署时需要此权限

### 环境配置
- **目的**: 提供部署环境的安全隔离
- **追踪**: 便于查看部署历史和状态
- **保护**: 可以配置环境保护规则

## ✅ 验证步骤

修复后，请检查：

1. **仓库设置** → **Pages** → 确保源设置为 "GitHub Actions"
2. **Actions** 页面查看工作流运行状态
3. 确认 `public` 目录包含正确的 `index.html` 文件
4. 检查部署完成后的访问 URL

## 🔗 参考资料

- [GitHub Pages 官方文档](https://docs.github.com/en/pages)
- [actions/deploy-pages](https://github.com/actions/deploy-pages)
- [GitHub Actions 权限文档](https://docs.github.com/en/actions/security-guides/automatic-token-authentication)

## 🚀 预期结果

修复后，工作流应该能够：

### 构建阶段 (`main_build` 作业)：
1. ✅ 使用 RAM 磁盘 (`/dev/shm/esdeath`) 进行高速构建
2. ✅ 生成完整的网站文件（不只是基础 HTML）
3. ✅ 将 RAM 构建结果复制到 `public` 目录
4. ✅ 上传完整的构建产物

### 部署阶段 (`deploy` 作业)：
1. ✅ 使用正确的 OIDC 认证机制
2. ✅ 在独立的 `github-pages` 环境中运行
3. ✅ 成功部署到 GitHub Pages
4. ✅ 提供可访问的完整网站 URL

### 性能改进：
- 🚀 恢复 RAM 磁盘加速（预计提升 3-5x 构建速度）
- 📊 详细的构建统计信息
- 🔒 更安全的权限分离
- 📈 更好的部署追踪和监控

### 网站内容：
- 📄 完整的文件树界面（取代简单的 "Esdeath Rules" 页面）
- 🔍 搜索功能
- 📁 分类展示 Modules、List、Dial 等目录
- 🔗 一键复制和导入功能