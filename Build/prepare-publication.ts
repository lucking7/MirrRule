import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

import { assertNoRetiredArtifacts, purgeRetiredArtifacts } from './lib/artifact-lifecycle';
import { writeFileAtomic } from './lib/atomic-file';
import { readBaselineEvidence, resolveBaselineEvidence, writeBaselineEvidence } from './lib/publication-baseline';
import type { ResolvedBaseline } from './lib/publication-baseline';
import { runBootstrap } from './lib/publication-bootstrap';
import { optionalInteger, parseTasks, requireOption, runCli, writeOutputs } from './lib/publication-cli';
import { checkoutCommit, publishStagingTree } from './lib/publication-git';
import { MIRRRULE_REPOSITORY, NRRULE_REPOSITORY, createGitHubClient } from './lib/publication-github';
import { getAcceptedReceipt, selectBaselineReceipt } from './lib/publication-receipt';
import type { AcceptedReceipt } from './lib/publication-receipt';
import {
  StageError,
  checkSuperseded,
  publicationScopeLabel,
  readCandidateBuiltAt,
  renderPublicInChild,
  restorePreservedDirs,
  stagePublication,
} from './lib/publication-stage';

const USAGE = `Usage: prepare-publication.ts <command> [options]

Commands:
  select-baseline   [--allow-missing]
      Print the newest accepted receipt (receipt_id, deploy_commit, kind).
  resolve-baseline  --tree <dir> --evidence <file> [--receipt-id <id>] [--expected-receipt-id <id>] [--allow-missing]
      Check out the accepted NRRule revision and verify it against its manifest or bootstrap inventory.
  restore-preserved --public <dir> --tasks <json> --tree <dir> --evidence <file>
      Replace optional directories not refreshed by this run with verified baseline files.
  stage             --candidate <dir> --out <dir> --tasks <json> --source-commit <sha>
                    [--tree <dir> --evidence <file>] [--rollback-evidence <file>] [--check-superseded]
      Assemble the complete production tree and write Internal/publication-manifest.json last.
      Requires the rule output audit, source delta, coverage, status and lifecycle reports, and
      every audited output to match its recorded bytes and sha256. If the accepted baseline
      changed after the build, preserved directories, index and manifest follow the new
      baseline, but the source delta is not recomputed: the stage fails with
      "baseline-drift: rebuild required", unless the new baseline is this same candidate
      already accepted, which ends as a no-op.
  purge             --root <dir>
      Remove registered retired artifacts under a directory and assert none remain.
  push              --repo <dir> --staging <dir> --expected-head <sha> --message <text> [--branch main]
      Commit the staging tree to an NRRule clone and push once; outputs deploy_commit.
  bootstrap         --tree <dir> --revision <sha> --immutable-url <url> --out <dir>
      Verify a pinned legacy NRRule revision and write the legacy inventory and evidence.

Environment: GITHUB_TOKEN (GitHub API), GITHUB_REPOSITORY (receipt repository, default ${MIRRRULE_REPOSITORY}).`;

const NRRULE_REMOTE = `https://github.com/${NRRULE_REPOSITORY}.git`;

function receiptRepository(): string {
  return process.env.GITHUB_REPOSITORY || MIRRRULE_REPOSITORY;
}

function describeReceipt(receipt: AcceptedReceipt): string {
  return `receipt ${receipt.id} (${receipt.payload.kind}) deployCommit ${receipt.payload.deployCommit} source ${receipt.payload.sourceCommit}`;
}

async function selectBaseline(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { 'allow-missing': { type: 'boolean' } } });
  const receipt = await selectBaselineReceipt(createGitHubClient(), { repository: receiptRepository() });
  if (!receipt) {
    if (!values['allow-missing']) throw new Error('No accepted publication receipt exists; run the bootstrap-baseline task first');
    console.log('No accepted publication receipt exists; later steps treat the baseline as unavailable');
    writeOutputs({ available: false, receipt_id: '', deploy_commit: '', kind: '' });
    return 0;
  }
  console.log(`Accepted baseline: ${describeReceipt(receipt)}`);
  writeOutputs({ available: true, receipt_id: receipt.id, deploy_commit: receipt.payload.deployCommit, kind: receipt.payload.kind });
  return 0;
}

