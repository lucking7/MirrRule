# 🔧 问题诊断和修复方案

## 📋 问题总结

### 问题 1: NRRule 仓库为空 ❌

**现象**: https://github.com/lucking7/NRRule 仓库是空的

**原因**: GitHub 部署失败，权限错误
```
remote: Permission to lucking7/NRRule.git denied to lucking7.
fatal: unable to access 'https://github.com/lucking7/NRRule.git/': The requested URL returned error: 403
```

**根本原因**: `GIT_TOKEN` 没有足够的权限推送到 NRRule 仓库

---

### 问题 2: 定时任务中很多流程被跳过 ⏭️

**现象**: 最新的 action 运行中，很多任务显示 `- in 0s` (被跳过)

**原因**: 这是**正常行为**！工作流设计为智能调度：

| 定时任务 | 执行的任务 | 跳过的任务 |
|---------|-----------|-----------|
| `0 5,17 * * *` | Build + Deploy | 其他全部 |
| `0 */2 * * *` | Rule Conversion | 其他全部 |
| `5,30,55 * * * *` | Mirror Sync | 其他全部 |
| `10,35 * * * *` | Convert Plugins | 其他全部 |

**示例**: 运行 18564382474 是 `10,35 * * * *` 触发的，所以：
- ✅ **Convert Plugins** 执行
- ⏭️ **其他任务** 全部跳过（符合预期）

---

### 问题 3: Convert Plugins 失败 ❌

**现象**: 插件转换任务失败，所有插件返回 HTTP 500

**原因**: Script-Hub 服务返回 500 错误
```
[Convert] ✗ 1.1.1.1: HTTP 500 
[Convert] ✗ BlockAdvertisers: HTTP 500 
[Convert] ✗ Block_HTTPDNS: HTTP 500 
...
```

**根本原因**: Script-Hub Docker 容器服务异常，不是工作流问题

---

## 🔧 修复方案

### 修复 1: NRRule 仓库权限问题

#### **方案 A: 重新生成 GIT_TOKEN (推荐)**

1. **访问 GitHub Settings**
   - https://github.com/settings/tokens

2. **生成新的 Personal Access Token (Classic)**
   - 点击 **Generate new token** → **Generate new token (classic)**
   - Note: `esdeath-deploy`
   - Expiration: 选择合适的过期时间
   - **必须勾选的权限**:
     - ✅ `repo` (完整仓库访问权限)
       - ✅ `repo:status`
       - ✅ `repo_deployment`
       - ✅ `public_repo`
       - ✅ `repo:invite`
       - ✅ `security_events`
     - ✅ `workflow` (更新 GitHub Actions 工作流)
   - 点击 **Generate token**
   - **立即复制 token**（只显示一次）

3. **更新 Secret**
   - 访问 https://github.com/lucking7/esdeath/settings/secrets/actions
   - 找到 `GIT_TOKEN`
   - 点击 **Update**
   - 粘贴新的 token
   - 点击 **Update secret**

4. **测试部署**
   ```bash
   gh workflow run main.yml -f task=deploy -f deploy_target=github
   ```

#### **方案 B: 使用 GitHub App Token (更安全)**

如果你想要更细粒度的权限控制，可以创建 GitHub App。这个方案更复杂但更安全。

#### **方案 C: 检查 NRRule 仓库设置**

确保 NRRule 仓库没有被保护：
1. 访问 https://github.com/lucking7/NRRule/settings
2. 检查 **Branch protection rules**
3. 如果 `main` 分支有保护规则，确保允许 force push

---

### 修复 2: Script-Hub 服务问题

#### **临时方案: 跳过失败的插件转换**

修改工作流，允许插件转换失败而不影响其他任务：

```yaml
# .github/workflows/main.yml 第 254 行附近
convert-plugins:
  name: Convert Plugins
  needs: prepare
  if: needs.prepare.outputs.should_convert_plugins == 'true'
  runs-on: ubuntu-latest
  continue-on-error: true  # 添加这一行
  permissions:
    contents: write
```

#### **长期方案: 监控 Script-Hub 服务**

1. **添加健康检查**
   ```yaml
   - name: Check Script-Hub health
     run: |
       if ! curl -f http://script.hub:9101/health 2>/dev/null; then
         echo "⚠️ Script-Hub service is not healthy, skipping conversion"
         exit 0
       fi
   ```

