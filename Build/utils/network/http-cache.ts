import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { Buffer } from 'node:buffer';
import Database from 'better-sqlite3';
import undici from 'undici';

import type { RequestInit } from 'undici';

import { CACHE_DIR } from '../../constants/dir';
import { defaultRequestInit } from './fetch-retry';

export interface FetchCachedOptions {
  readonly ttlSeconds?: number,
  readonly forceRefresh?: boolean,
  readonly requestInit?: RequestInit,
  /** 额外拼入 cache key，用于区分同 URL 不同语义 */
  readonly cacheKeySalt?: string,
  /** 返回格式，默认 text */
  readonly as?: 'text' | 'json' | 'arrayBuffer'
}

interface CacheRow {
  key: string,
  expireAt: number,
  value: Buffer,
  createdAt: number
}

const DB_FILE = path.join(CACHE_DIR, 'http-cache.db');

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

let db: Database.Database | null = null;
function getDb(): Database.Database {
  if (db) return db;
  ensureDir(DB_FILE);
  db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');
  db.exec(
    'CREATE TABLE IF NOT EXISTS http_cache (key TEXT PRIMARY KEY, expireAt INTEGER NOT NULL, value BLOB NOT NULL, createdAt INTEGER NOT NULL)'
  );
  return db;
}

function makeKey(url: string, salt?: string): string {
  const h = crypto.createHash('sha256');
  h.update(url);
  if (salt) h.update('|salt:' + salt);
  return h.digest('hex');
}

export function getDefaultTtlSeconds(url: string): number {
  try {
    const u = new URL(url);
    const host = u.hostname;
    // 相对稳定的静态源：较长 TTL
    if (
      host.endsWith('raw.githubusercontent.com')
      || host === 'codeload.github.com'
      || host === 'gitlab.com'
    ) {
      return 6 * 60 * 60; // 6h
    }
    // 频繁更新的 API：中等 TTL
    if (host.endsWith('core.telegram.org')) {
      return 60 * 60; // 1h
    }
  } catch {
    // ignore
  }
  return 10 * 60; // 默认 10 分钟
}

export async function fetchCached(
  url: string,
  options: FetchCachedOptions = {}
): Promise<string | any | ArrayBuffer> {
  const ttl = options.ttlSeconds ?? getDefaultTtlSeconds(url);
  const key = makeKey(url, options.cacheKeySalt);
  const now = Date.now();
  const dbi = getDb();

  if (!options.forceRefresh) {
    const row = dbi
      .prepare<unknown[], CacheRow>(
        'SELECT key, expireAt, value, createdAt FROM http_cache WHERE key = ?'
      )
      .get(key);
    if (row && row.expireAt > now) {
      return decode(row.value, options.as);
    }
  }

  const init: RequestInit = {
    ...defaultRequestInit,
    ...options.requestInit,
    method: options.requestInit?.method ?? 'GET'
  };

  const res = await undici.fetch(url, init);
  if (res.status >= 400) {
    throw new Error('HTTP ' + res.status + ' ' + url);
  }

  const buf = Buffer.from(await res.arrayBuffer());

  const expireAt = now + ttl * 1000;
  dbi
    .prepare(
      'INSERT OR REPLACE INTO http_cache (key, expireAt, value, createdAt) VALUES (?, ?, ?, ?)'
    )
    .run(key, expireAt, buf, now);

  return decode(buf, options.as);
}

function decode(buf: Buffer, as: FetchCachedOptions['as']): string | any | ArrayBuffer {
  switch (as) {
    case 'arrayBuffer':
      return buf;
    case 'json':
      return JSON.parse(buf.toString('utf8'));
    default:
      return buf.toString('utf8');
  }
}

export function clearCache(): void {
  const dbi = getDb();
  dbi.exec('DELETE FROM http_cache');
}

export function clearCacheKey(url: string, salt?: string): void {
  const dbi = getDb();
  const key = makeKey(url, salt);
  dbi.prepare('DELETE FROM http_cache WHERE key = ?').run(key);
}
