/**
 * Automated primary IP/CIDR loaders for first-party documentation and live global BGP routes,
 * cross-verified against authoritative RIR RDAP ownership and prefix containment records.
 */

import { Buffer } from 'node:buffer';
import { isIP } from 'node:net';
import { ip2bigint, parse as parseCidr } from 'fast-cidr-tools';
import type { IpMeta } from 'fast-cidr-tools';
import picocolors from 'picocolors';
import { UA_SURGE_MAC } from '../constants/user-agents';
import { $$fetch, ResponseError } from '../utils/network/fetch-retry';
import { IPValidator } from '../utils/validation/validators';
import { isNonHtmlText } from './downloaded-text';

export const ANTHROPIC_IP_DOCS_URL = 'https://platform.claude.com/docs/en/api/ip-addresses.md';
export const ANTHROPIC_ASN = 399358;
const DEFAULT_ARIN_RDAP_BASE_URL = 'https://rdap.arin.net/registry';
const DEFAULT_BOOTSTRAP_RDAP_BASE_URL = 'https://rdap.org';

const INBOUND_HEADING_RE = /^##\s+inbound\s+ip\s+addresses\b/i;
const TOP_LEVEL_HEADING_RE = /^#{1,2}\s+/;
const SUB_HEADING_RE = /^(#{3,6})[ \t]+(\S.*)$/;
const EXCLUDED_SUBSECTION_RE = /\b(?:phased\s+out|deprecated|outbound|no\s+longer)\b/i;
const FENCE_RE = /^(`{3,}|~{3,})/;

const IPV4_CIDR_TOKEN_RE = /\b\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}\b/g;
const IPV6_CIDR_TOKEN_RE = /(?<![0-9a-f:])[0-9a-f:]{2,39}\/\d{1,3}\b/gi;

export interface PrimaryIpLoadOptions {
  throwOnError?: boolean;
  allowEmpty?: boolean;
  fetchFn?: typeof $$fetch;
  rdapBaseUrl?: string;
  fallbackRdapBaseUrl?: string | null;
}

interface RdapRegistrantIdentity {
  handles: ReadonlySet<string>;
  orgNames: ReadonlySet<string>;
}

interface RdapIpRecord {
  identity: RdapRegistrantIdentity;
  ranges: IpMeta[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeOrgName(value: string): string {
  return value.trim().replaceAll(/\s+/g, ' ').toLowerCase();
}

function normalizeValidatedCidr(raw: string): string | null {
  const trimmed = raw.trim();
  const slashIndex = trimmed.indexOf('/');
  if (slashIndex === -1) return null;
  if (!IPValidator.isIpCidr(trimmed)) return null;

  const prefixLength = Number(trimmed.slice(slashIndex + 1));
  const isV6 = trimmed.includes(':');
  if (isV6) {
    if (prefixLength < 16 || prefixLength > 128) return null;
    return trimmed.toLowerCase();
  }
  if (prefixLength < 8 || prefixLength > 32) return null;
  return trimmed;
}

export function isAnthropicIpDocsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname.toLowerCase() === 'platform.claude.com' &&
      url.pathname === '/docs/en/api/ip-addresses.md'
    );
  } catch {
    return false;
  }
}

export function extractRipestatAsn(value: string): number | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.hostname.toLowerCase() !== 'stat.ripe.net') return null;
    if (url.pathname !== '/data/announced-prefixes/data.json') return null;
    const rawResource = url.searchParams.get('resource')?.trim() ?? '';
    const match = /^(?:AS)?(\d+)$/i.exec(rawResource);
    if (!match) return null;
    const asn = Number(match[1]);
    return Number.isSafeInteger(asn) && asn > 0 && asn <= 4_294_967_295 ? asn : null;
  } catch {
    return null;
  }
}

export function isRipestatAnnouncedPrefixesUrl(value: string): boolean {
  return extractRipestatAsn(value) !== null;
}

/**
 * Parse only the "Inbound IP addresses" section of Anthropic's official Markdown documentation,
 * ignoring Outbound and Phased out sections.
 */
export function parseAnthropicInboundCidrs(markdown: string, allowEmpty = false): string[] {
  const rawBuffer = Buffer.from(markdown, 'utf8');
  if (!isNonHtmlText(rawBuffer)) {
    throw new Error('Anthropic IP documentation returned empty or HTML content');
  }

  let inInboundSection = false;
  let foundInboundSection = false;
  let excludedHeadingDepth: number | null = null;
  let activeFence: string | null = null;
  const inboundLines: string[] = [];

  for (const rawLine of markdown.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    const fenceMatch = FENCE_RE.exec(trimmed);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (activeFence === null) {
        activeFence = marker;
      } else if (marker[0] === activeFence[0] && marker.length >= activeFence.length) {
        activeFence = null;
      }
      if (inInboundSection && excludedHeadingDepth === null) inboundLines.push(rawLine);
      continue;
    }

    if (activeFence === null) {
      if (INBOUND_HEADING_RE.test(trimmed)) {
        inInboundSection = true;
        foundInboundSection = true;
        excludedHeadingDepth = null;
        continue;
      }
      if (inInboundSection && TOP_LEVEL_HEADING_RE.test(trimmed)) {
        break;
      }
      if (inInboundSection) {
        const subMatch = SUB_HEADING_RE.exec(trimmed);
        if (subMatch) {
          const depth = subMatch[1].length;
          if (excludedHeadingDepth === null || depth <= excludedHeadingDepth) {
            excludedHeadingDepth = EXCLUDED_SUBSECTION_RE.test(subMatch[2]) ? depth : null;
          }
          continue;
        }
      }
    }

    if (inInboundSection && excludedHeadingDepth === null) {
      inboundLines.push(rawLine);
    }
  }

  if (!foundInboundSection) {
    throw new Error('Anthropic IP documentation is missing the "Inbound IP addresses" section');
  }

  const sectionText = inboundLines.join('\n');
  const seen = new Set<string>();
  const cidrs: string[] = [];

  for (const regex of [IPV4_CIDR_TOKEN_RE, IPV6_CIDR_TOKEN_RE]) {
    for (const match of sectionText.matchAll(regex)) {
      const normalized = normalizeValidatedCidr(match[0]);
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        cidrs.push(normalized);
      }
    }
  }

  if (!allowEmpty && cidrs.length === 0) {
    throw new Error('No valid inbound CIDRs found in Anthropic IP documentation');
  }
  return cidrs;
}

/**
 * Parse RIPEstat announced-prefixes JSON and keep only prefixes active at query_endtime
 * (excluding historical prefixes withdrawn earlier in the default 14-day window).
 */
export function parseRipestatAnnouncedPrefixes(
  json: unknown,
  expectedAsn: number,
  allowEmpty = false
): string[] {
  if (!isObject(json) || json.status !== 'ok' || !isObject(json.data)) {
    throw new Error(`Invalid RIPEstat announced-prefixes response for AS${expectedAsn}`);
  }

  const { data } = json;
  const resource = typeof data.resource === 'string' ? data.resource.trim().replace(/^AS/i, '') : '';
  if (resource !== String(expectedAsn)) {
    throw new Error(`RIPEstat resource mismatch: expected AS${expectedAsn}, got ${String(data.resource)}`);
  }

  const queryEndtime = typeof data.query_endtime === 'string' ? data.query_endtime.trim() : '';
  if (!queryEndtime || !Array.isArray(data.prefixes)) {
    throw new Error(`RIPEstat response for AS${expectedAsn} is missing query_endtime or prefixes`);
  }

  const seen = new Set<string>();
  const activeCidrs: string[] = [];

  for (const item of data.prefixes) {
    if (!isObject(item) || typeof item.prefix !== 'string' || !Array.isArray(item.timelines)) {
      throw new Error(`Malformed prefix entry in RIPEstat response for AS${expectedAsn}`);
    }

    let activeAtEnd = false;
    for (const timeline of item.timelines) {
      if (isObject(timeline) && timeline.endtime === queryEndtime) {
        activeAtEnd = true;
        break;
      }
    }
    if (!activeAtEnd) continue;

    const normalized = normalizeValidatedCidr(item.prefix);
    if (!normalized) {
      throw new Error(`Invalid BGP prefix in RIPEstat response for AS${expectedAsn}: ${item.prefix}`);
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      activeCidrs.push(normalized);
    }
  }

  if (!allowEmpty && activeCidrs.length === 0) {
    throw new Error(`No active BGP prefixes found in RIPEstat for AS${expectedAsn}`);
  }
  return activeCidrs;
}

function extractVcardFullNames(vcardArray: unknown): string[] {
  if (!Array.isArray(vcardArray) || vcardArray.length < 2 || !Array.isArray(vcardArray[1])) {
    return [];
  }
  const names: string[] = [];
  for (const property of vcardArray[1]) {
    if (
      Array.isArray(property) &&
      property.length >= 4 &&
      property[0] === 'fn' &&
      typeof property[3] === 'string' &&
      property[3].trim()
    ) {
      names.push(normalizeOrgName(property[3]));
    }
  }
  return names;
}

function extractRegistrantIdentity(rdap: Record<string, unknown>): RdapRegistrantIdentity {
  const handles = new Set<string>();
  const orgNames = new Set<string>();
  const entities = Array.isArray(rdap.entities) ? rdap.entities : [];

  for (const entity of entities) {
    if (!isObject(entity) || !Array.isArray(entity.roles)) continue;
    const isRegistrant = entity.roles.some(
      role => typeof role === 'string' && role.toLowerCase() === 'registrant'
    );
    if (!isRegistrant) continue;

    if (typeof entity.handle === 'string' && entity.handle.trim()) {
      handles.add(entity.handle.trim().toUpperCase());
    }
    for (const orgName of extractVcardFullNames(entity.vcardArray)) {
      orgNames.add(orgName);
    }
  }

  return { handles, orgNames };
}

function identitiesMatch(expected: RdapRegistrantIdentity, actual: RdapRegistrantIdentity): boolean {
  for (const handle of actual.handles) {
    if (expected.handles.has(handle)) return true;
  }
  for (const orgName of actual.orgNames) {
    if (expected.orgNames.has(orgName)) return true;
  }
  return false;
}

function parseRdapIpRanges(rdap: Record<string, unknown>): IpMeta[] {
  const ranges: IpMeta[] = [];
  if (Array.isArray(rdap.cidr0_cidrs)) {
    for (const entry of rdap.cidr0_cidrs) {
      if (!isObject(entry) || typeof entry.length !== 'number') continue;
      const prefix = typeof entry.v4prefix === 'string'
        ? entry.v4prefix
        : (typeof entry.v6prefix === 'string' ? entry.v6prefix : null);
      if (!prefix) continue;
      const cidr = `${prefix}/${entry.length}`;
      if (IPValidator.isIpCidr(cidr)) {
        ranges.push(parseCidr(cidr));
      }
    }
  }

  if (
    ranges.length === 0 &&
    typeof rdap.startAddress === 'string' &&
    typeof rdap.endAddress === 'string'
  ) {
    const startFamily = isIP(rdap.startAddress);
    const endFamily = isIP(rdap.endAddress);
    if (startFamily === endFamily && (startFamily === 4 || startFamily === 6)) {
      const start = ip2bigint(rdap.startAddress, startFamily);
      const end = ip2bigint(rdap.endAddress, startFamily);
      if (start <= end) {
        ranges.push([start, end, startFamily]);
      }
    }
  }

  return ranges;
}

function isRangeContained(candidate: IpMeta, parents: readonly IpMeta[]): boolean {
  const [childStart, childEnd, childFamily] = candidate;
  return parents.some(
    ([parentStart, parentEnd, parentFamily]) =>
      parentFamily === childFamily && parentStart <= childStart && childEnd <= parentEnd
  );
}

function formatIdentitySummary(identity: RdapRegistrantIdentity): string {
  const parts = [
    ...identity.handles,
    ...identity.orgNames,
  ];
  return parts.length > 0 ? parts.join(', ') : '(none)';
}

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

async function fetchRdapObject(
  url: string,
  fetchFn: typeof $$fetch
): Promise<Record<string, unknown>> {
  const response = await fetchFn(url, {
    headers: {
      'User-Agent': UA_SURGE_MAC,
      Accept: 'application/rdap+json, application/json',
    },
  });
  const json: unknown = await response.json();
  if (!isObject(json)) throw new Error(`RDAP returned non-object JSON for ${url}`);
  return json;
}

async function fetchRdapJson(
  resourcePath: string,
  fetchFn: typeof $$fetch,
  rdapBaseUrl: string,
  fallbackRdapBaseUrl: string | null
): Promise<Record<string, unknown>> {
  const primaryUrl = `${trimTrailingSlash(rdapBaseUrl)}/${resourcePath}`;
  try {
    return await fetchRdapObject(primaryUrl, fetchFn);
  } catch (error) {
    const isNotFound = error instanceof ResponseError && error.statusCode === 404;
    if (isNotFound && fallbackRdapBaseUrl) {
      const fallbackUrl = `${trimTrailingSlash(fallbackRdapBaseUrl)}/${resourcePath}`;
      return fetchRdapObject(fallbackUrl, fetchFn);
    }
    throw error;
  }
}

async function fetchAsnRegistrantIdentity(
  asn: number,
  fetchFn: typeof $$fetch,
  rdapBaseUrl: string,
  fallbackRdapBaseUrl: string | null
): Promise<RdapRegistrantIdentity> {
  const rdap = await fetchRdapJson(`autnum/${asn}`, fetchFn, rdapBaseUrl, fallbackRdapBaseUrl);
  const startAutnum = typeof rdap.startAutnum === 'number' ? rdap.startAutnum : null;
  const endAutnum = typeof rdap.endAutnum === 'number' ? rdap.endAutnum : null;
  if (startAutnum === null || endAutnum === null || asn < startAutnum || asn > endAutnum) {
    throw new Error(`RDAP autnum response does not cover AS${asn}`);
  }

  const identity = extractRegistrantIdentity(rdap);
  if (identity.handles.size === 0 && identity.orgNames.size === 0) {
    throw new Error(`RDAP autnum response for AS${asn} has no registrant identity`);
  }
  return identity;
}

async function fetchRdapIpRecord(
  cidr: string,
  fetchFn: typeof $$fetch,
  rdapBaseUrl: string,
  fallbackRdapBaseUrl: string | null
): Promise<RdapIpRecord> {
  const rdap = await fetchRdapJson(`ip/${cidr}`, fetchFn, rdapBaseUrl, fallbackRdapBaseUrl);
  return {
    identity: extractRegistrantIdentity(rdap),
    ranges: parseRdapIpRanges(rdap),
  };
}

/**
 * Cross-verify every candidate CIDR against RIR RDAP:
 * 1) Learn the authoritative registrant identity from RDAP for `asn` (no hardcoded org handles).
 * 2) Confirm every CIDR belongs to that same registrant and fits mathematically inside its
 *    RDAP-registered IP block (rejecting third-party cloud IPs or overly broad masks).
 */
export async function verifyCidrsWithRdap(
  cidrs: readonly string[],
  asn: number,
  options: Pick<PrimaryIpLoadOptions, 'fetchFn' | 'rdapBaseUrl' | 'fallbackRdapBaseUrl'> = {}
): Promise<string[]> {
  if (cidrs.length === 0) return [];

  const fetchFn = options.fetchFn ?? $$fetch;
  const rdapBaseUrl = options.rdapBaseUrl ?? DEFAULT_ARIN_RDAP_BASE_URL;
  const fallbackRdapBaseUrl = options.fallbackRdapBaseUrl === undefined
    ? DEFAULT_BOOTSTRAP_RDAP_BASE_URL
    : options.fallbackRdapBaseUrl;

  const expectedIdentity = await fetchAsnRegistrantIdentity(
    asn,
    fetchFn,
    rdapBaseUrl,
    fallbackRdapBaseUrl
  );

  for (const cidr of new Set(cidrs)) {
    const candidateMeta = parseCidr(cidr);
    // A suballocation can have a different registrant from its enclosing block.
    // eslint-disable-next-line no-await-in-loop -- sequential lookups avoid RIR rate limits
    const record = await fetchRdapIpRecord(cidr, fetchFn, rdapBaseUrl, fallbackRdapBaseUrl);
    if (!identitiesMatch(expectedIdentity, record.identity)) {
      throw new Error(
        `RDAP registrant mismatch for ${cidr}: expected AS${asn} (${formatIdentitySummary(expectedIdentity)}), got (${formatIdentitySummary(record.identity)})`
      );
    }
    if (!isRangeContained(candidateMeta, record.ranges)) {
      throw new Error(
        `RDAP registered IP ranges do not contain candidate CIDR ${cidr}`
      );
    }
  }

  return [...cidrs];
}

function formatCidrRules(cidrs: readonly string[]): string[] {
  const rules: string[] = [];
  for (const cidr of cidrs) {
    rules.push(`${cidr.includes(':') ? 'IP-CIDR6' : 'IP-CIDR'},${cidr}`);
  }
  return rules;
}

export async function loadAnthropicDocsIpRules(
  url: string = ANTHROPIC_IP_DOCS_URL,
  options: PrimaryIpLoadOptions = {}
): Promise<string[]> {
  const fetchFn = options.fetchFn ?? $$fetch;
  console.log(picocolors.gray(`[primary-ip] Loading Anthropic inbound IP docs: ${url}`));

  try {
    const response = await fetchFn(url, {
      headers: {
        'User-Agent': UA_SURGE_MAC,
        Accept: 'text/markdown, text/plain',
      },
    });
    const markdown = await response.text();
    const cidrs = parseAnthropicInboundCidrs(markdown, options.allowEmpty ?? false);
    const verified = await verifyCidrsWithRdap(cidrs, ANTHROPIC_ASN, options);
    const rules = formatCidrRules(verified);
    console.log(picocolors.green(`[primary-ip] Loaded ${rules.length} RDAP-verified Anthropic inbound CIDRs`));
    return rules;
  } catch (error) {
    console.error(picocolors.red(`[primary-ip] Failed to load Anthropic inbound IP docs: ${url}`), error);
    if (options.throwOnError) throw error;
    return [];
  }
}

export async function loadRipestatAsnRules(
  url: string,
  options: PrimaryIpLoadOptions & { asn?: number } = {}
): Promise<string[]> {
  const fetchFn = options.fetchFn ?? $$fetch;
  const asn = options.asn ?? extractRipestatAsn(url);
  if (asn === null) {
    const error = new Error(`Cannot determine ASN from RIPEstat URL: ${url}`);
    if (options.throwOnError) throw error;
    return [];
  }

  console.log(picocolors.gray(`[primary-ip] Loading RIPEstat BGP prefixes for AS${asn}: ${url}`));

  try {
    const response = await fetchFn(url, {
      headers: {
        'User-Agent': UA_SURGE_MAC,
        Accept: 'application/json',
      },
    });
    const json: unknown = await response.json();
    const cidrs = parseRipestatAnnouncedPrefixes(json, asn, options.allowEmpty ?? false);
    const verified = await verifyCidrsWithRdap(cidrs, asn, options);
    const rules = verified.length === 0 ? [] : [...formatCidrRules(verified), `IP-ASN,${asn}`];
    console.log(picocolors.green(`[primary-ip] Loaded ${verified.length} RDAP-verified BGP CIDRs${verified.length > 0 ? ` + IP-ASN,${asn}` : ''}`));
    return rules;
  } catch (error) {
    console.error(picocolors.red(`[primary-ip] Failed to load RIPEstat BGP prefixes for AS${asn}: ${url}`), error);
    if (options.throwOnError) throw error;
    return [];
  }
}
