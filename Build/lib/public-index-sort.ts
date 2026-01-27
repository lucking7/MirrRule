import { TreeFileType } from './tree-dir.ts';
import type { TreeType } from './tree-dir.ts';
import { fastStringCompare } from './misc.ts';

export const priorityOrder: Record<'default' | (string & {}), number> = {
  LICENSE: 0,
  domainset: 10,
  non_ip: 20,
  ip: 30,
  List: 40,
  Loon: 50,
  Clash: 70,
  'sing-box': 80,
  GEOIP: 90,
  Surge: 100,
  Surfboard: 110,
  LegacyClashPremium: 111,
  Script: 130,
  Mock: 140,
  Assets: 150,
  Internal: 160,
  // 低优先级条目（排在最后）
  Modules: 200,
  Scripts: 210,
  Mirror: 220,
  default: Number.MAX_VALUE,
};

export function prioritySorter(a: TreeType, b: TreeType) {
  // 1. 类型优先：目录 > 文件
  if (a.type !== b.type) {
    return a.type === TreeFileType.DIRECTORY ? -1 : 1;
  }

  // 2. 优先级数值排序
  const priorityDiff =
    (priorityOrder[a.name] || priorityOrder.default) -
    (priorityOrder[b.name] || priorityOrder.default);

  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  // 3. 同优先级内按字母序
  return fastStringCompare(a.name, b.name);
}
