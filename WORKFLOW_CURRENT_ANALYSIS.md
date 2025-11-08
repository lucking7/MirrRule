# 当前工作流部署机制分析

## 🔍 重要发现

经过仔细检查,我发现工作流**已经实现了智能增量部署**!

### 当前部署逻辑 (.github/workflows/main.yml 第 429-525 行)

```bash
# 1. 根据执行的任务决定要更新的目录
SYNC_PATHS=""

# 规则构建（始终执行）
SYNC_PATHS="$SYNC_PATHS List/ GeoIP/"

# 镜像同步
if [ "$should_mirror_sync" = "true" ]; then
  SYNC_PATHS="$SYNC_PATHS Mirror/"
fi

# QX 转换
if [ "$should_convert_qx" = "true" ]; then
  SYNC_PATHS="$SYNC_PATHS Modules/"
fi

# 插件转换
if [ "$should_convert_plugins" = "true" ]; then
  SYNC_PATHS="$SYNC_PATHS Modules/"
fi

# 2. 只删除和更新需要同步的目录
for path in $SYNC_PATHS; do
  rm -rf "./$path"              # 删除旧目录
  mkdir -p "./$path"
  cp -rf "../public/$path"* "./$path"  # 复制新内容
done
```

---

## ✅ 优点

1. **智能增量部署**
   - 只更新变化的目录
   - 不会删除未更新的目录
   - 避免了完整覆盖问题

2. **灵活性高**
   - 根据任务类型动态决定更新内容
   - 支持任意 Cron 组合

3. **有详细日志**
   - 显示同步的目录
   - 统计文件数量

---

## ⚠️ 存在的问题

### 问题 1: Clash 和 sing-box 目录缺失

**当前逻辑:**
```bash
SYNC_PATHS="$SYNC_PATHS List/ GeoIP/"  # ❌ 只包含 List 和 GeoIP
```

**实际输出目录:**
- `public/List/` ✅
- `public/Clash/` ❌ 缺失
- `public/sing-box/` ❌ 缺失
- `public/Loon/` ❌ 缺失
- `public/QuantumultX/` ❌ 缺失
- `public/GeoIP/` ✅

**影响:**
- 快速更新时不会更新 Clash/sing-box/Loon/QuantumultX
- 这些目录会保留旧版本
- 用户可能获取到过时的规则

---

### 问题 2: 目录重复添加

**当前逻辑:**
```bash
# QX 转换
if [ "$should_convert_qx" = "true" ]; then
  SYNC_PATHS="$SYNC_PATHS Modules/"
fi

# 插件转换
if [ "$should_convert_plugins" = "true" ]; then
  SYNC_PATHS="$SYNC_PATHS Modules/"  # ❌ 重复添加
fi

# 模块合并
if [ "$should_merge_modules" = "true" ]; then
  SYNC_PATHS="$SYNC_PATHS Modules/"  # ❌ 再次重复
fi
```

**影响:**
- `Modules/` 可能被添加 3 次
- 虽然不会导致错误,但不够优雅

---

### 问题 3: Cloudflare Pages 部署

**当前状态:**
```yaml
# .github/workflows/main.yml 第 389-394 行
- uses: cloudflare/wrangler-action@v3
  with:
    command: pages deploy public --project-name=nrrule
```

**问题:**
- Cloudflare Pages 是**完整上传** public 目录
- 不支持增量部署
- 如果 public 目录缺少某些目录,Cloudflare 上也会缺少

---

## 🎯 优化方案

### 优化 1: 修复规则构建的目录列表

**修改前:**
```bash
# 规则构建（始终执行）
SYNC_PATHS="$SYNC_PATHS List/ GeoIP/"
```

**修改后:**
```bash
# 规则构建（始终执行）
SYNC_PATHS="$SYNC_PATHS List/ Clash/ sing-box/ Loon/ QuantumultX/ Surfboard/ GeoIP/"
```

---

### 优化 2: 去重目录列表

**添加去重逻辑:**
```bash
# 在所有目录添加完成后
SYNC_PATHS=$(echo "$SYNC_PATHS" | tr ' ' '\n' | sort -u | tr '\n' ' ')
echo "📦 将要同步的目录（去重后）: $SYNC_PATHS"
```

---

### 优化 3: 确保 Cloudflare Pages 内容完整

**方案 A: 在部署前补全缺失目录**
```bash
# 在 Cloudflare Pages 部署前添加
- name: Ensure complete build for Cloudflare
  run: |
    # 从 GitHub Repository 下载缺失的目录
    git clone --depth=1 https://github.com/lucking7/NRRule.git ./prod
    
    for dir in Mirror Modules Scripts; do
      if [ ! -d "public/$dir" ] && [ -d "prod/$dir" ]; then
        echo "📥 Downloading missing $dir from production"
        cp -r "prod/$dir" "public/$dir"
      fi
    done
    
    rm -rf ./prod
```

**方案 B: 只在完整构建时部署到 Cloudflare**
```yaml
deploy-cloudflare:
  if: |
    needs.prepare.outputs.should_deploy == 'true' &&
    needs.prepare.outputs.should_mirror_sync == 'true' &&  # ✅ 添加条件
    ...
```

