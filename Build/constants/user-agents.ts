/**
 * 统一 User-Agent 常量
 * 集中管理所有 HTTP 请求使用的 User-Agent 字符串
 */

const SURGE_MAC_CLIENT = 'Surge Mac/8380';

/** Surge Mac 客户端 UA - 用于插件下载和 API 调用 */
export const UA_SURGE_MAC = SURGE_MAC_CLIENT;

/** 规则集镜像同步 UA - 用于 GitHub API 和镜像下载 */
export const UA_MIRROR = 'Surge-Ruleset-Mirror/1.0';

/**
 * MirrRule 应用标识。kelee.one 的 WAF 只放行以 `Surge Mac/` 开头的 UA，
 * 因此客户端前缀必须放在最前，应用标识放在括号内。
 */
export const UA_MIRRRULE = `${SURGE_MAC_CLIENT} (MirrRule/1.0; +https://github.com/lucking7/MirrRule)`;
