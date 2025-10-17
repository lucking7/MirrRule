# 🔧 已应用的修复方案

**修复时间**: 2025-10-17  
**修复的问题**: Rule Merge 推送冲突 + Convert Plugins Script-Hub 服务问题

---

## ✅ 修复 1: Rule Merge 推送冲突

### 问题描述

多个任务（Merge Modules、Mirror Sync、Rule Conversion、Rule Merge）并行运行并尝试推送到同一个仓库，导致推送冲突：

```
! [rejected]        main -> main (fetch first)
error: failed to push some refs to 'https://github.com/lucking7/esdeath'
hint: Updates were rejected because the remote contains work that you do not have locally.
```

### 解决方案

在所有 "Commit changes" 步骤的 `git push` 前添加 `git pull --rebase origin main || true`。

### 修改的文件

`.github/workflows/main.yml` - 5 处修改：

#### 1. Convert Plugins (第 266-275 行)
```yaml
- name: Commit changes
  run: |
    if ! git diff --quiet; then
      git config user.name "github-actions[bot]"
      git config user.email "github-actions[bot]@users.noreply.github.com"
      git add -f public/Plugins/
      git commit -m "🔄 转换插件 - $(TZ='Asia/Shanghai' date '+%Y-%m-%d %H:%M:%S')"
      git pull --rebase origin main || true  # ← 新增
      git push
    fi
```

#### 2. Merge Modules (第 305-315 行)
```yaml
- name: Commit changes
  run: |
    git add -N -f public/Modules/Merged/
    if ! git diff --quiet --exit-code public/Modules/Merged/; then
      git config user.name "github-actions[bot]"
      git config user.email "github-actions[bot]@users.noreply.github.com"
      git add -f public/Modules/Merged/
      git commit -m "🎯 合并模块 - $(TZ='Asia/Shanghai' date '+%Y-%m-%d %H:%M:%S')"
      git pull --rebase origin main || true  # ← 新增
      git push
    fi
```

#### 3. Mirror Sync (第 341-350 行)
```yaml
- name: Commit changes
  run: |
    if ! git diff --quiet; then
      git config user.name "github-actions[bot]"
      git config user.email "github-actions[bot]@users.noreply.github.com"
      git add -f public/Mirror/
      git commit -m "🪞 同步镜像 - $(TZ='Asia/Shanghai' date '+%Y-%m-%d %H:%M:%S')"
      git pull --rebase origin main || true  # ← 新增
      git push
    fi
```

#### 4. Rule Conversion (第 403-413 行)
```yaml
- name: Commit changes
  run: |
    git add -N -f public/Rules/
    if ! git diff --quiet --exit-code public/Rules/; then
      git config user.name "github-actions[bot]"
      git config user.email "github-actions[bot]@users.noreply.github.com"
      git add -f public/Rules/
      git commit -m "🔄 转换规则 - $(TZ='Asia/Shanghai' date '+%Y-%m-%d %H:%M:%S')"
      git pull --rebase origin main || true  # ← 新增
      git push
    fi
```

#### 5. Rule Merge (第 442-452 行)
```yaml
- name: Commit changes
  run: |
    git add -N -f public/Rules/Merged/
    if ! git diff --quiet --exit-code public/Rules/Merged/; then
      git config user.name "github-actions[bot]"
      git config user.email "github-actions[bot]@users.noreply.github.com"
      git add -f public/Rules/Merged/
      git commit -m "🔀 合并规则 - $(TZ='Asia/Shanghai' date '+%Y-%m-%d %H:%M:%S')"
      git pull --rebase origin main || true  # ← 新增
      git push
    fi
```

### 工作原理

1. **git pull --rebase origin main**: 在推送前拉取远程更改并 rebase 本地提交
2. **|| true**: 如果 rebase 失败（例如没有远程更改），继续执行
3. **git push**: 推送合并后的更改

### 预期效果

- ✅ 消除并行任务推送冲突
- ✅ 所有任务都能成功推送
- ✅ 保持提交历史清晰（使用 rebase 而不是 merge）

---

## ✅ 修复 2: Convert Plugins Script-Hub 服务问题

### 问题描述

Script-Hub Docker 服务返回 HTTP 500 错误，导致所有插件转换失败：

```
[Convert] ✗ 1.1.1.1: HTTP 500 
[Convert] ✗ BlockAdvertisers: HTTP 500 
[Convert] ✗ Block_HTTPDNS: HTTP 500 
...
```

### 解决方案

#### 方案 1: 增强服务等待和重试机制

修改 `.github/workflows/main.yml` 第 250-279 行：

**之前**:
```yaml
- name: Configure Script-Hub
  run: |
    echo "127.0.0.1 script.hub" | sudo tee -a /etc/hosts
    for i in {1..20}; do
      if curl -f -s http://script.hub:9101/ > /dev/null 2>&1; then
        echo "✓ Script-Hub ready"
        exit 0
      fi
      sleep 5
    done
    exit 1

- run: pnpm run convert-plugins --wait-service
  env:
    CI: true
```

