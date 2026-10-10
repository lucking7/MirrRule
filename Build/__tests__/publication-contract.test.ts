/* eslint-disable @typescript-eslint/require-await -- fakes implement async interfaces with synchronous bodies */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';

import { BaselineTreeMismatchError, resolveBaselineEvidence } from '../lib/publication-baseline';
import type { ResolvedBaseline } from '../lib/publication-baseline';
import { BootstrapArtifactUnavailableError, BootstrapVerificationError, runBootstrap } from '../lib/publication-bootstrap';
import { evaluateCheckRuns, parseImmutableUrl } from '../lib/publication-check';
import type { CheckRunRecord, Clock } from '../lib/publication-check';
import { PushUncertainError, RemoteDriftError, publishStagingTree, runGit } from '../lib/publication-git';
import type { GitResult, GitRunner } from '../lib/publication-git';
import { GitHubApiError } from '../lib/publication-github';
import type { GitHubClient, GitHubResponse } from '../lib/publication-github';
import type { HttpFetcher, HttpResult } from '../lib/publication-http';
import { publicPathFor } from '../lib/publication-http';
import {
  PUBLICATION_MANIFEST_PATH,
  buildManifest,
  computeCandidateId,
  diffManifests,
  parseManifest,
  scanTree,
  serializeManifest,
  sha256Hex,
} from '../lib/publication-manifest';
import {
  ReceiptNotPersistedError,
  isSameEvidence,
  recordReceipt,
  selectBaselineReceipt,
  validateReceiptPayload,
} from '../lib/publication-receipt';
import type { ReceiptPayload } from '../lib/publication-receipt';
import { StageError, checkSuperseded, classifyBaselineDrift, freshDirsForTasks, stagePublication } from '../lib/publication-stage';
import type { RenderPublic } from '../lib/publication-stage';
import { collectAbsentPaths, verifyPublication } from '../lib/publication-verify';

const SOURCE = 'a'.repeat(40);
const DEPLOY = 'b'.repeat(40);
const OTHER = 'c'.repeat(40);
const IMMUTABLE = 'https://c2ff8766.nrrule.pages.dev';
const SUMMARY = `<tr><td><strong>Preview URL:</strong></td><td>\n<a href='${IMMUTABLE}'>${IMMUTABLE}</a>\n</td></tr>`;
const CF_APP = { slug: 'cloudflare-workers-and-pages', id: 85455 };
const REPO = 'lucking7/MirrRule';
const NOT_PRESERVED = new Map<string, string>();

interface FakeDeployment {
  id: number,
  created_at: string,
  environment: string,
  task: string,
  ref: string,
  payload: unknown
}

/** In-memory GitHub REST fake covering deployments, check runs, artifacts and compare. */
class FakeGitHub implements GitHubClient {
  deployments: FakeDeployment[] = [];
  statuses = new Map<number, Array<{ id: number, state: string }>>();
  checkRuns: (sha: string, call: number) => CheckRunRecord[] = () => [];
  artifacts = new Map<number, { id: number, expired: boolean, digest: string | null, archive_download_url: string }>();
  downloads = new Map<string, Uint8Array>();
  compareStatus = 'ahead';
  failWrite: ((apiPath: string) => boolean) | null = null;
  writes: string[] = [];
  private nextId = 100;
  private checkCalls = 0;

  async request<T>(method: string, apiPath: string, body?: unknown): Promise<GitHubResponse<T>> {
    const url = new URL(apiPath, 'https://api.github.test');
    const pathname = url.pathname;
    const reply = (data: unknown): GitHubResponse<T> => ({ status: 200, data: data as T });
    if (method !== 'GET') {
      this.writes.push(`${method} ${pathname}`);
      if (this.failWrite?.(pathname)) throw new GitHubApiError(method, pathname, 502, 'injected failure');
    }
    let match = /^\/repos\/[^/]+\/[^/]+\/deployments$/.exec(pathname);
    if (match && method === 'GET') {
      const page = Number(url.searchParams.get('page') ?? '1');
      const filtered = this.deployments
        .filter(item => item.environment === url.searchParams.get('environment') && item.task === url.searchParams.get('task'))
        .sort((a, b) => b.id - a.id);
      return reply(filtered.slice((page - 1) * 100, page * 100));
    }
    if (match && method === 'POST') {
      const input = body as { ref: string, environment: string, task: string, payload: unknown };
      const id = this.nextId++;
      this.deployments.push({ id, created_at: new Date(id * 1000).toISOString(), environment: input.environment, task: input.task, ref: input.ref, payload: input.payload });
      return reply({ id });
    }
    match = /^\/repos\/[^/]+\/[^/]+\/deployments\/(\d+)\/statuses$/.exec(pathname);
    if (match) {
      const id = Number(match[1]);
      if (method === 'GET') return reply([...this.statuses.get(id) ?? []].reverse());
      const list = this.statuses.get(id) ?? [];
      list.push({ id: this.nextId++, state: (body as { state: string }).state });
      this.statuses.set(id, list);
      return reply({});
    }
    match = /^\/repos\/[^/]+\/[^/]+\/deployments\/(\d+)$/.exec(pathname);
    if (match) {
      const found = this.deployments.find(item => item.id === Number(match![1]));
      if (!found) throw new GitHubApiError(method, pathname, 404, 'Not Found');
      return reply(found);
    }
    match = /^\/repos\/[^/]+\/[^/]+\/commits\/([\da-f]+)\/check-runs$/.exec(pathname);
    if (match) return reply({ check_runs: this.checkRuns(match[1], this.checkCalls++) });
    match = /^\/repos\/[^/]+\/[^/]+\/actions\/artifacts\/(\d+)$/.exec(pathname);
    if (match) {
      const artifact = this.artifacts.get(Number(match[1]));
      if (!artifact) throw new GitHubApiError(method, pathname, 404, 'Not Found');
      return reply(artifact);
    }
    if (/^\/repos\/[^/]+\/[^/]+\/compare\//.test(pathname)) return reply({ status: this.compareStatus });
    throw new Error(`Unhandled fake route ${method} ${apiPath}`);
  }

  async download(url: string): Promise<Uint8Array> {
    const data = this.downloads.get(url);
    if (!data) throw new GitHubApiError('GET', url, 404, 'Not Found');
    return data;
  }

  addReceipt(payload: unknown, states: string[], environment = 'nrrule-production'): number {
    const id = this.nextId++;
    this.deployments.push({ id, created_at: new Date(id * 1000).toISOString(), environment, task: 'publish:nrrule', ref: SOURCE, payload });
    this.statuses.set(id, states.map(state => ({ id: this.nextId++, state })));
    return id;
  }
}

function fakeClock(start = 0): Clock & { elapsed: () => number, advance: (ms: number) => void } {
  let time = start;
  const waiters: Array<{ at: number, controller: AbortController }> = [];
  const advance = (ms: number) => {
    time += ms;
    for (const waiter of waiters) {
      if (time >= waiter.at) waiter.controller.abort();
    }
  };
  return {
    now: () => time,
    async sleep(ms) {
      advance(Math.max(ms, 1));
    },
    signalAt(deadline) {
      const controller = new AbortController();
      if (time >= deadline) controller.abort();
      else waiters.push({ at: deadline, controller });
      return controller.signal;
    },
    advance,
    elapsed: () => time - start,
  };
}

function successRun(sha: string, overrides: Partial<CheckRunRecord> = {}): CheckRunRecord {
  return {
    id: 1,
    name: 'Cloudflare Pages',
    head_sha: sha,
    status: 'completed',
    conclusion: 'success',
    app: CF_APP,
    output: { summary: SUMMARY },
    ...overrides,
  };
}

function manifestPayload(overrides: Partial<ReceiptPayload> = {}): ReceiptPayload {
  return {
    schemaVersion: 1,
    kind: 'manifest',
    sourceCommit: SOURCE,
    deployCommit: DEPLOY,
    candidateId: `sha256:${'d'.repeat(64)}`,
    manifestSha256: 'e'.repeat(64),
    immutableUrl: IMMUTABLE,
    ...overrides,
  } as ReceiptPayload;
}

/** Fetcher serving a map of origin-relative URL paths; unknown paths are 404. */
function siteFetcher(sites: Record<string, Record<string, string | Uint8Array>>, headers: Record<string, string> = {}): HttpFetcher & { calls: string[] } {
  const calls: string[] = [];
  const fetcher = async (url: string): Promise<HttpResult> => {
    calls.push(url);
    const parsed = new URL(url);
    const content = sites[parsed.origin]?.[parsed.pathname];
    if (content === undefined) return { status: 404, body: new Uint8Array(), headers: {} };
    return { status: 200, body: typeof content === 'string' ? new TextEncoder().encode(content) : content, headers };
  };
  return Object.assign(fetcher, { calls });
}

async function tempDir(t: { after: (fn: () => Promise<void>) => void }, prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, ...relative.split('/'));
    // eslint-disable-next-line no-await-in-loop -- small fixture
    await fs.mkdir(path.dirname(target), { recursive: true });
    // eslint-disable-next-line no-await-in-loop -- small fixture
    await fs.writeFile(target, content);
  }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } }).trim();
}

