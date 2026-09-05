import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import {
  FINANCE_POSTGRES_COLLECTIONS,
  financePostgresStatus,
  readFinancePostgresNormalized,
  readFinancePostgresStore,
  writeFinancePostgresNormalized,
} from '../src/server/finance-postgres-store'
import type { FinanceDatabase } from '../src/server/finance-store'

const dataDir = path.join(os.homedir(), '.hermes', 'finance')
const jsonPath = path.join(dataDir, 'finance.json')
const tradingPath = path.join(dataDir, 'trading.json')
const auditPath = path.join(dataDir, 'audit.jsonl')
const dryRun = process.argv.includes('--dry-run')
const archive = process.argv.includes('--archive')
const resolveJson = process.argv.includes('--resolve-json')

function readJson(file: string): FinanceDatabase | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as FinanceDatabase
  } catch {
    return null
  }
}

function checksum(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex')
}

function countCollections(db: FinanceDatabase | null): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const name of FINANCE_POSTGRES_COLLECTIONS) {
    const value = db ? db[name] : undefined
    counts[name] = Array.isArray(value) ? value.length : 0
  }
  return counts
}

function activeValidationMode(db: FinanceDatabase | null): string | null {
  if (!db) return null
  const runs = (db as unknown as Record<string, unknown>).validationRuns
  if (!runs || typeof runs !== 'object') return null
  const activeValue = (runs as Record<string, unknown>).active
  const active = Array.isArray(activeValue) ? activeValue[0] : activeValue
  if (!active || typeof active !== 'object') return null
  const stage = (active as Record<string, unknown>).stage
  return stage === 'paper' ? 'paper_trade' : stage === 'sandbox' ? 'testnet_execute' : null
}

function assertModeConsistency(db: FinanceDatabase): void {
  const expected = activeValidationMode(db)
  if (!expected) return
  const actual = db.settings.tradingMode
  if (actual !== expected) {
    throw new Error(
      `Unresolved active-run mode conflict: validation stage requires ${expected}, settings contain ${actual}.`,
    )
  }
}

function archiveFile(file: string, suffix: string): string | null {
  if (!fs.existsSync(file)) return null
  const archived = `${file}.archive-${suffix}`
  fs.copyFileSync(file, archived, fs.constants.COPYFILE_EXCL)
  fs.chmodSync(archived, 0o400)
  return archived
}

const jsonDb = readJson(jsonPath)
if (!jsonDb) throw new Error(`Finance JSON source is missing or invalid: ${jsonPath}`)
assertModeConsistency(jsonDb)

const snapshot = readFinancePostgresStore()
const normalized = readFinancePostgresNormalized()
const jsonMode = jsonDb.settings.tradingMode
const snapshotMode = snapshot ? snapshot.settings.tradingMode : undefined
if (snapshotMode && snapshotMode !== jsonMode) {
  if (!resolveJson) {
    throw new Error(
      `Source conflict: JSON mode=${jsonMode}, Postgres snapshot mode=${snapshotMode}. Re-run with --resolve-json only after reviewing the conflict.`,
    )
  }
}

const before = normalized ? countCollections(normalized) : {}
const after = countCollections(jsonDb)
const manifest = {
  generatedAt: new Date().toISOString(),
  sourceFiles: [jsonPath, tradingPath, auditPath],
  sourceChecksums: {
    financeJson: checksum(jsonDb),
    tradingJson: fs.existsSync(tradingPath)
      ? checksum(fs.readFileSync(tradingPath, 'utf8'))
      : null,
    auditJsonl: fs.existsSync(auditPath)
      ? checksum(fs.readFileSync(auditPath, 'utf8'))
      : null,
  },
  sourceUpdatedAt: jsonDb.updatedAt,
  beforeCounts: before,
  afterCounts: after,
  mode: jsonMode,
  conflictResolution:
    snapshotMode && snapshotMode !== jsonMode ? 'json_authoritative' : null,
}

if (!dryRun) {
  if (!writeFinancePostgresNormalized(jsonDb))
    throw new Error(
      `PostgreSQL normalized finance write failed: ${financePostgresStatus().lastWriteError ?? 'unknown error'}`,
    )
  const readBack = readFinancePostgresNormalized()
  if (
    !readBack ||
    readBack.settings.tradingMode !== jsonDb.settings.tradingMode ||
    readBack.settings.executionAccount !== jsonDb.settings.executionAccount ||
    readBack.settings.liveTradingEnabled !== false
  )
    throw new Error('PostgreSQL read-back verification failed for settings.')
  if (JSON.stringify(countCollections(readBack)) !== JSON.stringify(after))
    throw new Error('PostgreSQL read-back verification failed for collection counts.')
  fs.writeFileSync(
    path.join(dataDir, `postgres-cutover-manifest-${Date.now()}.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o400 },
  )
  if (archive) {
    const suffix = new Date().toISOString().replace(/[:.]/g, '-')
    for (const file of [jsonPath, tradingPath, auditPath]) {
      archiveFile(file, suffix)
      if (fs.existsSync(file)) fs.chmodSync(file, 0o400)
    }
  }
}

console.log(JSON.stringify(manifest, null, 2))
