# Git 强制推送操作指南

## ⚠️ 重要提示

由于您的终端环境存在输出污染问题(可能是 `.zshrc` 或 `.bashrc` 配置导致),自动化脚本无法正常执行。

请在一个**干净的终端窗口**中手动执行以下命令。

---

## 📋 操作步骤

### 1. 打开新的终端窗口

打开一个新的终端窗口,确保环境干净。

### 2. 进入项目目录

```bash
cd /Users/jasperl./Downloads/Surge-master-3
```

### 3. 检查并中止正在进行的 Git 操作

```bash
# 中止 rebase (如果有)
git rebase --abort 2>/dev/null || echo "没有正在进行的 rebase"

# 中止 merge (如果有)
git merge --abort 2>/dev/null || echo "没有正在进行的 merge"

# 中止 cherry-pick (如果有)
git cherry-pick --abort 2>/dev/null || echo "没有正在进行的 cherry-pick"
```

### 4. 检查当前分支和状态

```bash
# 查看当前分支
git branch

# 查看工作区状态
git status
```

**预期输出**: 应该显示您在 `main` 分支,并且有一些未提交的更改。

### 5. 添加所有修改的文件

```bash
git add -A
```

### 6. 提交更改

```bash
git commit -m "fix: 修复工作流输出目录配置

- 修复 createStrategiesForTargets 函数未传递 outputDir 参数的问题
- 所有平台策略现在正确接收输出目录参数
- 确保文件输出到 public/ 目录的正确子目录

详细说明请查看 WORKFLOW_OUTPUT_DIR_FIX.md"
```

**注意**: 如果提示 "nothing to commit",说明工作区是干净的,可以直接跳到步骤 7。

### 7. 查看最新提交

```bash
git log -1 --oneline
```

### 8. 强制推送到远程仓库

⚠️ **警告**: 以下命令将覆盖远程仓库的历史记录!

```bash
# 使用 --force 强制推送
git push --force origin main
```

**或者使用更安全的 --force-with-lease**:

```bash
# 使用 --force-with-lease (更安全,如果远程有其他人的提交会失败)
git push --force-with-lease origin main
```

---

## 📊 当前状态

### 本地仓库信息

- **路径**: `/Users/jasperl./Downloads/Surge-master-3`
- **远程仓库**: `https://github.com/lucking7/esdeath.git`
- **当前分支**: `main`
- **本地 HEAD**: `5d4571d8ad9aa4a08efc8314db85eac1b5b546d2`
- **远程 HEAD**: `a6ec7bfd176c6f3644c258309cb849e0c526b136`

### 修改的文件

根据之前的工作,以下文件已被修改:

1. **Build/lib/platform-config.ts** - 修复输出目录配置
2. **WORKFLOW_OUTPUT_DIR_FIX.md** - 新增文档
3. **CONFIG_PARAMETERS_IMPLEMENTATION.md** - 之前创建的文档
4. **COMMENT_AND_RULE_SUPPORT_IMPROVEMENTS.md** - 之前创建的文档
5. **IMPLEMENTATION_SUMMARY.md** - 之前创建的文档

---

## ✅ 验证推送成功

推送完成后,访问以下链接验证:

1. **GitHub 仓库**: https://github.com/lucking7/esdeath
2. **最新提交**: https://github.com/lucking7/esdeath/commits/main
3. **修改的文件**: https://github.com/lucking7/esdeath/blob/main/Build/lib/platform-config.ts

---

## 🔧 如果推送失败

### 错误 1: Authentication failed

**原因**: GitHub 认证失败

**解决方案**:
```bash
# 使用 Personal Access Token
git remote set-url origin https://YOUR_TOKEN@github.com/lucking7/esdeath.git

# 或者使用 SSH
git remote set-url origin git@github.com:lucking7/esdeath.git
```

### 错误 2: ! [rejected] main -> main (non-fast-forward)

**原因**: 远程有新的提交

**解决方案**:
```bash
# 使用 --force 强制推送
git push --force origin main
```

### 错误 3: ! [remote rejected] main -> main (protected branch hook declined)

**原因**: 分支受保护

**解决方案**:
1. 前往 GitHub 仓库设置
2. Settings → Branches → Branch protection rules
3. 临时禁用保护规则或添加例外

---

## 📝 推送后的操作

推送成功后,GitHub Actions 工作流将自动触发:

1. **构建任务**: 编译代码并生成规则文件到 `public/` 目录
2. **部署到 NRRule**: 将 `public/` 目录内容推送到 `https://github.com/lucking7/NRRule`
3. **部署到 Cloudflare Pages**: 将 `public/` 目录部署到 Cloudflare Pages 项目 `nrrule`

您可以在以下位置查看工作流状态:
- https://github.com/lucking7/esdeath/actions

---

## 🐛 终端输出污染问题

您的终端输出被以下内容污染:

```
fix: 修复 Build 任务不生成文件的问题
修复 rule-source-processor.ts 中调用 done() 而不是 write() 的问题
添加 withTitle() 和 withDescription() 调用
...
```

**可能的原因**:

1. `.zshrc` 或 `.bashrc` 文件中有 `echo` 或 `cat` 命令
2. `.zprofile` 或 `.bash_profile` 中有输出语句
3. 某个 shell 插件或主题配置错误

**建议修复**:

1. 检查 `~/.zshrc` 文件
2. 检查 `~/.bashrc` 文件
3. 检查 `~/.zprofile` 文件
4. 临时使用 `bash --norc --noprofile` 启动干净的 shell

---

## 📞 需要帮助?

如果遇到问题,请提供以下信息:

1. 执行的命令
2. 完整的错误信息
3. `git status` 的输出
4. `git log -1` 的输出

---

**创建时间**: 2025-01-XX  
**目标仓库**: https://github.com/lucking7/esdeath  
**目标分支**: main