const fakeRender: RenderPublic = async (dir, options) => {
  const files = (await scanTree(dir, new Set())).map(file => file.path);
  await fs.writeFile(path.join(dir, 'index.html'), `<p>${options.builtAt}</p>\n${files.join('\n')}\n`);
  await fs.writeFile(path.join(dir, '_headers'), '/List/*\n  content-type: text/plain; charset=utf-8\n');
  await fs.writeFile(path.join(dir, 'Internal', 'artifact-lifecycle.json'), `${JSON.stringify({ version: 1, automaticRedirects: false, records: [], removed: options.removed })}\n`);
};

const RULE_FILES: Record<string, string> = {
  'List/ai.list': 'DOMAIN-SUFFIX,openai.com\n',
  'List/telegram.list': 'IP-CIDR,91.108.4.0/22,no-resolve\n',
  'Clash/ai.txt': 'DOMAIN-SUFFIX,openai.com\n',
  'Loon/ai.list': 'DOMAIN-SUFFIX,openai.com\n',
  'sing-box/ai.json': '{"version":2,"rules":[]}\n',
};

/** Candidate rule outputs plus the reports the rule build delivers, with a consistent audit. */
function candidateFixture(options: { receiptId?: number | null, rules?: Record<string, string>, absent?: string[] } = {}): Record<string, string> {
  const rules = options.rules ?? RULE_FILES;
  const outputs = [
    ...Object.entries(rules).map(([relative, content]) => ({ path: relative, status: 'published', bytes: Buffer.byteLength(content), sha256: sha256Hex(content) })),
    ...(options.absent ?? []).map(relative => ({ path: relative, status: 'absent-empty', bytes: null, sha256: null })),
  ];
  return {
    ...rules,
    'GeoIP/Country.mmdb': 'mmdb',
    'Internal/rule-output-audit.json': `${JSON.stringify({ schemaVersion: 1, converterVersion: 'mirrrule-rule-output/1', rulesets: [{ id: 'fixture', sourceId: 'fixture', snapshotPath: 'Internal/source-snapshots/fixture.json', rawInputSha256: '2'.repeat(64), semanticSha256: sha256Hex('DOMAIN,example.com'), sources: [], outputs }] })}\n`,
    'Internal/source-snapshots/fixture.json': `${JSON.stringify({ schemaVersion: 1, converterVersion: 'mirrrule-rule-output/1', sourceId: 'fixture', rulesetId: 'fixture', contextSha256: '1'.repeat(64), sources: [], rawInputSha256: '2'.repeat(64), semanticSha256: sha256Hex('DOMAIN,example.com'), conditionCount: 1, conditions: ['DOMAIN,example.com'] })}\n`,
    'Internal/source-delta.json': `${JSON.stringify({ schemaVersion: 1, baseline: { configured: options.receiptId != null, receiptId: options.receiptId == null ? null : String(options.receiptId) }, sources: [] })}\n`,
    'Internal/rule-coverage.json': '{}\n',
    'status.json': '{"buildTime":"2026-10-10T00:00:00.000Z","commit":null,"rulesets":[]}\n',
  };
}

const CORE_FIXTURE = candidateFixture();

async function baselineFrom(root: string, receiptId: number, deployCommit = DEPLOY): Promise<ResolvedBaseline> {
  const files = await scanTree(root, new Set());
  return {
    receiptId,
    kind: 'manifest',
    deployCommit,
    sourceCommit: SOURCE,
    candidateId: computeCandidateId(files),
    generatedAt: '2026-10-09T00:00:00.000Z',
    parentReceiptId: null,
    files: files.map(file => ({ path: file.path, sha256: file.sha256 })),
  };
}

function stageError(code: string, pattern?: RegExp) {
  return (error: unknown) => error instanceof StageError && error.code === code && (!pattern || pattern.test(error.message));
}

describe('publication manifest', () => {
  it('lists sorted digests, excludes itself and rejects tampering', () => {
    const files = [
      { path: 'List/b.list', sha256: '1'.repeat(64), bytes: 1 },
      { path: PUBLICATION_MANIFEST_PATH, sha256: '2'.repeat(64), bytes: 2 },
      { path: 'Clash/a.txt', sha256: '3'.repeat(64), bytes: 3 },
    ];
    const manifest = buildManifest({
      kind: 'build',
      sourceCommit: SOURCE,
      baselineReceiptId: 7,
      baselineDeployCommit: DEPLOY,
      lifecycleVersion: 1,
      generatedAt: '2026-10-10T00:00:00.000Z',
      freshDirs: ['List', 'Clash'],
      preservedDirs: [],
      retiredRemoved: [],
      files,
      preservedFrom: relative => (relative.startsWith('Clash/') ? DEPLOY : undefined),
    });
    assert.deepEqual(manifest.files.map(file => file.path), ['Clash/a.txt', 'List/b.list']);
    assert.equal(manifest.files[0].origin, 'preserved');
    assert.equal(manifest.files[0].preservedFromCommit, DEPLOY);
    assert.equal(manifest.files[1].origin, 'generated');
    const text = serializeManifest(manifest);
    assert.deepEqual(parseManifest(text), manifest);
    const tampered = JSON.parse(text) as { files: Array<{ sha256: string }> };
    tampered.files[1].sha256 = '9'.repeat(64);
    assert.throws(() => parseManifest(JSON.stringify(tampered)), /candidateId does not match/);
    assert.deepEqual(diffManifests(manifest.files, [{ path: 'Clash/a.txt', sha256: '4'.repeat(64) }, { path: 'Loon/c.list', sha256: '5'.repeat(64) }]), {
      added: ['Loon/c.list'],
      removed: ['List/b.list'],
      changed: ['Clash/a.txt'],
    });
  });
});

