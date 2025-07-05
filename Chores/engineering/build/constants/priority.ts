// 定义目录显示的优先级顺序
export const DIRECTORY_PRIORITY: Record<string, number> = {
  // 主分类
  Surge: 10,
  List: 20,
  Modules: 30,
  Scripts: 40,
  Domain: 50,
  Dial: 60,

  // Dial子项目
  Sukka: 61,
  BiliUniverse: 62,
  DualSubs: 63,
  iRingo: 64,

  // 其他分类
  Internal: 90,
  default: 100,
};

// 文件类型标签优先级
export const FILE_TYPE_PRIORITY: Record<string, number> = {
  sgmodule: 1,
  list: 2,
  js: 3,
  conf: 4,
  mmdb: 5,
  default: 10,
};
