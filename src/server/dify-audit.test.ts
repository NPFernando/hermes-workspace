import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  appendDifyAudit,
  readDifyAudit,
  summarizeDifyAudit,
} from './dify-audit'

const auditPath = join(tmpdir(), `hermes-dify-audit-${Date.now()}.jsonl`)

afterEach(() => {
  delete process.env.DIFY_AUDIT_PATH
  rmSync(auditPath, { force: true })
})

describe('Dify audit logging', () => {
  it('writes metadata without accepting request secrets or inputs', () => {
    process.env.DIFY_AUDIT_PATH = auditPath
    appendDifyAudit({
      action: 'dify_run',
      appId: 'research',
      mode: 'workflow',
      outcome: 'success',
      status: 200,
    })

    expect(existsSync(auditPath)).toBe(true)
    const entry = JSON.parse(readFileSync(auditPath, 'utf8')) as Record<
      string,
      unknown
    >
    expect(entry).toMatchObject({
      action: 'dify_run',
      appId: 'research',
      outcome: 'success',
    })
    expect(entry).not.toHaveProperty('apiKey')
    expect(entry).not.toHaveProperty('inputs')
  })

  it('summarizes outcomes and latency without exposing event payloads', () => {
    process.env.DIFY_AUDIT_PATH = auditPath
    appendDifyAudit({
      action: 'dify_run',
      outcome: 'success',
      durationMs: 100,
    })
    appendDifyAudit({
      action: 'dify_run',
      outcome: 'failure',
      durationMs: 300,
    })
    appendDifyAudit({
      action: 'dify_run',
      outcome: 'rate_limited',
    })

    expect(summarizeDifyAudit()).toMatchObject({
      total: 3,
      success: 1,
      failure: 1,
      rateLimited: 1,
      averageDurationMs: 200,
      last24h: 3,
    })
  })

  it('reads only the bounded tail of a large audit file', () => {
    process.env.DIFY_AUDIT_PATH = auditPath
    writeFileSync(
      auditPath,
      Array.from(
        { length: 25_000 },
        (_, index) =>
          `${JSON.stringify({ action: 'dify_run', outcome: 'success', index })}\n`,
      ).join(''),
    )

    const entries = readDifyAudit(5)
    expect(entries).toHaveLength(5)
    expect(entries[0]).toMatchObject({ index: 24_999 })
  })
})
