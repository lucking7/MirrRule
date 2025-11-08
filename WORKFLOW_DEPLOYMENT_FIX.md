# 工作流部署覆盖问题解决方案

## 🚨 问题分析

### 当前部署覆盖机制

**部署代码 (.github/workflows/main.yml 第 442-443 行):**
```bash
rm -rf ./*              # ⚠️ 删除所有文件
cp -rf ../public/* ./   # ⚠️ 复制新文件
```

**问题:** 每次部署都是**完整覆盖**,不保留任何旧文件!

### 目录丢失场景分析

假设有 4 个 Cron 任务:

```yaml
- cron: '0 5,17 * * *'    # 完整构建
- cron: '0 */4 * * *'     # 快速更新
- cron: '0 6,14,22 * * *' # 镜像同步
- cron: '30 7,19 * * *'   # 插件转换
```

**时间线模拟 (UTC 时间):**

```
05:00 - 完整构建
  生成: List/ + Clash/ + Mirror/ + Modules/ + Scripts/
  部署: ✅ 所有内容完整

06:00 - 镜像同步 (假设)
  生成: Mirror/
  部署: ❌ 只有 Mirror/,丢失 List/ + Clash/ + Modules/ + Scripts/
  
07:30 - 插件转换
  生成: Scripts/ + Modules/
  部署: ❌ 只有 Scripts/ + Modules/,丢失 List/ + Clash/ + Mirror/

08:00 - 快速更新
  生成: List/ + Clash/
  部署: ❌ 只有 List/ + Clash/,丢失 Mirror/ + Modules/ + Scripts/
```

**结果:** 网站内容不断被覆盖,始终不完整!

---

## ✅ 解决方案对比

### 方案 1: 调整 Cron 时间,避免冲突 ⭐⭐

**思路:** 确保每次部署前都执行完整构建

**配置示例:**
```yaml
schedule:
  # 完整构建 - 每天 2 次
  - cron: '0 5,17 * * *'
  
  # 快速更新 - 避开完整构建时间
  - cron: '0 8,11,14,20,23 * * *'
```

**优点:**
- ✅ 简单,不需要修改代码
- ✅ 每次快速更新前都有完整构建

**缺点:**
- ❌ 无法解决根本问题
- ❌ 如果有多个任务类型,仍会相互覆盖
- ❌ 时间安排受限

**结论:** ❌ **不推荐** - 治标不治本

---

### 方案 2: 增量部署 (rsync) ⭐⭐⭐⭐⭐

**思路:** 使用 rsync 增量同步,只更新变化的文件

**实现代码:**
```bash
# 替换原来的 rm -rf ./* + cp -rf
rsync -av --delete-after \
  --exclude='.git' \
  --exclude='.github' \
  ../public/ ./
```

**rsync 参数说明:**
- `-a`: 归档模式,保留权限和时间戳
- `-v`: 详细输出
- `--delete-after`: 传输完成后删除目标中多余的文件
- `--exclude`: 排除不需要同步的目录

**工作原理:**
1. 比较源目录和目标目录
2. 只传输变化的文件
3. 保留目标中存在但源中不存在的文件 (如果不使用 --delete)
4. 或者在传输完成后删除多余文件 (使用 --delete-after)

**优点:**
- ✅ 完美解决覆盖问题
- ✅ 只更新变化的文件,效率高
- ✅ 支持任意 Cron 组合
- ✅ 不需要调整时间

**缺点:**
- ⚠️ 需要修改部署代码
- ⚠️ 如果使用 --delete,仍会删除旧文件

**结论:** ✅ **强烈推荐** - 最佳方案

---

### 方案 3: 部署前下载缺失目录 ⭐⭐⭐⭐

**思路:** 在部署前从生产环境下载缺失的目录

**实现代码:**
```bash
# 1. 克隆生产仓库
git clone ... ./deploy-git
cd ./deploy-git

# 2. 检测并保留缺失的目录
PRESERVE_DIRS=()
[ ! -d "../public/Mirror" ] && [ -d "./Mirror" ] && PRESERVE_DIRS+=("Mirror")
[ ! -d "../public/Modules" ] && [ -d "./Modules" ] && PRESERVE_DIRS+=("Modules")
[ ! -d "../public/Scripts" ] && [ -d "./Scripts" ] && PRESERVE_DIRS+=("Scripts")

# 3. 备份缺失的目录
for dir in "${PRESERVE_DIRS[@]}"; do
  echo "Preserving $dir..."
  cp -r "./$dir" "../public/$dir"
done

# 4. 正常部署
rm -rf ./*
cp -rf ../public/* ./
```

