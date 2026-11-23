import fs from 'node:fs/promises';
import process from 'node:process';

import { cleanAuditRuleLine } from './lib/rule-coverage-audit';
import { RULE_OUTPUT_VARIANTS } from './lib/rule-output-variants';
import type { RuleOutputSlot } from './lib/rule-output-variants';

const DEFAULT_AUDIT = 'https://nrrule.pages.dev/Internal/rule-output-audit.json';
const NRRULE_SURGE_URL = /https?:\/\/nrrule\.pages\.dev\/(List\/(?:(domainset|non_ip|ip)\/)?([^/,\s)"'?#]+)\.(?:list|conf))(?=[,\s)"'?#]|$)/g;

export interface ProfileVariantFinding {
  id: string,
  /** Surge path below the NRRule host, e.g. `List/ip/download.conf`. */
  path: string,
  /** `unreferenced`: published but not loaded by the profile; `absent`: loaded but not published (404). */
  kind: 'unreferenced' | 'absent'
}

type SlotPaths = Map<RuleOutputSlot, Set<string>>;

function addPath(slots: SlotPaths, slot: RuleOutputSlot, path: string): void {
  const paths = slots.get(slot) ?? new Set<string>();
  paths.add(path);
  slots.set(slot, paths);
}

/** NRRule Surge subscriptions referenced by active lines of the profile's [Rule] section, by ruleset id. */
function referencedSlots(profile: string): Map<string, SlotPaths> {
  const referenced = new Map<string, SlotPaths>();
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
    for (const [, path, variant, basename] of line.matchAll(NRRULE_SURGE_URL)) {
      const id = basename.toLowerCase();
      const slots = referenced.get(id) ?? new Map();
      addPath(slots, (variant || 'merged') as RuleOutputSlot, path);
      referenced.set(id, slots);
    }
  }
  return referenced;
}

/** Surge outputs the audit reports as published, by ruleset id. */
function publishedSlots(audit: unknown): Map<string, SlotPaths> {
  const rulesets = (audit as { rulesets?: unknown } | null)?.rulesets;
  if (!Array.isArray(rulesets)) throw new TypeError('Rule output audit has no rulesets list');
  const published = new Map<string, SlotPaths>();
  for (const ruleset of rulesets as Array<{ id?: unknown, outputs?: unknown } | null>) {
    if (typeof ruleset?.id !== 'string' || !Array.isArray(ruleset.outputs)) continue;
    const slots: SlotPaths = new Map();
    for (const output of ruleset.outputs as Array<Record<string, unknown> | null>) {
      if (output?.platform !== 'surge' || output.status !== 'published') continue;
      const slot = output.variant;
      if (slot !== 'merged' && slot !== 'domainset' && slot !== 'non_ip' && slot !== 'ip') continue;
      if (typeof output.path === 'string') {
        addPath(slots, slot, output.path);
      } else if (slot !== 'domainset' && output.path === undefined) {
        // Historical pathless audit entries describe only the original .list outputs.
        const directory = slot === 'merged' ? 'List' : `List/${slot}`;
        addPath(slots, slot, `${directory}/${ruleset.id}.list`);
      }
    }
    published.set(ruleset.id, slots);
  }
  return published;
}

/**
 * Check the exact referenced URL paths. Both extensions cover the same classical slot,
 * and only non_ip/ip participate in split coverage suggestions.
 */
export function checkProfileVariants(profile: string, audit: unknown): ProfileVariantFinding[] {
  const published = publishedSlots(audit);
  const findings: ProfileVariantFinding[] = [];
  for (const [id, slots] of [...referencedSlots(profile)].sort(([a], [b]) => a.localeCompare(b))) {
    const available = published.get(id);
    const loaded = new Set<RuleOutputSlot>();
    for (const [slot, paths] of slots) {
      for (const path of paths) {
        if (available?.get(slot)?.has(path)) loaded.add(slot);
        else findings.push({ id, path, kind: 'absent' });
      }
    }
    // The merged file already carries every condition.
    if (loaded.has('merged') || !RULE_OUTPUT_VARIANTS.some(variant => slots.has(variant))) continue;
    for (const variant of RULE_OUTPUT_VARIANTS) {
      if (loaded.has(variant)) continue;
      const paths = [...available?.get(variant) ?? []];
      const path = paths.find(candidate => candidate.endsWith('.conf')) ?? paths[0];
      if (path) findings.push({ id, path, kind: 'unreferenced' });
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
    console.log('Checks referenced NRRule Surge paths against the audit and reports missing non_ip or ip coverage for split subscriptions. Exits 1 when it finds either.');
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
  if (!findings.length) console.log('OK: NRRule Surge subscriptions and split coverage match the audit');
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
