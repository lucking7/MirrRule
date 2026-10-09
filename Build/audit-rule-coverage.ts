import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { auditRuleCoverage, cleanAuditRuleLine, splitSurgeRuleFields } from './lib/rule-coverage-audit';
import type { CoverageAuditReport, CoverageSubscription } from './lib/rule-coverage-audit';
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

async function readSubscription(id: string, policy: string, filename: string): Promise<CoverageSubscription> {
  try {
    return { id, policy, lines: (await fs.readFile(filename, 'utf8')).split(/\r?\n/) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { id, policy, lines: [], skipped: 'missing-local-file' };
    }
    throw new Error(`Unable to read subscription ${id}`, { cause: error });
  }
}

export async function readProfileSubscriptions(
  text: string,
  profileBase: string,
  rulesDir: string
): Promise<CoverageSubscription[]> {
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
    if (type !== 'RULE-SET') {
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
    let id = `subscription:${lineIndex + 1}`;
    let filename: string | undefined;
    let skipped: CoverageSubscription['skipped'];
    if (/^https?:\/\//i.test(reference)) {
      try {
        const url = new URL(reference);
        const basename = path.posix.basename(url.pathname);
        id = `remote/${url.hostname}:${lineIndex + 1}`;
        if (url.hostname === 'nrrule.pages.dev' && /^\/List\/[^/]+\.list$/.test(url.pathname)) {
          id = `${url.hostname}/${basename}:${lineIndex + 1}`;
          filename = path.join(rulesDir, basename);
        } else skipped = 'unavailable-remote';
      } catch {
        skipped = 'unsupported-reference';
      }
    } else if (reference && reference !== 'LAN' && reference !== 'SYSTEM') {
      id = `local/${path.basename(reference)}:${lineIndex + 1}`;
      filename = path.resolve(profileBase, reference);
    } else skipped = 'unsupported-reference';
    const outerOptions = fields.slice(3).map(field => field.toLowerCase());
    if (outerOptions.some(field => !['extended-matching', 'no-resolve'].includes(field) && !/^update-interval=-?\d+$/.test(field))) skipped = 'unsupported-options';
    if (skipped || !filename) {
      subscriptions.push({ id, policy, lines: [], skipped: skipped ?? 'unsupported-reference' });
    } else {
      // eslint-disable-next-line no-await-in-loop -- preserve supplied subscription order
      const subscription = await readSubscription(id, policy, filename);
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
    subscriptions = await readProfileSubscriptions(text, options.profileBase ?? path.dirname(options.profilePath), options.rulesDir);
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
    console.log('Usage: pnpm run node Build/audit-rule-coverage.ts --rules-dir public/List --output report.json [--profile profile.conf] [--profile-base directory] [--fail-on-full-shadow]');
    console.log('Without --profile, audits an illustrative ordering template, not your active configuration. No remote downloads. Missing local subscriptions exit 1; --fail-on-full-shadow exits 2 for proven full subscription shadow.');
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
    if (!['--rules-dir', '--profile', '--profile-base', '--output'].includes(option) || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error('Unknown option or missing option value; use --help');
    }
    if (values[option]) throw new Error('Duplicate option; use --help');
    values[option] = args[++index];
  }
  if (!values['--output']) throw new Error('--output is required; use --help');
  const report = await createRuleCoverageReport({ rulesDir: values['--rules-dir'] ?? path.resolve('public/List'), profilePath: values['--profile'], profileBase: values['--profile-base'] });
  await writeRuleCoverageReport(report, values['--output']);
  console.log(`Coverage audit (${report.basis}): ${report.summary.auditedSubscriptions} subscriptions, ${report.summary.fullyShadowedSubscriptions} fully shadowed, ${report.summary.differentPolicyConflicts} domain policy overlaps, ${report.summary.skippedSubscriptions} skipped, ${report.summary.unsupportedRules} unsupported rules.`);
  if (report.summary.missingLocalSubscriptions) return 1;
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
