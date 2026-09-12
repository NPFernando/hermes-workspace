// @vitest-environment jsdom
import React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('recharts', () => {
  const passthrough = (props: { children?: React.ReactNode }) => props.children
  return {
    CartesianGrid: () => null,
    Legend: () => null,
    Line: () => null,
    LineChart: passthrough,
    ResponsiveContainer: passthrough,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
  }
})

import type { PersonalFinancePayload } from '../types'
import { CsvImportPanel } from './csv-import-panel'
import { FxGainLossCard } from './fx-gain-loss-card'
import { GmailConnectionCard } from './gmail-connection-card'
import { NetWorthHistoryCard } from './net-worth-history-card'
import { SavingsGoalsPanel } from './savings-goals-panel'

const payload = {
  ok: true,
  checkedAt: Date.now(),
  baseCurrency: 'LKR',
  fxToBase: 1,
  netWorthHistory: [
    { date: '2026-07-01', netWorthBase: 100_000, cashBase: 100_000, investmentsBase: 0, debtBase: 0 },
    { date: '2026-08-01', netWorthBase: 110_000, cashBase: 110_000, investmentsBase: 0, debtBase: 0 },
  ],
  netWorthForecast: {
    hasData: true,
    currentNetWorthBase: 110_000,
    monthlyDeltaBase: 5_000,
    monthsOfHistoryUsed: 3,
    points: [{ month: '2026-09', projectedNetWorthBase: 115_000 }],
    accountBreakdown: [{
      accountId: 'checking',
      accountName: 'Everyday checking',
      type: 'bank',
      currentBalanceBase: 100_000,
      projectedBalanceBase: 115_000,
    }],
  },
  fxGainLoss: {
    entries: [{
      id: 'holding-1',
      symbol: 'ABC',
      currency: 'USD',
      quantity: 2,
      assetGainLkr: 1_000,
      fxGainLkr: 500,
      totalReturnLkr: 1_500,
      insufficientHistory: false,
    }],
    totalAssetGainLkr: 1_000,
    totalFxGainLkr: 500,
    totalReturnLkr: 1_500,
    excludedCount: 0,
  },
  data: {
    finance_accounts: [{ id: 'checking', name: 'Everyday checking' }],
    savings_goals: [{
      id: 'emergency-fund',
      name: 'Emergency fund',
      targetAmount: 50_000,
      currentAmount: 10_000,
      monthlyContribution: 10_000,
      currency: 'LKR',
      targetDate: '',
      priority: 1,
      status: 'active',
      goalKind: 'general',
    }],
    stock_holdings: [{
      id: 'holding-1',
      symbol: 'ABC',
      currency: 'USD',
      quantity: 2,
      buyPrice: 40,
      lastKnownPrice: 45,
    }],
    exchange_rates: [{ base: 'USD', target: 'LKR', rate: 300, date: '2026-08-01' }],
  },
} as unknown as PersonalFinancePayload

function response(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 })
}

describe('personal finance dashboard journey', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
    document.body.replaceChildren()
  })

  it('shows forecasts and freshness, then holds a possible CSV duplicate for explicit review', async () => {
    const postBodies: Array<Record<string, unknown>> = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('gmail-connect')) {
        return response({
          enabled: true,
          connected: true,
          email: 'finance@example.test',
          connectedAt: null,
          lastSyncedAtSeconds: Math.floor(Date.now() / 1_000),
          syncHistory: [],
          lastError: null,
        })
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      postBodies.push(body)
      if (body.force === true) {
        return response({ ok: true, created: 1, skippedDuplicates: 0, errors: [] })
      }
      return response({
        ok: true,
        created: 0,
        skippedDuplicates: 0,
        possibleDuplicates: [{
          index: 0,
          match: {
            id: 'existing-cafe-nero',
            vendorOrSource: 'Cafe Nero',
            date: '2026-08-01',
            amount: 1_500,
            confidence: 'possible',
          },
        }],
        errors: [],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const reactEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean
    }
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    await act(async () => {
      root.render(
        <>
          <NetWorthHistoryCard payload={payload} />
          <SavingsGoalsPanel payload={payload} onPayload={() => {}} />
          <FxGainLossCard payload={payload} />
          <GmailConnectionCard />
          <CsvImportPanel payload={payload} onPayload={() => {}} />
        </>,
      )
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(container.textContent).toContain('Where the projected growth lands')
    expect(container.textContent).toContain('Emergency fund')
    expect(container.textContent).toContain('about 4 months')
    expect(container.textContent).toContain('FX rate-move scenario')
    expect(container.textContent).toContain('Fresh')
    expect(container.textContent).toContain('Everyday checking')

    const breakdown = [...container.querySelectorAll('button')].find((button) => button.textContent === 'breakdown')
    expect(breakdown).toBeDefined()
    await act(async () => breakdown?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.textContent).not.toContain('Where the projected growth lands')

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    const csv = new File(
      ['Date,Amount,Vendor\n2026-08-01,-1500,Cafe Nreo\n'],
      'review.csv',
      { type: 'text/csv' },
    )
    Object.defineProperty(csv, 'text', {
      value: async () => 'Date,Amount,Vendor\n2026-08-01,-1500,Cafe Nreo\n',
    })
    await act(async () => {
      Object.defineProperty(fileInput, 'files', { configurable: true, value: [csv] })
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(container.textContent).toContain('1 row(s) found')

    const importButton = [...container.querySelectorAll('button')].find((button) => button.textContent?.startsWith('Import 1 row'))
    expect(importButton).toBeDefined()
    await act(async () => importButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(container.textContent).toContain('held for review')
    expect(container.textContent).toContain('Cafe Nero')
    expect(postBodies).toHaveLength(1)
    expect(postBodies[0].force).toBeUndefined()

    const reviewedImport = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('reviewed row(s) anyway'))
    expect(reviewedImport).toBeDefined()
    await act(async () => reviewedImport?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(postBodies).toHaveLength(2)
    expect(postBodies[1].force).toBe(true)
    expect(container.textContent).toContain('1 record(s) created')
    expect(container.textContent).not.toContain('held for review')

    await act(async () => root.unmount())
    container.remove()
  })
})
