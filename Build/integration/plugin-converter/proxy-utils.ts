/**
 * 代理工具模块（插件转换专用）
 * 重新导出通用代理工具，保持向后兼容
 */

export { shouldUseProxy, applyProxyIfNeeded, getProxyBase, buildProxyUrlCandidates } from '../../utils/network/proxy.ts';
