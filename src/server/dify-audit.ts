import {
  appendFileSync,
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export type DifyAuditEvent = {
  action: string
  appId?: string
  mode?: string
  outcome: 'success' | 'failure' | 'rate_limited'
  status?: number
  durationMs?: number
  errorCode?: string
  clientIp?: string
}

export type DifyAuditSummary = {
  total: number
  success: number
  failure: number
  rateLimited: number
  averageDurationMs: number | null
  last24h: number
  lastEventAt: string | null
}

// History is observability data, not an archival store. Keep reads bounded so
// a long-lived append-only file cannot make a status request allocate its full
// size in memory. The record limit below remains the primary response bound.
const MAX_AUDIT_READ_BYTES = 2 * 1024 * 1024

function auditPath(): string {
  return (
    process.env.DIFY_AUDIT_PATH ||
    join(
      process.env.HERMES_HOME ||
        process.env.CLAUDE_HOME ||
        join(homedir(), '.hermes'),
      'dify-audit.jsonl',
    )
  )
}

/** Append metadata-only Dify activity; request inputs and credentials are never logged. */
export function appendDifyAudit(event: DifyAuditEvent): void {
  try {
    const path = auditPath()
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    appendFileSync(
      path,
      `${JSON.stringify({ ...event, timestamp: new Date().toISOString() })}\n`,
      { encoding: 'utf8', mode: 0o600 },
    )
  } catch {
    // Observability must never make a Dify request fail.
  }
}

export function readDifyAudit(
  limit = 50,
  offset = 0,
): Array<Record<string, unknown>> {
  try {
    const path = auditPath()
    const fd = openSync(path, 'r')
    let text: string
    try {
      const size = fstatSync(fd).size
      const start = Math.max(0, size - MAX_AUDIT_READ_BYTES)
      const buffer = Buffer.allocUnsafe(size - start)
      readSync(fd, buffer, 0, buffer.length, start)
      text = buffer.toString('utf8')
    } finally {
      closeSync(fd)
    }
    const entries = text
      .split('\n')
      .filter(Boolean)
      .slice(
        -Math.min(Math.max(limit + Math.max(offset, 0), 1), 200),
        offset > 0 ? -offset : undefined,
      )
      .reverse()
    return entries.flatMap((line: string) => {
      try {
        const value = JSON.parse(line) as unknown
        return value && typeof value === 'object'
          ? [value as Record<string, unknown>]
          : []
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

export function summarizeDifyAudit(): DifyAuditSummary {
  const entries = readDifyAudit(200)
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  let success = 0
  let failure = 0
  let rateLimited = 0
  let last24h = 0
  let durationTotal = 0
  let durationCount = 0
  let lastEventAt: string | null = null

  for (const entry of entries) {
    if (typeof entry.timestamp === 'string') {
      const timestamp = Date.parse(entry.timestamp)
      if (Number.isFinite(timestamp)) {
        if (!lastEventAt || timestamp > Date.parse(lastEventAt)) {
          lastEventAt = entry.timestamp
        }
        if (timestamp >= cutoff) last24h += 1
      }
    }
    if (entry.outcome === 'success') success += 1
    if (entry.outcome === 'failure') failure += 1
    if (entry.outcome === 'rate_limited') rateLimited += 1
    if (typeof entry.durationMs === 'number' && entry.durationMs >= 0) {
      durationTotal += entry.durationMs
      durationCount += 1
    }
  }

  return {
    total: entries.length,
    success,
    failure,
    rateLimited,
    averageDurationMs:
      durationCount > 0 ? Math.round(durationTotal / durationCount) : null,
    last24h,
    lastEventAt,
  }
}
