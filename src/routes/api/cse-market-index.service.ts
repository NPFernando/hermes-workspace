/**
 * Read-only CSE market-wide data used by the market-index and daily-snapshot
 * surfaces. The CSE endpoints are unofficial and may change or rate-limit;
 * callers must treat a null result as a normal manual-fallback state.
 */

import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const CSE_API_URL = 'https://www.cse.lk/api/'
const REQUEST_TIMEOUT_MS = 8_000
const MAX_REQUEST_ATTEMPTS = 2
const RETRY_DELAY_MS = 100
const MAX_STORED_SNAPSHOTS = 365

export const CSE_MARKET_SNAPSHOT_PATH = join(
  process.env.HERMES_HOME ?? join(homedir(), '.hermes'),
  'finance',
  'cse-market-snapshots.json',
)

export interface CseMarketSnapshot {
  capturedAt: string
  tradeDate: string | null
  aspi: number | null
  aspiChange: number | null
  sp20: number | null
  sp20Change: number | null
  marketTurnover: number | null
  shareVolume: number | null
  trades: number | null
  marketCap: number | null
  source: 'cse_unofficial'
}

export interface CseMarketIndexProvider {
  readonly id: string
  fetchSnapshot: () => Promise<unknown>
}

export function readCseMarketSnapshots(
  path = CSE_MARKET_SNAPSHOT_PATH,
): Array<CseMarketSnapshot> {
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry) => parseCseMarketSnapshot(entry, entry?.capturedAt))
      .filter((entry): entry is CseMarketSnapshot => entry !== null)
      .slice(-MAX_STORED_SNAPSHOTS)
  } catch {
    return []
  }
}

export function appendCseMarketSnapshot(
  snapshot: CseMarketSnapshot,
  path = CSE_MARKET_SNAPSHOT_PATH,
): Array<CseMarketSnapshot> {
  const current = readCseMarketSnapshots(path)
  const key = snapshot.tradeDate?.slice(0, 10) ?? snapshot.capturedAt.slice(0, 10)
  const withoutSameDay = current.filter(
    (entry) =>
      (entry.tradeDate?.slice(0, 10) ?? entry.capturedAt.slice(0, 10)) !== key,
  )
  const next = [...withoutSameDay, snapshot].slice(-MAX_STORED_SNAPSHOTS)
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    })
    chmodSync(temporaryPath, 0o600)
    renameSync(temporaryPath, path)
    chmodSync(path, 0o600)
  } finally {
    try {
      unlinkSync(temporaryPath)
    } catch {
      /* already renamed or never created */
    }
  }
  return next
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Number(value.replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function firstObject(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = firstObject(entry)
      if (found) return found
    }
    return null
  }
  if (!value || typeof value !== 'object') return null
  const object = value as Record<string, unknown>
  if (
    Object.keys(object).some((key) =>
      ['asi', 'aspi', 'value', 'tradeDate', 'marketTurnover'].includes(key),
    )
  ) {
    return object
  }
  for (const child of Object.values(object)) {
    const found = firstObject(child)
    if (found) return found
  }
  return null
}

function pick(object: Record<string, unknown>, ...keys: Array<string>): unknown {
  for (const key of keys) {
    if (object[key] !== undefined && object[key] !== null) return object[key]
  }
  return null
}

export function parseCseMarketSnapshot(
  value: unknown,
  capturedAt = new Date().toISOString(),
): CseMarketSnapshot | null {
  const object = firstObject(value)
  if (!object) return null

  const aspi = finiteNumber(pick(object, 'aspi', 'asi', 'value'))
  const sp20 = finiteNumber(pick(object, 'sp20', 'spp', 'snp', 'snpValue'))
  // A market response without either headline index is not useful enough to
  // persist or display as a valid snapshot.
  if (aspi === null && sp20 === null) return null

  const tradeDateValue = pick(object, 'tradeDate', 'date', 'marketDate')
  let tradeDate: string | null = null
  if (typeof tradeDateValue === 'number' && Number.isFinite(tradeDateValue)) {
    tradeDate = new Date(tradeDateValue).toISOString()
  } else if (typeof tradeDateValue === 'string' && tradeDateValue.trim()) {
    tradeDate = tradeDateValue.trim()
  }

  return {
    capturedAt,
    tradeDate,
    aspi,
    aspiChange: finiteNumber(pick(object, 'aspiChange', 'asiChange', 'change')),
    sp20,
    sp20Change: finiteNumber(
      pick(object, 'sp20Change', 'sppChange', 'snpChange'),
    ),
    marketTurnover: finiteNumber(
      pick(object, 'marketTurnover', 'turnover', 'equityTurnover'),
    ),
    shareVolume: finiteNumber(
      pick(object, 'shareVolume', 'volumeOfTurnOverNumber', 'tradeVolume'),
    ),
    trades: finiteNumber(pick(object, 'trades', 'tradesNo', 'marketTrades')),
    marketCap: finiteNumber(pick(object, 'marketCap', 'marketCapitalization')),
    source: 'cse_unofficial',
  }
}

async function postJson(endpoint: string): Promise<unknown> {
  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${CSE_API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (response.ok) return await response.json()
      if (attempt === MAX_REQUEST_ATTEMPTS) return null
    } catch {
      if (attempt === MAX_REQUEST_ATTEMPTS) return null
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
  }
  return null
}

export const unofficialCseMarketIndexProvider: CseMarketIndexProvider = {
  id: 'cse_unofficial',
  fetchSnapshot: () => postJson('dailyMarketSummery'),
}

export async function fetchCseMarketSnapshot(
  provider: CseMarketIndexProvider = unofficialCseMarketIndexProvider,
): Promise<CseMarketSnapshot | null> {
  try {
    return parseCseMarketSnapshot(await provider.fetchSnapshot())
  } catch {
    return null
  }
}
