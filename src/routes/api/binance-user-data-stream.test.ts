import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as os from 'node:os'
import * as fs from 'node:fs'
import * as path from 'node:path'

// Same sandbox pattern as demo-trading-engine.test.ts: point the finance
// store at a temp HOME so tests never touch ~/.hermes/finance.
let tmp: string
let realHome: string | undefined
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'binance-user-data-stream-'))
  realHome = process.env.HOME
  process.env.HOME = tmp
  vi.resetModules()
})
afterEach(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('auditEntryForEvent', () => {
  it('maps executionReport to an audit entry with the key order fields', async () => {
    const { auditEntryForEvent } = await import('./binance-user-data-stream')
    const entry = auditEntryForEvent({
      e: 'executionReport',
      s: 'BTCUSDT',
      S: 'BUY',
      o: 'MARKET',
      x: 'TRADE',
      X: 'FILLED',
      r: 'NONE',
      i: 123456,
      l: '0.00013',
      z: '0.00013',
      L: '64000.00',
      n: '0.00002',
      N: 'BNB',
      Z: '8.32',
    })
    expect(entry).not.toBeNull()
    expect(entry?.action).toBe('binance_user_data_execution_report')
    expect(entry?.details).toMatchObject({
      symbol: 'BTCUSDT',
      side: 'BUY',
      orderStatus: 'FILLED',
      orderId: 123456,
      commission: '0.00002',
      commissionAsset: 'BNB',
    })
  })

  it('maps outboundAccountPosition to an audit entry, dropping zero balances', async () => {
    const { auditEntryForEvent } = await import('./binance-user-data-stream')
    const entry = auditEntryForEvent({
      e: 'outboundAccountPosition',
      E: 1564034571105,
      u: 1564034571073,
      B: [
        { a: 'USDT', f: '100.5', l: '0' },
        { a: 'BTC', f: '0', l: '0' },
      ],
    })
    expect(entry).not.toBeNull()
    expect(entry?.action).toBe('binance_user_data_account_position')
    const balances = entry?.details.balances as Array<{ a: string }>
    expect(balances).toHaveLength(1)
    expect(balances[0].a).toBe('USDT')
  })

  it('maps balanceUpdate to an audit entry', async () => {
    const { auditEntryForEvent } = await import('./binance-user-data-stream')
    const entry = auditEntryForEvent({
      e: 'balanceUpdate',
      a: 'BTC',
      d: '100.00000000',
    })
    expect(entry).toEqual({
      action: 'binance_user_data_balance_update',
      details: { asset: 'BTC', delta: '100.00000000' },
    })
  })

  it('returns null for an unrecognized event type', async () => {
    const { auditEntryForEvent } = await import('./binance-user-data-stream')
    expect(auditEntryForEvent({ e: 'listStatus' })).toBeNull()
  })

  it('returns null for malformed input', async () => {
    const { auditEntryForEvent } = await import('./binance-user-data-stream')
    expect(auditEntryForEvent(undefined)).toBeNull()
    expect(auditEntryForEvent(null)).toBeNull()
    expect(auditEntryForEvent('not an object')).toBeNull()
    expect(auditEntryForEvent({})).toBeNull()
  })
})

describe('startBinanceUserDataStream', () => {
  it('never opens a real connection under the test environment guard', async () => {
    const { startBinanceUserDataStream, stopBinanceUserDataStream } =
      await import('./binance-user-data-stream')
    expect(startBinanceUserDataStream()).toBe(false)
    // Idempotent no-op teardown even though nothing started.
    expect(() => stopBinanceUserDataStream()).not.toThrow()
  })
})
