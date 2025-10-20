#!/usr/bin/env python3
"""
Git 强制推送脚本
用于将本地代码强制推送到远程仓库
"""

import subprocess
import sys
import os

def run_command(cmd, check=True, capture_output=True):
    """执行命令并返回结果"""
    print(f"执行命令: {' '.join(cmd)}")
    result = subprocess.run(
        cmd,
        capture_output=capture_output,
        text=True,
        check=False
    )
    
    if result.stdout:
        print(f"输出: {result.stdout}")
    if result.stderr:
        print(f"错误: {result.stderr}")
    
    if check and result.returncode != 0:
        print(f"命令执行失败,返回码: {result.returncode}")
        if not capture_output:
            sys.exit(1)
    
    return result

def main():
    print("=" * 60)
    print("Git 强制推送脚本")
    print("=" * 60)
    print()
    
    # 切换到仓库目录
    repo_dir = "/Users/jasperl./Downloads/Surge-master-3"
    os.chdir(repo_dir)
    print(f"工作目录: {os.getcwd()}")
    print()
    
    # 1. 中止任何正在进行的 Git 操作
    print("步骤 1: 中止正在进行的 Git 操作...")
    
    # 检查并中止 rebase
    if os.path.exists(".git/REBASE_HEAD"):
        print("  发现正在进行的 rebase,正在中止...")
        run_command(["git", "rebase", "--abort"], check=False)
        print("  ✅ Rebase 已中止")
    
    # 检查并中止 merge
    if os.path.exists(".git/MERGE_HEAD"):
        print("  发现正在进行的 merge,正在中止...")
        run_command(["git", "merge", "--abort"], check=False)
        print("  ✅ Merge 已中止")
    
    # 检查并中止 cherry-pick
    if os.path.exists(".git/CHERRY_PICK_HEAD"):
        print("  发现正在进行的 cherry-pick,正在中止...")
        run_command(["git", "cherry-pick", "--abort"], check=False)
        print("  ✅ Cherry-pick 已中止")
    
    print("  ✅ 所有 Git 操作已清理")
    print()
    
    # 2. 检查当前分支
    print("步骤 2: 检查当前分支...")
    result = run_command(["git", "rev-parse", "--abbrev-ref", "HEAD"])
    current_branch = result.stdout.strip()
    print(f"  当前分支: {current_branch}")
    print()
    
    # 3. 显示当前状态
    print("步骤 3: 显示当前工作区状态...")
    run_command(["git", "status", "--short"])
    print()
    
    # 4. 添加所有修改
    print("步骤 4: 添加所有修改的文件...")
    run_command(["git", "add", "-A"])
    print("  ✅ 所有文件已添加到暂存区")
    print()
    
    # 5. 提交更改
    print("步骤 5: 提交更改...")
    commit_message = """fix: 修复工作流输出目录配置

- 修复 createStrategiesForTargets 函数未传递 outputDir 参数的问题
- 所有平台策略现在正确接收输出目录参数
- 确保文件输出到 public/ 目录的正确子目录

详细说明请查看 WORKFLOW_OUTPUT_DIR_FIX.md"""
    
    result = run_command(["git", "commit", "-m", commit_message], check=False)
    
    if result.returncode != 0:
        if "nothing to commit" in result.stdout or "nothing to commit" in result.stderr:
            print("  ℹ️  工作区是干净的,没有需要提交的更改")
        else:
            print("  ⚠️  提交失败")
            print(f"  返回码: {result.returncode}")
    else:
        print("  ✅ 提交成功")
    print()
    
    # 6. 显示最新提交
    print("步骤 6: 显示最新提交信息...")
    run_command(["git", "log", "-1", "--oneline"])
    print()
    
    # 7. 强制推送
    print("步骤 7: 强制推送到远程仓库...")
    print(f"  目标仓库: https://github.com/lucking7/esdeath.git")
    print(f"  目标分支: {current_branch}")
    print()
    
    # 直接推送,不需要确认
    print("  正在推送...")
    result = run_command(
        ["git", "push", "--force", "origin", current_branch],
        capture_output=False
    )
    
    if result.returncode == 0:
        print("  ✅ 推送成功!")
    else:
        print("  ❌ 推送失败!")
        sys.exit(1)
    
    print()
    print("=" * 60)
    print("✅ Git 强制推送完成!")
    print("=" * 60)
    print()
    print(f"远程仓库: https://github.com/lucking7/esdeath")
    print(f"分支: {current_branch}")
    print()

if __name__ == "__main__":
    main()