**优点:**
- ✅ 确保内容完整
- ✅ 兼容现有部署逻辑
- ✅ 灵活,可以选择性保留

**缺点:**
- ⚠️ 需要额外的下载时间
- ⚠️ 逻辑较复杂
- ⚠️ 可能保留过时的文件

**结论:** ✅ **推荐** - 作为方案 2 的备选

---

### 方案 4: 分离部署目标 ⭐⭐⭐

**思路:** 不同任务部署到不同分支或目录

**实现示例:**
```yaml
# 完整构建 → main 分支
# 快速更新 → quick-update 分支
# 镜像同步 → mirror-sync 分支

# 最终合并到 production 分支
```

**优点:**
- ✅ 完全避免覆盖
- ✅ 可以独立回滚

**缺点:**
- ❌ 复杂度高
- ❌ 需要额外的合并逻辑
- ❌ Cloudflare Pages 不支持

**结论:** ❌ **不推荐** - 过于复杂

---

## 🎯 最终推荐方案

### 方案 2 + 方案 3 组合 ⭐⭐⭐⭐⭐

**核心思路:**
1. 使用 rsync 增量部署 (方案 2)
2. 部署前补全缺失目录 (方案 3)
3. 保留 4 个 Cron 任务,无需调整时间

---

## 📝 具体实施方案

### 1. 保留 4 个 Cron 任务

```yaml
schedule:
  # 完整构建 - 每天 2 次 (05:00, 17:00 UTC)
  - cron: '0 5,17 * * *'
  
  # 快速更新 - 每 4 小时
  - cron: '0 */4 * * *'
  
  # 镜像同步 - 每天 3 次 (06:00, 14:00, 22:00 UTC)
  - cron: '0 6,14,22 * * *'
  
  # 插件转换 - 每天 2 次 (07:30, 19:30 UTC)
  - cron: '30 7,19 * * *'
```

### 2. 任务分配

| Cron | 执行内容 |
|------|----------|
| `0 5,17 * * *` | Mirror + Sukka + QX + Plugins + Merge + Build + Deploy |
| `0 */4 * * *` | Build + Deploy |
| `0 6,14,22 * * *` | Mirror + Sukka + Build + Deploy |
| `30 7,19 * * *` | Plugins + Merge + Build + Deploy |

### 3. 修改部署逻辑

**位置:** `.github/workflows/main.yml` 第 429-456 行

**修改前:**
```bash
- name: Deploy to NRRule Repository
  run: |
    git clone ... ./deploy-git
    cd ./deploy-git
    
    rm -rf ./*              # ❌ 删除所有文件
    cp -rf ../public/* ./   # ❌ 复制新文件
    
    git add --all .
    git commit -m "..."
    git push
```

**修改后:**
```bash
- name: Deploy to NRRule Repository
  run: |
    echo "🚀 Starting deployment..."
    
    # 1. 克隆生产仓库
    git clone --filter=tree:0 --no-tags \
      https://${GH_USER}:${GH_TOKEN}@github.com/lucking7/NRRule.git \
      ./deploy-git
    
    cd ./deploy-git
    git config user.email "${GH_EMAIL}"
    git config user.name "${GH_USER}"
    
    # 2. 检测并保留缺失的目录
    echo "📦 Checking for missing directories..."
    PRESERVED=0
    
    for dir in Mirror Modules Scripts; do
      if [ ! -d "../public/$dir" ] && [ -d "./$dir" ]; then
        echo "  ✅ Preserving $dir/ from production"
        cp -r "./$dir" "../public/$dir"
        PRESERVED=$((PRESERVED + 1))
      fi
    done
    
    if [ $PRESERVED -gt 0 ]; then
      echo "  📊 Preserved $PRESERVED directories"
    else
      echo "  ℹ️  No directories need preservation"
    fi
    
    # 3. 使用 rsync 增量同步
    echo "🔄 Syncing files with rsync..."
    rsync -av --delete-after \
      --exclude='.git' \
      --exclude='.github' \
      --stats \
      ../public/ ./
    
    # 4. 提交并推送
    echo "📝 Committing changes..."
    git add --all .
    
    if git diff --staged --quiet; then
      echo "ℹ️  No changes to deploy"
    else
      git commit -m "deploy: ${{ github.repository }}@${{ github.sha }}"
      echo "🚀 Pushing to production..."
      git push --quiet --force origin HEAD:main
      echo "✅ Deployment complete"
    fi
    
    cd ..
    rm -rf ./deploy-git
```

