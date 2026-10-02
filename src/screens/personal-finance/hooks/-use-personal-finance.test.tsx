// @vitest-environment jsdom
/**
 * useSetPersonalFinancePayload must never cache the unscoped trading payload
 * that POST /api/finance mutations return — it lacks currencyExposure etc.
 * and crashed the screen ("can't access property length, d is undefined").
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { personalFinanceKey } from '../personal-finance-queries'
import {
  isPersonalFinancePayload,
  useSetPersonalFinancePayload,
} from './use-personal-finance'

const personal = {
  ok: true,
  baseCurrency: 'LKR',
  summary: { netWorthBase: 1 },
  currencyExposure: [],
  trends: [],
  budgetVsActual: [],
}
const trading = {
  ok: true,
  summary: { netWorthBase: 1 },
  budgetVsActual: [],
  tradingPerformance: {},
}

describe('isPersonalFinancePayload', () => {
  it('accepts the scoped payload and rejects the trading payload', () => {
    expect(isPersonalFinancePayload(personal)).toBe(true)
    expect(isPersonalFinancePayload(trading)).toBe(false)
    expect(isPersonalFinancePayload(null)).toBe(false)
    expect(isPersonalFinancePayload({ ...personal, summary: null })).toBe(false)
  })
})

describe('useSetPersonalFinancePayload', () => {
  function setup() {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    let setter: (p: unknown) => void = () => {}
    function Probe() {
      setter = useSetPersonalFinancePayload()
      return null
    }
    const root = createRoot(document.createElement('div'))
    React.act(() => {
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      )
    })
    return { client, invalidate, set: (p: unknown) => setter(p), root }
  }

  it('caches a personal-finance payload', () => {
    const { client, invalidate, set, root } = setup()
    set(personal)
    expect(client.getQueryData(personalFinanceKey)).toEqual(personal)
    expect(invalidate).not.toHaveBeenCalled()
    React.act(() => root.unmount())
  })

  it('refetches instead of caching a non personal-finance payload', () => {
    const { client, invalidate, set, root } = setup()
    client.setQueryData(personalFinanceKey, personal)
    set(trading)
    expect(client.getQueryData(personalFinanceKey)).toEqual(personal)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: personalFinanceKey })
    React.act(() => root.unmount())
  })
})
