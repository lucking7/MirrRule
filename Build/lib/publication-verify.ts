import { retiredPublicPaths } from './artifact-lifecycle';
import type { GitHubClient } from './publication-github';
import { NRRULE_REPOSITORY } from './publication-github';
import type { Clock } from './publication-check';
import { PRODUCTION_ORIGIN, pollCloudflareCheck, systemClock } from './publication-check';
import type { ExpectedFile, HeaderProbe, HttpFetcher, OriginFailure } from './publication-http';
import { checkOriginUntil } from './publication-http';
import { PUBLICATION_MANIFEST_PATH, comparePaths } from './publication-manifest';
import type { PublicationManifest } from './publication-manifest';
import { RULE_OUTPUT_AUDIT_FILE, auditAbsentPaths, readOutputContract } from './publication-outputs';

/**
 * Paths that must answer 404: outputs the audit declares absent, every retired registry path,
 * and baseline paths this tree no longer publishes (retired removals and stale variants).
 */
export async function collectAbsentPaths(staging: string, manifest: PublicationManifest): Promise<string[]> {
  const { outputs } = await readOutputContract(staging, [RULE_OUTPUT_AUDIT_FILE]);
  const published = new Set(manifest.files.map(file => file.path));
  const absent = new Set([...auditAbsentPaths(outputs), ...retiredPublicPaths(), ...manifest.removedPaths, ...manifest.retiredRemoved]);
  return [...absent].filter(relative => !published.has(relative) && relative !== PUBLICATION_MANIFEST_PATH).sort(comparePaths);
}

export type VerificationOutcome =
  | 'accepted'
  | 'check-failed'
  | 'check-timeout'
  | 'immutable-mismatch'
  | 'production-lagging';

export const VERIFICATION_EXIT_CODES: Readonly<Record<VerificationOutcome, number>> = {
  accepted: 0,
  'check-failed': 10,
  'check-timeout': 11,
  'immutable-mismatch': 12,
  'production-lagging': 13,
};

const DEFAULT_VERIFICATION_TIMEOUT_MS = 15 * 60000;

export interface VerificationReport {
  outcome: VerificationOutcome,
  message: string,
  deployCommit: string,
  check: {
    state: string,
    checkRunId?: number,
    url?: string,
    reason?: string,
    rejected: string[]
  },
  immutableUrl: string | null,
  productionOrigin: string,
  checkedFiles: number,
  failures: Array<OriginFailure & { origin: string }>
}

export interface VerifyPublicationOptions {
  client: GitHubClient,
  deployCommit: string,
  /** Every published file, including the manifest itself. */
  files: readonly ExpectedFile[],
  absentPaths: readonly string[],
  headerProbes?: readonly HeaderProbe[],
  repository?: string,
  productionOrigin?: string,
  timeoutMs?: number,
  fetcher?: HttpFetcher,
  clock?: Clock,
  checkIntervalMs?: number,
  retryIntervalMs?: number,
  concurrency?: number
}

/**
 * Accept a deploy commit only after its own Cloudflare check succeeded, its immutable deployment
 * serves every manifest file, and the production domain serves the same bytes.
 */
export async function verifyPublication(options: VerifyPublicationOptions): Promise<VerificationReport> {
  const clock = options.clock ?? systemClock;
  const deadline = clock.now() + (options.timeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS);
  const productionOrigin = options.productionOrigin ?? PRODUCTION_ORIGIN;
  const base = {
    deployCommit: options.deployCommit,
    productionOrigin,
    checkedFiles: options.files.length,
  };
  const check = await pollCloudflareCheck({
    client: options.client,
    repository: options.repository ?? NRRULE_REPOSITORY,
    deployCommit: options.deployCommit,
    deadline,
    intervalMs: options.checkIntervalMs,
    clock,
  });
  if (check.state === 'timeout') {
    return {
      ...base,
      outcome: 'check-timeout',
      message: `Git published, website not accepted: no completed Cloudflare Pages check for ${options.deployCommit} before the deadline`,
      check: { state: `timeout (last ${check.lastState})`, checkRunId: check.checkRunId, rejected: check.rejected },
      immutableUrl: null,
      failures: [],
    };
  }
  if (check.state === 'failed') {
    return {
      ...base,
      outcome: 'check-failed',
      message: `Git published, website not accepted: ${check.reason}`,
      check: { state: check.state, checkRunId: check.checkRunId, url: check.url, reason: check.reason, rejected: check.rejected },
      immutableUrl: null,
      failures: [],
    };
  }
  const checkInfo = { state: check.state, checkRunId: check.checkRunId, url: check.url, rejected: check.rejected };
  const common = {
    files: options.files,
    absentPaths: options.absentPaths,
    headerProbes: options.headerProbes,
    fetcher: options.fetcher,
    clock,
    deadline,
    retryIntervalMs: options.retryIntervalMs,
    concurrency: options.concurrency,
  };
  const immutableFailures = await checkOriginUntil({ ...common, origin: check.immutableUrl });
  if (immutableFailures.length) {
    return {
      ...base,
      outcome: 'immutable-mismatch',
      message: `Git published, website not accepted: immutable deployment ${check.immutableUrl} does not match the manifest`,
      check: checkInfo,
      immutableUrl: check.immutableUrl,
      failures: immutableFailures.map(item => ({ ...item, origin: check.immutableUrl })),
    };
  }
  const productionFailures = await checkOriginUntil({ ...common, origin: productionOrigin });
  if (productionFailures.length) {
    return {
      ...base,
      outcome: 'production-lagging',
      message: `Git published, website not accepted: ${productionOrigin} does not serve deploy commit ${options.deployCommit} before the deadline`,
      check: checkInfo,
      immutableUrl: check.immutableUrl,
      failures: productionFailures.map(item => ({ ...item, origin: productionOrigin })),
    };
  }
  return {
    ...base,
    outcome: 'accepted',
    message: `Accepted: ${productionOrigin} and ${check.immutableUrl} serve every manifest file of ${options.deployCommit}`,
    check: checkInfo,
    immutableUrl: check.immutableUrl,
    failures: [],
  };
}

export function formatVerificationReport(report: VerificationReport, limit = 50): string {
  const lines = [
    `Outcome: ${report.outcome}`,
    report.message,
    `NRRule deployCommit: ${report.deployCommit}`,
    `Cloudflare check: ${report.check.state}${report.check.checkRunId ? ` (check run ${report.check.checkRunId})` : ''}${report.check.url ? ` ${report.check.url}` : ''}`,
  ];
  if (report.check.reason) lines.push(`Check reason: ${report.check.reason}`);
  for (const rejected of report.check.rejected) lines.push(`Rejected check evidence: ${rejected}`);
  if (report.immutableUrl) lines.push(`Immutable URL: ${report.immutableUrl}`);
  if (report.failures.length) {
    lines.push(`Failing URLs (${report.failures.length}):`);
    for (const failure of report.failures.slice(0, limit)) lines.push(`  ${failure.url} [${failure.reason}] ${failure.detail}`);
    if (report.failures.length > limit) lines.push(`  ... ${report.failures.length - limit} more in the JSON report`);
  }
  return lines.join('\n');
}
