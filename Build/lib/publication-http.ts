import { sha256Hex } from './publication-manifest';
import type { Clock } from './publication-check';
import { systemClock } from './publication-check';

export interface HttpResult {
  status: number,
  body: Uint8Array,
  /** Lowercase header names; repeated headers are comma-joined. */
  headers: Record<string, string>
}

/** The signal aborts at the verification deadline; fetchers must stop reading when it fires. */
export type HttpFetcher = (url: string, signal: AbortSignal) => Promise<HttpResult>;

const defaultFetcher: HttpFetcher = async (url, signal) => {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'cache-control': 'no-cache', 'user-agent': 'MirrRule-publication-verifier' },
    signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
  });
  const body = new Uint8Array(await response.arrayBuffer());
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name.toLowerCase()] = value;
  });
  return { status: response.status, body, headers };
};

/** Cloudflare Pages configuration files: applied by Pages, never served as assets. */
const PAGES_CONFIG_FILES: ReadonlySet<string> = new Set(['_headers', '_redirects', '_routes.json', '_worker.js']);

export function isPagesConfigPath(relative: string): boolean {
  return PAGES_CONFIG_FILES.has(relative);
}

function encodePath(relative: string): string {
  return relative.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

/** Public URL path for a file; HTML files follow the Pages pretty-URL redirects. */
export function publicPathFor(relative: string): string {
  if (relative === 'index.html') return '/';
  if (relative.endsWith('/index.html')) return `/${encodePath(relative.slice(0, -'index.html'.length))}`;
  if (relative.endsWith('.html')) return `/${encodePath(relative.slice(0, -'.html'.length))}`;
  return `/${encodePath(relative)}`;
}

export interface HeaderRule {
  pattern: string,
  headers: Array<[string, string]>
}

export function parseHeadersFile(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  let current: HeaderRule | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (/^\s/.test(line)) {
      const separator = line.indexOf(':');
      if (current && separator > 0) current.headers.push([line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim()]);
      continue;
    }
    current = { pattern: line.trim(), headers: [] };
    rules.push(current);
  }
  return rules;
}

function patternToRegExp(pattern: string): RegExp {
  const source = pattern
    .split('*')
    .map(part => part.replaceAll(/[$()+.?[\\\]^{|}]/g, String.raw`\$&`).replaceAll(/:\w+/g, '[^/]+'))
    .join('.*');
  return new RegExp(`^${source}$`);
}

export interface HeaderProbe {
  pattern: string,
  path: string,
  headers: Array<[string, string]>
}

/** One deterministic asset per same-host `_headers` rule, used to observe the applied headers. */
export function headerProbes(rules: readonly HeaderRule[], assetPaths: readonly string[]): HeaderProbe[] {
  const probes: HeaderProbe[] = [];
  const candidates = assetPaths.filter(relative => !isPagesConfigPath(relative) && !relative.endsWith('.html'));
  for (const rule of rules) {
    if (!rule.pattern.startsWith('/') || !rule.headers.length) continue;
    const matcher = patternToRegExp(rule.pattern);
    const match = candidates.find(relative => matcher.test(`/${relative}`));
    if (match) probes.push({ pattern: rule.pattern, path: match, headers: rule.headers });
  }
  return probes;
}

export interface ExpectedFile {
  path: string,
  sha256: string
}

type OriginFailureReason = 'network' | 'status' | 'content' | 'header' | 'retired-present' | 'deadline';

export interface OriginFailure {
  key: string,
  path: string,
  url: string,
  reason: OriginFailureReason,
  detail: string
}

interface OriginCheck {
  key: string,
  path: string,
  url: string,
  run: (signal: AbortSignal) => Promise<OriginFailure | null>
}

export interface OriginCheckInput {
  origin: string,
  files: readonly ExpectedFile[],
  absentPaths?: readonly string[],
  headerProbes?: readonly HeaderProbe[],
  fetcher?: HttpFetcher,
  concurrency?: number
}

function failure(key: string, relative: string, url: string, reason: OriginFailureReason, detail: string): OriginFailure {
  return { key, path: relative, url, reason, detail };
}