describe('acceptance receipts', () => {
  it('selects the newest receipt whose latest status is success and whose payload validates', async () => {
    const github = new FakeGitHub();
    const accepted = github.addReceipt(manifestPayload(), ['in_progress', 'success']);
    github.addReceipt(manifestPayload({ deployCommit: OTHER }), ['success', 'failure']);
    github.addReceipt({ kind: 'manifest', deployCommit: OTHER }, ['success']);
    github.addReceipt(manifestPayload({ immutableUrl: 'https://evil.pages.dev' }), ['success']);
    github.addReceipt(manifestPayload({ deployCommit: OTHER }), ['pending']);
    github.addReceipt(manifestPayload({ deployCommit: OTHER }), ['success'], 'preview');
    const selected = await selectBaselineReceipt(github, { repository: REPO });
    assert.equal(selected?.id, accepted);
    assert.equal(selected.payload.deployCommit, DEPLOY);
    assert.equal(await selectBaselineReceipt(new FakeGitHub(), { repository: REPO }), null);
  });

  it('validates bootstrap payloads and rejects non-allowlisted immutable URLs', () => {
    assert.ok(validateReceiptPayload(JSON.stringify(manifestPayload())));
    assert.equal(validateReceiptPayload(manifestPayload({ immutableUrl: 'https://main.nrrule.pages.dev' })), null);
    const bootstrap = {
      ...manifestPayload(),
      kind: 'legacy-bootstrap',
      candidateId: `legacy:${DEPLOY}`,
      bootstrapArtifactId: 5,
      bootstrapArtifactDigest: `sha256:${'f'.repeat(64)}`,
      bootstrapRunId: 9,
    };
    assert.equal(validateReceiptPayload(bootstrap)?.kind, 'legacy-bootstrap');
    assert.equal(validateReceiptPayload({ ...bootstrap, bootstrapArtifactDigest: 'abc' }), null);
  });

  it('reports a partial write distinctly and completes it on retry without duplicating', async () => {
    const github = new FakeGitHub();
    github.failWrite = apiPath => apiPath.endsWith('/statuses');
    const payload = manifestPayload();
    await assert.rejects(
      recordReceipt(github, { repository: REPO, ref: SOURCE, payload }),
      (error: unknown) => error instanceof ReceiptNotPersistedError && error.message.includes('website accepted, acceptance receipt not persisted')
    );
    assert.equal(github.deployments.length, 1);
    github.failWrite = null;
    const retry = await recordReceipt(github, { repository: REPO, ref: SOURCE, payload });
    assert.deepEqual(retry, { deploymentId: github.deployments[0].id, createdDeployment: false, createdStatus: true });
    const again = await recordReceipt(github, { repository: REPO, ref: SOURCE, payload });
    assert.deepEqual(again, { deploymentId: github.deployments[0].id, createdDeployment: false, createdStatus: false });
    assert.equal(github.deployments.length, 1);
    assert.equal((await selectBaselineReceipt(github, { repository: REPO }))?.id, github.deployments[0].id);
  });
});

describe('Cloudflare check identity', () => {
  it('parses the immutable URL from the real summary shape and allowlists only deployment hashes', () => {
    assert.equal(parseImmutableUrl(SUMMARY), IMMUTABLE);
    assert.equal(parseImmutableUrl('<a href=\'https://main.nrrule.pages.dev\'>x</a> https://c2ff8766.other.pages.dev'), null);
  });

  it('rejects a successful check for another commit or another app', () => {
    assert.equal(evaluateCheckRuns([successRun(OTHER)], DEPLOY).state, 'pending');
    assert.equal(evaluateCheckRuns([successRun(DEPLOY, { app: { slug: 'cloudflare-workers-and-pages', id: 1 } })], DEPLOY).state, 'pending');
    assert.equal(evaluateCheckRuns([successRun(DEPLOY, { app: { slug: 'netlify', id: 85455 } })], DEPLOY).state, 'pending');
    const rejected = evaluateCheckRuns([successRun(OTHER), successRun(DEPLOY, { app: { slug: 'x', id: 2 } })], DEPLOY);
    assert.equal(rejected.rejected.length, 2);
    assert.equal(evaluateCheckRuns([successRun(DEPLOY, { status: 'in_progress', conclusion: null })], DEPLOY).state, 'pending');
    assert.equal(evaluateCheckRuns([successRun(DEPLOY, { conclusion: 'failure' })], DEPLOY).state, 'failed');
    const noUrl = evaluateCheckRuns([successRun(DEPLOY, { output: { summary: 'https://evil.example.com' } })], DEPLOY);
    assert.equal(noUrl.state, 'failed');
    const newest = evaluateCheckRuns([successRun(DEPLOY, { id: 1, conclusion: 'failure' }), successRun(DEPLOY, { id: 2 })], DEPLOY);
    assert.equal(newest.state, 'success');
  });
});

