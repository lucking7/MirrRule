/**
 * 代理工具模块
 * 为需要代理访问的 URL 提供统一的代理支持
 *
 * 代理配置通过环境变量 PROXY_BASE 提供，保护代理服务不被滥用
 * 在 GitHub Actions 中通过 secrets.PROXY_BASE 传入
 */

import process from 'node:process';

/**
 * 需要代理的域名列表
 */
const PROXY_REQUIRED_DOMAINS = ['kelee.one'] as const;

/**
 * 获取代理基础 URL（从环境变量读取）
 * @returns 代理 URL 或 undefined（如果未配置）
 */
function getProxyBaseFromEnv(): string | undefined {
  const proxyBase = process.env.PROXY_BASE?.trim();
  if (proxyBase) {
    // 确保代理 URL 格式正确（以 ? 或 / 结尾便于拼接）
    if (!proxyBase.endsWith('?') && !proxyBase.endsWith('/') && !proxyBase.includes('?url=')) {
      return proxyBase + '?url=';
    }
    return proxyBase;
  }
  return undefined;
}

/**
 * 检查代理是否已配置
 */
export function isProxyConfigured(): boolean {
  return getProxyBaseFromEnv() !== undefined;
}

/**
 * 检查 URL 是否需要使用代理
 * 目前匹配 kelee.one 域名（含子域名）
 */
export function shouldUseProxy(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return PROXY_REQUIRED_DOMAINS.some(
      domain => hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

/**
 * 为 URL 添加代理前缀（如果需要且代理已配置）
 * 代理通过 PROXY_BASE 环境变量配置
 * 如果未配置代理，返回原始 URL（直连模式）
 */
export function applyProxyIfNeeded(url: string): string {
  if (!shouldUseProxy(url)) {
    return url;
  }

  const proxyBase = getProxyBaseFromEnv();
  if (!proxyBase) {
    // 未配置代理，返回原始 URL
    return url;
  }

  return proxyBase + url;
}

/**
 * 获取当前代理基础 URL
 * @returns 代理 URL 或空字符串（如果未配置）
 */
export function getProxyBase(): string {
  return getProxyBaseFromEnv() || '';
}

/**
 * 返回按优先级排列的 URL 备选列表
 * 如果配置了代理：优先使用代理，其次直连
 * 如果未配置代理：仅返回原始 URL
 */
export function buildProxyUrlCandidates(url: string): string[] {
  const proxied = applyProxyIfNeeded(url);

  if (proxied === url) {
    return [url];
  }

  return [proxied, url];
}