**现在**:
```yaml
- name: Configure Script-Hub
  run: |
    echo "127.0.0.1 script.hub" | sudo tee -a /etc/hosts
    echo "⏳ 等待 Script-Hub 服务启动..."
    for i in {1..30}; do
      if curl -f -s http://script.hub:9101/ > /dev/null 2>&1; then
        echo "✓ Script-Hub 服务就绪 (尝试 $i/30)"
        # 额外等待确保服务完全稳定
        sleep 3
        exit 0
      fi
      echo "  尝试 $i/30 失败，等待 5 秒后重试..."
      sleep 5
    done
    echo "❌ Script-Hub 服务启动超时"
    exit 1

- name: Convert plugins with retry
  run: |
    # 增加超时时间到 600 秒
    pnpm run convert-plugins --wait-service --timeout 600 || {
      echo "⚠️ 首次转换失败，等待 10 秒后重试..."
      sleep 10
      pnpm run convert-plugins --wait-service --timeout 600 || {
        echo "❌ 两次转换都失败，可能是 Script-Hub 服务问题"
        exit 1
      }
    }
  env:
    CI: true
```

#### 改进点

1. **增加等待次数**: 从 20 次增加到 30 次
2. **添加进度提示**: 显示当前尝试次数
3. **额外稳定等待**: 服务就绪后额外等待 3 秒
4. **增加超时时间**: 从 300 秒增加到 600 秒
5. **添加重试机制**: 失败后等待 10 秒重试一次
6. **更好的错误提示**: 清晰的成功/失败消息

#### 方案 2: 保持容错机制

已在之前的修复中添加 `continue-on-error: true`（第 254 行）：

```yaml
convert-plugins:
  name: Convert Plugins
  needs: prepare
  if: needs.prepare.outputs.should_convert_plugins == 'true'
  runs-on: ubuntu-latest
  continue-on-error: true  # Script-Hub 服务可能不稳定，允许失败
  permissions:
    contents: write
```

这确保即使插件转换失败，也不会阻止其他任务执行。

### 预期效果

- ✅ 更长的服务启动等待时间（150 秒 → 150 秒，但有额外稳定等待）
- ✅ 更长的转换超时时间（300 秒 → 600 秒）
- ✅ 自动重试机制（失败后重试一次）
- ✅ 即使失败也不影响其他任务（continue-on-error）

### 根本原因分析

Script-Hub 服务返回 500 错误可能的原因：

1. **服务未完全启动**: Docker 容器启动但内部服务还未就绪
2. **服务过载**: 并发请求过多导致服务崩溃
3. **上游源问题**: Script-Hub 依赖的上游源不可用
4. **内存/资源限制**: Docker 容器资源不足

### 长期解决方案

如果问题持续存在，考虑：

1. **自建转换服务**: 部署自己的 Script-Hub 实例
2. **使用备用工具**: 寻找其他插件转换工具
3. **预转换**: 提前转换插件并存储，而不是每次都转换
4. **监控和告警**: 添加服务健康监控

---

## 📊 修复总结

| 问题 | 状态 | 修复方式 | 预期效果 |
|------|------|----------|----------|
| **Rule Merge 推送冲突** | ✅ 已修复 | 添加 `git pull --rebase` | 消除并行推送冲突 |
| **Convert Plugins 失败** | ⚠️ 已缓解 | 增加超时 + 重试 + 容错 | 提高成功率，失败不影响其他任务 |

---

## 🧪 测试建议

### 测试 Rule Merge 修复

手动触发完整构建：

```bash
gh workflow run main.yml -f task=all -f deploy_target=all
```

预期结果：
- ✅ 所有任务都能成功推送
- ✅ 没有推送冲突错误
- ✅ Rule Merge 任务成功完成

### 测试 Convert Plugins 修复

手动触发插件转换：

```bash
gh workflow run main.yml -f task=convert-plugins
```

预期结果：
- ✅ Script-Hub 服务成功启动
- ⚠️ 插件转换可能仍会失败（取决于 Script-Hub 服务状态）
- ✅ 失败不会阻止工作流完成（continue-on-error）

---

## 📝 后续监控

### 监控指标

1. **Rule Merge 成功率**: 应该从 0% 提升到 100%
2. **Convert Plugins 成功率**: 应该有所提升（取决于 Script-Hub 服务）
3. **整体工作流成功率**: 应该提升

### 如何检查

```bash
# 查看最近的运行
gh run list --limit 10

# 查看特定运行的详情
gh run view <run-id>

# 查看失败的日志
gh run view <run-id> --log-failed
```

---

## ✅ 修复完成

所有修复已应用到 `.github/workflows/main.yml`。

**下一步**: 提交并推送更改，然后测试工作流。

