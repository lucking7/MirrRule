import process from 'node:process';

const DEFAULT_PROXY_BASE = 'https://proxy-one.cc.sbs?url=';

const proxyBaseConfig =
  process.env.PROXY_BASES ?? process.env.PROXY_BASE ?? DEFAULT_PROXY_BASE;

const PROXY_BASES = proxyBaseConfig
  .split(',')
  .map(base => base.trim())
  .filter(Boolean);

export function shouldUseProxy(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'kelee.one' || hostname.endsWith('.kelee.one');
  } catch {
    return false;
  }
}

export function applyProxyIfNeeded(url: string): string {
  if (!shouldUseProxy(url)) {
    return url;
  }

  const candidates = buildProxyUrlCandidates(url, { forceProxy: true });
  return candidates[0] ?? url;
}

interface BuildCandidateOptions {
  forceProxy?: boolean;
}

export function buildProxyUrlCandidates(
  url: string,
  options?: BuildCandidateOptions
): string[] {
  const shouldForceProxy = options?.forceProxy === true;
  const proxied = shouldForceProxy || shouldUseProxy(url)
    ? PROXY_BASES.map(base => `${base}${url}`)
    : [];

  if (shouldForceProxy) {
    return proxied.length > 0 ? proxied : [url];
  }

  return proxied.length > 0 ? [...proxied, url] : [url];
}
