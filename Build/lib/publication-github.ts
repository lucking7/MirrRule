import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

export interface GitHubResponse<T = unknown> {
  status: number,
  data: T
}

/** Minimal REST surface used by publication; tests inject in-memory fakes. */
export interface GitHubClient {
  request: <T = unknown>(method: string, apiPath: string, body?: unknown) => Promise<GitHubResponse<T>>,
  download: (url: string) => Promise<Uint8Array>
}

export class GitHubApiError extends Error {
  constructor(
    readonly method: string,
    // eslint-disable-next-line sukka/unicorn/custom-error-definition -- structured publication fields precede the message
    readonly apiPath: string,
    readonly status: number,
    detail: string
  ) {
    super(`GitHub API ${method} ${apiPath} failed with HTTP ${status}: ${detail}`);
    this.name = 'GitHubApiError';
  }
}

export const MIRRRULE_REPOSITORY = 'lucking7/MirrRule';
export const NRRULE_REPOSITORY = 'lucking7/NRRule';

export function assertRepository(repository: string): string {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error(`Invalid repository: ${repository}`);
  return repository;
}

export interface CreateGitHubClientOptions {
  token?: string,
  baseUrl?: string,
  fetchImpl?: typeof fetch,
  /** Attempts for GET requests that fail on the network or with HTTP 5xx. */
  getAttempts?: number
}

function resolveGitHubToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.GITHUB_TOKEN || env.GH_TOKEN || undefined;
}

export function createGitHubClient(options: CreateGitHubClientOptions = {}): GitHubClient {
  const baseUrl = (options.baseUrl ?? 'https://api.github.com').replace(/\/$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const token = options.token ?? resolveGitHubToken();
  const getAttempts = Math.max(1, options.getAttempts ?? 3);
  const headers = (): Record<string, string> => ({
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'MirrRule-publication',
    ...(token && { authorization: `Bearer ${token}` }),
  });

  return {
    async request<T>(method: string, apiPath: string, body?: unknown): Promise<GitHubResponse<T>> {
      // Only reads are retried: a repeated write could duplicate state, so writes rely on idempotent lookups.
      const attempts = method === 'GET' ? getAttempts : 1;
      let lastError: unknown;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          // eslint-disable-next-line no-await-in-loop -- bounded sequential retry
          const response = await fetchImpl(`${baseUrl}${apiPath}`, {
            method,
            headers: body === undefined ? headers() : { ...headers(), 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(60000),
          });
          // eslint-disable-next-line no-await-in-loop -- bounded sequential retry
          const text = await response.text();
          if (response.status >= 500 && attempt < attempts) {
            lastError = new GitHubApiError(method, apiPath, response.status, text.slice(0, 300));
            // eslint-disable-next-line no-await-in-loop -- bounded sequential retry
            await sleep(1000 * attempt);
            continue;
          }
          if (!response.ok) throw new GitHubApiError(method, apiPath, response.status, text.slice(0, 300));
          return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
        } catch (error) {
          if (error instanceof GitHubApiError) throw error;
          lastError = error;
          if (attempt < attempts) {
            // eslint-disable-next-line no-await-in-loop -- bounded sequential retry
            await sleep(1000 * attempt);
          }
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    },
    async download(url: string): Promise<Uint8Array> {
      // fetch drops the authorization header when the archive redirect leaves api.github.com.
      const response = await fetchImpl(url, { headers: headers(), redirect: 'follow', signal: AbortSignal.timeout(300000) });
      if (!response.ok) throw new GitHubApiError('GET', url, response.status, (await response.text()).slice(0, 300));
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

export function isNotFound(error: unknown): boolean {
  return error instanceof GitHubApiError && error.status === 404;
}
