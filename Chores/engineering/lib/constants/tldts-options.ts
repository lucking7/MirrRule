/**
 * tldts 库的配置选项
 */

/**
 * 规范化域名时使用的选项
 * 用于本地规则文件（宽松模式）
 */
export const normalizeTldtsOpt = {
  allowIcannDomains: true,
  allowPrivateDomains: true, // 允许私有后缀
  detectIp: false,
  validateHostname: true,
};

/**
 * 松散模式的 tldts 选项
 * 用于验证等场景
 */
export const looseTldtsOpt = {
  allowIcannDomains: true,
  allowPrivateDomains: false, // 不允许私有后缀
  detectIp: false,
  validateHostname: true,
};

/**
 * 严格模式的 tldts 选项
 * 用于 AdGuard 过滤器解析（只接受 ICANN TLD）
 */
export const strictTldtsOpt = {
  allowIcannDomains: true,
  allowPrivateDomains: false,
  detectIp: false,
  validateHostname: true,
};
