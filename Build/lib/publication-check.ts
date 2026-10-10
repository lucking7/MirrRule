import type { GitHubClient } from './publication-github';
import { assertRepository } from './publication-github';

/** Identity of the Cloudflare Pages Git integration that deploys NRRule commits. */
const CLOUDFLARE_PAGES_APP = { slug: 'cloudflare-workers-and-pages', id: 85455 } as const;
export const PRODUCTION_ORIGIN = 'https://nrrule.pages.dev';
const IMMUTABLE_ORIGIN = /^https:\/\/[\da-f]{8}\.nrrule\.pages\.dev$/;
const CANDIDATE_URL = /https:\/\/[\w.-]+\.pages\.dev\/?/gi;

export function isAllowlistedImmutableUrl(url: string): boolean {
  return IMMUTABLE_ORIGIN.test(url);
}

/** Extract the per-deployment URL from a Cloudflare check summary; other hosts are ignored. */
export function parseImmutableUrl(summary: string | null | undefined): string | null {
  for (const match of summary?.matchAll(CANDIDATE_URL) ?? []) {
    const url = match[0].replace(/\/$/, '').toLowerCase();
    if (isAllowlistedImmutableUrl(url)) return url;
  }
  return null;
}

export interface CheckRunRecord {
  id: number,
  name?: string,
  head_sha: string,
  status: string,
  conclusion: string | null,
  html_url?: string,
  app?: { id?: number, slug?: string } | null,
  output?: { title?: string | null, summary?: string | null } | null
}

export type CheckEvaluation =
  | { state: 'pending', rejected: string[], checkRunId?: number }
  | { state: 'failed', reason: string, checkRunId: number, conclusion: string | null, url?: string, rejected: string[] }
  | { state: 'success', checkRunId: number, immutableUrl: string, url?: string, rejected: string[] };

/**
 * Accept only a Cloudflare Pages check on exactly the deploy commit. Runs from other apps or
 * for other commits are rejected and reported, never treated as evidence.
 */
export function evaluateCheckRuns(runs: readonly CheckRunRecord[], deployCommit: string): CheckEvaluation {
  const rejected: string[] = [];
  const matching = runs.filter(run => {
    if (run.app?.slug !== CLOUDFLARE_PAGES_APP.slug || run.app.id !== CLOUDFLARE_PAGES_APP.id) {
      rejected.push(`check ${run.id} from app ${run.app?.slug ?? 'unknown'}/${run.app?.id ?? 'unknown'}`);
      return false;
    }
    if (run.head_sha !== deployCommit) {
      rejected.push(`check ${run.id} for commit ${run.head_sha}`);
      return false;
    }
    return true;
  });
  if (!matching.length) return { state: 'pending', rejected };
  const latest = matching.reduce((a, b) => (b.id > a.id ? b : a));
  if (latest.status !== 'completed') return { state: 'pending', rejected, checkRunId: latest.id };
  if (latest.conclusion !== 'success') {
    return { state: 'failed', reason: `Cloudflare check concluded ${latest.conclusion ?? 'without a conclusion'}`, checkRunId: latest.id, conclusion: latest.conclusion, url: latest.html_url, rejected };
  }
  const immutableUrl = parseImmutableUrl(latest.output?.summary);
  if (!immutableUrl) {
    return { state: 'failed', reason: 'Cloudflare check summary has no allowlisted immutable URL', checkRunId: latest.id, conclusion: latest.conclusion, url: latest.html_url, rejected };
  }
  return { state: 'success', checkRunId: latest.id, immutableUrl, url: latest.html_url, rejected };
}

export interface Clock {
  now: () => number,
  sleep: (ms: number) => Promise<void>,
  /** Signal that aborts when `now()` reaches the deadline; defaults to a real-time timeout. */
  signalAt?: (deadline: number) => AbortSignal
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: ms => new Promise(resolve => {
    setTimeout(resolve, ms);
  }),
  signalAt: deadline => AbortSignal.timeout(Math.max(0, deadline - Date.now())),
};

export type CheckPollResult =
  | (CheckEvaluation & { state: 'success' | 'failed' })
  | { state: 'timeout', lastState: CheckEvaluation['state'], checkRunId?: number, rejected: string[] };

export async function pollCloudflareCheck(options: {
  client: GitHubClient,
  repository: string,
  deployCommit: string,
  deadline: number,
  intervalMs?: number,
  clock?: Clock
}): Promise<CheckPollResult> {
  const clock = options.clock ?? systemClock;
  const repository = assertRepository(options.repository);
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- polling until the deadline
    const { data } = await options.client.request<{ check_runs: CheckRunRecord[] }>(
      'GET',
      `/repos/${repository}/commits/${options.deployCommit}/check-runs?app_id=${CLOUDFLARE_PAGES_APP.id}&per_page=100`
    );
    const last = evaluateCheckRuns(data.check_runs, options.deployCommit);
    if (last.state !== 'pending') return last;
    if (clock.now() >= options.deadline) {
      return { state: 'timeout', lastState: last.state, checkRunId: last.checkRunId, rejected: last.rejected };
    }
    // eslint-disable-next-line no-await-in-loop -- polling until the deadline
    await clock.sleep(Math.min(options.intervalMs ?? 15000, Math.max(0, options.deadline - clock.now())));
  }
}