2. **添加重试机制**
   在 `Build/convert-plugins.ts` 中添加重试逻辑

3. **使用备用服务**
   如果 Script-Hub 持续不稳定，考虑：
   - 自建转换服务
   - 使用其他转换工具
   - 直接维护 Surge 格式的插件

---

### 修复 3: Cloudflare Pages 项目

#### **创建 Cloudflare Pages 项目**

1. **访问 Cloudflare Dashboard**
   - https://dash.cloudflare.com/

2. **创建 Pages 项目**
   - 进入 **Workers & Pages**
   - 点击 **Create application**
   - 选择 **Pages** → **Direct Upload**
   - 项目名称: `nrrule`
   - 点击 **Create project**

3. **测试部署**
   ```bash
   gh workflow run main.yml -f task=deploy -f deploy_target=cloudflare
   ```

#### **或者：修改项目名称**

如果你已有其他 Cloudflare Pages 项目，修改工作流使用现有项目：

```yaml
# .github/workflows/main.yml 第 469 行
command: pages deploy public --project-name=你的项目名 --commit-dirty=true --branch=main
```

---

## ✅ 验证步骤

### 1. 验证 GIT_TOKEN 权限

```bash
# 使用新的 token 测试
export GH_TOKEN="your-new-token"
gh repo view lucking7/NRRule
gh api repos/lucking7/NRRule/collaborators/lucking7/permission
```

### 2. 手动触发完整构建

```bash
gh workflow run main.yml -f task=all -f deploy_target=all
```

### 3. 检查运行结果

```bash
gh run list --limit 3
gh run watch <run-id>
```

### 4. 验证 NRRule 仓库

访问 https://github.com/lucking7/NRRule 确认文件已部署

---

## 📊 预期结果

修复后，完整构建应该：

| 任务 | 状态 | 说明 |
|------|------|------|
| **Prepare Tasks** | ✅ | 智能调度正常 |
| **Build** | ✅ | 核心构建成功 |
| **Convert Plugins** | ⚠️ | 可能失败（Script-Hub 问题） |
| **Merge Modules** | ✅ | 模块合并成功 |
| **Mirror Sync** | ✅ | 镜像同步成功 |
| **Rule Conversion** | ✅ | 规则转换成功 |
| **Rule Merge** | ✅ | 规则合并成功 |
| **Deploy to GitHub** | ✅ | 部署到 NRRule 成功 |
| **Deploy to Cloudflare** | ✅ | 部署到 Cloudflare 成功 |

---

## 🎯 优先级

### 高优先级 (立即处理)

1. ✅ **修复 GIT_TOKEN 权限** - 否则无法部署到 NRRule
2. ✅ **创建 Cloudflare Pages 项目** - 否则无法部署到 Cloudflare

### 中优先级 (可以稍后处理)

3. ⚠️ **处理 Script-Hub 服务问题** - 添加 `continue-on-error: true`

### 低优先级 (可选)

4. 📝 **优化错误处理** - 添加更详细的日志和通知
5. 📝 **添加健康检查** - 监控服务状态

---

## 📝 快速修复清单

- [ ] 重新生成 GIT_TOKEN (勾选 `repo` 和 `workflow` 权限)
- [ ] 更新 esdeath 仓库的 GIT_TOKEN Secret
- [ ] 创建 Cloudflare Pages 项目 `nrrule`
- [ ] 添加 `continue-on-error: true` 到 convert-plugins 任务
- [ ] 手动触发完整构建测试
- [ ] 验证 NRRule 仓库有内容
- [ ] 验证 Cloudflare Pages 部署成功

---

## 🔍 调试命令

```bash
# 查看最新运行
gh run list --limit 5

# 查看特定运行的详情
gh run view <run-id>

# 查看失败的日志
gh run view <run-id> --log-failed

# 监控运行进度
gh run watch <run-id>

# 手动触发特定任务
gh workflow run main.yml -f task=convert-plugins
gh workflow run main.yml -f task=deploy -f deploy_target=github
gh workflow run main.yml -f task=all -f deploy_target=all
```

---

**下一步**: 请先修复 GIT_TOKEN 权限问题，这是最关键的！

