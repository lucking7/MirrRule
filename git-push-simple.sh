#!/bin/bash
set -x  # 显示执行的命令

# 中止任何正在进行的操作
git rebase --abort 2>/dev/null || true
git merge --abort 2>/dev/null || true
git cherry-pick --abort 2>/dev/null || true

# 添加所有文件
git add -A

# 提交
git commit -m "fix: 修复工作流输出目录配置

- 修复 createStrategiesForTargets 函数未传递 outputDir 参数的问题
- 所有平台策略现在正确接收输出目录参数
- 确保文件输出到 public/ 目录的正确子目录

详细说明请查看 WORKFLOW_OUTPUT_DIR_FIX.md" || true

# 强制推送
git push --force origin main

echo "Done!"

