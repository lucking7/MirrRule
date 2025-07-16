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

## 🔧 修复方案

### 已应用的修复：

1. **添加必要权限**
```yaml
permissions:
  contents: write
  pages: write      # GitHub Pages 部署权限
  id-token: write   # OIDC 令牌权限
```

2. **添加环境配置**
```yaml
environment:
  name: github-pages
  url: ${{ steps.deployment.outputs.page_url }}
```

3. **优化部署步骤**
```yaml
- name: 部署到 GitHub Pages
  id: deployment
  uses: actions/deploy-pages@v4
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
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
1. 成功构建网站文件到 `public` 目录
2. 正确上传构建产物
3. 成功部署到 GitHub Pages
4. 提供可访问的网站 URL