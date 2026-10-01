import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tmp: string
let realHome: string | undefined

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trading-reconciliation-'))
  realHome = process.env.HOME
  process.env.HOME = tmp
  vi.resetModules()
})

afterEach(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('trading account reconciliation automation', () => {
  it('does not contact Binance in paper mode and persists a safe no-op report', async () => {
    const { readFinanceStore, writeFinanceStore } = await import('./finance-store')
    const { reconcileTradingAccount } = await import('./trading-reconciliation')
    const client = { getAccount: vi.fn() }
    const db = readFinanceStore()
    db.settings.tradingMode = 'paper_trade'
    writeFinanceStore(db)

    const report = await reconcileTradingAccount(client as never)

    expect(report).toMatchObject({
      executionMode: 'paper',
      status: 'not_applicable',
      mismatches: [],
      detail: 'Paper mode has no exchange account to reconcile.',
    })
    expect(client.getAccount).not.toHaveBeenCalled()
    expect(readFinanceStore().settings.tradingAccountReconciliation).toMatchObject({
      status: 'not_applicable',
      executionMode: 'paper',
    })
  })
})
