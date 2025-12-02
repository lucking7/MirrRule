/**
 * 代理工具模块（供插件转换使用）
 * 直接复用通用网络代理工具，保持兼容
 */

export {
  shouldUseProxy,
  applyProxyIfNeeded,
  getProxyBase,
  buildProxyUrlCandidates,
  isProxyConfigured,
} from '../../utils/network/proxy';
