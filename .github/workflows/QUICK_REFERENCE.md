# 🚀 快速参考卡片

## 📋 平台构建目标速查

| 平台 | BUILD_TARGET | 主要特性 | 构建时间 |
|------|--------------|----------|----------|
| **GitHub Pages** | `github-pages` | Jekyll、SEO、Sitemap | ~4 分钟 |
| **Cloudflare Pages** | `cloudflare-pages` | Edge、Brotli、HTTP/2 | ~5 分钟 |
| **NRRule Repo** | `nrrule-repo` | 去重、归档、CDN | ~4 分钟 |

---

## 🔧 常用环境变量

### GitHub Pages
```bash
BUILD_TARGET=github-pages
ENABLE_JEKYLL=true
ENABLE_COMPRESSION=true
OUTPUT_FORMAT=static
```

### Cloudflare Pages
```bash
BUILD_TARGET=cloudflare-pages
ENABLE_EDGE_OPTIMIZATION=true
CF_ENVIRONMENT=production
```

### NRRule Repository
```bash
BUILD_TARGET=nrrule-repo
OPTIMIZE_FOR_CDN=true
ENABLE_COMPRESSION=true
```

---

## 🎯 手动触发工作流

### 部署到所有平台
```bash
gh workflow run deploy.yml -f target=all -f environment=production
```

### 部署到 GitHub Pages
```bash
gh workflow run deploy.yml -f target=github -f environment=production
```

### 部署到 Cloudflare
```bash
gh workflow run deploy.yml -f target=cloudflare -f environment=staging
```

---

## 📊 构建对比

### 修改前 (复用 Artifact)
```
✅ 快速 (~1 分钟/平台)
✅ 节省 Actions 分钟数
❌ 无法定制化
❌ 所有平台相同构建
```

### 修改后 (独立构建)
```
✅ 完全定制化
✅ 平台特定优化
✅ 灵活配置
❌ 较慢 (~4-5 分钟/平台)
```

---

## 🔍 调试命令

### 查看工作流状态
```bash
gh workflow view deploy.yml
```

### 查看最近运行
```bash
gh run list --workflow=deploy.yml --limit=5
```

### 查看运行日志
```bash
gh run view <run-id> --log
```

### 查看特定任务日志
```bash
gh run view <run-id> --log --job=<job-id>
```

---

## 📁 关键文件位置

```
.github/workflows/
├── deploy.yml                    # 部署工作流
├── build-config.json             # 平台配置
├── PLATFORM_CUSTOMIZATION.md     # 定制化指南
├── UPGRADE_SUMMARY.md            # 升级总结
└── QUICK_REFERENCE.md            # 本文件

Build/lib/
└── platform-builder.ts           # 构建器实现
```

---

## ⚡ 性能优化技巧

### 1. 启用缓存
```yaml
- uses: actions/cache@v4
  with:
    path: ${{ steps.pnpm-cache.outputs.STORE_PATH }}
    key: ${{ runner.os }}-pnpm-store-${{ hashFiles('**/pnpm-lock.yaml') }}
```

### 2. 并行部署
```yaml
# 各平台独立运行，自动并行
deploy-github-pages: ...
deploy-cloudflare: ...
deploy-to-nrrule: ...
```

### 3. 跳过不必要步骤
```yaml
- name: Optional step
  if: env.ENABLE_FEATURE == 'true'
  run: ...
```

---

## 🛠️ 故障排查

### 问题 1: 构建失败
```bash
# 检查环境变量
echo $BUILD_TARGET

# 验证配置文件
cat .github/workflows/build-config.json | jq .
```

### 问题 2: 部署失败
```bash
# 检查 Secrets
gh secret list

# 验证权限
gh auth status
```

### 问题 3: 缓存问题
```bash
# 清理缓存
gh cache delete <cache-key>

# 列出所有缓存
gh cache list
```

---

## 📞 获取帮助

1. **查看文档**
   - [平台定制化指南](./PLATFORM_CUSTOMIZATION.md)
   - [升级总结](./UPGRADE_SUMMARY.md)
   - [工作流文档](./README.md)

2. **检查日志**
   ```bash
   gh run view --log
   ```

3. **提交 Issue**
   - 描述问题
   - 附上日志
   - 说明环境

---

## 🎓 最佳实践清单

- [ ] 使用稳定的缓存键
- [ ] 启用 pnpm store 缓存
- [ ] 设置合理的超时时间
- [ ] 添加错误处理
- [ ] 记录详细日志
- [ ] 定期清理缓存
- [ ] 监控 Actions 配额
- [ ] 测试后再部署到生产环境

---

**更新时间**: 2024-10-15  
**版本**: v2.0.0

