import type { GitHubClient } from './publication-github';
import { assertRepository } from './publication-github';
import { isAllowlistedImmutableUrl } from './publication-check';

/** GitHub Deployments environment on the MirrRule repository that stores acceptance receipts. */
const RECEIPT_ENVIRONMENT = 'nrrule-production';
const RECEIPT_TASK = 'publish:nrrule';
const RECEIPT_SCHEMA_VERSION = 1;

interface ReceiptPayloadBase {
  schemaVersion: typeof RECEIPT_SCHEMA_VERSION,
  /** MirrRule revision of the published content. */
  sourceCommit: string,
  /** NRRule revision accepted on the immutable deployment and production domain. */
  deployCommit: string,
  candidateId: string,
  /** SHA256 of the publication manifest file, or of the legacy inventory for bootstrap receipts. */
  manifestSha256: string,
  immutableUrl: string
}

interface ManifestReceiptPayload extends ReceiptPayloadBase {
  kind: 'manifest'
}

interface BootstrapReceiptPayload extends ReceiptPayloadBase {
  kind: 'legacy-bootstrap',
  bootstrapArtifactId: number,
  /** `sha256:<hex>` digest of the uploaded artifact archive. */
  bootstrapArtifactDigest: string,
  bootstrapRunId: number
}

export type ReceiptPayload = ManifestReceiptPayload | BootstrapReceiptPayload;

export interface AcceptedReceipt {
  id: number,
  createdAt: string,
  payload: ReceiptPayload
}

export class ReceiptNotPersistedError extends Error {
  // eslint-disable-next-line sukka/unicorn/custom-error-definition -- structured publication fields precede the message
  constructor(readonly deployCommit: string, readonly candidateId: string, cause: unknown) {
    super(
      `website accepted, acceptance receipt not persisted (deployCommit ${deployCommit}, candidate ${candidateId}): `
      + (cause instanceof Error ? cause.message : String(cause))
    );
    this.name = 'ReceiptNotPersistedError';
  }
}

const COMMIT = /^[\da-f]{40}$/;
const SHA256 = /^[\da-f]{64}$/;
const ARTIFACT_DIGEST = /^sha256:[\da-f]{64}$/;

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** Return a typed payload, or null when the stored payload is not a valid receipt. */
export function validateReceiptPayload(raw: unknown): ReceiptPayload | null {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') return null;
  const payload = value as Record<string, unknown>;
  if (payload.schemaVersion !== RECEIPT_SCHEMA_VERSION) return null;
  if (typeof payload.sourceCommit !== 'string' || !COMMIT.test(payload.sourceCommit)) return null;
  if (typeof payload.deployCommit !== 'string' || !COMMIT.test(payload.deployCommit)) return null;
  if (typeof payload.candidateId !== 'string' || !payload.candidateId) return null;
  if (typeof payload.manifestSha256 !== 'string' || !SHA256.test(payload.manifestSha256)) return null;
  if (typeof payload.immutableUrl !== 'string' || !isAllowlistedImmutableUrl(payload.immutableUrl)) return null;
  const base = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    sourceCommit: payload.sourceCommit,
    deployCommit: payload.deployCommit,
    candidateId: payload.candidateId,
    manifestSha256: payload.manifestSha256,
    immutableUrl: payload.immutableUrl,
  } as const;
  if (payload.kind === 'manifest') {
    if (!payload.candidateId.startsWith('sha256:')) return null;
    return { ...base, kind: 'manifest' };
  }
  if (payload.kind === 'legacy-bootstrap') {
    if (!positiveInteger(payload.bootstrapArtifactId) || !positiveInteger(payload.bootstrapRunId)) return null;
    if (typeof payload.bootstrapArtifactDigest !== 'string' || !ARTIFACT_DIGEST.test(payload.bootstrapArtifactDigest)) return null;
    return {
      ...base,
      kind: 'legacy-bootstrap',
      bootstrapArtifactId: payload.bootstrapArtifactId,
      bootstrapArtifactDigest: payload.bootstrapArtifactDigest,
      bootstrapRunId: payload.bootstrapRunId,
    };
  }
  return null;
}

interface DeploymentRecord {
  id: number,
  created_at: string,
  environment?: string,
  task?: string,
  payload: unknown
}

interface DeploymentStatusRecord {
  id: number,
  state: string
}

export interface ReceiptQueryOptions {
  repository: string,
  environment?: string,
  /** Pages of 100 deployments to scan, newest first. */
  maxPages?: number
}

async function listDeployments(client: GitHubClient, options: ReceiptQueryOptions): Promise<DeploymentRecord[]> {
  const repository = assertRepository(options.repository);
  const environment = encodeURIComponent(options.environment ?? RECEIPT_ENVIRONMENT);
  const task = encodeURIComponent(RECEIPT_TASK);
  const deployments: DeploymentRecord[] = [];
  for (let page = 1; page <= (options.maxPages ?? 3); page++) {
    // eslint-disable-next-line no-await-in-loop -- pages are read until the history ends
    const { data } = await client.request<DeploymentRecord[]>(
      'GET',
      `/repos/${repository}/deployments?environment=${environment}&task=${task}&per_page=100&page=${page}`
    );
    deployments.push(...data);
    if (data.length < 100) break;
  }
  return deployments.sort((a, b) => b.id - a.id);
}

