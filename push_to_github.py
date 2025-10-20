#!/usr/bin/env python3
import subprocess
import os

os.chdir('/Users/jasperl./Downloads/Surge-master-3')

# Add files
subprocess.run(['git', 'add', 'Build/lib/platform-config.ts', 'WORKFLOW_OUTPUT_DIR_FIX.md'], check=True)

# Commit
subprocess.run(['git', 'commit', '-m', 'fix: 修复
