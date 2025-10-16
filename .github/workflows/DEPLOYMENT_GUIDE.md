# 🚀 部署测试指南

**仓库地址**: https://github.com/lucking7/esdeath  
**推送状态**: ✅ 成功  
**推送时间**: 2024-10-16  

---

## 📋 推送内容总结

### **提交信息**
```
feat: 升级为独立构建模式，支持平台定制化

- 每个部署任务独立构建（GitHub Pages、Cloudflare Pages、NRRule Repo）
- 添加平台特定环境变量和优化配置
- 添加 pnpm 缓存优化
- 保持仓库归档/解归档功能不变
- 新增完整文档体系（6个文档）
- 新增平台构建器实现
- 新增自动化测试脚本
```

### **推送统计**
- **对象总数**: 310 个
- **压缩对象**: 300 个
- **传输大小**: 782.87 KiB
- **传输速度**: 12.23 MiB/s
- **推送方式**: 强制推送 (forced update)

---

## ⚙️ 配置 GitHub Secrets

在运行工作流之前，需要配置以下 Secrets：

### **必需的 Secrets**

1. **Cloudflare Pages 部署**
   ```
   CLOUDFLARE_API_TOKEN    # Cloudflare API Token
   ```

2. **Cloudflare Pages 变量**
   ```
   CLOUDFLARE_ACCOUNT_ID   # Cloudflare Account ID (Variables)
   ```

3. **NRRule Repository 部署**
   ```
   GIT_EMAIL               # Git 提交邮箱
   GIT_USER                # Git 用户名
   GIT_TOKEN               # GitHub Personal Access Token
   ```

### **配置步骤**

1. **访问仓库设置**
   ```
   https://github.com/lucking7/esdeath/settings/secrets/actions
   ```

2. **添加 Secrets**
   - 点击 "New repository secret"
   - 输入 Name 和 Value
   - 点击 "Add secret"

3. **添加 Variables**
   ```
   https://github.com/lucking7/esdeath/settings/variables/actions
   ```
   - 添加 `CLOUDFLARE_ACCOUNT_ID`

---

## 🧪 测试部署工作流

### **方法 1: 通过 GitHub Actions 界面**

1. **访问 Actions 页面**
   ```
   https://github.com/lucking7/esdeath/actions
   ```

2. **选择工作流**
   - 点击左侧 "Deploy to Multiple Platforms"

3. **手动触发**
   - 点击右侧 "Run workflow" 按钮
   - 选择参数:
     - **Branch**: `main`
     - **Deployment target**: 
       - `all` - 部署到所有平台
       - `github` - 仅 GitHub Pages
       - `cloudflare` - 仅 Cloudflare Pages
     - **Environment**: 
       - `production` - 生产环境
       - `staging` - 测试环境
   - 点击绿色 "Run workflow" 按钮

### **方法 2: 通过 GitHub CLI**

```bash
# 部署到所有平台 (生产环境)
gh workflow run deploy.yml \
  -f target=all \
  -f environment=production

# 仅部署到 GitHub Pages (测试环境)
gh workflow run deploy.yml \
  -f target=github \
  -f environment=staging

# 仅部署到 Cloudflare Pages
gh workflow run deploy.yml \
  -f target=cloudflare \
  -f environment=production
```

### **方法 3: 通过 Git Push 触发**

工作流会在以下情况自动触发：
- Push 到 `main` 分支
- Push 到 `master` 分支

```bash
# 修改文件后推送
git add .
git commit -m "test: 触发部署测试"
git push origin main
```

---

## 📊 监控部署状态

### **查看工作流运行**

1. **通过 Web 界面**
   ```
   https://github.com/lucking7/esdeath/actions
   ```

2. **通过 CLI**
   ```bash
   # 查看最近的运行
   gh run list --workflow=deploy.yml
   
   # 查看特定运行的详情
   gh run view <run-id>
   
   # 实时查看日志
   gh run watch
   ```

### **检查部署结果**

#### **GitHub Pages**
- **URL**: `https://lucking7.github.io/esdeath/`
- **检查方式**:
  ```bash
  curl -I https://lucking7.github.io/esdeath/
  ```

#### **Cloudflare Pages**
- **URL**: `https://nrrule.pages.dev/` (或自定义域名)
- **检查方式**:
  ```bash
  curl -I https://nrrule.pages.dev/
  ```

