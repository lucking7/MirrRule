# 🔍 部署内容不匹配问题分析

## 📊 问题描述

**观察到的现象**：
- **本地 `public` 目录**：包含 GeoIP、List、Mirror、Modules、Rules、Scripts 等多个目录
- **GitHub NRRule 仓库**：只包含 Rules 目录和几个 HTML 文件（404.html、index.html、_headers、README.md）

**用户疑问**：
1. 为什么本地和 GitHub 上的内容差异这么大？
2. 为什么 `public/Rules` 存在于本地但不应该存在？

---

## 🎯 根本原因分析

### **问题 1: 工作流架构设计缺陷**

当前工作流的执行顺序：

```
1. Build 任务
   ↓
   生成 public/ 目录（包含 Modules、Scripts、List 等）
   ↓
   上传 build-artifact（只包含 Build 任务生成的内容）
   ↓
2. 并行任务（在 Build 之后）
   - Convert Plugins → 生成 public/Plugins/
   - Merge Modules → 生成 public/Modules/Merged/
   - Mirror Sync → 生成 public/Mirror/
   - Rule Conversion → 生成 public/Rules/
   - Rule Merge → 生成 public/Rules/Merged/
   ↓
3. Deploy to GitHub
   ↓
   下载 build-artifact
   ↓
   部署到 NRRule 仓库
```

**关键问题**：
- ❌ **Build 任务上传 artifact 时，其他任务还没运行**
- ❌ **其他任务生成的内容（Rules、Plugins、Mirror 等）不在 artifact 中**
- ❌ **Deploy 任务只下载 build-artifact，所以只部署了 Build 任务的输出**

### **问题 2: Build 任务实际生成了什么？**

查看 `Build/build-public.ts`，Build 任务主要生成：

