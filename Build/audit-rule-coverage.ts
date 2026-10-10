import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { auditRuleCoverage, cleanAuditRuleLine, splitSurgeRuleFields } from './lib/rule-coverage-audit';
import type { CoverageAuditReport, CoverageSubscription, CoverageVariant } from './lib/rule-coverage-audit';
import { writeFileAtomic } from './lib/atomic-file';

/** An illustrative order, with distinct policy roles to expose otherwise hidden overlaps. */
export const exampleRoutingOrder: ReadonlyArray<readonly [string, string]> = [
  ['reject.list', 'REJECT'],
  ['wechat_no_ua.list', 'DIRECT'],
  ['apple_intelligence.list', 'AppleIntelligence'],
  ['ai.list', 'AI'],
  ['emby.list', 'Emby'],
  ['stream.list', 'Streaming'],
  ['telegram.list', 'Telegram'],
  ['apple_cdn.list', 'DIRECT'],
  ['apple_cn.list', 'DIRECT'],
  ['microsoft_cdn.list', 'DIRECT'],
  ['download.list', 'CDN'],
  ['domestic_cdn.list', 'DIRECT'],
  ['domestic.list', 'DIRECT'],
  ['cdn.list', 'CDN'],
  ['apple_services.list', 'Apple'],
  ['apple_services_ip.list', 'Apple'],
  ['icloud_private_relay.list', 'Apple'],
  ['google.list', 'Google'],
  ['amazon.list', 'Amazon'],
  ['global.list', 'Proxy'],
  ['lan.list', 'DIRECT'],
  ['china_ip.list', 'DIRECT']
];

function unquote(value: string): string {
  return /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
}

async function readSubscription(
  id: string,
  policy: string,
  filename: string,
  details: Pick<CoverageSubscription, 'format' | 'variant'> = {}
): Promise<CoverageSubscription> {
  try {
    return { id, policy, ...details, lines: (await fs.readFile(filename, 'utf8')).split(/\r?\n/) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { id, policy, ...details, lines: [], skipped: 'missing-local-file', notCoveredReason: 'Local subscription file not found' };
    }
    throw new Error(`Unable to read subscription ${id}`, { cause: error });
  }
}

const NRRULE_HOST = 'nrrule.pages.dev';
const SPLIT_VARIANTS = new Set<string>(['domainset', 'non_ip', 'ip']);
const NRRULE_SURGE_PATH = /^\/List\/(?:([^/]+)\/)?([^/]+\.list)$/;

type ReferenceFormat = 'rule-set' | 'domain-set';

interface ResolvedReference {
  /** Path label below the NRRule host, e.g. `domainset/apple_cdn.list`. */
  label: string,
  variant?: CoverageVariant,
  filename?: string,
  skipped?: CoverageSubscription['skipped'],
  notCoveredReason?: string
}

/**
 * Map an NRRule Surge URL path to a file below the supplied `List` directory.
 * Flat `List/<id>.list` is the merged RULE-SET; `List/domainset/<id>.list` is native DOMAIN-SET;
 * `List/non_ip|ip/<id>.list` are classical RULE-SET variants. Anything else stays unresolved.
 */
