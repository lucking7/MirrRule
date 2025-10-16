# 🎨 平台定制化构建指南

## 📋 概述

本项目支持针对不同部署平台的定制化构建，每个平台都有独立的构建流程和优化策略。

## 🚀 支持的平台

### 1. GitHub Pages
**构建目标**: `github-pages`

**特性**:
- ✅ Jekyll 支持
- ✅ SEO 优化
- ✅ 静态资源压缩
- ✅ 自动生成 sitemap 和 robots.txt

**环境变量**:
```bash
BUILD_TARGET=github-pages
ENABLE_JEKYLL=true
ENABLE_COMPRESSION=true
OUTPUT_FORMAT=static
```

**适用场景**:
- 需要 Jekyll 静态站点生成
- 需要 SEO 优化
- 面向公开访问的文档站点

---

### 2. Cloudflare Pages
**构建目标**: `cloudflare-pages`

**特性**:
- ✅ Edge Functions 支持
- ✅ Workers 集成
- ✅ CDN 优化
- ✅ Brotli 压缩
- ✅ HTTP/2 Server Push

**环境变量**:
```bash
BUILD_TARGET=cloudflare-pages
ENABLE_EDGE_OPTIMIZATION=true
ENABLE_COMPRESSION=true
OUTPUT_FORMAT=edge
CF_ENVIRONMENT=production  # 或 staging
```

**适用场景**:
- 需要全球 CDN 加速
- 需要 Edge Computing 能力
- 高并发访问场景
- 需要动态内容处理

---

### 3. NRRule Repository
**构建目标**: `nrrule-repo`

**特性**:
- ✅ 原始文件格式
- ✅ CDN 友好
- ✅ 文件去重
- ✅ 大小优化
- ✅ 自动归档/解归档

**环境变量**:
```bash
BUILD_TARGET=nrrule-repo
ENABLE_COMPRESSION=true
OPTIMIZE_FOR_CDN=true
OUTPUT_FORMAT=raw
```

**适用场景**:
- 规则文件直接引用
- 需要版本控制
- 需要自动归档节省空间
- 作为其他平台的数据源

---

## 🔧 如何定制构建

### 方法 1: 修改环境变量

在 `deploy.yml` 中修改对应平台的环境变量:

```yaml
- name: Build for GitHub Pages
  run: |
    echo "🏗️ Building for GitHub Pages..."
    pnpm run build
  env:
    BUILD_TARGET: github-pages
    ENABLE_JEKYLL: true
    # 添加你的自定义变量
    CUSTOM_VAR: value
```

### 方法 2: 使用配置文件

参考 `build-config.json` 文件，在构建脚本中读取配置:

```typescript
// Build/lib/platform-config.ts
import config from '../../.github/workflows/build-config.json';

const platformConfig = config.platforms[process.env.BUILD_TARGET || 'default'];
```

### 方法 3: 条件构建步骤

在构建脚本中根据 `BUILD_TARGET` 执行不同逻辑:

```typescript
if (process.env.BUILD_TARGET === 'github-pages') {
  // GitHub Pages 特定逻辑
  await generateJekyllConfig();
  await generateSitemap();
} else if (process.env.BUILD_TARGET === 'cloudflare-pages') {
  // Cloudflare Pages 特定逻辑
  await optimizeForEdge();
  await generateWorkers();
}
```

---

## 📊 构建对比

| 特性 | GitHub Pages | Cloudflare Pages | NRRule Repo |
|------|--------------|------------------|-------------|
| **构建时间** | ~3-5 分钟 | ~4-6 分钟 | ~3-4 分钟 |
| **输出大小** | 中等 (压缩) | 小 (Brotli) | 最小 (优化) |
| **Jekyll 支持** | ✅ | ❌ | ❌ |
| **Edge 优化** | ❌ | ✅ | ❌ |
| **CDN 友好** | ⚠️ 部分 | ✅ 完全 | ✅ 完全 |
| **自动归档** | ❌ | ❌ | ✅ |
| **缓存策略** | 标准 | 激进 | 保守 |

---

## 🎯 最佳实践

### 1. GitHub Pages 优化
```yaml
env:
  BUILD_TARGET: github-pages
  ENABLE_JEKYLL: true
  ENABLE_COMPRESSION: true
  # 启用 SEO 优化
  GENERATE_SITEMAP: true
  GENERATE_ROBOTS: true
  # 压缩级别
  COMPRESSION_LEVEL: 9
```

### 2. Cloudflare Pages 优化
```yaml
env:
  BUILD_TARGET: cloudflare-pages
  ENABLE_EDGE_OPTIMIZATION: true
  # Edge 缓存策略
  EDGE_CACHE_TTL: 3600
  # Brotli 压缩
  ENABLE_BROTLI: true
  # HTTP/2 Push
  ENABLE_HTTP2_PUSH: true
```

### 3. NRRule Repository 优化
```yaml
env:
  BUILD_TARGET: nrrule-repo
  OPTIMIZE_FOR_CDN: true
  # 文件去重
  ENABLE_DEDUPLICATION: true
  # 格式规范化
  NORMALIZE_FORMAT: true
  # 生成元数据
  GENERATE_METADATA: true
```

---

## 🔍 调试技巧

### 查看构建目标
```bash
echo "Current build target: $BUILD_TARGET"
```

### 验证环境变量
```bash
env | grep BUILD_
env | grep ENABLE_
```

### 检查输出文件
```bash
# 查看文件大小
du -sh public/

# 查看文件数量
find public/ -type f | wc -l

# 查看文件类型分布
find public/ -type f -exec file {} \; | cut -d: -f2 | sort | uniq -c
```

---

## 📝 添加新平台

### 步骤 1: 更新配置文件
在 `build-config.json` 中添加新平台配置:

```json
{
  "platforms": {
    "new-platform": {
      "name": "New Platform",
      "description": "新平台描述",
      "env": {
        "BUILD_TARGET": "new-platform",
        "CUSTOM_VAR": "value"
      },
      "features": {},
      "optimizations": {}
    }
  }
}
```

### 步骤 2: 添加部署任务
在 `deploy.yml` 中添加新的 job:

```yaml
deploy-new-platform:
  name: Deploy to New Platform
  needs: prepare
  if: needs.prepare.outputs.should_deploy == 'true'
  runs-on: ubuntu-latest
  
  steps:
    - name: Checkout repository
      uses: actions/checkout@v4
    
    - name: Setup environment
      # ... 环境设置步骤
    
    - name: Build for New Platform
      run: pnpm run build
      env:
        BUILD_TARGET: new-platform
    
    - name: Deploy
      # ... 部署步骤
```

### 步骤 3: 更新构建脚本
在构建脚本中添加平台特定逻辑:

```typescript
// Build/lib/platform-builder.ts
export async function buildForPlatform(target: string) {
  switch (target) {
    case 'new-platform':
      await buildForNewPlatform();
      break;
    // ... 其他平台
  }
}
```

---

## 🤝 贡献指南

1. 添加新平台时，请更新 `build-config.json`
2. 在 `PLATFORM_CUSTOMIZATION.md` 中添加文档
3. 确保所有平台的构建都能成功
4. 添加适当的测试用例

---

## 📚 参考资源

- [GitHub Pages 文档](https://docs.github.com/pages)
- [Cloudflare Pages 文档](https://developers.cloudflare.com/pages)
- [GitHub Actions 文档](https://docs.github.com/actions)

---

**更新时间**: 2024-10-15
**维护者**: @lucking7