---

## 📊 完整的优化方案

### 修改部署逻辑

```bash
- name: Deploy to NRRule Repository
  run: |
    # 🔧 根据执行的任务决定要更新的目录（智能增量部署）
    SYNC_PATHS=""
    SYNC_DESC=""
    
    # 规则构建（始终执行）- 包含所有规则格式
    SYNC_PATHS="$SYNC_PATHS List/ Clash/ sing-box/ Loon/ QuantumultX/ Surfboard/ GeoIP/"
    SYNC_DESC="rules"
    
    # 镜像同步
    if [ "${{ needs.prepare.outputs.should_mirror_sync }}" = "true" ]; then
      SYNC_PATHS="$SYNC_PATHS Mirror/"
      SYNC_DESC="$SYNC_DESC+mirrors"
    fi
    
    # QX 转换 / 插件转换 / 模块合并 - 统一处理 Modules
    if [ "${{ needs.prepare.outputs.should_convert_qx }}" = "true" ] || \
       [ "${{ needs.prepare.outputs.should_convert_plugins }}" = "true" ] || \
       [ "${{ needs.prepare.outputs.should_merge_modules }}" = "true" ]; then
      SYNC_PATHS="$SYNC_PATHS Modules/"
      SYNC_DESC="$SYNC_DESC+modules"
    fi
    
    # Scripts 目录（如果存在）
    if [ -d "../public/Scripts" ]; then
      SYNC_PATHS="$SYNC_PATHS Scripts/"
      SYNC_DESC="$SYNC_DESC+scripts"
    fi
    
    # 去重目录列表
    SYNC_PATHS=$(echo "$SYNC_PATHS" | tr ' ' '\n' | sort -u | tr '\n' ' ')
    
    echo "📦 将要同步的目录（去重后）: $SYNC_PATHS"
    echo "📝 更新描述: $SYNC_DESC"

    gh repo unarchive lucking7/NRRule --yes || true

    git clone --filter=tree:0 --no-tags \
      https://${GH_USER}:${GH_TOKEN}@github.com/lucking7/NRRule.git \
      ./deploy-git

    cd ./deploy-git
    git config user.email "${GH_EMAIL}"
    git config user.name "${GH_USER}"

    # 🔧 只删除和更新需要同步的目录
    for path in $SYNC_PATHS; do
      if [ -d "./$path" ]; then
        echo "🗑️  删除旧目录: $path"
        rm -rf "./$path"
      fi
      mkdir -p "./$path"
      if [ -d "../public/$path" ]; then
        echo "📥 复制新内容: $path"
        cp -rf "../public/$path"* "./$path" 2>/dev/null || true
      fi
    done
    
    # 复制根目录文件（如 README.md, index.html 等）
    echo "📄 复制根目录文件..."
    find ../public/ -maxdepth 1 -type f -exec cp {} ./ \; 2>/dev/null || true

    echo ""
    echo "📊 部署后的文件统计："
    echo "  List: $(find ./List -type f 2>/dev/null | wc -l) 个文件"
    echo "  Clash: $(find ./Clash -type f 2>/dev/null | wc -l) 个文件"
    echo "  sing-box: $(find ./sing-box -type f 2>/dev/null | wc -l) 个文件"
    echo "  Loon: $(find ./Loon -type f 2>/dev/null | wc -l) 个文件"
    echo "  QuantumultX: $(find ./QuantumultX -type f 2>/dev/null | wc -l) 个文件"
    echo "  Modules: $(find ./Modules -type f 2>/dev/null | wc -l) 个文件"
    echo "  Scripts: $(find ./Scripts -type f 2>/dev/null | wc -l) 个文件"
    echo "  Mirror: $(find ./Mirror -type f 2>/dev/null | wc -l) 个文件"
    echo "  GeoIP: $(find ./GeoIP -type f 2>/dev/null | wc -l) 个文件"

    git add --all .
    if git diff --cached --quiet; then
      echo "✅ 没有变更需要提交"
      exit 0
    fi
    
    git commit -m "deploy: ${{ github.repository }}@${{ github.sha }} [$SYNC_DESC]"
    git push --quiet origin HEAD:main

    cd ..
    rm -rf ./deploy-git

    gh repo archive lucking7/NRRule --yes || true
```

---

## 🎯 结论

### 当前状态

✅ **已经实现了智能增量部署**
- 只更新变化的目录
- 不会删除未更新的目录
- 避免了相互覆盖问题

### 需要修复的问题

❌ **规则构建缺少 Clash/sing-box 等目录**
- 快速更新时这些目录不会更新
- 需要添加到 SYNC_PATHS

⚠️ **Cloudflare Pages 可能内容不完整**
- 如果快速更新后部署到 Cloudflare
- 会缺少 Mirror/Modules/Scripts

### 推荐操作

1. **修复规则构建的目录列表** (必须)
2. **添加目录去重逻辑** (建议)
3. **限制 Cloudflare 部署条件** (建议)

---

**好消息:** 你的工作流已经很智能了,只需要小幅优化即可完美运行! ✅

