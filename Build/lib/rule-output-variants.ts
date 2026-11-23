import path from 'node:path';
import type { SupportedPlatform } from './platform-config';

/**
 * Classical routing classes. The independent domainset projection also exposes exact and suffix
 * domains, which stay in non_ip for compatibility with existing subscriptions.
 */
export const RULE_OUTPUT_VARIANTS = ['non_ip', 'ip'] as const;
export type RuleOutputVariant = typeof RULE_OUTPUT_VARIANTS[number];
export type RuleOutputSlot = 'merged' | RuleOutputVariant | 'domainset';

export type RuleOutputFormat =
  | 'surge-classical'
  | 'surge-domainset'
  | 'clash-classical'
  | 'clash-domain'
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

const DOMAINSET_LAYOUT = {
  surge: { extension: 'conf', format: 'surge-domainset' },
  clash: { extension: 'txt', format: 'clash-domain' },
  singbox: { extension: 'json', format: 'singbox-json-v2' },
} as const;

type DomainsetPlatform = keyof typeof DOMAINSET_LAYOUT;

export function supportsDomainset(platform: SupportedPlatform): platform is DomainsetPlatform {
  return platform !== 'loon';
}

export const RULE_OUTPUT_LAYOUT_VERSION = 'sukka-compatible-v1';

/** Public split directories, including native domainsets where the platform supports them. */
export const RULE_OUTPUT_VARIANT_DIRECTORIES: readonly string[] = Object.values(PLATFORM_OUTPUT_LAYOUT)
  .flatMap(({ directory }) => {
    const slots = directory === 'Loon' ? RULE_OUTPUT_VARIANTS : ['domainset', ...RULE_OUTPUT_VARIANTS];
    return slots.map(slot => `${directory}/${slot}`);
  });

export type RuleOutputTarget = {
  platform: SupportedPlatform;
  format: RuleOutputFormat;
  /** Output-root relative path with `/` separators. */
  relativePath: string;
  /** A second public URL for the bytes of this output-root relative file. */
  aliasOf?: string;
} & ({ slot: 'merged' | RuleOutputVariant } | { slot: 'domainset' });

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
  if (slot === 'domainset') {
    if (!supportsDomainset(platform)) throw new Error(`Domainset output is unavailable for ${platform}`);
    const { extension, format } = DOMAINSET_LAYOUT[platform];
    return { platform, slot, format, relativePath: `${layout.directory}/domainset/${id}.${extension}` };
  }
  const filename = `${id}.${layout.extension}`;
  return {
    platform,
    slot,
    format: layout.format,
    relativePath: slot === 'merged'
      ? `${layout.directory}/${filename}`
      : `${layout.directory}/${slot}/${filename}`,
  };
}

/** Every physical file for this platform, with Surge's .conf split files paired to their .list sources. */
export function resolveRuleOutputTargets(
  platform: SupportedPlatform,
  id: string,
  { legacyOnly = false }: { legacyOnly?: boolean } = {}
): RuleOutputTarget[] {
  const targets: RuleOutputTarget[] = [];
  if (platform !== 'surge') targets.push(resolveRuleOutputTarget(platform, 'merged', id));
  if (!legacyOnly && supportsDomainset(platform)) targets.push(resolveRuleOutputTarget(platform, 'domainset', id));
  for (const variant of RULE_OUTPUT_VARIANTS) {
    const target = resolveRuleOutputTarget(platform, variant, id);
    targets.push(target);
    if (!legacyOnly && platform === 'surge') {
      targets.push({
        ...target,
        relativePath: `${target.relativePath.slice(0, -'.list'.length)}.conf`,
        aliasOf: target.relativePath,
      });
    }
  }
  return targets;
}

/** Destination-address matchers; source-address types such as SRC-IP are not included. */
const DESTINATION_IP_RULE_TYPES: ReadonlySet<string> = new Set([
  'IP-CIDR', 'IP-CIDR6', 'IP-ASN', 'GEOIP', 'IP-SUFFIX',
]);
const LOGICAL_RULE_TYPES: ReadonlySet<string> = new Set(['AND', 'OR', 'NOT']);
const LOGICAL_CHILD_TYPE = /\(\s*([A-Z][A-Z\d-]*)\s*,/gi;

/** Rule types that Surge's extended-matching flag applies to. */
export const EXTENDED_MATCHING_RULE_TYPES: ReadonlySet<string> = new Set([
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
 * Every destination IP rule belongs to ip, whether or not it carries no-resolve.
 * Logical expressions are classified as a whole and are never split.
 */
export function classifyRuleLine(rule: string): RuleOutputVariant | null {
  const trimmed = rule.trim();
  if (!trimmed || /^(?:[!#;]|\/\/)/.test(trimmed)) return null;
  const fields = trimmed.split(',').map(field => field.trim());
  const type = fields[0].toUpperCase();
  if (DESTINATION_IP_RULE_TYPES.has(type)) {
    return 'ip';
  }
  if (LOGICAL_RULE_TYPES.has(type)) {
    for (const child of trimmed.matchAll(LOGICAL_CHILD_TYPE)) {
      if (DESTINATION_IP_RULE_TYPES.has(child[1].toUpperCase())) return 'ip';
    }
  }
  return 'non_ip';
}