---

## 📊 方案效果对比

| 方案 | 避免覆盖 | 保留 4 个 Cron | 实施难度 | 可靠性 | 推荐度 |
|------|----------|----------------|----------|--------|--------|
| 方案 1: 调整时间 | ⚠️ 部分 | ❌ 否 | ⭐ 简单 | ⭐⭐ 低 | ⭐⭐ |
| 方案 2: rsync | ✅ 是 | ✅ 是 | ⭐⭐ 中等 | ⭐⭐⭐⭐⭐ 高 | ⭐⭐⭐⭐⭐ |
| 方案 3: 下载缺失 | ✅ 是 | ✅ 是 | ⭐⭐⭐ 较难 | ⭐⭐⭐⭐ 较高 | ⭐⭐⭐⭐ |
| **方案 2+3 组合** | **✅ 是** | **✅ 是** | **⭐⭐ 中等** | **⭐⭐⭐⭐⭐ 极高** | **⭐⭐⭐⭐⭐** |

---

## 🔍 验证方法

### 1. 部署日志检查

在部署步骤中添加详细日志:

```bash
echo "📊 Deployment Statistics:"
echo "  Files transferred: $(rsync output)"
echo "  Directories preserved: $PRESERVED"
echo ""
echo "📁 Final directory structure:"
ls -la public/
echo ""
echo "📈 Directory file counts:"
echo "  Mirror: $(find public/Mirror -type f 2>/dev/null | wc -l) files"
echo "  Modules: $(find public/Modules -type f 2>/dev/null | wc -l) files"
echo "  Scripts: $(find public/Scripts -type f 2>/dev/null | wc -l) files"
echo "  List: $(find public/List -type f 2>/dev/null | wc -l) files"
```

### 2. 网站内容验证

部署后检查关键目录:

```bash
# 在 deploy job 后添加验证步骤
- name: Verify deployment
  run: |
    ERRORS=0
    
    # 检查关键目录
    for dir in List Clash sing-box Mirror Modules Scripts; do
      if [ ! -d "public/$dir" ]; then
        echo "❌ Missing directory: $dir"
        ERRORS=$((ERRORS + 1))
      else
        COUNT=$(find "public/$dir" -type f 2>/dev/null | wc -l)
        echo "✅ $dir: $COUNT files"
      fi
    done
    
    if [ $ERRORS -gt 0 ]; then
      echo "⚠️  Deployment incomplete: $ERRORS missing directories"
      exit 1
    fi
    
    echo "✅ All directories present"
```

### 3. 监控指标

**关键指标:**
- 每次部署的文件变化数量
- 保留目录的次数
- 部署后的目录完整性
- 用户访问 404 错误率

**监控方法:**
```bash
# 在 GitHub Actions 中记录
echo "deployment_files_changed=$FILES_CHANGED" >> $GITHUB_STEP_SUMMARY
echo "directories_preserved=$PRESERVED" >> $GITHUB_STEP_SUMMARY
```

---

## ⚠️ 潜在风险和注意事项

### 1. rsync --delete-after 的影响

**风险:** 如果源目录缺少某个目录,rsync 会删除目标中的该目录

**解决:** 在 rsync 前先保留缺失目录 (方案 3)

### 2. 并发部署冲突

**风险:** 多个 Cron 同时触发,可能导致 git push 冲突

**解决:** 
```yaml
# 添加并发控制
concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: false  # 不取消,排队执行
```

### 3. 文件权限问题

**风险:** rsync 可能改变文件权限

**解决:** 使用 `-a` 参数保留权限

---

## 🚀 实施步骤

### 步骤 1: 备份当前配置
```bash
cp .github/workflows/main.yml .github/workflows/main.yml.backup
```

### 步骤 2: 修改部署逻辑
按照上面的"修改后"代码更新部署步骤

### 步骤 3: 添加验证步骤
在部署后添加目录完整性检查

### 步骤 4: 测试
手动触发 workflow,验证不同任务类型

### 步骤 5: 监控
观察 1-2 天,确认没有目录丢失

---

## 📈 预期效果

**优化前:**
- ❌ 不同 Cron 任务相互覆盖
- ❌ 网站内容不完整
- ❌ 用户访问 404

**优化后:**
- ✅ 所有 Cron 任务和平共存
- ✅ 网站内容始终完整
- ✅ 用户体验良好
- ✅ 保留 4 个 Cron 的灵活性

---

**这个方案完美解决了部署覆盖问题,同时保留了 4 个 Cron 任务的灵活性!** ✅

