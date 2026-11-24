import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  auditRuleCoverage, cleanAuditRuleLine, NRRULE_HOST, nrruleSurgeReferences,
  parseSurgeSubscriptionPath, splitSurgeRuleFields, unquoteSurgeField,
} from './lib/rule-coverage-audit';
import type { CoverageAuditReport, CoverageSubscription, CoverageVariant } from './lib/rule-coverage-audit';
import { writeFileAtomic } from './lib/atomic-file';
import { RULE_OUTPUT_VARIANTS, resolveRuleOutputTargets } from './lib/rule-output-variants';

/** An illustrative order, with distinct policy roles to expose otherwise hidden overlaps. */
export const exampleRoutingOrder: ReadonlyArray<readonly [string, string]> = [
  ['reject', 'REJECT'],
  ['wechat', 'DIRECT'],
  ['apple_intelligence', 'AppleIntelligence'],
  ['openai', 'OpenAI'],
  ['anthropic', 'Anthropic'],
  ['ai', 'AI'],
  ['emby', 'Emby'],
  ['stream', 'Streaming'],
  ['telegram', 'Telegram'],
  ['apple_cdn', 'DIRECT'],
  ['apple_cn', 'DIRECT'],
  ['microsoft_cdn', 'DIRECT'],
  ['download', 'CDN'],
  ['domestic_cdn', 'DIRECT'],
  ['domestic', 'DIRECT'],
  ['cdn', 'CDN'],
  ['apple_services', 'Apple'],
  ['apple_services_ip', 'Apple'],
  ['icloud_private_relay', 'Apple'],
  ['google', 'Google'],
  ['amazon', 'Amazon'],
  ['global', 'Proxy'],
  ['lan', 'DIRECT'],
  ['china_ip', 'DIRECT']
];

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

type ReferenceFormat = 'rule-set' | 'domain-set';

interface ResolvedReference {
  /** Path label below the NRRule host, e.g. `non_ip/apple_cdn.list`. */
  label: string,
  variant?: CoverageVariant,
  filename?: string,
  skipped?: CoverageSubscription['skipped'],
  notCoveredReason?: string
}

