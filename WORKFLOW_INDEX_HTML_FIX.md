# index.html 缺少目录问题解决方案

## 🔍 问题根源

### 现象

- GitHub 仓库中文件齐全: https://github.com/lucking7/NRRule/tree/main
- 但 index.html 缺少 Mirror/Modules/Scripts 目录: https://github.com/lucking7/NRRule/blob/main/index.html

### 根本原因

**`index.html` 是在构建时扫描 `public` 目录生成的!**

```typescript
// Build/build-public.ts 第 55-57 行
const html = await span
  .traceChild('generate index.html')
  .traceAsyncFn(() => treeDir(PUBLIC_DIR).then(generateHtml));
```

**执行流程:**

1. 镜像同步 (条件执行) → 生成 `public/Mirror/`
2. QX 转换 (条件执行) → 生成 `public/Modules/`
3. 插件转换 (条件执行) → 生成 `public/Scripts/`
4. **规则构建** → 扫描 `public` 目录 → 生成 `index.html`

**问题:**

- 快速更新时,镜像/QX/插件步骤被跳过
- `public` 目录中**没有** Mirror/Modules/Scripts
- `treeDir()` 扫描时找不到这些目录
- 生成的 `index.html` 就不包含它们

**即使部署时从生产环境保留了这些目录,`index.html` 也不会显示!**

---

## ✅ 解决方案

### 方案 1: 在构建前下载生产环境的目录 ⭐⭐⭐⭐⭐

**思路:** 在生成 `index.html` 前,从生产环境下载缺失的目录

**实现:**

```yaml
# 在 "规则构建" 步骤之前添加
- name: Download missing directories for index.html
  if: needs.prepare.outputs.should_build == 'true'
  run: |
    echo "📥 检查并下载缺失的目录..."
    
    # 克隆生产仓库（浅克隆,只获取最新版本）
    git clone --depth=1 --filter=blob:none --sparse \
      https://github.com/lucking7/NRRule.git \
      ./prod-temp
    
    cd ./prod-temp
    git sparse-checkout set Mirror Modules Scripts
    cd ..
    
    # 复制缺失的目录到 public
    for dir in Mirror Modules Scripts; do
      if [ ! -d "public/$dir" ] && [ -d "prod-temp/$dir" ]; then
        echo "  ✅ 复制 $dir/ 从生产环境"
        cp -r "prod-temp/$dir" "public/$dir"
      elif [ -d "public/$dir" ]; then
        echo "  ℹ️  $dir/ 已存在,跳过"
      else
        echo "  ⚠️  $dir/ 在生产环境也不存在"
      fi
    done
    
    # 清理临时目录
    rm -rf ./prod-temp
    
    echo "✅ 目录检查完成"
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

# 然后执行规则构建
- run: pnpm run build
  env:
    PUBLIC_DIR: ${{ steps.build-dir.outputs.dir }}
```

**优点:**
- ✅ 确保 `index.html` 始终包含所有目录
- ✅ 不修改构建逻辑
- ✅ 使用 sparse-checkout 只下载需要的目录,速度快

**缺点:**
- ⚠️ 需要额外的网络请求
- ⚠️ 首次构建时生产环境可能为空

---

### 方案 2: 修改 buildPublic 逻辑,合并生产环境的文件树 ⭐⭐⭐⭐

**思路:** 在生成 `index.html` 时,合并生产环境的文件树

**实现:**

```typescript
// Build/build-public.ts

import { execSync } from 'node:child_process';

export const buildPublic = task(
  require.main === module,
  __filename
)(async span => {
  // ... 现有代码 ...

  // 获取生产环境的文件树
  let prodTree: TreeTypeArray = [];
  try {
    const tempDir = path.join(ROOT_DIR, '.prod-temp');
    
    // 克隆生产仓库
    execSync(
      `git clone --depth=1 --filter=blob:none --sparse https://github.com/lucking7/NRRule.git ${tempDir}`,
      { stdio: 'ignore' }
    );
    
    // 只检出需要的目录
    execSync('git sparse-checkout set Mirror Modules Scripts', {
      cwd: tempDir,
      stdio: 'ignore'
    });
    
    // 扫描生产环境的文件树
    prodTree = await treeDir(tempDir);
    
    // 清理
    execSync(`rm -rf ${tempDir}`, { stdio: 'ignore' });
  } catch (error) {
    console.warn('⚠️  无法获取生产环境文件树,使用本地文件树');
  }

  // 合并文件树
  const localTree = await treeDir(PUBLIC_DIR);
  const mergedTree = mergeTree(localTree, prodTree);
  
  const html = await span
    .traceChild('generate index.html')
    .traceAsyncFn(() => Promise.resolve(generateHtml(mergedTree)));

  // ... 其余代码 ...
});

