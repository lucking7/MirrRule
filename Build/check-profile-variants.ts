import fs from 'node:fs/promises';
import process from 'node:process';

import { cleanAuditRuleLine } from './lib/rule-coverage-audit';
import { RULE_OUTPUT_VARIANTS } from './lib/rule-output-variants';

const DEFAULT_AUDIT = 'https://nrrule.pages.dev/Internal/rule-output-audit.json';
const NRRULE_SURGE_URL = new RegExp(String.raw`https?://nrrule\.pages\.dev/List/(?:(${RULE_OUTPUT_VARIANTS.join('|')})/)?([^/,\s)]+)\.list`, 'g');

export interface ProfileVariantFinding {
  id: string,
  /** Surge path below the NRRule host, e.g. `List/ip/download.list`. */
  path: string,
  /** `unreferenced`: published but not loaded by the profile; `absent`: loaded but not published (404). */
  kind: 'unreferenced' | 'absent'
}

type Slot = 'merged' | typeof RULE_OUTPUT_VARIANTS[number];

function surgePath(id: string, slot: Slot): string {
  return slot === 'merged' ? `List/${id}.list` : `List/${slot}/${id}.list`;
}

/** NRRule Surge subscriptions referenced by active lines of the profile's [Rule] section, by ruleset id. */
function referencedSlots(profile: string): Map<string, Set<Slot>> {
  const referenced = new Map<string, Set<Slot>>();
  let inRules = false;
  for (const raw of profile.split(/\r?\n/)) {
    const line = cleanAuditRuleLine(raw);
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      inRules = header[1].toLowerCase() === 'rule';
      continue;
    }
    if (!inRules || !line || /^(?:#|;|\/\/)/.test(line)) continue;
    // Matches nested references in logical rules as well as top-level RULE-SET/DOMAIN-SET lines.
    for (const [, variant, id] of line.matchAll(NRRULE_SURGE_URL)) {
      const slots = referenced.get(id.toLowerCase()) ?? new Set<Slot>();
      slots.add((variant ?? 'merged') as Slot);
      referenced.set(id.toLowerCase(), slots);
    }
  }
  return referenced;
}

/** Surge outputs the audit reports as published, by ruleset id. */
function publishedSlots(audit: unknown): Map<string, Set<Slot>> {
  const rulesets = (audit as { rulesets?: unknown } | null)?.rulesets;
  if (!Array.isArray(rulesets)) throw new Error('Rule output audit has no rulesets list');
  const published = new Map<string, Set<Slot>>();
  for (const ruleset of rulesets as Array<{ id?: unknown, outputs?: unknown } | null>) {
    if (typeof ruleset?.id !== 'string' || !Array.isArray(ruleset.outputs)) continue;
    const slots = new Set<Slot>();
    for (const output of ruleset.outputs as Array<Record<string, unknown> | null>) {
      if (output?.platform === 'surge' && output.status === 'published' && typeof output.variant === 'string') slots.add(output.variant as Slot);
    }
    published.set(ruleset.id, slots);
  }
  return published;
}

/**
 * Compare a Surge profile with the output audit. A ruleset loaded only through its variants misses
 * any variant that appears later, such as an ip variant once upstream adds rules that trigger a DNS
 * lookup; a loaded variant that is no longer published fails to download.
 */
export function checkProfileVariants(profile: string, audit: unknown): ProfileVariantFinding[] {
  const published = publishedSlots(audit);
  const findings: ProfileVariantFinding[] = [];
  for (const [id, slots] of [...referencedSlots(profile)].sort(([a], [b]) => a.localeCompare(b))) {
    const available = published.get(id) ?? new Set<Slot>();
    for (const slot of slots) {
      if (!available.has(slot)) findings.push({ id, path: surgePath(id, slot), kind: 'absent' });
    }
    // The merged file already carries every condition.
    if (slots.has('merged')) continue;
    for (const variant of RULE_OUTPUT_VARIANTS) {
      if (available.has(variant) && !slots.has(variant)) findings.push({ id, path: surgePath(id, variant), kind: 'unreferenced' });
    }
  }
  return findings;
}

async function readAudit(source: string): Promise<unknown> {
  if (/^https?:\/\//.test(source)) {
    const response = await fetch(source, { headers: { 'cache-control': 'no-cache' } });
    if (!response.ok) throw new Error(`Unable to fetch rule output audit: HTTP ${response.status}`);
    return response.json();
  }
  return JSON.parse(await fs.readFile(source, 'utf8'));
}

export async function runProfileVariantCli(args: readonly string[]): Promise<number> {
  if (args[0] === '--') args = args.slice(1);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: pnpm run node Build/check-profile-variants.ts --profile profile.conf [--audit <path or URL, default ${DEFAULT_AUDIT}>]`);
    console.log('Lists NRRule Surge variants the profile does not load although they are published, and loaded variants that are no longer published. Exits 1 when it finds either.');
    return 0;
  }
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (!['--profile', '--audit'].includes(option) || !args[index + 1] || args[index + 1].startsWith('--') || values[option]) {
      throw new Error('Unknown, duplicate or incomplete option; use --help');
    }
    values[option] = args[++index];
  }
  if (!values['--profile']) throw new Error('--profile is required; use --help');
  const findings = checkProfileVariants(await fs.readFile(values['--profile'], 'utf8'), await readAudit(values['--audit'] ?? DEFAULT_AUDIT));
  for (const finding of findings) {
    console.log(finding.kind === 'unreferenced'
      ? `missing: ${finding.path} is published but the profile does not load it`
      : `absent: ${finding.path} is loaded but not published (HTTP 404)`);
  }
  if (!findings.length) console.log('OK: every published variant of the loaded NRRule rulesets is referenced');
  return findings.length ? 1 : 0;
}

if (require.main === module) {
  runProfileVariantCli(process.argv.slice(2)).then(code => {
    process.exitCode = code;
  }).catch(error => {
    console.error(error instanceof Error ? error.message : 'Profile variant check failed');
    process.exitCode = 1;
  });
}