async function resolveBaseline(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      tree: { type: 'string' },
      evidence: { type: 'string' },
      'receipt-id': { type: 'string' },
      'expected-receipt-id': { type: 'string' },
      'allow-missing': { type: 'boolean' },
    },
  });
  const tree = path.resolve(requireOption(values, 'tree'));
  const evidence = path.resolve(requireOption(values, 'evidence'));
  const client = createGitHubClient();
  const repository = receiptRepository();
  const receiptId = optionalInteger(values, 'receipt-id');
  const receipt = receiptId === undefined
    ? await selectBaselineReceipt(client, { repository })
    : await getAcceptedReceipt(client, receiptId, { repository });
  if (!receipt) {
    if (!values['allow-missing']) throw new Error('No accepted publication receipt exists; run the bootstrap-baseline task first');
    console.log('::notice::No accepted baseline; preserved directories and source delta are unavailable for this run');
    writeOutputs({ available: false, receipt_id: '', deploy_commit: '', kind: '', drift: false });
    return 0;
  }
  console.log(`Accepted baseline: ${describeReceipt(receipt)}`);
  await checkoutCommit({ remoteUrl: NRRULE_REMOTE, commit: receipt.payload.deployCommit, directory: tree });
  const resolved = await resolveBaselineEvidence({ client, repository, receipt, treeDir: tree });
  await writeBaselineEvidence(evidence, resolved);
  const expected = values['expected-receipt-id'];
  const drift = expected !== undefined && expected !== String(receipt.id);
  if (drift) {
    console.log(`::notice::Accepted baseline changed from receipt ${expected || 'none'} to ${receipt.id} after the candidate was built; staging re-checks whether this candidate is already accepted, otherwise it fails with baseline-drift: rebuild required`);
  }
  writeOutputs({ available: true, receipt_id: receipt.id, deploy_commit: resolved.deployCommit, kind: resolved.kind, drift });
  return 0;
}

async function restorePreserved(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { public: { type: 'string' }, tasks: { type: 'string' }, tree: { type: 'string' }, evidence: { type: 'string' } },
  });
  const baseline = await readBaselineEvidence(path.resolve(requireOption(values, 'evidence')));
  const restored = await restorePreservedDirs({
    publicDir: path.resolve(requireOption(values, 'public')),
    tasks: parseTasks(requireOption(values, 'tasks')),
    baseline,
    baselineTreeDir: path.resolve(requireOption(values, 'tree')),
    log: message => console.log(message),
  });
  writeOutputs({ restored: restored.join(',') });
  return 0;
}

async function stage(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      candidate: { type: 'string' },
      out: { type: 'string' },
      tasks: { type: 'string' },
      'source-commit': { type: 'string' },
      tree: { type: 'string' },
      evidence: { type: 'string' },
      'rollback-evidence': { type: 'string' },
      'check-superseded': { type: 'boolean' },
    },
  });
  const candidate = path.resolve(requireOption(values, 'candidate'));
  const tasks = parseTasks(requireOption(values, 'tasks'));
  let sourceCommit = requireOption(values, 'source-commit');
  const baseline: ResolvedBaseline | null = values.evidence ? await readBaselineEvidence(path.resolve(values.evidence)) : null;
  const rollbackEvidence = values['rollback-evidence'] ? await readBaselineEvidence(path.resolve(values['rollback-evidence'])) : null;
  if (rollbackEvidence) {
    if (rollbackEvidence.kind !== 'manifest') throw new Error(`Rollback receipt ${rollbackEvidence.receiptId} is a legacy bootstrap; only manifest receipts carry a verified full tree`);
    sourceCommit = rollbackEvidence.sourceCommit;
  }
  const builtAt = await readCandidateBuiltAt(candidate);
  if (!builtAt) console.log('::warning::Candidate status.json has no buildTime; the index timestamp is not reproducible');

  if (!rollbackEvidence && values['check-superseded']) {
    const superseded = await checkSuperseded({
      client: createGitHubClient(),
      repository: receiptRepository(),
      sourceCommit,
      builtAt: builtAt ?? new Date().toISOString(),
      baseline,
    });
    if (superseded.superseded) {
      console.log(`::notice::Candidate superseded, not publishing: ${superseded.reason}`);
      writeOutputs({ superseded: true, manifest_sha256: '', candidate_id: '', scopes: '' });
      return 0;
    }
    if (superseded.note) console.log(`::warning::${superseded.note}`);
  }

  let result;
  try {
    result = await stagePublication({
      candidateDir: candidate,
      outDir: requireOption(values, 'out'),
      tasks,
      sourceCommit,
      baseline,
      baselineTreeDir: values.tree ? path.resolve(values.tree) : null,
      render: renderPublicInChild,
      rollbackOf: rollbackEvidence
        ? { receiptId: rollbackEvidence.receiptId, deployCommit: rollbackEvidence.deployCommit, sourceCommit: rollbackEvidence.sourceCommit }
        : null,
      builtAt: builtAt ?? undefined,
      log: message => console.log(message),
    });
  } catch (error) {
    if (error instanceof StageError && error.code === 'already-accepted') {
      console.log(`::notice::${error.message}`);
      writeOutputs({ superseded: true, manifest_sha256: '', candidate_id: '', scopes: '' });
      return 0;
    }
    throw error;
  }
  const { manifest } = result;
  console.log(`Staged ${manifest.files.length} files; candidate ${manifest.candidateId}`);
  console.log(`  fresh: ${manifest.freshDirs.join(', ') || 'none'}; preserved: ${manifest.preservedDirs.join(', ') || 'none'}`);
  if (result.removed.length) console.log(`  retired paths removed: ${result.removed.join(', ')}`);
  writeOutputs({
    superseded: false,
    manifest_sha256: result.manifestSha256,
    candidate_id: manifest.candidateId,
    scopes: publicationScopeLabel(manifest),
  });
  return 0;
}

