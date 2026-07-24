export const CANONICAL_RULE_TYPES = [
  'DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'DOMAIN-WILDCARD',
  'IP-CIDR', 'IP-CIDR6', 'IP-ASN', 'GEOIP',
  'USER-AGENT', 'PROCESS-NAME', 'PROCESS-PATH', 'URL-REGEX',
  'SRC-IP-CIDR', 'SRC-PORT', 'DEST-PORT', 'PROTOCOL',
  'AND', 'OR', 'NOT',
] as const;

export type CanonicalRuleType = typeof CANONICAL_RULE_TYPES[number];
export type RulePlatform = 'surge' | 'clash' | 'loon' | 'singbox';
export type RuleSupport =
  | { status: 'supported' }
  | { status: 'convertible'; conversion: string }
  | { status: 'explicitly-unsupported' };

const supported = { status: 'supported' } as const;
const unsupported = { status: 'explicitly-unsupported' } as const;
const convertible = (conversion: string): RuleSupport => ({ status: 'convertible', conversion });

export const RULE_SUPPORT_MATRIX: Record<RulePlatform, Record<CanonicalRuleType, RuleSupport>> = {
  surge: {
    DOMAIN: supported, 'DOMAIN-SUFFIX': supported, 'DOMAIN-KEYWORD': supported,
    'DOMAIN-WILDCARD': supported, 'IP-CIDR': supported, 'IP-CIDR6': supported,
    'IP-ASN': supported, GEOIP: supported, 'USER-AGENT': supported,
    'PROCESS-NAME': supported, 'PROCESS-PATH': convertible('PROCESS-NAME'),
    'URL-REGEX': supported, 'SRC-IP-CIDR': convertible('SRC-IP'),
    'SRC-PORT': supported, 'DEST-PORT': supported, PROTOCOL: supported,
    AND: supported, OR: supported, NOT: supported,
  },
  clash: {
    DOMAIN: supported, 'DOMAIN-SUFFIX': supported, 'DOMAIN-KEYWORD': supported,
    'DOMAIN-WILDCARD': supported, 'IP-CIDR': supported, 'IP-CIDR6': supported,
    'IP-ASN': supported, GEOIP: supported, 'USER-AGENT': unsupported,
    'PROCESS-NAME': supported, 'PROCESS-PATH': supported, 'URL-REGEX': unsupported,
    'SRC-IP-CIDR': convertible('SRC-IP-CIDR/SRC-IP-CIDR6'), 'SRC-PORT': supported,
    'DEST-PORT': convertible('DST-PORT'), PROTOCOL: convertible('NETWORK'),
    AND: supported, OR: supported, NOT: supported,
  },
  loon: {
    DOMAIN: supported, 'DOMAIN-SUFFIX': supported, 'DOMAIN-KEYWORD': supported,
    'DOMAIN-WILDCARD': unsupported, 'IP-CIDR': supported, 'IP-CIDR6': supported,
    'IP-ASN': supported, GEOIP: supported, 'USER-AGENT': supported,
    'PROCESS-NAME': unsupported, 'PROCESS-PATH': supported, 'URL-REGEX': supported,
    'SRC-IP-CIDR': unsupported, 'SRC-PORT': supported, 'DEST-PORT': supported,
    PROTOCOL: supported,
    AND: supported, OR: supported, NOT: supported,
  },
  singbox: {
    DOMAIN: supported, 'DOMAIN-SUFFIX': supported, 'DOMAIN-KEYWORD': supported,
    'DOMAIN-WILDCARD': convertible('domainWildCardToRegex'), 'IP-CIDR': supported,
    'IP-CIDR6': convertible('ip_cidr'), 'IP-ASN': unsupported, GEOIP: unsupported,
    'USER-AGENT': unsupported, 'PROCESS-NAME': unsupported, 'PROCESS-PATH': unsupported,
    'URL-REGEX': unsupported, 'SRC-IP-CIDR': unsupported, 'SRC-PORT': unsupported,
    'DEST-PORT': unsupported, PROTOCOL: unsupported,
    AND: unsupported, OR: unsupported, NOT: unsupported,
  },
};

export const MALFORMED_RULE_POLICY: { readonly failBuild: boolean } = { failBuild: false };
