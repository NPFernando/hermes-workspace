import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as os from 'node:os'
import * as fs from 'node:fs'
import * as path from 'node:path'

// Same isolation pattern as connectivity-breaker.test.ts — the finance
// store resolves its path from os.homedir() at module load, so point HOME
// at a temp dir and reset modules so the store re-evaluates against it.
let tmp: string
let realHome: string | undefined
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alerts-'))
  realHome = process.env.HOME
  process.env.HOME = tmp
  vi.resetModules()
})
afterEach(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  fs.rmSync(tmp, { recursive: true, force: true })
})

function auditLines(): Array<{
  action: string
  details: Record<string, unknown>
}> {
  const auditPath = path.join(tmp, '.hermes', 'finance', 'audit.jsonl')
  if (!fs.existsSync(auditPath)) return []
  return fs
    .readFileSync(auditPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(
      (line) =>
        JSON.parse(line) as {
          action: string
          details: Record<string, unknown>
        },
    )
}

describe('sendAlert', () => {
  it('always appends an alert_sent audit entry regardless of severity or alertsEnabled', async () => {
    const { sendAlert } = await import('./alerts')
    sendAlert({
      severity: 'info',
      title: 'test info',
      detail: 'd',
      source: 'unit-test',
    })
    sendAlert({
      severity: 'warning',
      title: 'test warning',
      detail: 'd',
      source: 'unit-test',
    })
    sendAlert({
      severity: 'critical',
      title: 'test critical',
      detail: 'd',
      source: 'unit-test',
    })

    const entries = auditLines().filter((e) => e.action === 'alert_sent')
    expect(entries).toHaveLength(3)
    expect(entries.map((e) => e.details.severity)).toEqual([
      'info',
      'warning',
      'critical',
    ])
  })

  it('never throws even if delivery would fail', async () => {
    const { sendAlert } = await import('./alerts')
    expect(() =>
      sendAlert({
        severity: 'critical',
        title: 't',
        detail: 'd',
        source: 'unit-test',
      }),
    ).not.toThrow()
  })
})

describe('sendAlert delivery gating', () => {
  // deliverTelegram short-circuits under process.env.VITEST (so tests never
  // spam a real Telegram chat) — to actually exercise the gating logic we
  // mock child_process.spawn and briefly unset VITEST around the call,
  // restoring it immediately after regardless of outcome.
  it('skips delivery for non-critical severity when alertsEnabled is false (default)', async () => {
    vi.doMock('node:child_process', () => ({ spawn: vi.fn() }))
    const { spawn } = await import('node:child_process')
    const { sendAlert } = await import('./alerts')

    const prevVitest = process.env.VITEST
    delete process.env.VITEST
    try {
      sendAlert({
        severity: 'warning',
        title: 't',
        detail: 'd',
        source: 'unit-test',
      })
    } finally {
      process.env.VITEST = prevVitest
    }
    expect(spawn).not.toHaveBeenCalled()
  })

  it('attempts delivery for critical severity even when alertsEnabled is false', async () => {
    vi.doMock('node:child_process', () => ({
      spawn: vi.fn(() => ({ on: vi.fn(), unref: vi.fn() })),
    }))
    const { spawn } = await import('node:child_process')
    const { sendAlert } = await import('./alerts')

    const prevVitest = process.env.VITEST
    const prevNodeEnv = process.env.NODE_ENV
    delete process.env.VITEST
    process.env.NODE_ENV = 'production'
    try {
      sendAlert({
        severity: 'critical',
        title: 't',
        detail: 'd',
        source: 'unit-test',
      })
    } finally {
      process.env.VITEST = prevVitest
      process.env.NODE_ENV = prevNodeEnv
    }
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('attempts delivery for non-critical severity once alertsEnabled is true', async () => {
    vi.doMock('node:child_process', () => ({
      spawn: vi.fn(() => ({ on: vi.fn(), unref: vi.fn() })),
    }))
    const { spawn } = await import('node:child_process')
    const { readFinanceStore, writeFinanceStore } =
      await import('./finance-store')
    const { sendAlert } = await import('./alerts')

    const db = readFinanceStore()
    db.settings.alertsEnabled = true
    writeFinanceStore(db)

    const prevVitest = process.env.VITEST
    const prevNodeEnv = process.env.NODE_ENV
    delete process.env.VITEST
    process.env.NODE_ENV = 'production'
    try {
      sendAlert({
        severity: 'info',
        title: 't',
        detail: 'd',
        source: 'unit-test',
      })
    } finally {
      process.env.VITEST = prevVitest
      process.env.NODE_ENV = prevNodeEnv
    }
    expect(spawn).toHaveBeenCalledTimes(1)
  })
})