describe('publication verification', () => {
  const files = [
    { path: 'List/ai.list', sha256: sha256Hex('new') },
    { path: 'index.html', sha256: sha256Hex('<html>') },
    { path: '_headers', sha256: sha256Hex('ignored') },
  ];
  const absentPaths = ['List/domainset/old.list', 'Modules/Converted/腾讯视频去广告.sgmodule'];
  const site = { '/List/ai.list': 'new', '/': '<html>' };

  function scenario(checkRuns: FakeGitHub['checkRuns'], sites: Record<string, Record<string, string>>) {
    const github = new FakeGitHub();
    github.checkRuns = checkRuns;
    const clock = fakeClock();
    const fetcher = siteFetcher(sites);
    return {
      fetcher,
      clock,
      run: () => verifyPublication({ client: github, deployCommit: DEPLOY, files, absentPaths, fetcher, clock, timeoutMs: 60000, checkIntervalMs: 5000, retryIntervalMs: 5000 }),
    };
  }

  it('accepts after a pending check when both origins serve the manifest bytes and retired paths are 404', async () => {
    const { run, fetcher } = scenario(
      (sha, call) => (call < 2 ? [successRun(sha, { status: 'queued', conclusion: null })] : [successRun(sha)]),
      { [IMMUTABLE]: site, 'https://nrrule.pages.dev': site }
    );
    const report = await run();
    assert.equal(report.outcome, 'accepted');
    assert.equal(report.immutableUrl, IMMUTABLE);
    assert.ok(fetcher.calls.includes(`${IMMUTABLE}/List/ai.list`));
    assert.ok(fetcher.calls.includes(`https://nrrule.pages.dev${publicPathFor(absentPaths[1])}`));
    assert.ok(!fetcher.calls.some(url => url.endsWith('/_headers')), 'Pages config files are not fetched as assets');
  });

  it('distinguishes failed, timed-out and wrong-commit checks', async () => {
    const failed = await scenario(sha => [successRun(sha, { conclusion: 'failure' })], {}).run();
    assert.equal(failed.outcome, 'check-failed');
    assert.match(failed.message, /Git published, website not accepted/);
    const wrongCommit = await scenario(() => [successRun(OTHER)], {}).run();
    assert.equal(wrongCommit.outcome, 'check-timeout');
    assert.ok(wrongCommit.check.rejected.some(item => item.includes(OTHER)));
    const missing = await scenario(() => [], {}).run();
    assert.equal(missing.outcome, 'check-timeout');
    assert.equal(missing.deployCommit, DEPLOY);
  });

  it('reports immutable mismatch and production lag with the failing URLs', async () => {
    const mismatch = await scenario(sha => [successRun(sha)], { [IMMUTABLE]: { ...site, '/List/ai.list': 'old' }, 'https://nrrule.pages.dev': site }).run();
    assert.equal(mismatch.outcome, 'immutable-mismatch');
    assert.deepEqual(mismatch.failures.map(item => item.url), [`${IMMUTABLE}/List/ai.list`]);
    const lagging = await scenario(sha => [successRun(sha)], { [IMMUTABLE]: site, 'https://nrrule.pages.dev': { ...site, '/List/ai.list': 'old' } }).run();
    assert.equal(lagging.outcome, 'production-lagging');
    assert.match(lagging.message, /Git published, website not accepted/);
    assert.deepEqual(lagging.failures.map(item => item.url), ['https://nrrule.pages.dev/List/ai.list']);
    const retired = await scenario(sha => [successRun(sha)], {
      [IMMUTABLE]: site,
      'https://nrrule.pages.dev': { ...site, [publicPathFor(absentPaths[1])]: 'legacy' },
    }).run();
    assert.equal(retired.outcome, 'production-lagging');
    assert.equal(retired.failures[0].reason, 'retired-present');
  });

  it('does not accept while an absent variant still answers 200, even if every published file matches', async () => {
    const stale = { ...site, '/List/domainset/old.list': '.example.com\n' };
    const immutable = await scenario(sha => [successRun(sha)], { [IMMUTABLE]: stale, 'https://nrrule.pages.dev': site }).run();
    assert.equal(immutable.outcome, 'immutable-mismatch');
    assert.deepEqual(immutable.failures.map(item => item.url), [`${IMMUTABLE}/List/domainset/old.list`]);
    const production = await scenario(sha => [successRun(sha)], { [IMMUTABLE]: site, 'https://nrrule.pages.dev': stale }).run();
    assert.equal(production.outcome, 'production-lagging');
    assert.equal(production.failures[0].path, 'List/domainset/old.list');
  });

  it('starts no request after the deadline, aborts in-flight requests and never accepts late', async () => {
    const github = new FakeGitHub();
    github.checkRuns = sha => [successRun(sha)];
    const clock = fakeClock();
    const many = ['a', 'b', 'c', 'd'].map(name => ({ path: `List/${name}.list`, sha256: sha256Hex(name) }));
    const calls: string[] = [];
    const slow: HttpFetcher = async (url, signal) => {
      calls.push(url);
      clock.advance(25000);
      if (signal.aborted) throw new Error('aborted');
      return { status: 200, body: new TextEncoder().encode(url.slice(-6, -5)), headers: {} };
    };
    const report = await verifyPublication({ client: github, deployCommit: DEPLOY, files: many, absentPaths: [], fetcher: slow, clock, timeoutMs: 60000, concurrency: 1 });
    assert.equal(report.outcome, 'immutable-mismatch');
    assert.equal(calls.length, 3, 'the fourth request must not start after the deadline');
    assert.deepEqual(report.failures.map(item => [item.path, item.reason]), [['List/c.list', 'deadline'], ['List/d.list', 'deadline']]);

    const hangingClock = fakeClock();
    const hanging: HttpFetcher = (_url, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
      setTimeout(() => hangingClock.advance(120000), 5);
    });
    const hung = await verifyPublication({ client: github, deployCommit: DEPLOY, files: many.slice(0, 1), absentPaths: [], fetcher: hanging, clock: hangingClock, timeoutMs: 60000 });
    assert.equal(hung.outcome, 'immutable-mismatch');
    assert.equal(hung.failures[0].reason, 'deadline');
  });

  it('keeps retrying production until it catches up before the deadline', async () => {
    const production: Record<string, string> = { ...site, '/List/ai.list': 'old' };
    const { run, clock } = scenario(sha => [successRun(sha)], { [IMMUTABLE]: site, 'https://nrrule.pages.dev': production });
    const originalSleep = clock.sleep;
    let rounds = 0;
    clock.sleep = async ms => {
      rounds++;
      if (rounds === 2) production['/List/ai.list'] = 'new';
      await originalSleep(ms);
    };
    const report = await run();
    assert.equal(report.outcome, 'accepted');
    assert.ok(rounds >= 2);
  });
});

describe('NRRule push', () => {
  async function setup(t: { after: (fn: () => Promise<void>) => void }) {
    const root = await tempDir(t, 'mirrrule-push-');
    const remote = path.join(root, 'remote.git');
    git(root, 'init', '--quiet', '--bare', '--initial-branch=main', remote);
    const seed = path.join(root, 'seed');
    git(root, 'init', '--quiet', '--initial-branch=main', seed);
    git(seed, 'remote', 'add', 'origin', remote);
    await writeTree(seed, { 'List/ai.list': 'old\n' });
    git(seed, 'add', '.');
    git(seed, 'commit', '--quiet', '-m', 'seed');
    git(seed, 'push', '--quiet', 'origin', 'HEAD:main');
    const clone = path.join(root, 'clone');
    git(root, 'clone', '--quiet', remote, clone);
    git(clone, 'config', 'user.email', 't@example.com');
    git(clone, 'config', 'user.name', 't');
    const staging = path.join(root, 'staging');
    await writeTree(staging, { 'List/ai.list': 'new\n', 'index.html': 'x\n' });
    return { root, remote, seed, clone, staging, head: git(clone, 'rev-parse', 'HEAD') };
  }

  function countingRunner(behavior: (args: readonly string[], cwd: string) => Promise<GitResult | null>) {
    const pushes: string[] = [];
    const runner: GitRunner = async (args, cwd) => {
      if (args[0] === 'push') pushes.push(args.join(' '));
      return await behavior(args, cwd) ?? runGit(args, cwd);
    };
    return { runner, pushes };
  }

  it('pushes once, then a retry of the same tree is a no-op that still returns the current HEAD', async (t) => {
    const env = await setup(t);
    const first = await publishStagingTree({ repoDir: env.clone, stagingDir: env.staging, branch: 'main', expectedHead: env.head, message: 'deploy: test' });
    assert.equal(first.outcome, 'pushed');
    assert.equal(git(env.root, '--git-dir', env.remote, 'rev-parse', 'main'), first.deployCommit);
    assert.equal(git(env.root, '--git-dir', env.remote, 'log', '-1', '--format=%s', 'main'), 'deploy: test');
    const second = await publishStagingTree({ repoDir: env.clone, stagingDir: env.staging, branch: 'main', expectedHead: first.deployCommit, message: 'deploy: test' });
    assert.deepEqual(second, { deployCommit: first.deployCommit, outcome: 'no-op', previousHead: first.deployCommit });
  });

  it('resolves an uncertain push by reading the remote instead of pushing again', async (t) => {
    const env = await setup(t);
    const { runner, pushes } = countingRunner(async (args, cwd) => {
      if (args[0] !== 'push') return null;
      await runGit(args, cwd);
      return { code: 128, stdout: '', stderr: 'fatal: the remote end hung up unexpectedly' };
    });
    const result = await publishStagingTree({ repoDir: env.clone, stagingDir: env.staging, branch: 'main', expectedHead: env.head, message: 'm', runner });
    assert.equal(result.outcome, 'landed-after-error');
    assert.equal(pushes.length, 1);
    assert.equal(git(env.root, '--git-dir', env.remote, 'rev-parse', 'main'), result.deployCommit);

    const lost = await setup(t);
    const failing = countingRunner(async args => (args[0] === 'push' ? { code: 1, stdout: '', stderr: 'network down' } : null));
    await assert.rejects(
      publishStagingTree({ repoDir: lost.clone, stagingDir: lost.staging, branch: 'main', expectedHead: lost.head, message: 'm', runner: failing.runner }),
      /did not land/
    );
    assert.equal(failing.pushes.length, 1);

    const unreadable = await setup(t);
    const blind = countingRunner(async (args, cwd) => {
      if (args[0] === 'push') {
        await runGit(args, cwd);
        return { code: 1, stdout: '', stderr: 'timeout' };
      }
      if (args[0] === 'ls-remote' && blind.pushes.length) return { code: 128, stdout: '', stderr: 'unreachable' };
      return null;
    });
    await assert.rejects(
      publishStagingTree({ repoDir: unreadable.clone, stagingDir: unreadable.staging, branch: 'main', expectedHead: unreadable.head, message: 'm', runner: blind.runner }),
      PushUncertainError
    );
    assert.equal(blind.pushes.length, 1);
  });

  it('refuses to push when the NRRule remote HEAD drifted', async (t) => {
    const env = await setup(t);
    await writeTree(env.seed, { 'List/ai.list': 'concurrent\n' });
    git(env.seed, 'commit', '--quiet', '-am', 'concurrent');
    git(env.seed, 'push', '--quiet', 'origin', 'HEAD:main');
    const { runner, pushes } = countingRunner(async () => null);
    await assert.rejects(
      publishStagingTree({ repoDir: env.clone, stagingDir: env.staging, branch: 'main', expectedHead: env.head, message: 'm', runner }),
      RemoteDriftError
    );
    assert.equal(pushes.length, 0);
  });
});

