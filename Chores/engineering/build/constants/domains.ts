/**
 * ICP 备案域名后缀白名单
 * 第一级 TLD 验证白名单
 */
export const ICP_TLD = [
  // 中国顶级域名
  'cn',
  'xn--fiqs8s', // 中国
  'xn--fiqz9s', // 中國

  // 通用中文域名
  'xn--3ds443g', // 在线
  'xn--55qx5d', // 公司
  'xn--io0a7i', // 网络
  'xn--od0alg', // 商城
  'xn--vuq861b', // 信息

  // 中文地理域名
  'xn--1qqw23a', // 佛山
  'xn--xhq521b', // 广东
  'xn--ses554g', // 网址

  // 政府机构
  'gov.cn',
  'org.cn',
  'ac.cn',
  'mil.cn',
  'net.cn',
  'edu.cn',
  'com.cn',

  // 地区域名
  'ah.cn',
  'bj.cn',
  'cq.cn',
  'fj.cn',
  'gd.cn',
  'gs.cn',
  'gz.cn',
  'gx.cn',
  'ha.cn',
  'hb.cn',
  'he.cn',
  'hi.cn',
  'hk.cn',
  'hl.cn',
  'hn.cn',
  'jl.cn',
  'js.cn',
  'jx.cn',
  'ln.cn',
  'mo.cn',
  'nm.cn',
  'nx.cn',
  'qh.cn',
  'sc.cn',
  'sd.cn',
  'sh.cn',
  'sn.cn',
  'sx.cn',
  'tj.cn',
  'tw.cn',
  'xj.cn',
  'xz.cn',
  'yn.cn',
  'zj.cn',

  // 其他相关域名
  'com.hk',
  'org.hk',
  'net.hk',
  'edu.hk',
  'gov.hk',
  'idv.hk',
  'com.tw',
  'org.tw',
  'net.tw',
  'edu.tw',
  'gov.tw',
  'idv.tw',
  'com.mo',
  'org.mo',
  'net.mo',
  'edu.mo',
  'gov.mo',

  // 地区二级域名
  'ac.cn',
  'com.cn',
  'edu.cn',
  'gov.cn',
  'mil.cn',
  'net.cn',
  'org.cn',
  'bj.cn',
  'sh.cn',
  'tj.cn',
  'cq.cn',
  'he.cn',
  'sn.cn',
  'sx.cn',
  'nm.cn',
  'ln.cn',
  'jl.cn',
  'hl.cn',
  'js.cn',
  'zj.cn',
  'ah.cn',
  'fj.cn',
  'jx.cn',
  'sd.cn',
  'ha.cn',
  'hb.cn',
  'hn.cn',
  'gd.cn',
  'gx.cn',
  'hi.cn',
  'sc.cn',
  'gz.cn',
  'yn.cn',
  'gs.cn',
  'qh.cn',
  'nx.cn',
  'xj.cn',
  'xz.cn',

  // 特殊用途
  '公司.cn',
  '网络.cn',
  '政务.cn',
  'xn--55qx5d.cn', // 公司.cn
  'xn--io0a7i.cn', // 网络.cn
  'xn--zfr164b.cn', // 政务.cn

  // 新增域名
  'wang',
  'shop',
  'site',
  'ltd',
  'vip',
  'ren',
  'club',
  'online',
  'website',
  'tech',
  'store',
  'fun',
  'today',
  'city',
  'chat',
  'show',
  'email',
  'plus',
  'center',
  'world',
  'company',
  '公司',
  '我爱你',
  '商店',
  '企业',
  '游戏',
  '娱乐',
  '商城',
  '网店',
  '中文网',
  '在线',
  '网址',
  '网络',
  '手机',
  '购物',
  '信息',
  '广东',
  '佛山',
] as const;

// 导出类型
export type IcpTld = (typeof ICP_TLD)[number];