function buildChecks(input: OriginCheckInput): OriginCheck[] {
  const fetcher = input.fetcher ?? defaultFetcher;
  const origin = input.origin.replace(/\/$/, '');
  const checks: OriginCheck[] = [];
  const guarded = (key: string, relative: string, url: string, fn: (result: HttpResult) => OriginFailure | null) => async (signal: AbortSignal) => {
    try {
      return fn(await fetcher(url, signal));
    } catch (error) {
      if (signal.aborted) return failure(key, relative, url, 'deadline', 'request aborted at the verification deadline');
      return failure(key, relative, url, 'network', error instanceof Error ? error.message : String(error));
    }
  };
  for (const file of input.files) {
    if (isPagesConfigPath(file.path)) continue;
    const url = origin + publicPathFor(file.path);
    const key = `file:${file.path}`;
    checks.push({
      key,
      path: file.path,
      url,
      run: guarded(key, file.path, url, result => {
        if (result.status !== 200) return failure(key, file.path, url, 'status', `HTTP ${result.status}`);
        const actual = sha256Hex(result.body);
        return actual === file.sha256 ? null : failure(key, file.path, url, 'content', `sha256 ${actual} != ${file.sha256}`);
      }),
    });
  }
  const { absentPaths = [], headerProbes: probes = [] } = input;
  for (const relative of absentPaths) {
    const url = origin + publicPathFor(relative);
    const key = `absent:${relative}`;
    checks.push({
      key,
      path: relative,
      url,
      run: guarded(key, relative, url, result => (result.status === 404 ? null : failure(key, relative, url, 'retired-present', `HTTP ${result.status}, expected 404`))),
    });
  }
  for (const probe of probes) {
    const url = origin + publicPathFor(probe.path);
    const key = `header:${probe.pattern}`;
    checks.push({
      key,
      path: probe.path,
      url,
      run: guarded(key, probe.path, url, result => {
        const missing = probe.headers.filter(([name, value]) => !(result.headers[name] ?? '').toLowerCase().includes(value.toLowerCase()));
        return missing.length
          ? failure(key, probe.path, url, 'header', `${probe.pattern} not applied: ${missing.map(([name, value]) => `${name}: ${value}`).join('; ')}`)
          : null;
      }),
    });
  }
  return checks;
}

interface RoundContext {
  deadline: number,
  clock: Clock,
  signal: AbortSignal,
  concurrency: number
}

/**
 * Run one round. No request starts once the deadline passed, in-flight requests are aborted at
 * the deadline, and a result that arrives after the deadline counts as a failure.
 */
async function runRound(checks: readonly OriginCheck[], context: RoundContext): Promise<OriginFailure[]> {
  const failures: OriginFailure[] = [];
  let index = 0;
  const worker = async () => {
    while (index < checks.length) {
      const check = checks[index++];
      if (context.signal.aborted || context.clock.now() >= context.deadline) {
        failures.push(failure(check.key, check.path, check.url, 'deadline', 'not checked before the verification deadline'));
        continue;
      }
      // eslint-disable-next-line no-await-in-loop -- each worker processes its share sequentially
      const result = await check.run(context.signal);
      if (result) failures.push(result);
      else if (context.clock.now() > context.deadline) failures.push(failure(check.key, check.path, check.url, 'deadline', 'completed after the verification deadline'));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(context.concurrency, checks.length)) }, worker));
  return failures.sort((a, b) => (a.key < b.key ? -1 : (a.key > b.key ? 1 : 0)));
}

/** Re-check only failing items until they pass or the deadline passes. */
export async function checkOriginUntil(
  input: OriginCheckInput & { deadline: number, retryIntervalMs?: number, clock?: Clock }
): Promise<OriginFailure[]> {
  const clock = input.clock ?? systemClock;
  const signal = clock.signalAt?.(input.deadline) ?? AbortSignal.timeout(Math.max(0, input.deadline - clock.now()));
  const context: RoundContext = { deadline: input.deadline, clock, signal, concurrency: input.concurrency ?? 16 };
  let pending = buildChecks(input);
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- retry rounds are sequential
    const failures = await runRound(pending, context);
    if (!failures.length) return failures;
    if (signal.aborted || clock.now() >= input.deadline || failures.every(item => item.reason === 'deadline')) return failures;
    const failing = new Set(failures.map(item => item.key));
    pending = pending.filter(check => failing.has(check.key));
    // eslint-disable-next-line no-await-in-loop -- retry rounds are sequential
    await clock.sleep(Math.min(input.retryIntervalMs ?? 20000, Math.max(0, input.deadline - clock.now())));
    // A round that could only start at the deadline would replace the observed reasons.
    if (signal.aborted || clock.now() >= input.deadline) return failures;
  }
}