describe('publication staging', () => {
  async function setup(t: { after: (fn: () => Promise<void>) => void }, candidateFiles: Record<string, string>, baselineFiles: Record<string, string> = {}) {
    const root = await tempDir(t, 'mirrrule-stage-');
    const candidate = path.join(root, 'candidate');
    const tree = path.join(root, 'baseline');
    await writeTree(candidate, candidateFiles);
    await writeTree(tree, baselineFiles);
    const out = path.join(root, 'out');
    return { root, candidate, tree, out };
  }

  it('fails when a required fresh directory is missing or empty instead of keeping production', async (t) => {
    const { 'GeoIP/Country.mmdb': _geoip, ...withoutGeoIp } = CORE_FIXTURE;
    const env = await setup(t, withoutGeoIp);
    await fs.mkdir(path.join(env.candidate, 'GeoIP'));
    const run = (tasks: string[]) => stagePublication({ candidateDir: env.candidate, outDir: env.out, tasks, sourceCommit: SOURCE, baseline: null, baselineTreeDir: null, render: fakeRender });
    await assert.rejects(run(['build', 'deploy']), stageError('missing-core-dir', /GeoIP/));
    await writeTree(env.candidate, { 'GeoIP/Country.mmdb': 'mmdb' });
    await assert.rejects(run(['mirror-sync', 'build', 'deploy']), stageError('missing-core-dir', /Mirror/));
    assert.deepEqual(freshDirsForTasks(['convert-plugins', 'merge-modules', 'mirror-sync']).slice(-3), ['Mirror', 'Modules', 'Scripts']);
  });

  it('requires every rule build report with a valid schema', async (t) => {
    for (const report of ['Internal/rule-output-audit.json', 'Internal/source-delta.json', 'Internal/rule-coverage.json', 'status.json']) {
      // eslint-disable-next-line no-await-in-loop -- one fixture per report
      const env = await setup(t, CORE_FIXTURE, { 'Mirror/a.sgmodule': 'a' });
      // eslint-disable-next-line no-await-in-loop -- one fixture per report
      await fs.rm(path.join(env.candidate, ...report.split('/')));
      // eslint-disable-next-line no-await-in-loop -- one fixture per report
      await assert.rejects(
        stagePublication({ candidateDir: env.candidate, outDir: env.out, tasks: ['build', 'deploy'], sourceCommit: SOURCE, baseline: null, baselineTreeDir: null, render: fakeRender }),
        stageError('missing-report', new RegExp(report.replaceAll('.', String.raw`\.`))),
        report
      );
    }
    const invalid = await setup(t, { ...CORE_FIXTURE, 'Internal/rule-output-audit.json': '{"schemaVersion":2,"rulesets":[]}' });
    await assert.rejects(
      stagePublication({ candidateDir: invalid.candidate, outDir: invalid.out, tasks: ['build', 'deploy'], sourceCommit: SOURCE, baseline: null, baselineTreeDir: null, render: fakeRender }),
      stageError('invalid-report')
    );
    const noLifecycle = await setup(t, CORE_FIXTURE, { 'Mirror/a.sgmodule': 'a' });
    const baseline = await baselineFrom(noLifecycle.tree, 7);
    await writeTree(noLifecycle.candidate, candidateFixture({ receiptId: 7 }));
    const renderWithoutLifecycle: RenderPublic = async dir => {
      await fs.writeFile(path.join(dir, 'index.html'), 'x');
    };
    await assert.rejects(
      stagePublication({ candidateDir: noLifecycle.candidate, outDir: noLifecycle.out, tasks: ['build', 'deploy'], sourceCommit: SOURCE, baseline, baselineTreeDir: noLifecycle.tree, render: renderWithoutLifecycle }),
      stageError('missing-report', /artifact-lifecycle/)
    );
  });

  it('checks every audited output, flat and variant, by presence, bytes and sha256', async (t) => {
    const absent = ['List/domainset/telegram.list'];
    const run = async (mutate: (candidate: string) => Promise<void>) => {
      const env = await setup(t, candidateFixture({ receiptId: 7, absent }), { 'Mirror/a.sgmodule': 'a' });
      await mutate(env.candidate);
      return stagePublication({ candidateDir: env.candidate, outDir: env.out, tasks: ['build', 'deploy'], sourceCommit: SOURCE, baseline: await baselineFrom(env.tree, 7), baselineTreeDir: env.tree, render: fakeRender });
    };
    const ok = await run(() => Promise.resolve());
    assert.ok(ok.manifest.files.some(file => file.path === 'List/telegram.list'));
    await assert.rejects(run(candidate => fs.rm(path.join(candidate, 'List', 'telegram.list'))), stageError('output-mismatch', /List\/telegram\.list: published in the audit but missing/));
    await assert.rejects(run(candidate => fs.writeFile(path.join(candidate, 'List', 'ai.list'), 'DOMAIN-SUFFIX,openai')), stageError('output-mismatch', /List\/ai\.list: \d+ bytes/));
    await assert.rejects(run(candidate => fs.writeFile(path.join(candidate, 'List', 'ai.list'), 'DOMAIN-SUFFIX,openai.org\n')), stageError('output-mismatch', /List\/ai\.list/));
    await assert.rejects(
      run(candidate => writeTree(candidate, { 'List/domainset/telegram.list': '.telegram.org\n' })),
      stageError('output-mismatch', /List\/domainset\/telegram\.list: audit says absent-empty but the file is present/)
    );
    await assert.rejects(
      run(candidate => writeTree(candidate, { 'Loon/ip/stale.list': 'IP-CIDR,1.1.1.1/32\n' })),
      stageError('output-mismatch', /Loon\/ip\/stale\.list: variant file is not listed/)
    );
  });

  it('requires an accepted baseline for preserved directories and fails on copy or digest problems', async (t) => {
    const env = await setup(t, candidateFixture({ receiptId: 7 }), { 'Mirror/a.sgmodule': 'a', 'Modules/Merged/b.sgmodule': 'b', 'Scripts/c.js': 'c' });
    await writeTree(env.candidate, candidateFixture({ receiptId: null }));
    await assert.rejects(
      stagePublication({ candidateDir: env.candidate, outDir: env.out, tasks: ['build', 'deploy'], sourceCommit: SOURCE, baseline: null, baselineTreeDir: null, render: fakeRender }),
      stageError('baseline-unavailable')
    );
    await writeTree(env.candidate, candidateFixture({ receiptId: 7 }));
    const baseline = await baselineFrom(env.tree, 7);
    await fs.rm(path.join(env.tree, 'Scripts', 'c.js'));
    await assert.rejects(
      stagePublication({ candidateDir: env.candidate, outDir: env.out, tasks: ['build', 'deploy'], sourceCommit: SOURCE, baseline, baselineTreeDir: env.tree, render: fakeRender }),
      stageError('copy-failed', /Scripts\/c\.js/)
    );
    await writeTree(env.tree, { 'Scripts/c.js': 'changed' });
    await assert.rejects(
      stagePublication({ candidateDir: env.candidate, outDir: env.out, tasks: ['build', 'deploy'], sourceCommit: SOURCE, baseline, baselineTreeDir: env.tree, render: fakeRender }),
      stageError('copy-failed', /digest/)
    );
  });

  it('records baseline paths that are no longer published so they must answer 404', async (t) => {
    const env = await setup(t, candidateFixture({ receiptId: 7 }), { 'Mirror/a.sgmodule': 'a', 'List/ip/old.list': 'old' });
    const baseline = await baselineFrom(env.tree, 7);
    const result = await stagePublication({ candidateDir: env.candidate, outDir: env.out, tasks: ['build', 'deploy'], sourceCommit: SOURCE, baseline, baselineTreeDir: env.tree, render: fakeRender });
    assert.deepEqual(result.manifest.removedPaths, ['List/ip/old.list']);
    const absent = await collectAbsentPaths(env.out, result.manifest);
    assert.ok(absent.includes('List/ip/old.list'));
    assert.ok(absent.includes('Modules/Converted/腾讯视频去广告.sgmodule'));
    assert.ok(!absent.includes('List/ai.list'));
  });

  it('rebases receipt drift and recognizes this same candidate already accepted', async (t) => {
    const env = await setup(t, candidateFixture({ receiptId: 5 }), { 'Mirror/a.sgmodule': 'a' });
    const drifted = await baselineFrom(env.tree, 7);
    const run = (baseline: ResolvedBaseline) => stagePublication({ candidateDir: env.candidate, outDir: env.out, tasks: ['build', 'deploy'], sourceCommit: SOURCE, baseline, baselineTreeDir: env.tree, render: fakeRender });
    const rebased = await run(drifted);
    assert.equal(rebased.manifest.baselineReceiptId, 7);
    const rebasedDelta = JSON.parse(await fs.readFile(path.join(env.out, 'Internal/source-delta.json'), 'utf8')) as { baseline: { receiptId: number } };
    assert.equal(rebasedDelta.baseline.receiptId, 7);
    assert.match(await fs.readFile(path.join(env.candidate, 'Internal/source-delta.json'), 'utf8'), /"receiptId":"5"/);
    const same = await baselineFrom(env.tree, 5);
    const result = await run(same);
    assert.equal(result.manifest.baselineReceiptId, 5);

    // The staged tree is what receipt 7 accepted; a retry inside the lock must be a no-op.
    const ownAccepted: ResolvedBaseline = {
      ...(await baselineFrom(env.out, 7)),
      parentReceiptId: 5,
      generatedAt: '2026-10-10T00:00:00.000Z',
    };
    const drift = await classifyBaselineDrift({ candidateDir: env.candidate, baseline: ownAccepted, sourceCommit: SOURCE, builtAt: '2026-10-10T00:00:00.000Z' });
    assert.deepEqual(drift, { state: 'already-accepted', receiptId: 7, deployCommit: DEPLOY });
    await assert.rejects(run(ownAccepted), stageError('already-accepted'));
    const otherBuild = await classifyBaselineDrift({ candidateDir: env.candidate, baseline: { ...ownAccepted, generatedAt: '2026-10-10T01:00:00.000Z' }, sourceCommit: SOURCE, builtAt: '2026-10-10T00:00:00.000Z' });
    assert.equal(otherBuild.state, 'drift');
    await writeTree(env.candidate, { 'List/ai.list': 'DOMAIN-SUFFIX,changed.example\n' });
    assert.equal((await classifyBaselineDrift({ candidateDir: env.candidate, baseline: ownAccepted, sourceCommit: SOURCE, builtAt: '2026-10-10T00:00:00.000Z' })).state, 'drift');
  });

  it('marks restored optional artifacts as preserved only when their provenance verifies', async (t) => {
    const baselineFiles = { 'Mirror/a.sgmodule': 'a', 'Modules/Converted/optional.sgmodule': '#!name=optional\n', 'Scripts/shared.js': 'shared' };
    const provenance = (fromCommit: string, content = '#!name=optional\n') => `${JSON.stringify({
      schemaVersion: 1,
      fromCommit,
      files: [{ path: 'Modules/Converted/optional.sgmodule', sha256: sha256Hex(content), bytes: Buffer.byteLength(content) }],
    })}\n`;
    const make = async (fromCommit: string, moduleContent = '#!name=optional\n') => {
      const env = await setup(t, {
        ...candidateFixture({ receiptId: 7 }),
        'Modules/Converted/fresh.sgmodule': '#!name=fresh\n',
        'Modules/Converted/optional.sgmodule': moduleContent,
        'Scripts/fresh.js': 'fresh',
        'Internal/preserved-artifacts.json': provenance(fromCommit),
      }, baselineFiles);
      return stagePublication({ candidateDir: env.candidate, outDir: env.out, tasks: ['convert-plugins', 'merge-modules', 'build', 'deploy'], sourceCommit: SOURCE, baseline: await baselineFrom(env.tree, 7), baselineTreeDir: env.tree, render: fakeRender });
    };
    const result = await make(DEPLOY);
    const optional = result.manifest.files.find(file => file.path === 'Modules/Converted/optional.sgmodule');
    assert.equal(optional?.origin, 'preserved');
    assert.equal(optional.preservedFromCommit, DEPLOY);
    assert.equal(result.manifest.files.find(file => file.path === 'Modules/Converted/fresh.sgmodule')?.origin, 'generated');
    await assert.rejects(make(OTHER), stageError('provenance-mismatch', /come from c{40}/));
    await assert.rejects(make(DEPLOY, '#!name=tampered\n'), stageError('provenance-mismatch', /changed after restoration/));
  });

  it('purges retired modules copied into a directory through the purge subcommand', async (t) => {
    const root = await tempDir(t, 'mirrrule-purge-');
    await writeTree(root, { 'Modules/Converted/腾讯视频去广告.sgmodule': 'retired', 'Modules/Converted/active.sgmodule': 'active' });
    const output = execFileSync(process.execPath, ['-r', '@swc-node/register', path.resolve(__dirname, '..', 'prepare-publication.ts'), 'purge', '--root', root], {
      cwd: path.resolve(__dirname, '..', '..'),
      env: { ...process.env, SWC_NODE_IGNORE_DYNAMIC: 'true' },
      encoding: 'utf8',
    });
    assert.match(output, /Removed retired artifacts: Modules\/Converted\/腾讯视频去广告\.sgmodule/);
    await assert.rejects(fs.access(path.join(root, 'Modules', 'Converted', '腾讯视频去广告.sgmodule')));
    await fs.access(path.join(root, 'Modules', 'Converted', 'active.sgmodule'));
  });

  it('rolls back an accepted tree under the current retirement registry', async (t) => {
    const env = await setup(t, {
      ...candidateFixture({ receiptId: 3 }),
      'Modules/Converted/腾讯视频去广告.sgmodule': '#!name=retired\n',
      'Modules/Converted/active.sgmodule': '#!name=active\n',
      'List/discord.list': 'DOMAIN,discord.com\n',
    });
    const result = await stagePublication({
      candidateDir: env.candidate,
      outDir: env.out,
      tasks: ['rollback'],
      sourceCommit: SOURCE,
      baseline: null,
      baselineTreeDir: null,
      render: fakeRender,
      rollbackOf: { receiptId: 42, deployCommit: OTHER, sourceCommit: SOURCE },
    });
    const paths = result.manifest.files.map(file => file.path);
    assert.equal(result.manifest.kind, 'rollback');
    assert.deepEqual(result.manifest.rollbackOf, { receiptId: 42, deployCommit: OTHER, sourceCommit: SOURCE });
    assert.ok(result.manifest.retiredRemoved.includes('Modules/Converted/腾讯视频去广告.sgmodule'));
    assert.ok(result.manifest.retiredRemoved.includes('List/discord.list'));
    assert.ok(result.manifest.removedPaths.includes('List/discord.list'));
    assert.ok(!paths.includes('Modules/Converted/腾讯视频去广告.sgmodule'));
    const active = result.manifest.files.find(file => file.path === 'Modules/Converted/active.sgmodule');
    assert.equal(active?.origin, 'preserved');
    assert.equal(active.preservedFromCommit, OTHER);
    assert.equal(result.manifest.files.find(file => file.path === 'index.html')?.origin, 'generated');
  });

  it('treats a candidate as superseded only when the accepted baseline carries newer source or build time', async () => {
    const github = new FakeGitHub();
    const baseline: ResolvedBaseline = { receiptId: 1, kind: 'manifest', deployCommit: DEPLOY, sourceCommit: SOURCE, candidateId: 'sha256:x', generatedAt: '2026-10-10T02:00:00.000Z', parentReceiptId: null, files: [] };
    assert.equal((await checkSuperseded({ client: github, repository: REPO, sourceCommit: SOURCE, builtAt: '2026-10-10T01:00:00.000Z', baseline })).superseded, true);
    assert.equal((await checkSuperseded({ client: github, repository: REPO, sourceCommit: SOURCE, builtAt: '2026-10-10T03:00:00.000Z', baseline })).superseded, false);
    github.compareStatus = 'behind';
    assert.equal((await checkSuperseded({ client: github, repository: REPO, sourceCommit: OTHER, builtAt: '2026-10-10T03:00:00.000Z', baseline })).superseded, true);
    github.compareStatus = 'ahead';
    assert.equal((await checkSuperseded({ client: github, repository: REPO, sourceCommit: OTHER, builtAt: '2026-10-10T03:00:00.000Z', baseline })).superseded, false);
    assert.equal((await checkSuperseded({ client: github, repository: REPO, sourceCommit: OTHER, builtAt: '2026-10-10T03:00:00.000Z', baseline: { ...baseline, kind: 'legacy-bootstrap' } })).superseded, false);
  });
});

