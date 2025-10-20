#!/bin/bash

# Git 强制推送脚本
# 用于将本地代码强制推送到远程仓库

set -e  # 遇到错误立即退出

echo "========================================="
echo "Git 强制推送脚本"
echo "========================================="
echo ""

# 1. 检查是否有正在进行的 Git 操作
echo "步骤 1: 检查并中止正在进行的 Git 操作..."

if [ -f .git/REBASE_HEAD ]; then
    echo "  发现正在进行的 rebase,正在中止..."
    git rebase --abort || true
    echo "  ✅ Rebase 已中止"
fi

if [ -f .git/MERGE_HEAD ]; then
    echo "  发现正在进行的 merge,正在中止..."
    git merge --abort || true
    echo "  ✅ Merge 已中止"
fi

if [ -f .git/CHERRY_PICK_HEAD ]; then
    echo "  发现正在进行的 cherry-pick,正在中止..."
    git cherry-pick --abort || true
    echo "  ✅ Cherry-pick 已中止"
fi

echo "  ✅ 所有 Git 操作已清理"
echo ""

# 2. 检查当前分支
echo "步骤 2: 检查当前分支..."
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "  当前分支: $CURRENT_BRANCH"

if [ "$CURRENT_BRANCH" != "main" ]; then
    echo "  ⚠️  警告: 当前不在 main 分支"
    echo "  是否继续推送到 $CURRENT_BRANCH 分支? (y/n)"
    read -r response
    if [ "$response" != "y" ]; then
        echo "  操作已取消"
        exit 1
    fi
fi
echo ""

# 3. 显示当前状态
echo "步骤 3: 显示当前工作区状态..."
git status --short
echo ""

# 4. 添加所有修改
echo "步骤 4: 添加所有修改的文件..."
git add -A
echo "  ✅ 所有文件已添加到暂存区"
echo ""

# 5. 提交更改
echo "步骤 5: 提交更改..."
COMMIT_MESSAGE="fix: 修复工作流输出目录配置

- 修复 createStrategiesForTargets 函数未传递 outputDir 参数的问题
- 所有平台策略现在正确接收输出目录参数
- 确保文件输出到 public/ 目录的正确子目录

详细说明请查看 WORKFLOW_OUTPUT_DIR_FIX.md"

git commit -m "$COMMIT_MESSAGE" || {
    echo "  ⚠️  提交失败或没有需要提交的更改"
    echo "  检查是否有未提交的更改..."
    if git diff-index --quiet HEAD --; then
        echo "  ℹ️  工作区是干净的,没有需要提交的更改"
    else
        echo "  ❌ 提交失败,请检查错误信息"
        exit 1
    fi
}
echo ""

# 6. 显示提交信息
echo "步骤 6: 显示最新提交信息..."
git log -1 --oneline
echo ""

# 7. 强制推送到远程
echo "步骤 7: 强制推送到远程仓库..."
echo "  ⚠️  警告: 即将使用 --force 推送,这将覆盖远程仓库的历史记录!"
echo "  目标仓库: https://github.com/lucking7/esdeath.git"
echo "  目标分支: $CURRENT_BRANCH"
echo ""
echo "  是否继续? (y/n)"
read -r response

if [ "$response" = "y" ]; then
    git push --force origin "$CURRENT_BRANCH"
    echo "  ✅ 推送成功!"
else
    echo "  操作已取消"
    exit 1
fi

echo ""
echo "========================================="
echo "✅ Git 强制推送完成!"
echo "========================================="
echo ""
echo "远程仓库: https://github.com/lucking7/esdeath"
echo "分支: $CURRENT_BRANCH"
echo ""

