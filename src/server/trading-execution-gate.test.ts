import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// connectivity-breaker.ts reads finance-store.ts settings, so isolate HOME
// the same way rebalance-engine.test.ts / llm-signal-engine.test.ts do.
let tmp: string
let realHome: string | undefined
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trading-execution-gate-'))
  realHome = process.env.HOME
  process.env.HOME = tmp
  vi.resetModules()
})
afterEach(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('executionModeAllowed (Phase 6 shared gate)', () => {
  it('blocks on emergency kill switch first, regardless of other state', async () => {
    const { executionModeAllowed } = await import('./trading-execution-gate')
    const result = executionModeAllowed(
      { emergencyKillSwitch: true, tradingMode: 'testnet_execute' },
      { enabled: true },
      'disabled',
    )
    expect(result).toEqual({ allowed: false, reason: 'emergency kill switch is active' })
  })

  it('blocks when tradingMode is not testnet_execute', async () => {
    const { executionModeAllowed } = await import('./trading-execution-gate')
    const result = executionModeAllowed(
      { emergencyKillSwitch: false, tradingMode: 'paper_trade' },
      { enabled: true },
      'disabled',
    )
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/testnet_execute/)
  })

  it('blocks with the caller-supplied reason when the engine itself is disabled', async () => {
    const { executionModeAllowed } = await import('./trading-execution-gate')
    const result = executionModeAllowed(
      { emergencyKillSwitch: false, tradingMode: 'testnet_execute' },
      { enabled: false },
      'rebalance engine is disabled (settings.demoTradingRebalance.enabled)',
    )
    expect(result).toEqual({
      allowed: false,
      reason: 'rebalance engine is disabled (settings.demoTradingRebalance.enabled)',
    })
  })

  it('allows when kill switch is off, mode is testnet_execute, and engine is enabled', async () => {
    const { executionModeAllowed } = await import('./trading-execution-gate')
    const result = executionModeAllowed(
      { emergencyKillSwitch: false, tradingMode: 'testnet_execute' },
      { enabled: true },
      'disabled',
    )
    expect(result).toEqual({ allowed: true })
  })
})