export function resolveNrruleSurgeReference(pathname: string, format: ReferenceFormat, rulesDir: string): ResolvedReference {
  const match = NRRULE_SURGE_PATH.exec(pathname);
  const directory: string | undefined = match?.[1];
  if (!match || (directory !== undefined && !SPLIT_VARIANTS.has(directory))) {
    return {
      label: pathname.replace(/^\//, ''),
      skipped: 'unavailable-remote',
      notCoveredReason: 'NRRule path is not a known Surge subscription (List/<id>.list or List/{domainset,non_ip,ip}/<id>.list)'
    };
  }
  const variant = (directory ?? 'merged') as CoverageVariant;
  const basename = match[2];
  const label = directory ? `${directory}/${basename}` : basename;
  const expected: ReferenceFormat = variant === 'domainset' ? 'domain-set' : 'rule-set';
  if (format !== expected) {
    return {
      label,
      variant,
      skipped: 'format-mismatch',
      notCoveredReason: expected === 'domain-set'
        ? 'List/domainset files are native DOMAIN-SET; reference them with DOMAIN-SET, not RULE-SET'
        : `List/${label} is a classical RULE-SET; reference it with RULE-SET, not DOMAIN-SET`
    };
  }
  return { label, variant, filename: directory ? path.join(rulesDir, directory, basename) : path.join(rulesDir, basename) };
}

type VariantAvailability = ReadonlyMap<string, string>;

/**
 * Read absent Surge variant states from `Internal/rule-output-audit.json`
 * (`rulesets[].id` with `outputs[]` entries carrying `platform`, `variant`, `status` and optional `reason`).
 * Returns `<id>/<variant>` -> `status` or `status (reason)`; only `absent-*` Surge outputs are kept.
 */
export async function loadVariantAvailability(auditPath: string): Promise<VariantAvailability> {
  const availability = new Map<string, string>();
  let data: unknown;
  try {
    data = JSON.parse(await fs.readFile(auditPath, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return availability;
    throw new Error('Unable to read rule output audit', { cause: error });
  }
  const rulesets = (data as { rulesets?: unknown } | null)?.rulesets;
  if (!Array.isArray(rulesets)) throw new Error('Rule output audit has no rulesets list');
  for (const ruleset of rulesets as Array<{ id?: unknown, outputs?: unknown } | null>) {
    if (typeof ruleset?.id !== 'string' || !Array.isArray(ruleset.outputs)) continue;
    for (const output of ruleset.outputs as Array<Record<string, unknown> | null>) {
      const { platform, variant, status, reason } = output ?? {};
      if (platform !== 'surge' || typeof variant !== 'string' || typeof status !== 'string' || !status.startsWith('absent-')) continue;
      availability.set(`${ruleset.id}/${variant}`, typeof reason === 'string' ? `${status} (${reason})` : status);
    }
  }
  return availability;
}

export async function readProfileSubscriptions(
  text: string,
  profileBase: string,
  rulesDir: string,
  options: { outputAuditPath?: string } = {}
): Promise<CoverageSubscription[]> {
  let availability: Promise<VariantAvailability> | undefined;
  const absentStatus = async (variant: CoverageVariant, basename: string) => {
    if (variant === 'merged') return;
    availability ??= loadVariantAvailability(options.outputAuditPath ?? path.join(rulesDir, '..', 'Internal', 'rule-output-audit.json'));
    return (await availability).get(`${basename.replace(/\.list$/, '').toLowerCase()}/${variant}`);
  };
  const subscriptions: CoverageSubscription[] = [];
  let inRules = false;
  let hasRules = false;
  const lines = text.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = cleanAuditRuleLine(lines[lineIndex]);
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      inRules = header[1].toLowerCase() === 'rule';
      hasRules ||= inRules;
      continue;
    }
    if (!inRules || !line || line.startsWith('#') || line.startsWith(';') || line.startsWith('//')) continue;
    const fields = splitSurgeRuleFields(line);
    const type = fields[0].toUpperCase();
    if (type !== 'RULE-SET' && type !== 'DOMAIN-SET') {
      // Remove the outer policy, retaining only conditions needed for the audit.
      const policyIndex = type === 'FINAL' ? 1 : 2;
      const policy = unquote(fields[policyIndex] ?? 'UNKNOWN');
      const condition = fields.slice(0, policyIndex).join(',');
      const outerOptions = fields.slice(policyIndex + 1).map(field => field.toLowerCase());
      const unsupportedOptions = outerOptions.some(field => !['extended-matching', 'no-resolve'].includes(field));
      subscriptions.push({ id: `inline:${lineIndex + 1}:${/^[A-Z0-9-]+$/.test(type) ? type : 'UNKNOWN'}`, policy, kind: 'inline', lines: [condition], extendedMatching: outerOptions.includes('extended-matching'), ...(unsupportedOptions && { skipped: 'unsupported-options' as const }) });
      continue;
    }
    const reference = unquote(fields[1] ?? '');
    const policy = unquote(fields[2] ?? 'UNKNOWN');
    const format: ReferenceFormat = type === 'DOMAIN-SET' ? 'domain-set' : 'rule-set';
    let id = `subscription:${lineIndex + 1}`;
    let filename: string | undefined;
    let variant: CoverageVariant | undefined;
    let skipped: CoverageSubscription['skipped'];
    let notCoveredReason: string | undefined;
    if (/^https?:\/\//i.test(reference)) {
      try {
        const url = new URL(reference);
        id = `remote/${url.hostname}:${lineIndex + 1}`;
        if (url.hostname === NRRULE_HOST) {
          const resolved = resolveNrruleSurgeReference(url.pathname, format, rulesDir);
          ({ filename, variant, skipped, notCoveredReason } = resolved);
          if (!skipped) id = `${url.hostname}/${resolved.label}:${lineIndex + 1}`;
        } else {
          skipped = 'unavailable-remote';
          notCoveredReason = 'Remote subscriptions are not fetched';
        }
      } catch {
        skipped = 'unsupported-reference';
      }
    } else if (reference && (format === 'domain-set' || (reference !== 'LAN' && reference !== 'SYSTEM'))) {
      id = `local/${path.basename(reference)}:${lineIndex + 1}`;
      filename = path.resolve(profileBase, reference);
    } else skipped = 'unsupported-reference';
    const outerOptions = fields.slice(3).map(field => field.toLowerCase());
    if (outerOptions.some(field => !['extended-matching', 'no-resolve'].includes(field) && !/^update-interval=-?\d+$/.test(field))) {
      skipped = 'unsupported-options';
      notCoveredReason = 'Unsupported outer subscription options';
    }
    const details = { format, ...(variant && { variant }) };
    if (skipped || !filename) {
      subscriptions.push({ id, policy, ...details, lines: [], skipped: skipped ?? 'unsupported-reference', ...(notCoveredReason && { notCoveredReason }) });
    } else {
      // eslint-disable-next-line no-await-in-loop -- preserve supplied subscription order
      const subscription = await readSubscription(id, policy, filename, details);
      if (variant && subscription.skipped === 'missing-local-file') {
        // eslint-disable-next-line no-await-in-loop -- loaded once, then cached
        const absent = await absentStatus(variant, path.basename(filename));
        if (absent) {
          subscription.skipped = 'absent-variant';
          subscription.notCoveredReason = `rule-output-audit reports ${absent} for the Surge ${variant} variant; no file is published at this URL`;
        } else if (variant !== 'merged') {
          subscription.notCoveredReason = 'Variant file not found and rule-output-audit records no absent status for it';
        }
      }
      subscription.extendedMatching = outerOptions.includes('extended-matching');
      subscriptions.push(subscription);
    }
  }
  if (!hasRules) throw new Error('Profile input has no [Rule] section');
  return subscriptions;
}

export async function createRuleCoverageReport(options: {
  rulesDir: string,
  profilePath?: string,
  profileBase?: string,
  /** Defaults to `<rulesDir>/../Internal/rule-output-audit.json`. */
  outputAuditPath?: string,
  exampleLimit?: number
}): Promise<CoverageAuditReport> {
  let subscriptions: CoverageSubscription[];
  if (options.profilePath) {
    let text: string;
    try {
      text = await fs.readFile(options.profilePath, 'utf8');
    } catch {
      throw new Error('Unable to read profile input');
    }
    subscriptions = await readProfileSubscriptions(text, options.profileBase ?? path.dirname(options.profilePath), options.rulesDir, { outputAuditPath: options.outputAuditPath });
  } else {
    subscriptions = await Promise.all(exampleRoutingOrder.map(([filename, policy]) => readSubscription(filename, policy, path.join(options.rulesDir, filename))));
  }
  return auditRuleCoverage(subscriptions, {
    basis: options.profilePath ? 'profile-rule-section' : 'example-order',
    exampleLimit: options.exampleLimit
  });
}

export async function auditRulesDirectory(rulesDir: string): Promise<CoverageAuditReport> {
  return createRuleCoverageReport({ rulesDir });
}

export async function writeRuleCoverageReport(report: CoverageAuditReport, outputPath: string): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await writeFileAtomic(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

export async function runCoverageAuditCli(args: readonly string[]): Promise<number> {
  if (args[0] === '--') args = args.slice(1);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: pnpm run node Build/audit-rule-coverage.ts --rules-dir public/List --output report.json [--profile profile.conf] [--profile-base directory] [--output-audit Internal/rule-output-audit.json] [--fail-on-full-shadow]');
    console.log('Without --profile, audits an illustrative ordering template, not your active configuration. No remote downloads. Profile DOMAIN-SET references to List/domainset/<id>.list and RULE-SET references to List/{non_ip,ip}/<id>.list resolve below --rules-dir. Missing local subscriptions, absent variants and RULE-SET/DOMAIN-SET format mismatches exit 1; --fail-on-full-shadow exits 2 for proven full subscription shadow.');
    return 0;
  }
  const values: Record<string, string> = {};
  let failOnFullShadow = false;
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (option === '--fail-on-full-shadow') {
      failOnFullShadow = true;
      continue;
    }
    if (!['--rules-dir', '--profile', '--profile-base', '--output', '--output-audit'].includes(option) || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error('Unknown option or missing option value; use --help');
    }
    if (values[option]) throw new Error('Duplicate option; use --help');
    values[option] = args[++index];
  }
  if (!values['--output']) throw new Error('--output is required; use --help');
  const report = await createRuleCoverageReport({ rulesDir: values['--rules-dir'] ?? path.resolve('public/List'), profilePath: values['--profile'], profileBase: values['--profile-base'], outputAuditPath: values['--output-audit'] });
  await writeRuleCoverageReport(report, values['--output']);
  console.log(`Coverage audit (${report.basis}): ${report.summary.auditedSubscriptions} subscriptions, ${report.summary.fullyShadowedSubscriptions} fully shadowed, ${report.summary.differentPolicyConflicts} domain policy overlaps, ${report.summary.skippedSubscriptions} skipped (not covered), ${report.summary.unsupportedRules} unsupported rules.`);
  const { missingLocalSubscriptions, absentVariantSubscriptions, formatMismatchSubscriptions } = report.summary;
  if (missingLocalSubscriptions || absentVariantSubscriptions || formatMismatchSubscriptions) return 1;
  return failOnFullShadow && report.summary.fullyShadowedSubscriptions ? 2 : 0;
}

if (require.main === module) {
  runCoverageAuditCli(process.argv.slice(2)).then(code => {
    process.exitCode = code;
  }).catch(error => {
    console.error(error instanceof Error ? error.message : 'Coverage audit failed');
    process.exitCode = 1;
  });
}
