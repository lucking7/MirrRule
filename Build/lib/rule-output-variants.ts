import path from 'node:path';
import type { SupportedPlatform } from './platform-config';

/** Mutually exclusive condition classes published next to each merged ruleset. */
export const RULE_OUTPUT_VARIANTS = ['domainset', 'non_ip', 'ip'] as const;
export type RuleOutputVariant = typeof RULE_OUTPUT_VARIANTS[number];
export type RuleOutputSlot = 'merged' | RuleOutputVariant;

export type RuleOutputFormat =
  | 'surge-classical'
  | 'surge-domainset'
  | 'clash-classical'
  | 'loon-classical'
  | 'singbox-json-v2';

export type RuleOutputStatus = 'published' | 'absent-empty' | 'absent-unsupported';

interface PlatformOutputLayout {
  directory: 'List' | 'Clash' | 'Loon' | 'sing-box';
  extension: 'list' | 'txt' | 'json';
  format: RuleOutputFormat;
}

export const PLATFORM_OUTPUT_LAYOUT: Readonly<Record<SupportedPlatform, PlatformOutputLayout>> = {
  surge: { directory: 'List', extension: 'list', format: 'surge-classical' },
  clash: { directory: 'Clash', extension: 'txt', format: 'clash-classical' },
  singbox: { directory: 'sing-box', extension: 'json', format: 'singbox-json-v2' },
  loon: { directory: 'Loon', extension: 'list', format: 'loon-classical' },
};

export interface RuleOutputTarget {
  platform: SupportedPlatform;
  slot: RuleOutputSlot;
  format: RuleOutputFormat;
  /** Output-root relative path with `/` separators. */
  relativePath: string;
}

/** Keep the historical flat id: lowercase basename of the configured path without its extension. */
export function rulesetIdFromConfigPath(configPath: string): string {
  const basename = path.posix.basename(configPath.replaceAll('\\', '/'));
  const extension = path.posix.extname(basename);
  const id = (extension ? basename.slice(0, -extension.length) : basename).toLowerCase();
  if (!id || id === '.' || id === '..') throw new Error(`Invalid ruleset path: ${configPath}`);
  return id;
}

export function resolveRuleOutputTarget(
  platform: SupportedPlatform,
  slot: RuleOutputSlot,
  id: string
): RuleOutputTarget {
  const layout = PLATFORM_OUTPUT_LAYOUT[platform];
  const filename = `${id}.${layout.extension}`;
  return {
    platform,
    slot,
    format: platform === 'surge' && slot === 'domainset' ? 'surge-domainset' : layout.format,
    relativePath: slot === 'merged'
      ? `${layout.directory}/${filename}`
      : `${layout.directory}/${slot}/${filename}`,
  };
}

/** Destination-address matchers; source-address types such as SRC-IP are not included. */
const DESTINATION_IP_RULE_TYPES: ReadonlySet<string> = new Set([
  'IP-CIDR', 'IP-CIDR6', 'IP-ASN', 'GEOIP', 'IP-SUFFIX',
]);
const LOGICAL_RULE_TYPES: ReadonlySet<string> = new Set(['AND', 'OR', 'NOT']);
const LOGICAL_CHILD_TYPE = /\(\s*([A-Z][A-Z\d-]*)\s*,/gi;

/** Rule types that Surge's extended-matching flag applies to. */
const EXTENDED_MATCHING_RULE_TYPES: ReadonlySet<string> = new Set([
  'DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'DOMAIN-WILDCARD', 'URL-REGEX',
]);

/** Whether a logical expression contains a sub-rule that extended matching affects. */
export function hasDomainMatcherSubRule(rule: string): boolean {
  for (const child of rule.matchAll(LOGICAL_CHILD_TYPE)) {
    if (EXTENDED_MATCHING_RULE_TYPES.has(child[1].toUpperCase())) return true;
  }
  return false;
}

/**
 * Classify a canonical rule line that is not stored in a typed canonical set.
 * Returns null for lines that carry no matching condition (comments, empty lines).
 * Logical expressions are classified as a whole and are never split.
 */
export function classifyRuleLine(rule: string): RuleOutputVariant | null {
  const trimmed = rule.trim();
  if (!trimmed || /^(?:[!#;]|\/\/)/.test(trimmed)) return null;
  const comma = trimmed.indexOf(',');
  const type = (comma === -1 ? trimmed : trimmed.slice(0, comma)).trim().toUpperCase();
  if (DESTINATION_IP_RULE_TYPES.has(type)) return 'ip';
  if (LOGICAL_RULE_TYPES.has(type)) {
    for (const child of trimmed.matchAll(LOGICAL_CHILD_TYPE)) {
      if (DESTINATION_IP_RULE_TYPES.has(child[1].toUpperCase())) return 'ip';
    }
  }
  return 'non_ip';
}