// 合并两个文件树
function mergeTree(local: TreeTypeArray, prod: TreeTypeArray): TreeTypeArray {
  const merged = [...local];
  const localNames = new Set(local.map(item => item.name));
  
  // 添加生产环境中存在但本地不存在的目录
  for (const item of prod) {
    if (!localNames.has(item.name) && item.type === TreeFileType.DIRECTORY) {
      merged.push(item);
    }
  }
  
  return merged;
}
```

**优点:**
- ✅ 逻辑集中在构建脚本中
- ✅ 自动合并文件树

**缺点:**
- ❌ 需要修改构建代码
- ❌ 增加构建复杂度
- ❌ 每次构建都要下载

---

### 方案 3: 创建占位目录 ⭐⭐⭐

**思路:** 在构建前创建空的占位目录

**实现:**

```yaml
- name: Create placeholder directories
  run: |
    mkdir -p public/Mirror
    mkdir -p public/Modules
    mkdir -p public/Scripts
    
    # 创建 README 说明这是占位目录
    echo "# Mirror Directory" > public/Mirror/README.md
    echo "# Modules Directory" > public/Modules/README.md
    echo "# Scripts Directory" > public/Scripts/README.md

- run: pnpm run build
```

**优点:**
- ✅ 简单
- ✅ 不需要网络请求

**缺点:**
- ❌ 目录是空的,用户点击后看不到内容
- ❌ 不够优雅

---

### 方案 4: 只在完整构建时生成 index.html ⭐⭐

**思路:** 快速更新时不重新生成 `index.html`,保留旧版本

**实现:**

```yaml
# 修改 build 步骤
- name: Build rules
  run: |
    if [ "${{ needs.prepare.outputs.should_mirror_sync }}" = "true" ]; then
      # 完整构建,生成新的 index.html
      pnpm run build
    else
      # 快速更新,跳过 buildPublic
      pnpm run build:rules-only
    fi
```

```json
// package.json
{
  "scripts": {
    "build": "node --loader @swc-node/register/esm ./Build/index.ts",
    "build:rules-only": "node --loader @swc-node/register/esm ./Build/build-rules-only.ts"
  }
}
```

**优点:**
- ✅ 避免生成不完整的 `index.html`

**缺点:**
- ❌ 需要创建新的构建脚本
- ❌ 快速更新时 `index.html` 不会更新时间戳

---

## 🎯 推荐方案

### 方案 1 (在构建前下载生产环境的目录)

**理由:**

1. **最简单有效** - 只需添加一个步骤
2. **不修改代码** - 不影响现有构建逻辑
3. **速度快** - 使用 sparse-checkout 只下载需要的目录
4. **可靠** - 确保 `index.html` 始终完整

---

## 📝 具体实施

### 步骤 1: 在工作流中添加下载步骤

在 `.github/workflows/main.yml` 的第 309 行之前添加:

```yaml
      # 🔧 步骤 4.5: 下载缺失的目录用于生成完整的 index.html
      - name: Download missing directories for index.html
        if: needs.prepare.outputs.should_build == 'true'
        run: |
          echo "📥 检查并下载缺失的目录..."
          
          # 检查哪些目录缺失
          MISSING_DIRS=""
          for dir in Mirror Modules Scripts; do
            if [ ! -d "public/$dir" ]; then
              MISSING_DIRS="$MISSING_DIRS $dir"
            fi
          done
          
          if [ -z "$MISSING_DIRS" ]; then
            echo "✅ 所有目录都已存在,无需下载"
            exit 0
          fi
          
          echo "📋 缺失的目录:$MISSING_DIRS"
          
          # 克隆生产仓库（浅克隆,只获取最新版本）
          echo "⏬ 克隆生产仓库..."
          git clone --depth=1 --filter=blob:none --sparse \
            https://github.com/lucking7/NRRule.git \
            ./prod-temp 2>/dev/null || {
            echo "⚠️  无法克隆生产仓库,可能是首次构建"
            exit 0
          }
          
          cd ./prod-temp
          git sparse-checkout set Mirror Modules Scripts 2>/dev/null || true
          cd ..
          
          # 复制缺失的目录到 public
          for dir in $MISSING_DIRS; do
            if [ -d "prod-temp/$dir" ]; then
              echo "  ✅ 复制 $dir/ 从生产环境 ($(find prod-temp/$dir -type f | wc -l) 个文件)"
              cp -r "prod-temp/$dir" "public/$dir"
            else
              echo "  ⚠️  $dir/ 在生产环境也不存在,创建空目录"
              mkdir -p "public/$dir"
            fi
          done
          
          # 清理临时目录
          rm -rf ./prod-temp
          
          echo "✅ 目录准备完成"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      # 🔧 步骤 5: 规则构建（始终执行）
      - run: pnpm run build
        env:
          PUBLIC_DIR: ${{ steps.build-dir.outputs.dir }}
```

### 步骤 2: 验证

提交后,检查 GitHub Actions 日志:

```
📥 检查并下载缺失的目录...
📋 缺失的目录: Mirror Modules Scripts
⏬ 克隆生产仓库...
  ✅ 复制 Mirror/ 从生产环境 (234 个文件)
  ✅ 复制 Modules/ 从生产环境 (89 个文件)
  ✅ 复制 Scripts/ 从生产环境 (12 个文件)
✅ 目录准备完成
```

然后检查生成的 `index.html` 是否包含所有目录。

---

## 🎁 预期效果

**优化前:**
- 快速更新时 `index.html` 缺少 Mirror/Modules/Scripts
- 用户看不到这些目录

**优化后:**
- 所有构建都会生成完整的 `index.html`
- 用户可以看到所有目录
- 点击目录可以浏览文件

---

**这个方案完美解决了 index.html 缺少目录的问题!** ✅