describe('legacy bootstrap', () => {
  async function legacyRepo(t: { after: (fn: () => Promise<void>) => void }) {
    const root = await tempDir(t, 'mirrrule-bootstrap-');
    const tree = path.join(root, 'tree');
    await writeTree(tree, {
      'Mirror/iRingo/Weather.sgmodule': 'weather',
      'Modules/Converted/active.sgmodule': 'active',
      'Modules/Converted/腾讯视频去广告.sgmodule': 'retired',
      'Scripts/a.js': 'script',
      'List/ai.list': 'not preserved',
      'status.json': '{"buildTime":"2026-10-01T00:00:00.000Z"}',
      'index.html': '<html>',
      _headers: '/*\n  cache-control: public, max-age=240\n/Mirror/*\n  content-type: text/plain; charset=utf-8\n',
    });
    git(tree, 'init', '--quiet');
    git(tree, 'add', '.');
    git(tree, 'commit', '--quiet', '-m', 'legacy');
    const revision = git(tree, 'rev-parse', 'HEAD');
    const site: Record<string, string> = {
      '/Mirror/iRingo/Weather.sgmodule': 'weather',
      '/Modules/Converted/active.sgmodule': 'active',
      '/Scripts/a.js': 'script',
      '/status.json': '{"buildTime":"2026-10-01T00:00:00.000Z"}',
      '/': '<html>',
    };
    return { root, tree, revision, site };
  }

  it('verifies a legacy tree without a manifest and excludes retired paths from the inventory', async (t) => {
    const env = await legacyRepo(t);
    const github = new FakeGitHub();
    github.checkRuns = sha => [successRun(sha)];
    const fetcher = siteFetcher({ [IMMUTABLE]: env.site, 'https://nrrule.pages.dev': env.site }, { 'cache-control': 'public, max-age=240', 'content-type': 'text/plain; charset=utf-8' });
    const result = await runBootstrap({ client: github, treeDir: env.tree, revision: env.revision, immutableUrl: `${IMMUTABLE}/`, outDir: path.join(env.root, 'out'), fetcher, clock: fakeClock() });
    const paths = result.inventory.files.map(file => file.path);
    assert.deepEqual(paths, ['Mirror/iRingo/Weather.sgmodule', 'Modules/Converted/active.sgmodule', 'Scripts/a.js', '_headers', 'index.html', 'status.json']);
    assert.deepEqual(result.inventory.excludedRetired, ['Modules/Converted/腾讯视频去广告.sgmodule']);
    assert.deepEqual(result.evidence.origins.map(item => item.headerRules), [2, 2]);
    const written = await fs.readFile(path.join(env.root, 'out', 'legacy-inventory.json'), 'utf8');
    assert.equal(sha256Hex(written), result.inventorySha256);
  });

  it('rejects asset mismatches, missing header behavior and an immutable URL from another revision', async (t) => {
    const env = await legacyRepo(t);
    const github = new FakeGitHub();
    github.checkRuns = sha => [successRun(sha)];
    const headers = { 'cache-control': 'public, max-age=240', 'content-type': 'text/plain; charset=utf-8' };
    const drifted = siteFetcher({ [IMMUTABLE]: env.site, 'https://nrrule.pages.dev': { ...env.site, '/Scripts/a.js': 'newer' } }, headers);
    await assert.rejects(
      runBootstrap({ client: github, treeDir: env.tree, revision: env.revision, immutableUrl: IMMUTABLE, outDir: path.join(env.root, 'out1'), fetcher: drifted, clock: fakeClock(), timeoutMs: 30000 }),
      (error: unknown) => error instanceof BootstrapVerificationError && error.failures.some(item => item.url === 'https://nrrule.pages.dev/Scripts/a.js')
    );
    await assert.rejects(fs.access(path.join(env.root, 'out1', 'legacy-inventory.json')));
    await fs.access(path.join(env.root, 'out1', 'legacy-evidence.json'));

    const noHeaders = siteFetcher({ [IMMUTABLE]: env.site, 'https://nrrule.pages.dev': env.site });
    await assert.rejects(
      runBootstrap({ client: github, treeDir: env.tree, revision: env.revision, immutableUrl: IMMUTABLE, outDir: path.join(env.root, 'out2'), fetcher: noHeaders, clock: fakeClock(), timeoutMs: 30000 }),
      (error: unknown) => error instanceof BootstrapVerificationError && error.failures.some(item => item.reason === 'header')
    );
    await assert.rejects(
      runBootstrap({ client: github, treeDir: env.tree, revision: env.revision, immutableUrl: 'https://deadbeef.nrrule.pages.dev', outDir: path.join(env.root, 'out3'), fetcher: noHeaders, clock: fakeClock() }),
      /names https:\/\/c2ff8766\.nrrule\.pages\.dev/
    );
    await assert.rejects(
      runBootstrap({ client: github, treeDir: env.tree, revision: OTHER, immutableUrl: IMMUTABLE, outDir: path.join(env.root, 'out4'), fetcher: noHeaders, clock: fakeClock() }),
      /expected c{40}/
    );
  });

  it('re-verification is required when the bootstrap artifact is missing, expired or altered', async (t) => {
    const env = await legacyRepo(t);
    const github = new FakeGitHub();
    github.checkRuns = sha => [successRun(sha)];
    const fetcher = siteFetcher({ [IMMUTABLE]: env.site, 'https://nrrule.pages.dev': env.site }, { 'cache-control': 'public, max-age=240', 'content-type': 'text/plain; charset=utf-8' });
    const out = path.join(env.root, 'out');
    const result = await runBootstrap({ client: github, treeDir: env.tree, revision: env.revision, immutableUrl: IMMUTABLE, outDir: out, fetcher, clock: fakeClock() });
    const archive = new TextEncoder().encode('zip-bytes');
    const digest = `sha256:${sha256Hex(archive)}`;
    const payload = {
      schemaVersion: 1,
      kind: 'legacy-bootstrap',
      sourceCommit: SOURCE,
      deployCommit: env.revision,
      candidateId: `legacy:${env.revision}`,
      manifestSha256: result.inventorySha256,
      immutableUrl: IMMUTABLE,
      bootstrapArtifactId: 77,
      bootstrapArtifactDigest: digest,
      bootstrapRunId: 9,
    } as const;
    const receipt = { id: 1, createdAt: '', payload };
    const extract = async (_zip: string, directory: string) => {
      await fs.copyFile(path.join(out, 'legacy-inventory.json'), path.join(directory, 'legacy-inventory.json'));
    };
    await assert.rejects(resolveBaselineEvidence({ client: github, repository: REPO, receipt, treeDir: env.tree, extract }), BootstrapArtifactUnavailableError);
    github.artifacts.set(77, { id: 77, expired: true, digest, archive_download_url: 'https://dl/77' });
    await assert.rejects(resolveBaselineEvidence({ client: github, repository: REPO, receipt, treeDir: env.tree, extract }), /expired/);
    github.artifacts.set(77, { id: 77, expired: false, digest, archive_download_url: 'https://dl/77' });
    github.downloads.set('https://dl/77', new TextEncoder().encode('tampered'));
    await assert.rejects(resolveBaselineEvidence({ client: github, repository: REPO, receipt, treeDir: env.tree, extract }), /downloaded archive digest/);
    github.downloads.set('https://dl/77', archive);
    const resolved = await resolveBaselineEvidence({ client: github, repository: REPO, receipt, treeDir: env.tree, extract });
    assert.equal(resolved.kind, 'legacy-bootstrap');
    assert.equal(resolved.generatedAt, null);
    assert.ok(resolved.files.some(file => file.path === 'Modules/Converted/active.sgmodule'));
    assert.ok(!resolved.files.some(file => file.path.includes('腾讯')));
    await fs.writeFile(path.join(env.tree, 'Scripts', 'a.js'), 'edited after verification');
    await assert.rejects(resolveBaselineEvidence({ client: github, repository: REPO, receipt, treeDir: env.tree, extract }), BaselineTreeMismatchError);
  });

  it('replaces a receipt whose bootstrap artifact expired with a newer re-verified receipt', async (t) => {
    const env = await legacyRepo(t);
    const github = new FakeGitHub();
    github.checkRuns = sha => [successRun(sha)];
    const fetcher = siteFetcher({ [IMMUTABLE]: env.site, 'https://nrrule.pages.dev': env.site }, { 'cache-control': 'public, max-age=240', 'content-type': 'text/plain; charset=utf-8' });
    const out = path.join(env.root, 'out');
    const verified = await runBootstrap({ client: github, treeDir: env.tree, revision: env.revision, immutableUrl: IMMUTABLE, outDir: out, fetcher, clock: fakeClock() });
    const extract = async (_zip: string, directory: string) => {
      await fs.copyFile(path.join(out, 'legacy-inventory.json'), path.join(directory, 'legacy-inventory.json'));
    };
    const payloadFor = (artifactId: number, archive: Uint8Array): ReceiptPayload => ({
      schemaVersion: 1,
      kind: 'legacy-bootstrap',
      sourceCommit: SOURCE,
      deployCommit: env.revision,
      candidateId: `legacy:${env.revision}:artifact-${artifactId}`,
      manifestSha256: verified.inventorySha256,
      immutableUrl: IMMUTABLE,
      bootstrapArtifactId: artifactId,
      bootstrapArtifactDigest: `sha256:${sha256Hex(archive)}`,
      bootstrapRunId: artifactId,
    });

    const oldArchive = new TextEncoder().encode('old-zip');
    const first = await recordReceipt(github, { repository: REPO, ref: SOURCE, payload: payloadFor(77, oldArchive) });
    github.artifacts.set(77, { id: 77, expired: true, digest: `sha256:${sha256Hex(oldArchive)}`, archive_download_url: 'https://dl/77' });
    const stale = await selectBaselineReceipt(github, { repository: REPO });
    assert.equal(stale?.id, first.deploymentId);
    await assert.rejects(resolveBaselineEvidence({ client: github, repository: REPO, receipt: stale, treeDir: env.tree, extract }), BootstrapArtifactUnavailableError);

    const newArchive = new TextEncoder().encode('new-zip');
    github.artifacts.set(78, { id: 78, expired: false, digest: `sha256:${sha256Hex(newArchive)}`, archive_download_url: 'https://dl/78' });
    github.downloads.set('https://dl/78', newArchive);
    const second = await recordReceipt(github, { repository: REPO, ref: SOURCE, payload: payloadFor(78, newArchive) });
    assert.equal(second.createdDeployment, true);
    assert.notEqual(second.deploymentId, first.deploymentId);
    const retry = await recordReceipt(github, { repository: REPO, ref: SOURCE, payload: payloadFor(78, newArchive) });
    assert.deepEqual(retry, { deploymentId: second.deploymentId, createdDeployment: false, createdStatus: false });
    assert.equal(isSameEvidence(payloadFor(77, oldArchive), payloadFor(78, newArchive)), false);

    const selected = await selectBaselineReceipt(github, { repository: REPO });
    assert.equal(selected?.id, second.deploymentId);
    const resolved = await resolveBaselineEvidence({ client: github, repository: REPO, receipt: selected, treeDir: env.tree, extract });
    assert.equal(resolved.receiptId, second.deploymentId);
    assert.ok(resolved.files.some(file => file.path === 'Scripts/a.js'));
  });

  it('rejects a manifest baseline tree that differs from its receipt', async (t) => {
    const root = await tempDir(t, 'mirrrule-manifest-baseline-');
    const tree = path.join(root, 'tree');
    await writeTree(tree, CORE_FIXTURE);
    const files = await scanTree(tree);
    const manifest = buildManifest({
      kind: 'build', sourceCommit: SOURCE, baselineReceiptId: null, baselineDeployCommit: null, lifecycleVersion: 1,
      generatedAt: '2026-10-10T00:00:00.000Z', freshDirs: [], preservedDirs: [], retiredRemoved: [], files, preservedFrom: relative => NOT_PRESERVED.get(relative),
    });
    const text = serializeManifest(manifest);
    await writeTree(tree, { [PUBLICATION_MANIFEST_PATH]: text });
    const receipt = { id: 3, createdAt: '', payload: manifestPayload({ candidateId: manifest.candidateId, manifestSha256: sha256Hex(text) }) };
    const resolved = await resolveBaselineEvidence({ client: new FakeGitHub(), repository: REPO, receipt, treeDir: tree });
    assert.equal(resolved.files.length, files.length);
    await writeTree(tree, { 'Internal/unlisted.json': '{}' });
    await assert.rejects(resolveBaselineEvidence({ client: new FakeGitHub(), repository: REPO, receipt, treeDir: tree }), /extra Internal\/unlisted\.json/);
    await fs.rm(path.join(tree, 'Internal', 'unlisted.json'));
    await assert.rejects(
      resolveBaselineEvidence({ client: new FakeGitHub(), repository: REPO, receipt: { ...receipt, payload: manifestPayload({ candidateId: manifest.candidateId }) }, treeDir: tree }),
      /manifest sha256/
    );
  });
});
