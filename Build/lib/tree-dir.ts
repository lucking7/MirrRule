import fsp from 'node:fs/promises';
import { sep } from 'node:path';
import type { VoidOrVoidArray } from './misc';

// eslint-disable-next-line sukka/no-export-const-enum -- TODO: fix this in the future
export const enum TreeFileType {
  FILE = 1,
  DIRECTORY = 2
}

interface TreeFile {
  type: TreeFileType.FILE,
  name: string,
  path: string
}

interface TreeDirectoryType {
  type: TreeFileType.DIRECTORY,
  name: string,
  path: string,
  children: TreeTypeArray
}

export type TreeType = TreeDirectoryType | TreeFile;
export type TreeTypeArray = TreeType[];

export async function treeDir(rootPath: string): Promise<TreeTypeArray> {
  const tree: TreeTypeArray = [];

  const walk = async (dir: string, node: TreeTypeArray, dirRelativeToRoot = ''): Promise<void> => {
    const promises: Array<Promise<void>> = [];

    for await (const child of await fsp.opendir(dir)) {
      // Ignore hidden files
      if (child.name[0] === '.' || child.name === 'CNAME') {
        continue;
      }

      const childFullPath = child.parentPath + sep + child.name;
      const childRelativeToRoot = dirRelativeToRoot + sep + child.name;

      if (child.isDirectory()) {
        const newNode: TreeDirectoryType = {
          type: TreeFileType.DIRECTORY,
          name: child.name,
          path: childRelativeToRoot,
          children: []
        };
        node.push(newNode);
        // 立即递归处理子目录，而不是推迟到后面
        promises.push(walk(childFullPath, newNode.children, childRelativeToRoot));
        continue;
      }
      if (child.isFile()) {
        const newNode: TreeFile = {
          type: TreeFileType.FILE,
          name: child.name,
          path: childRelativeToRoot
        };
        node.push(newNode);
        continue;
      }
    }

    // 等待所有子目录处理完成
    await Promise.all(promises);
  };

  await walk(rootPath, tree);

  return tree;
}
