#!/usr/bin/env tsx

/**
 * 扫描并显示 Surge/Rulesets 目录结构
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import picocolors from 'picocolors';

interface DirTree {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: DirTree[];
}

async function scanDirectory(dir: string): Promise<DirTree> {
  const stats = await fs.stat(dir);
  const name = path.basename(dir);

  if (!stats.isDirectory()) {
    return { name, path: dir, type: 'file' };
  }

  const tree: DirTree = {
    name,
    path: dir,
    type: 'dir',
    children: [],
  };

  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const subTree = await scanDirectory(fullPath);
      tree.children!.push(subTree);
    } else if (entry.name.endsWith('.list') || entry.name.endsWith('.conf')) {
      tree.children!.push({
        name: entry.name,
        path: fullPath,
        type: 'file',
      });
    }
  }

  // 排序：目录在前，文件在后
  tree.children!.sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name);
    return a.type === 'dir' ? -1 : 1;
  });

  return tree;
}

function printTree(tree: DirTree, prefix: string = '', isLast: boolean = true) {
  const connector = isLast ? '└── ' : '├── ';
  const extension = isLast ? '    ' : '│   ';

  if (tree.type === 'dir') {
    console.log(prefix + connector + picocolors.blue(tree.name + '/'));

    if (tree.children) {
      tree.children.forEach((child, index) => {
        const isLastChild = index === tree.children!.length - 1;
        printTree(child, prefix + extension, isLastChild);
      });
    }
  } else {
    const color = tree.name.endsWith('.list') ? picocolors.green : picocolors.yellow;
    console.log(prefix + connector + color(tree.name));
  }
}

async function main() {
  console.log(picocolors.bold(picocolors.cyan('📁 Surge/Rulesets 目录结构\n')));

  const rulesetDir = path.resolve('Surge/Rulesets');

  try {
    // 检查目录是否存在
    await fs.access(rulesetDir);

    // 扫描目录
    const tree = await scanDirectory(rulesetDir);

    // 打印树形结构
    console.log(picocolors.blue('Surge/'));
    printTree(tree, '', true);

    // 统计信息
    let fileCount = 0;
    let dirCount = 0;

    function countFiles(node: DirTree) {
      if (node.type === 'file') {
        fileCount++;
      } else {
        dirCount++;
        node.children?.forEach(countFiles);
      }
    }

    countFiles(tree);

    console.log(picocolors.gray(`\n总计: ${dirCount} 个目录, ${fileCount} 个规则文件`));

    // 运行分类器
    console.log(picocolors.yellow('\n运行规则集分类器...\n'));

    const { RulesetClassifier } = await import('../build/lib/ruleset-classifier.js');
    await RulesetClassifier.classifyDirectory(rulesetDir);
  } catch (error) {
    console.error(picocolors.red('错误:'), error);
    process.exit(1);
  }
}

main();
