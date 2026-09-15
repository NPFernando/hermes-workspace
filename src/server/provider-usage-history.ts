import {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ProviderUsageResult } from './provider-usage'

const HISTORY_DB =
  process.env.HERMES_PROVIDER_USAGE_HISTORY_DB ??
  join(
    process.env.HERMES_HOME ?? join(homedir(), '.hermes'),
    'provider-usage-history.db',
  )
const HISTORY_DAYS = 90

export type ProviderUsageHistoryPoint = {
  day: string
  provider: string
  displayName: string
  label: string
  measure: 'quota' | 'spend'
  used: number
  limit: number | null
  percent: number | null
  sampledAt: number
  source: string | null
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function ensureHistoryDb(path: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  if (existsSync(path)) {
    const metadata = lstatSync(path)
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error('Provider usage history path is not a regular file.')
    }
  }
  const descriptor = openSync(path, 'a+', 0o600)
  try {
    if (!fstatSync(descriptor).isFile()) {
      throw new Error('Provider usage history path is not a regular file.')
    }
    chmodSync(path, 0o600)
  } finally {
    closeSync(descriptor)
  }
}

function runSql(path: string, sql: string): string {
  return execFileSync('/usr/bin/sqlite3', ['-json', path], {
    input: sql,
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 2 * 1024 * 1024,
  })
}

function schemaSql(): string {
  return `CREATE TABLE IF NOT EXISTS provider_usage_samples (
      sampled_at INTEGER NOT NULL,
      provider TEXT NOT NULL,
      display_name TEXT NOT NULL,
      label TEXT NOT NULL,
      measure TEXT NOT NULL CHECK (measure IN ('quota','spend')),
      used REAL NOT NULL,
      limit_value REAL,
      source TEXT,
      PRIMARY KEY (sampled_at, provider, label)
    );
    CREATE INDEX IF NOT EXISTS provider_usage_samples_time_idx
      ON provider_usage_samples(sampled_at);
  `
}

function sampleSql(providers: Array<ProviderUsageResult>, now: number): string {
  const statements: Array<string> = [schemaSql()]
  const cutoff = now - HISTORY_DAYS * 24 * 60 * 60 * 1000
  statements.push(
    `DELETE FROM provider_usage_samples WHERE sampled_at < ${Math.trunc(cutoff)};`,
  )

  for (const provider of providers) {
    if (provider.status !== 'ok') continue
    for (const line of provider.lines) {
      if (
        line.type !== 'progress' ||
        (line.measure !== 'quota' && line.measure !== 'spend') ||
        typeof line.used !== 'number' ||
        !Number.isFinite(line.used)
      ) {
        continue
      }
      const limit =
        typeof line.limit === 'number' && Number.isFinite(line.limit)
          ? String(line.limit)
          : 'NULL'
      statements.push(
        `INSERT OR IGNORE INTO provider_usage_samples ` +
          `(sampled_at, provider, display_name, label, measure, used, limit_value, source) VALUES (` +
          `${Math.trunc(provider.updatedAt)}, ${sqlString(provider.provider)}, ` +
          `${sqlString(provider.displayName)}, ${sqlString(line.label)}, ` +
          `${sqlString(line.measure)}, ${line.used}, ${limit}, ` +
          `${provider.source ? sqlString(provider.source) : 'NULL'});`,
      )
    }
  }
  return statements.join('\n')
}

export function recordAndReadProviderUsageHistory(
  providers: Array<ProviderUsageResult>,
  options: { dbPath?: string; now?: number; days?: number } = {},
): Array<ProviderUsageHistoryPoint> {
  const dbPath = options.dbPath ?? HISTORY_DB
  const now = options.now ?? Date.now()
  const days = Math.max(
    1,
    Math.min(HISTORY_DAYS, Math.floor(options.days ?? 7)),
  )
  ensureHistoryDb(dbPath)
  runSql(dbPath, sampleSql(providers, now))
  const cutoff = now - days * 24 * 60 * 60 * 1000
  const rows = runSql(
    dbPath,
    `WITH ranked AS (
       SELECT date(sampled_at / 1000, 'unixepoch') AS day,
              provider, display_name, label, measure, used, limit_value,
              sampled_at, source,
              ROW_NUMBER() OVER (
                PARTITION BY date(sampled_at / 1000, 'unixepoch'), provider, label
                ORDER BY sampled_at DESC
              ) AS rank
         FROM provider_usage_samples
        WHERE sampled_at >= ${Math.trunc(cutoff)} AND sampled_at <= ${Math.trunc(now)}
     )
     SELECT day, provider, display_name AS displayName, label, measure, used,
            limit_value AS "limit", sampled_at AS sampledAt, source
       FROM ranked WHERE rank = 1 ORDER BY day, provider, label;`,
  )
  const parsed = JSON.parse(rows || '[]') as Array<
    Omit<ProviderUsageHistoryPoint, 'percent'>
  >
  return parsed.map((row) => ({
    ...row,
    percent:
      row.limit !== null && row.limit > 0
        ? Math.max(0, Math.min(100, (row.used / row.limit) * 100))
        : null,
  }))
}
