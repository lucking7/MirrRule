import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

export interface GitResult {
  code: number,
  stdout: string,
  stderr: string
}

export type GitRunner = (args: readonly string[], cwd: string) => Promise<GitResult>;

export const runGit: GitRunner = (args, cwd) => new Promise(resolve => {
  execFile('git', [...args], { cwd, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (error, stdout, stderr) => {
    const code = error ? (typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : 1) : 0;
    resolve({ code, stdout, stderr });
  });
});

function redact(text: string): string {
  return text.replaceAll(/https:\/\/[^\s/@]+@/g, 'https://***@');
}

async function git(runner: GitRunner, cwd: string, args: readonly string[]): Promise<string> {
  const result = await runner(args, cwd);
  if (result.code !== 0) throw new Error(`git ${redact(args.join(' '))} failed (${result.code}): ${redact(result.stderr.trim())}`);
  return result.stdout.trim();
}

const COMMIT = /^[\da-f]{40}$/;

/** Fetch one exact commit into a fresh directory and verify the checked-out revision. */
export async function checkoutCommit(options: {
  remoteUrl: string,
  commit: string,
  directory: string,
  runner?: GitRunner
}): Promise<void> {
  if (!COMMIT.test(options.commit)) throw new Error(`Refusing to check out a non-commit ref: ${options.commit}`);
  const runner = options.runner ?? runGit;
  await fs.rm(options.directory, { recursive: true, force: true });
  await fs.mkdir(options.directory, { recursive: true });
  await git(runner, options.directory, ['init', '--quiet']);
  await git(runner, options.directory, ['remote', 'add', 'origin', options.remoteUrl]);
  await git(runner, options.directory, ['fetch', '--quiet', '--depth=1', '--no-tags', 'origin', options.commit]);
  await git(runner, options.directory, ['checkout', '--quiet', '--detach', 'FETCH_HEAD']);
  const head = await git(runner, options.directory, ['rev-parse', 'HEAD']);
  if (head !== options.commit) throw new Error(`Checked out ${head}, expected ${options.commit}`);
}

async function readRemoteHead(runner: GitRunner, repoDir: string, branch: string): Promise<string> {
  const output = await git(runner, repoDir, ['ls-remote', 'origin', `refs/heads/${branch}`]);
  const sha = output.split(/\s+/)[0] ?? '';
  if (!COMMIT.test(sha)) throw new Error(`Remote branch ${branch} has no readable head`);
  return sha;
}

export class RemoteDriftError extends Error {
  // eslint-disable-next-line sukka/unicorn/custom-error-definition -- structured publication fields precede the message
  constructor(readonly expected: string, readonly actual: string) {
    super(`NRRule remote HEAD drifted: expected ${expected}, found ${actual}; refusing to push`);
    this.name = 'RemoteDriftError';
  }
}

export class PushUncertainError extends Error {
  // eslint-disable-next-line sukka/unicorn/custom-error-definition -- structured publication fields precede the message
  constructor(readonly commit: string, detail: string) {
    super(`Push result unknown for ${commit}: ${detail}; no further push was attempted`);
    this.name = 'PushUncertainError';
  }
}

type PublishOutcome = 'no-op' | 'pushed' | 'landed-after-error';

export interface PublishResult {
  deployCommit: string,
  outcome: PublishOutcome,
  previousHead: string
}

async function replaceWorkTree(repoDir: string, stagingDir: string): Promise<void> {
  const entries = await fs.readdir(repoDir);
  await Promise.all(entries.flatMap(name => (name === '.git' ? [] : [fs.rm(path.join(repoDir, name), { recursive: true, force: true })])));
  for (const name of await fs.readdir(stagingDir)) {
    // eslint-disable-next-line no-await-in-loop -- sequential copy keeps error attribution precise
    await fs.cp(path.join(stagingDir, name), path.join(repoDir, name), { recursive: true, errorOnExist: true, force: false });
  }
}

/**
 * Commit the staging tree as the full NRRule tree and push it once without force. A no-op returns
 * the current HEAD; a failed push is resolved by reading the remote instead of pushing again.
 */
export async function publishStagingTree(options: {
  repoDir: string,
  stagingDir: string,
  branch: string,
  expectedHead: string,
  message: string,
  runner?: GitRunner
}): Promise<PublishResult> {
  const runner = options.runner ?? runGit;
  const { repoDir, branch, expectedHead } = options;
  await git(runner, repoDir, ['fetch', '--quiet', '--no-tags', 'origin', `refs/heads/${branch}`]);
  const fetched = await git(runner, repoDir, ['rev-parse', 'FETCH_HEAD']);
  if (fetched !== expectedHead) throw new RemoteDriftError(expectedHead, fetched);
  // Point the branch and index at the expected commit without checking out files, so a
  // `--no-checkout --filter=blob:none` clone never downloads the blobs it will replace.
  await git(runner, repoDir, ['update-ref', `refs/heads/${branch}`, expectedHead]);
  await git(runner, repoDir, ['symbolic-ref', 'HEAD', `refs/heads/${branch}`]);
  await git(runner, repoDir, ['read-tree', expectedHead]);
  await replaceWorkTree(repoDir, options.stagingDir);
  await git(runner, repoDir, ['add', '--all', '.']);
  const diff = await runner(['diff', '--cached', '--quiet'], repoDir);
  if (diff.code === 0) return { deployCommit: expectedHead, outcome: 'no-op', previousHead: expectedHead };
  if (diff.code !== 1) throw new Error(`git diff failed: ${diff.stderr.trim()}`);
  await git(runner, repoDir, ['commit', '--quiet', '-m', options.message]);
  const commit = await git(runner, repoDir, ['rev-parse', 'HEAD']);

  const beforePush = await readRemoteHead(runner, repoDir, branch);
  if (beforePush !== expectedHead) throw new RemoteDriftError(expectedHead, beforePush);

  const push = await runner(['push', '--quiet', 'origin', `HEAD:refs/heads/${branch}`], repoDir);
  let remote: string;
  try {
    remote = await readRemoteHead(runner, repoDir, branch);
  } catch (error) {
    throw new PushUncertainError(commit, `push exit ${push.code}; remote unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (remote === commit) {
    return { deployCommit: commit, outcome: push.code === 0 ? 'pushed' : 'landed-after-error', previousHead: expectedHead };
  }
  if (push.code === 0) throw new PushUncertainError(commit, `push reported success but remote is ${remote}`);
  if (remote !== expectedHead) throw new RemoteDriftError(expectedHead, remote);
  throw new Error(`Push of ${commit} failed and did not land (remote still ${remote}): ${redact(push.stderr.trim())}`);
}
