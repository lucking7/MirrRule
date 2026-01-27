import { fastNormalizeDomain, fastNormalizeDomainWithoutWww } from '../../utils/domain/normalize-domain';
import { pushNormalizedDomain } from './line-helpers';
import { fetchAssets } from '../../utils/network/fetch-assets';
import type { Span } from '../../trace';

function domainListLineCb(line: string, set: string[], meta: string, normalizeDomain = fastNormalizeDomain) {
  pushNormalizedDomain(line, set, meta, normalizeDomain, false);
}

function domainListLineCbIncludeAllSubdomain(line: string, set: string[], meta: string, normalizeDomain = fastNormalizeDomain) {
  pushNormalizedDomain(line, set, meta, normalizeDomain, true);
}
export function processDomainListsWithPreload(
  domainListsUrl: string, mirrors: string[] | null,
  includeAllSubDomain = false,
  allowEmptyRemote = false
) {
  const downloadPromise = fetchAssets(domainListsUrl, mirrors, true, allowEmptyRemote);
  const lineCb = includeAllSubDomain ? domainListLineCbIncludeAllSubdomain : domainListLineCb;

  return (span: Span) => span.traceChildAsync(`process domainlist: ${domainListsUrl}`, async (span) => {
    const filterRules = await span.traceChildPromise('download', downloadPromise);
    const domainSets: string[] = [];

    span.traceChildSync('parse domain list', () => {
      for (let i = 0, len = filterRules.length; i < len; i++) {
        lineCb(filterRules[i], domainSets, domainListsUrl, fastNormalizeDomainWithoutWww);
      }
    });

    return domainSets;
  });
}