/** Resolve published split subscriptions and enforce the client's reference format. */
export function resolveNrruleSurgeReference(pathname: string, format: ReferenceFormat, rulesDir: string): ResolvedReference {
  const parsed = parseSurgeSubscriptionPath(pathname);
  if (!parsed) {
    return {
      label: pathname.replace(/^\//, ''),
      skipped: 'unavailable-remote',
      notCoveredReason: 'Unknown NRRule Surge subscription path or extension'
    };
  }
  const label = parsed.path.slice('List/'.length);
  if ('retirementReason' in parsed) {
    return { label, skipped: 'retired-subscription', notCoveredReason: parsed.retirementReason };
  }
  const { variant } = parsed;
  const expected = variant === 'domainset' ? 'domain-set' : 'rule-set';
  if (format !== expected) {
    return {
      label,
      variant,
      skipped: 'format-mismatch',
      notCoveredReason: `List/${label} requires ${expected.toUpperCase()}; profile uses ${format.toUpperCase()}`
    };
  }
  return { label, variant, filename: path.join(rulesDir, label) };
}

type VariantAvailability = ReadonlyMap<string, string>;

interface AuditedRuleSet {
  id?: unknown,
  outputs?: unknown
}

async function readAuditedRuleSets(auditPath: string, mode: 'required' | 'optional'): Promise<AuditedRuleSet[]> {
  let data: unknown;
  try {
    data = JSON.parse(await fs.readFile(auditPath, 'utf8'));
  } catch (error) {
    if (mode === 'optional' && (error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error(`Unable to read rule output audit at ${auditPath}`, { cause: error });
  }
  const rulesets = (data as { rulesets?: unknown } | null)?.rulesets;
  if (!Array.isArray(rulesets)) throw new TypeError('Rule output audit has no rulesets list');
  return rulesets.filter((ruleset): ruleset is AuditedRuleSet => Boolean(ruleset) && typeof ruleset === 'object');
}

/**
 * Read absent Surge variant states from `Internal/rule-output-audit.json`
 * (`rulesets[].id` with `outputs[]` entries carrying `platform`, `variant`, `status` and optional `reason`).
 * Returns `<id>/<variant>` -> `status` or `status (reason)`; only `absent-*` Surge outputs are kept.
 */
export async function loadVariantAvailability(auditPath: string): Promise<VariantAvailability> {
  const availability = new Map<string, string>();
  for (const ruleset of await readAuditedRuleSets(auditPath, 'optional')) {
    if (typeof ruleset.id !== 'string' || !Array.isArray(ruleset.outputs)) continue;
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
    availability ??= loadVariantAvailability(options.outputAuditPath ?? path.join(rulesDir, '..', 'Internal', 'rule-output-audit.json'));
    return (await availability).get(`${basename.replace(/\.(?:list|conf)$/, '').toLowerCase()}/${variant}`);
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
      const retired = new Set<string>();
      for (const reference of nrruleSurgeReferences(fields)) {
        const { path: relative } = reference;
        if (!('retirementReason' in reference) || retired.has(relative)) continue;
        retired.add(relative);
        subscriptions.push({
          id: `${NRRULE_HOST}/${relative}:${lineIndex + 1}`,
          policy: unquoteSurgeField(fields[2] ?? 'UNKNOWN'),
          lines: [],
          skipped: 'retired-subscription',
          notCoveredReason: reference.retirementReason
        });
      }
      if (retired.size) continue;
      // Remove the outer policy, retaining only conditions needed for the audit.
      const policyIndex = type === 'FINAL' ? 1 : 2;
      const policy = unquoteSurgeField(fields[policyIndex] ?? 'UNKNOWN');
      const condition = fields.slice(0, policyIndex).join(',');
      const outerOptions = fields.slice(policyIndex + 1).map(field => field.toLowerCase());
      const unsupportedOptions = outerOptions.some(field => !['extended-matching', 'no-resolve'].includes(field));
      subscriptions.push({ id: `inline:${lineIndex + 1}:${/^[A-Z0-9-]+$/.test(type) ? type : 'UNKNOWN'}`, policy, kind: 'inline', lines: [condition], extendedMatching: outerOptions.includes('extended-matching'), ...(unsupportedOptions && { skipped: 'unsupported-options' as const }) });
      continue;
    }
    const reference = unquoteSurgeField(fields[1] ?? '');
    const policy = unquoteSurgeField(fields[2] ?? 'UNKNOWN');
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
          if (!skipped || skipped === 'retired-subscription') {
            const label = skipped === 'retired-subscription' ? `List/${resolved.label}` : resolved.label;
            id = `${url.hostname}/${label}:${lineIndex + 1}`;
          }
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
    if (skipped !== 'retired-subscription' && outerOptions.some(field => !['extended-matching', 'no-resolve'].includes(field) && !/^update-interval=-?\d+$/.test(field))) {
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
        } else {
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

async function readExampleSubscriptions(rulesDir: string, auditPath: string): Promise<CoverageSubscription[]> {
  const rulesets = new Map((await readAuditedRuleSets(auditPath, 'required')).map(ruleSet => [ruleSet.id, ruleSet.outputs]));
  return (await Promise.all(exampleRoutingOrder.map(async ([id, policy]) => {
    const outputs = rulesets.get(id);
    const targets = resolveRuleOutputTargets('surge', id);
    const paths = RULE_OUTPUT_VARIANTS.flatMap(variant => {
      if (!Array.isArray(outputs)) return [];
      const published = outputs.filter((output: Record<string, unknown> | null) =>
        output?.platform === 'surge' && output.variant === variant && output.status === 'published'
      );
      const available = targets.filter(target => target.slot === variant && published.some(output =>
        output.path === target.relativePath || (output.path === undefined && !target.aliasOf)
      ));
      const target = available.find(output => output.relativePath.endsWith('.conf')) ?? available.at(0);
      return target ? [{ label: target.relativePath.slice('List/'.length), variant }] : [];
    });
    if (paths.length === 0) {
      return [{ id, policy, lines: [], skipped: 'missing-local-file' as const, notCoveredReason: 'Rule output audit lists no published classical Surge variant' }];
    }
    return Promise.all(paths.map(({ label, variant }) =>
      readSubscription(label, policy, path.join(rulesDir, label), { format: 'rule-set', variant })
    ));
  }))).flat();
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
    subscriptions = await readExampleSubscriptions(options.rulesDir, options.outputAuditPath ?? path.join(options.rulesDir, '..', 'Internal', 'rule-output-audit.json'));
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
    console.log('Without --profile, audits the example subscription order. Profile references resolve below --rules-dir: DOMAIN-SET for List/domainset/*.conf and RULE-SET for non_ip/ip subscriptions. Retired subscriptions, missing files, absent variants and format mismatches exit 1; --fail-on-full-shadow exits 2 for proven full subscription shadow.');
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
  const { missingLocalSubscriptions, absentVariantSubscriptions, formatMismatchSubscriptions, retiredSubscriptions } = report.summary;
  if (missingLocalSubscriptions || absentVariantSubscriptions || formatMismatchSubscriptions || retiredSubscriptions) return 1;
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
