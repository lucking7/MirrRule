import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

import { writeFileAtomic } from './lib/atomic-file';
import { optionalInteger, requireOption, runCli, writeOutputs } from './lib/publication-cli';
import { MIRRRULE_REPOSITORY, createGitHubClient } from './lib/publication-github';
import { headerProbes, parseHeadersFile } from './lib/publication-http';
import { PUBLICATION_MANIFEST_PATH, readManifestFromTree, sha256Hex } from './lib/publication-manifest';
import { ReceiptNotPersistedError, recordReceipt } from './lib/publication-receipt';
import type { ReceiptPayload } from './lib/publication-receipt';
import { VERIFICATION_EXIT_CODES, collectAbsentPaths, formatVerificationReport, verifyPublication } from './lib/publication-verify';

const USAGE = `Usage: verify-publication.ts <command> [options]

Commands:
  verify         --deploy-commit <sha> --staging <dir> [--timeout-minutes 15] [--report <file>]
      Wait for the Cloudflare Pages check of exactly this NRRule commit, then compare every
      manifest file at the immutable URL and at https://nrrule.pages.dev, and require 404 at both
      for audit-absent outputs, retired registry paths and baseline paths no longer published.
      No request starts after the deadline; unfinished paths are reported as failures. Exit codes: 0 accepted, 10 check-failed, 11 check-timeout,
      12 immutable-mismatch, 13 production-lagging.
  record-receipt --kind manifest --staging <dir> --deploy-commit <sha> --immutable-url <url> --ref <sha> [--log-url <url>]
  record-receipt --kind legacy-bootstrap --inventory <file> --deploy-commit <sha> --immutable-url <url>
                 --source-commit <sha> --artifact-id <id> --artifact-digest <sha256:hex> --run-id <id> --ref <sha> [--log-url <url>]
      Persist an acceptance receipt idempotently. Exit code 14: website accepted, receipt not persisted.

Environment: GITHUB_TOKEN, GITHUB_REPOSITORY (receipt repository, default ${MIRRRULE_REPOSITORY}).`;

const RECEIPT_NOT_PERSISTED_EXIT_CODE = 14;

async function verify(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      'deploy-commit': { type: 'string' },
      staging: { type: 'string' },
      'timeout-minutes': { type: 'string' },
      report: { type: 'string' },
    },
  });
  const staging = path.resolve(requireOption(values, 'staging'));
  const deployCommit = requireOption(values, 'deploy-commit');
  const { manifest, text } = await readManifestFromTree(staging);
  const files = [
    ...manifest.files.map(file => ({ path: file.path, sha256: file.sha256 })),
    { path: PUBLICATION_MANIFEST_PATH, sha256: sha256Hex(text) },
  ];
  let probes: ReturnType<typeof headerProbes> = [];
  try {
    probes = headerProbes(parseHeadersFile(await fs.readFile(path.join(staging, '_headers'), 'utf8')), files.map(file => file.path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const report = await verifyPublication({
    client: createGitHubClient(),
    deployCommit,
    files,
    absentPaths: await collectAbsentPaths(staging, manifest),
    headerProbes: probes,
    timeoutMs: (optionalInteger(values, 'timeout-minutes') ?? 15) * 60000,
  });
  const formatted = formatVerificationReport(report);
  if (report.outcome === 'accepted') console.log(formatted);
  else console.error(`::error::${report.message}\n${formatted}`);
  if (values.report) await writeFileAtomic(path.resolve(values.report), `${JSON.stringify(report, null, 2)}\n`);
  writeOutputs({ outcome: report.outcome, immutable_url: report.immutableUrl ?? '' });
  return VERIFICATION_EXIT_CODES[report.outcome];
}

async function record(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      kind: { type: 'string' },
      staging: { type: 'string' },
      inventory: { type: 'string' },
      'deploy-commit': { type: 'string' },
      'immutable-url': { type: 'string' },
      'source-commit': { type: 'string' },
      'artifact-id': { type: 'string' },
      'artifact-digest': { type: 'string' },
      'run-id': { type: 'string' },
      ref: { type: 'string' },
      'log-url': { type: 'string' },
    },
  });
  const kind = requireOption(values, 'kind');
  const deployCommit = requireOption(values, 'deploy-commit');
  const immutableUrl = requireOption(values, 'immutable-url');
  let payload: ReceiptPayload;
  if (kind === 'manifest') {
    const { manifest, sha256 } = await readManifestFromTree(path.resolve(requireOption(values, 'staging')));
    payload = {
      schemaVersion: 1,
      kind: 'manifest',
      sourceCommit: manifest.sourceCommit,
      deployCommit,
      candidateId: manifest.candidateId,
      manifestSha256: sha256,
      immutableUrl,
    };
  } else if (kind === 'legacy-bootstrap') {
    const inventoryText = await fs.readFile(path.resolve(requireOption(values, 'inventory')), 'utf8');
    const artifactId = optionalInteger(values, 'artifact-id');
    const runId = optionalInteger(values, 'run-id');
    if (!artifactId || !runId) throw new Error('--artifact-id and --run-id are required for legacy-bootstrap receipts');
    payload = {
      schemaVersion: 1,
      kind: 'legacy-bootstrap',
      sourceCommit: requireOption(values, 'source-commit'),
      deployCommit,
      candidateId: `legacy:${deployCommit}:artifact-${artifactId}`,
      manifestSha256: sha256Hex(inventoryText),
      immutableUrl,
      bootstrapArtifactId: artifactId,
      bootstrapArtifactDigest: requireOption(values, 'artifact-digest').startsWith('sha256:')
        ? requireOption(values, 'artifact-digest')
        : `sha256:${requireOption(values, 'artifact-digest')}`,
      bootstrapRunId: runId,
    };
  } else {
    throw new Error(`Unknown receipt kind: ${kind}`);
  }
  try {
    const result = await recordReceipt(createGitHubClient(), {
      repository: process.env.GITHUB_REPOSITORY || MIRRRULE_REPOSITORY,
      ref: requireOption(values, 'ref'),
      payload,
      logUrl: values['log-url'],
    });
    console.log(`Receipt ${result.deploymentId}: ${result.createdDeployment ? 'created' : 'reused existing deployment'}, ${result.createdStatus ? 'success status written' : 'already accepted'}`);
    writeOutputs({ receipt_id: result.deploymentId });
    return 0;
  } catch (error) {
    if (error instanceof ReceiptNotPersistedError) {
      console.error(`::error::${error.message}`);
      return RECEIPT_NOT_PERSISTED_EXIT_CODE;
    }
    throw error;
  }
}

const COMMANDS: Record<string, (args: string[]) => Promise<number>> = {
  verify,
  'record-receipt': record,
};

if (require.main === module) {
  const [command, ...rest] = process.argv.slice(2);
  const handler = command ? COMMANDS[command] : undefined;
  if (handler) {
    void runCli(() => handler(rest));
  } else {
    console.error(USAGE);
    process.exitCode = 2;
  }
}
