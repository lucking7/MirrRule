import type { Span } from '../../trace';
import { fetchAssets } from '../../utils/network/fetch-assets';
import { fastNormalizeDomainWithoutWww } from '../../utils/domain/normalize-domain';
import { extractHostsDomain, pushNormalizedDomain } from './line-helpers';

function hostsLineCb(line: string, set: string[], meta: string) {
  const raw = extractHostsDomain(line);
  pushNormalizedDomain(raw, set, meta, fastNormalizeDomainWithoutWww, false);
}

function hostsLineCbIncludeAllSubdomain(line: string, set: string[], meta: string) {
  const raw = extractHostsDomain(line);
  pushNormalizedDomain(raw, set, meta, fastNormalizeDomainWithoutWww, true);
}

export function processHosts(
  span: Span,
  hostsUrl: string, mirrors: string[] | null, includeAllSubDomain = false
) {
  const cb = includeAllSubDomain ? hostsLineCbIncludeAllSubdomain : hostsLineCb;

  return span.traceChildAsync(`process hosts: ${hostsUrl}`, async (span) => {
    const filterRules = await span.traceChild('download').traceAsyncFn(() => fetchAssets(hostsUrl, mirrors, true));

    const domainSets: string[] = [];

    span.traceChild('parse hosts').traceSyncFn(() => {
      for (let i = 0, len = filterRules.length; i < len; i++) {
        cb(filterRules[i], domainSets, hostsUrl);
      }
    });

    return domainSets;
  });
}

export function processHostsWithPreload(hostsUrl: string, mirrors: string[] | null, includeAllSubDomain = false, allowEmptyRemote = false) {
  const downloadPromise = fetchAssets(hostsUrl, mirrors, true, allowEmptyRemote);
  const cb = includeAllSubDomain ? hostsLineCbIncludeAllSubdomain : hostsLineCb;

  return (span: Span) => span.traceChildAsync(`process hosts: ${hostsUrl}`, async (span) => {
    const filterRules = await span.traceChild('download').tracePromise(downloadPromise);

    const domainSets: string[] = [];

    span.traceChild('parse hosts').traceSyncFn(() => {
      for (let i = 0, len = filterRules.length; i < len; i++) {
        cb(filterRules[i], domainSets, hostsUrl);
      }
    });

    return domainSets;
  });
}