1. **index.html** - 文件列表页面
2. **404.html** - 404 错误页面
3. **_headers** - HTTP 头配置
4. **README.md** - 说明文档
5. **Modules/** - 从上游下载的模块（通过 downloadMockAndModules）
6. **Scripts/** - 从上游下载的脚本
7. **List/** - 从上游下载的列表
8. **GeoIP/** - 从上游下载的 GeoIP 数据

**但不包括**：
- ❌ **Rules/** - 由 Rule Conversion 和 Rule Merge 任务生成
- ❌ **Plugins/** - 由 Convert Plugins 任务生成
- ❌ **Mirror/** - 由 Mirror Sync 任务生成
- ❌ **Modules/Merged/** - 由 Merge Modules 任务生成

---

## 📋 当前工作流的问题

### **问题 1: 部署内容不完整**

```yaml
deploy-github:
  needs: [prepare, build]  # ← 只依赖 build，不依赖其他任务
  steps:
    - uses: actions/download-artifact@v4
      with:
        name: build-artifact-${{ github.sha }}  # ← 只下载 build artifact
        path: public
```

**结果**：
- ✅ 部署了 Build 任务生成的内容（Modules、Scripts、List、HTML 文件）
- ❌ **没有部署** Rule Conversion 生成的 Rules/
- ❌ **没有部署** Rule Merge 生成的 Rules/Merged/
- ❌ **没有部署** Convert Plugins 生成的 Plugins/
- ❌ **没有部署** Mirror Sync 生成的 Mirror/
- ❌ **没有部署** Merge Modules 生成的 Modules/Merged/

### **问题 2: 为什么 GitHub 上只有 Rules？**

查看最近的工作流运行，发现：

1. **Rule Conversion 和 Rule Merge 任务**：
   - 这些任务在 Build 之后运行
   - 它们直接 `git push` 到 esdeath 仓库（源仓库）
   - 所以 `public/Rules/` 存在于源仓库

2. **Deploy to GitHub 任务**：
   - 从 build-artifact 下载内容
   - 部署到 NRRule 仓库
   - 但 build-artifact 中没有 Rules/

3. **为什么 NRRule 有 Rules？**
   - 可能是之前的部署流程遗留的
   - 或者是手动添加的
   - 或者是旧版工作流部署的

---

## ✅ 解决方案

### **方案 1: 修复部署依赖和 Artifact 收集** ⭐ **推荐**

#### 步骤 1: 创建一个新的 "Collect Artifacts" 任务

```yaml
collect-artifacts:
  name: Collect All Artifacts
  needs: [prepare, build, convert-plugins, merge-modules, mirror-sync, rule-conversion, rule-merge]
  if: needs.prepare.outputs.should_deploy == 'true'
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    
    # 下载 build artifact
    - uses: actions/download-artifact@v4
      with:
        name: build-artifact-${{ github.sha }}
        path: public
    
    # 从源仓库拉取其他任务生成的内容
    - name: Pull latest changes
      run: |
        git pull origin main
        
        # 确保所有目录都存在
        mkdir -p public/Rules
        mkdir -p public/Plugins
        mkdir -p public/Mirror
        mkdir -p public/Modules/Merged
    
    # 上传完整的 artifact
    - uses: actions/upload-artifact@v4
      with:
        name: deploy-artifact-${{ github.sha }}
        path: public
        retention-days: 1
```

#### 步骤 2: 修改 Deploy 任务使用新的 Artifact

```yaml
deploy-github:
  name: Deploy to GitHub Repository
  needs: [prepare, collect-artifacts]  # ← 依赖 collect-artifacts
  if: |
    needs.prepare.outputs.should_deploy == 'true' &&
    (needs.prepare.outputs.deploy_target == 'all' || needs.prepare.outputs.deploy_target == 'github') &&
    github.ref == 'refs/heads/main'
  runs-on: ubuntu-latest
  steps:
    - uses: actions/download-artifact@v4
      with:
        name: deploy-artifact-${{ github.sha }}  # ← 使用新的 artifact
        path: public
    
    # ... 其余部署逻辑不变
```

---

### **方案 2: 简化架构 - 所有任务都推送到源仓库，最后统一部署** ⭐⭐ **更推荐**

#### 核心思想

1. **所有任务都推送到源仓库**（esdeath）
2. **Deploy 任务从源仓库拉取完整内容**
3. **部署到 NRRule 仓库**

#### 修改 Deploy 任务

```yaml
deploy-github:
  name: Deploy to GitHub Repository
  needs: [prepare, build, convert-plugins, merge-modules, mirror-sync, rule-conversion, rule-merge]
  if: |
    needs.prepare.outputs.should_deploy == 'true' &&
    (needs.prepare.outputs.deploy_target == 'all' || needs.prepare.outputs.deploy_target == 'github') &&
    github.ref == 'refs/heads/main'
  runs-on: ubuntu-latest
  steps:
    # 不再下载 artifact，直接 checkout 源仓库
    - uses: actions/checkout@v4
      with:
        ref: main
    
    # 确保所有内容都已同步
    - name: Pull latest changes
      run: |
        git pull origin main
    
    # 验证 public 目录内容
    - name: Verify public directory
      run: |
        echo "📁 Public 目录内容："
        ls -la public/
        echo ""
        echo "📊 统计："
        echo "  Modules: $(find public/Modules -type f 2>/dev/null | wc -l) 个文件"
        echo "  Scripts: $(find public/Scripts -type f 2>/dev/null | wc -l) 个文件"
        echo "  Rules: $(find public/Rules -type f 2>/dev/null | wc -l) 个文件"
        echo "  List: $(find public/List -type f 2>/dev/null | wc -l) 个文件"
        echo "  Mirror: $(find public/Mirror -type f 2>/dev/null | wc -l) 个文件"
        echo "  Plugins: $(find public/Plugins -type f 2>/dev/null | wc -l) 个文件"
    
    - name: Deploy to NRRule Repository
      continue-on-error: true
      run: |
        gh repo unarchive lucking7/NRRule --yes || true

        git clone --filter=tree:0 --no-tags \
          https://${GH_USER}:${GH_TOKEN}@github.com/lucking7/NRRule.git \
          ./deploy-git

        cd ./deploy-git
        git config user.email "${GH_EMAIL}"
        git config user.name "${GH_USER}"

        rm -rf ./*
        cp -rf ../public/* ./

        git add --all .
        git commit -m "deploy: ${{ github.repository }}@${{ github.sha }}"
        git push --quiet --force origin HEAD:main

        cd ..
        rm -rf ./deploy-git

        gh repo archive lucking7/NRRule --yes || true
      env:
        GH_EMAIL: ${{ secrets.GIT_EMAIL }}
        GH_USER: ${{ secrets.GIT_USER }}
        GH_TOKEN: ${{ secrets.GIT_TOKEN }}
```

**优点**：
- ✅ 简单直接，不需要额外的 artifact 收集任务
- ✅ 确保部署的是完整内容
- ✅ 易于调试和验证

**缺点**：
- ⚠️ 需要等待所有任务完成
- ⚠️ 如果某个任务失败，可能导致内容不完整

---

### **方案 3: 每个任务都上传自己的 Artifact，Deploy 时合并**

```yaml
# 在每个任务中添加
- uses: actions/upload-artifact@v4
  with:
    name: rules-artifact-${{ github.sha }}
    path: public/Rules

# 在 Deploy 任务中
- uses: actions/download-artifact@v4
  with:
    pattern: '*-artifact-${{ github.sha }}'
    path: public
    merge-multiple: true
```

**优点**：
- ✅ 每个任务独立
- ✅ 可以并行上传

**缺点**：
- ⚠️ 复杂度高
- ⚠️ 需要修改所有任务

---

## 📊 推荐方案对比

| 方案 | 复杂度 | 可靠性 | 维护成本 | 推荐度 |
|------|--------|--------|---------|--------|
| **方案 1: Collect Artifacts** | 中 | 高 | 中 | ⭐⭐⭐ |
| **方案 2: 从源仓库部署** | 低 | 高 | 低 | ⭐⭐⭐⭐⭐ |
| **方案 3: 多 Artifact 合并** | 高 | 中 | 高 | ⭐⭐ |

---

## 🎯 立即行动

### **推荐实施方案 2**

1. ✅ **修改 deploy-github 任务**
   - 移除 `actions/download-artifact` 步骤
   - 添加 `actions/checkout` 步骤
   - 添加验证步骤

2. ✅ **测试部署**
   - 手动触发一次完整构建
   - 验证 NRRule 仓库内容

3. ✅ **验证结果**
   - 检查 NRRule 仓库是否包含所有目录
   - 对比本地 `public` 和 NRRule 的内容

---

## 📝 预期结果

修复后，NRRule 仓库应该包含：

```
NRRule/
├── 404.html
├── README.md
├── _headers
├── index.html
├── GeoIP/          ← Build 任务生成
├── List/           ← Build 任务生成
├── Mirror/         ← Mirror Sync 任务生成
├── Modules/        ← Build 任务生成
│   └── Merged/     ← Merge Modules 任务生成
├── Plugins/        ← Convert Plugins 任务生成
├── Rules/          ← Rule Conversion 任务生成
│   └── Merged/     ← Rule Merge 任务生成
└── Scripts/        ← Build 任务生成
```

---

**创建时间**: 2025-10-17  
**状态**: 待实施