#### **NRRule Repository**
- **URL**: `https://github.com/lucking7/NRRule`
- **检查方式**:
  ```bash
  # 检查最新提交
  gh repo view lucking7/NRRule
  
  # 检查归档状态
  gh repo view lucking7/NRRule --json isArchived
  ```

---

## 🔍 验证独立构建

### **检查构建日志**

每个平台的构建日志应该显示：

1. **环境设置步骤**
   ```
   ✅ Checkout repository
   ✅ Setup Node.js
   ✅ Setup pnpm
   ✅ Get pnpm store directory
   ✅ Setup pnpm cache
   ✅ Install dependencies
   ```

2. **平台特定构建**
   ```
   🏗️ Building for [Platform Name]...
   
   Environment variables:
   - BUILD_TARGET=[platform-name]
   - ENABLE_[FEATURE]=true
   ```

3. **缓存命中**
   ```
   Cache restored from key: macOS-pnpm-store-xxxxx
   ```

### **验证平台定制化**

检查每个平台的输出是否包含特定优化：

#### **GitHub Pages**
- ✅ Jekyll 配置文件 (`_config.yml`)
- ✅ Sitemap (`sitemap.xml`)
- ✅ robots.txt

#### **Cloudflare Pages**
- ✅ Edge 优化
- ✅ Brotli 压缩
- ✅ HTTP/2 Push 头

#### **NRRule Repository**
- ✅ 文件去重
- ✅ CDN 优化
- ✅ README 自动生成

---

## 🐛 故障排查

### **常见问题**

#### **1. Secrets 未配置**
```
Error: Input required and not supplied: apiToken
```
**解决方案**: 检查并添加所需的 Secrets

#### **2. 权限不足**
```
Error: Resource not accessible by integration
```
**解决方案**: 
- 检查 GitHub Token 权限
- 确保 Actions 有写入权限

#### **3. 构建失败**
```
Error: Command failed: pnpm run build
```
**解决方案**:
- 检查 `package.json` 中的构建脚本
- 查看完整的构建日志
- 验证依赖是否正确安装

#### **4. 部署超时**
```
Error: The operation was canceled.
```
**解决方案**:
- 检查网络连接
- 增加 `timeout_ms` 参数
- 分批部署（先测试单个平台）

### **调试命令**

```bash
# 查看工作流文件
cat .github/workflows/deploy.yml

# 查看配置文件
cat .github/workflows/build-config.json | jq

# 本地测试构建
BUILD_TARGET=github-pages pnpm run build

# 检查环境变量
env | grep -E "BUILD_|ENABLE_"
```

---

## 📈 性能基准

### **预期构建时间**

| 平台 | 预期时间 | 说明 |
|------|----------|------|
| **GitHub Pages** | ~4 分钟 | 包含 Jekyll 配置 |
| **Cloudflare Pages** | ~5 分钟 | 包含 Edge 优化 |
| **NRRule Repository** | ~4 分钟 | 包含归档操作 |
| **总计 (并行)** | ~5 分钟 | 三个任务并行 |

### **资源消耗**

- **Actions 分钟数**: ~13 分钟/次部署
- **存储空间**: 0 (不使用 artifacts)
- **网络传输**: 最小化

---

## ✅ 测试清单

### **部署前检查**
- [ ] 所有 Secrets 已配置
- [ ] Variables 已设置
- [ ] 工作流文件语法正确
- [ ] 本地测试通过

### **部署测试**
- [ ] GitHub Pages 部署成功
- [ ] Cloudflare Pages 部署成功
- [ ] NRRule Repository 更新成功
- [ ] 所有平台独立构建
- [ ] 环境变量正确传递
- [ ] 缓存正常工作

### **功能验证**
- [ ] 平台特定优化生效
- [ ] 仓库归档/解归档正常
- [ ] 构建时间在预期范围
- [ ] 无错误或警告

---

## 📚 相关文档

- [平台定制化指南](PLATFORM_CUSTOMIZATION.md)
- [升级总结](UPGRADE_SUMMARY.md)
- [快速参考](QUICK_REFERENCE.md)
- [修改清单](CHANGES.md)
- [测试报告](TEST_REPORT.md)

---

## 🎯 下一步

1. **配置 Secrets** ✅
2. **触发测试部署** ⏳
3. **监控运行状态** ⏳
4. **验证部署结果** ⏳
5. **检查性能指标** ⏳
6. **生产环境部署** ⏳

---

**准备就绪！现在可以开始测试部署了！** 🚀

