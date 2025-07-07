#!/usr/bin/env tsx

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// 定义重命名映射
const renameMap: Record<string, string> = {
  'adguard-filter-config.ts': 'rule-adguard-config.ts',
  'geoip-processor.ts': 'rule-geoip-processor.ts',
  'optimize-rules.ts': 'rule-optimizer.ts',
  'reject-merger.ts': 'rule-reject-merger.ts',
  'mirror.ts': 'module-sync.ts',
};

// 需要更新引用的文件列表
const filesToUpdate = [
  'main.ts',
  'mirror.ts',
  'module-sync.ts', // 重命名后
  'rule-processor.ts',
  'rule-merger.ts',
  '*.ts', // 所有 ts 文件
];

async function main() {
  const syncDir = path.join(process.cwd(), 'sync');

  console.log('🔄 开始重命名 sync 目录下的模块...\n');

  // 1. 执行重命名
  for (const [oldName, newName] of Object.entries(renameMap)) {
    const oldPath = path.join(syncDir, oldName);
    const newPath = path.join(syncDir, newName);

    if (fs.existsSync(oldPath)) {
      // 使用 git mv 保留历史
      try {
        execSync(`git mv "${oldPath}" "${newPath}"`, { stdio: 'inherit' });
        console.log(`✅ ${oldName} → ${newName}`);
      } catch (error) {
        // 如果 git mv 失败，尝试普通重命名
        fs.renameSync(oldPath, newPath);
        console.log(`✅ ${oldName} → ${newName} (非 git 重命名)`);
      }
    } else {
      console.log(`⏭️  ${oldName} 不存在，跳过`);
    }
  }

  console.log('\n📝 更新导入语句...\n');

  // 2. 更新所有文件中的导入语句
  const allTsFiles = fs
    .readdirSync(syncDir)
    .filter(file => file.endsWith('.ts'))
    .map(file => path.join(syncDir, file));

  for (const filePath of allTsFiles) {
    let content = fs.readFileSync(filePath, 'utf-8');
    let hasChanges = false;

    // 更新导入语句
    for (const [oldName, newName] of Object.entries(renameMap)) {
      const oldImport = oldName.replace('.ts', '');
      const newImport = newName.replace('.ts', '');

      // 匹配各种导入格式
      const patterns = [
        new RegExp(`from ['"]\./${oldImport}(\\.js)?['"]`, 'g'),
        new RegExp(`import\\(['"]\./${oldImport}(\\.js)?['"]\\)`, 'g'),
        new RegExp(`require\\(['"]\./${oldImport}(\\.js)?['"]\\)`, 'g'),
      ];

      for (const pattern of patterns) {
        if (pattern.test(content)) {
          content = content.replace(pattern, match => match.replace(oldImport, newImport));
          hasChanges = true;
        }
      }
    }

    if (hasChanges) {
      fs.writeFileSync(filePath, content);
      console.log(`✅ 更新了 ${path.basename(filePath)} 中的导入`);
    }
  }

  console.log('\n✨ 重命名完成！');
  console.log('\n请检查以下事项：');
  console.log('1. 运行 npm run build 确保编译通过');
  console.log('2. 检查 GitHub Actions 工作流是否需要更新');
  console.log('3. 更新相关文档中的文件名引用');
}

main().catch(console.error);