async function push(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      repo: { type: 'string' },
      staging: { type: 'string' },
      branch: { type: 'string', default: 'main' },
      'expected-head': { type: 'string' },
      message: { type: 'string' },
    },
  });
  const result = await publishStagingTree({
    repoDir: path.resolve(requireOption(values, 'repo')),
    stagingDir: path.resolve(requireOption(values, 'staging')),
    branch: requireOption(values, 'branch'),
    expectedHead: requireOption(values, 'expected-head'),
    message: requireOption(values, 'message'),
  });
  const description = {
    'no-op': `No content change; verifying current NRRule HEAD ${result.deployCommit}`,
    pushed: `Pushed NRRule ${result.deployCommit} (previous ${result.previousHead})`,
    'landed-after-error': `Push reported an error but NRRule ${result.deployCommit} landed; not pushing again`,
  }[result.outcome];
  console.log(description);
  writeOutputs({ deploy_commit: result.deployCommit, push_outcome: result.outcome });
  return 0;
}

async function bootstrap(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      tree: { type: 'string' },
      revision: { type: 'string' },
      'immutable-url': { type: 'string' },
      out: { type: 'string' },
      'timeout-minutes': { type: 'string' },
    },
  });
  const revision = requireOption(values, 'revision');
  const tree = path.resolve(requireOption(values, 'tree'));
  await checkoutCommit({ remoteUrl: NRRULE_REMOTE, commit: revision, directory: tree });
  const result = await runBootstrap({
    client: createGitHubClient(),
    treeDir: tree,
    revision,
    immutableUrl: requireOption(values, 'immutable-url'),
    outDir: path.resolve(requireOption(values, 'out')),
    timeoutMs: (optionalInteger(values, 'timeout-minutes') ?? 15) * 60000,
  });
  console.log(`Legacy inventory: ${result.inventory.files.length} files in ${result.inventory.preservedDirs.join(', ')}`);
  if (result.inventory.excludedRetired.length) console.log(`  excluded retired paths: ${result.inventory.excludedRetired.join(', ')}`);
  writeOutputs({ inventory_sha256: result.inventorySha256, immutable_url: result.inventory.immutableUrl });
  return 0;
}

/** Child-process entry: PUBLIC_DIR already points at the staging tree. */
async function renderPublic(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { 'built-at': { type: 'string' }, removed: { type: 'string' } } });
  const builtAt = new Date(requireOption(values, 'built-at'));
  if (Number.isNaN(builtAt.getTime())) throw new Error('--built-at must be an ISO date');
  const removed = JSON.parse(values.removed ?? '[]') as string[];
  const publicDir = process.env.PUBLIC_DIR;
  if (!publicDir) throw new Error('render-public requires PUBLIC_DIR');
  // build-public reads PUBLIC_DIR at load time, so it is loaded only inside this child process.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- runtime TS modules are loaded through @swc-node/register
  const { buildPublic, generateHtml, scanPublicTree } = require('./build-public') as typeof import('./build-public');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- runtime TS modules are loaded through @swc-node/register
  const { writeLifecycleReport } = require('./lib/artifact-lifecycle') as typeof import('./lib/artifact-lifecycle');
  await buildPublic();
  await writeLifecycleReport(publicDir, removed);
  await writeFileAtomic(path.join(publicDir, 'index.html'), generateHtml(await scanPublicTree(publicDir), builtAt));
  await fs.access(path.join(publicDir, '_headers'));
  return 0;
}

async function purge(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { root: { type: 'string' } } });
  const root = path.resolve(requireOption(values, 'root'));
  const removed = await purgeRetiredArtifacts(root);
  await assertNoRetiredArtifacts(root);
  console.log(removed.length ? `Removed retired artifacts: ${removed.join(', ')}` : 'No retired artifacts present');
  return 0;
}

const COMMANDS: Record<string, (args: string[]) => Promise<number>> = {
  purge,
  'select-baseline': selectBaseline,
  'resolve-baseline': resolveBaseline,
  'restore-preserved': restorePreserved,
  stage,
  push,
  bootstrap,
  'render-public': renderPublic,
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