async function latestStatusState(client: GitHubClient, repository: string, deploymentId: number): Promise<string | null> {
  const { data } = await client.request<DeploymentStatusRecord[]>(
    'GET',
    `/repos/${repository}/deployments/${deploymentId}/statuses?per_page=100`
  );
  if (!data.length) return null;
  return data.reduce((latest, status) => (status.id > latest.id ? status : latest)).state;
}

/** The newest accepted receipt; the NRRule HEAD is never consulted. */
export async function selectBaselineReceipt(client: GitHubClient, options: ReceiptQueryOptions): Promise<AcceptedReceipt | null> {
  for (const deployment of await listDeployments(client, options)) {
    const payload = validateReceiptPayload(deployment.payload);
    if (!payload) continue;
    // eslint-disable-next-line no-await-in-loop -- stop at the first accepted receipt
    if (await latestStatusState(client, options.repository, deployment.id) === 'success') {
      return { id: deployment.id, createdAt: deployment.created_at, payload };
    }
  }
  return null;
}

export async function getAcceptedReceipt(client: GitHubClient, id: number, options: ReceiptQueryOptions): Promise<AcceptedReceipt> {
  const repository = assertRepository(options.repository);
  const { data } = await client.request<DeploymentRecord>('GET', `/repos/${repository}/deployments/${id}`);
  if ((data.environment ?? RECEIPT_ENVIRONMENT) !== (options.environment ?? RECEIPT_ENVIRONMENT)) {
    throw new Error(`Receipt ${id} belongs to environment ${String(data.environment)}`);
  }
  const payload = validateReceiptPayload(data.payload);
  if (!payload) throw new Error(`Receipt ${id} has no valid publication payload`);
  const state = await latestStatusState(client, repository, id);
  if (state !== 'success') throw new Error(`Receipt ${id} is not accepted (latest status: ${state ?? 'none'})`);
  return { id, createdAt: data.created_at, payload };
}

/**
 * A retry of the same evidence reuses its receipt. New evidence for the same deploy commit,
 * such as a re-verified bootstrap with a new artifact, gets its own newer receipt.
 */
export function isSameEvidence(a: ReceiptPayload, b: ReceiptPayload): boolean {
  if (a.kind !== b.kind || a.deployCommit !== b.deployCommit || a.candidateId !== b.candidateId || a.manifestSha256 !== b.manifestSha256) return false;
  if (a.kind === 'legacy-bootstrap' && b.kind === 'legacy-bootstrap') {
    return a.bootstrapArtifactId === b.bootstrapArtifactId && a.bootstrapArtifactDigest === b.bootstrapArtifactDigest;
  }
  return true;
}

export interface RecordReceiptOptions extends ReceiptQueryOptions {
  /** MirrRule ref the deployment record is attached to, normally the publishing run's commit. */
  ref: string,
  payload: ReceiptPayload,
  logUrl?: string,
  environmentUrl?: string
}

export interface RecordReceiptResult {
  deploymentId: number,
  createdDeployment: boolean,
  createdStatus: boolean
}

/**
 * Create a receipt idempotently. An existing deployment with the same candidate and deploy
 * commit is reused, so a retry after a partial write completes it instead of duplicating it.
 */
export async function recordReceipt(client: GitHubClient, options: RecordReceiptOptions): Promise<RecordReceiptResult> {
  const repository = assertRepository(options.repository);
  const environment = options.environment ?? RECEIPT_ENVIRONMENT;
  const { payload } = options;
  try {
    const existing = (await listDeployments(client, options)).find(deployment => {
      const stored = validateReceiptPayload(deployment.payload);
      return stored !== null && isSameEvidence(stored, payload);
    });
    let deploymentId: number;
    let createdDeployment = false;
    if (existing) {
      deploymentId = existing.id;
      if (await latestStatusState(client, repository, deploymentId) === 'success') {
        return { deploymentId, createdDeployment: false, createdStatus: false };
      }
    } else {
      const { data } = await client.request<{ id?: number }>('POST', `/repos/${repository}/deployments`, {
        ref: options.ref,
        task: RECEIPT_TASK,
        environment,
        auto_merge: false,
        required_contexts: [],
        payload,
        description: `${payload.kind} ${payload.deployCommit.slice(0, 12)}`,
        transient_environment: false,
        production_environment: true,
      });
      if (!positiveInteger(data.id)) throw new Error('GitHub did not return a deployment id');
      deploymentId = data.id;
      createdDeployment = true;
    }
    await client.request('POST', `/repos/${repository}/deployments/${deploymentId}/statuses`, {
      state: 'success',
      environment_url: options.environmentUrl ?? 'https://nrrule.pages.dev',
      ...(options.logUrl && { log_url: options.logUrl }),
      description: `accepted ${payload.candidateId.slice(0, 40)}`,
      // Older receipts stay `success` so rollback can still select them.
      auto_inactive: false,
    });
    return { deploymentId, createdDeployment, createdStatus: true };
  } catch (error) {
    throw new ReceiptNotPersistedError(payload.deployCommit, payload.candidateId, error);
  }
}
