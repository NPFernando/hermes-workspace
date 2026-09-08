import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  __resetHarpMemoryClient,
  approveMemory,
  flagFinanceMemory,
  getCachedCategoryPreferences,
  getUserFinanceMemoriesForPrompt,
  isHarpMemoryEnabled,
  listActiveFinanceMemories,
  listPendingFinanceCandidates,
  proposeCategoryPreference,
  proposeFinancialRule,
  rejectMemory,
} from './harp-memory-client'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
  delete process.env.HARP_MEMORY_API_TOKEN
  delete process.env.HARP_MEMORY_API_URL
  __resetHarpMemoryClient()
})

describe('harp-memory-client — disabled (no token)', () => {
  it('proposeCategoryPreference is a no-op and never calls fetch', async () => {
    const spy = vi.fn()
    globalThis.fetch = spy as unknown as typeof fetch
    await proposeCategoryPreference({ vendor: 'Keells', category: 'Groceries' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('getCachedCategoryPreferences returns {} and does not call fetch', () => {
    const spy = vi.fn()
    globalThis.fetch = spy as unknown as typeof fetch
    expect(getCachedCategoryPreferences()).toEqual({})
    expect(spy).not.toHaveBeenCalled()
  })

  it('getUserFinanceMemoriesForPrompt returns [] without calling fetch', async () => {
    const spy = vi.fn()
    globalThis.fetch = spy as unknown as typeof fetch
    expect(await getUserFinanceMemoriesForPrompt('am I overspending?')).toEqual(
      [],
    )
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('harp-memory-client — enabled', () => {
  beforeEach(() => {
    process.env.HARP_MEMORY_API_TOKEN = 'test-token'
    process.env.HARP_MEMORY_API_URL = 'http://harp.test'
    __resetHarpMemoryClient()
  })

  it('proposeCategoryPreference POSTs a confidential user-scoped candidate', async () => {
    const spy = vi.fn(async () => new Response('{"accepted":true}', { status: 200 }))
    globalThis.fetch = spy as unknown as typeof fetch

    await proposeCategoryPreference({ vendor: '  Keells  ', category: ' Groceries ' })

    expect(spy).toHaveBeenCalledTimes(1)
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://harp.test/api/propose')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-token')
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({
      scope: 'user',
      data_class: 'confidential',
      memory_type: 'category_rule',
      metadata: { vendor: 'keells', category: 'Groceries' },
    })
    expect(body.content).toContain('"Keells"')
  })

  it('getCachedCategoryPreferences returns {} on the first (async) call, then the mapped rules', async () => {
    const payload = {
      results: [
        { id: '1', metadata: { vendor: 'keells', category: 'Groceries' } },
        { id: '2', content: 'Categorize finance transactions from "uber" as "Transport".' },
      ],
    }
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), { status: 200 })) as unknown as typeof fetch

    expect(getCachedCategoryPreferences()).toEqual({}) // kicks off the refresh
    await vi.waitFor(() => {
      expect(getCachedCategoryPreferences()).toEqual({
        keells: 'Groceries',
        uber: 'Transport',
      })
    })
  })

  it('a failing search leaves the cache empty (never throws)', async () => {
    globalThis.fetch = (async () =>
      new Response('nope', { status: 503 })) as unknown as typeof fetch
    getCachedCategoryPreferences()
    await new Promise((r) => setTimeout(r, 10))
    expect(getCachedCategoryPreferences()).toEqual({})
  })

  it('getUserFinanceMemoriesForPrompt filters category rules and truncates', async () => {
    const payload = {
      results: [
        { id: '1', content: 'I consider dining out discretionary spending.' },
        {
          id: '2',
          memory_type: 'category_rule',
          content: 'Categorize finance transactions from "keells" as "Groceries".',
        },
        { id: '3', content: 'Categorize finance transactions from "uber" as "Transport".' },
        { id: '4', content: 'x'.repeat(500) },
      ],
    }
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), { status: 200 })) as unknown as typeof fetch

    const mems = await getUserFinanceMemoriesForPrompt('am I overspending?')
    expect(mems).toEqual([
      'I consider dining out discretionary spending.',
      `${'x'.repeat(240)}…`,
    ])
  })

  it('isHarpMemoryEnabled reflects the token', () => {
    expect(isHarpMemoryEnabled()).toBe(true)
    delete process.env.HARP_MEMORY_API_TOKEN
    __resetHarpMemoryClient()
    expect(isHarpMemoryEnabled()).toBe(false)
  })

  it('listActiveFinanceMemories classifies each entry', async () => {
    const payload = {
      results: [
        { id: 'a', memory_type: 'category_rule', content: 'Categorize finance transactions from "keells" as "Groceries".' },
        { id: 'b', memory_type: 'financial_rule', content: 'Keep 6 months of expenses in cash.' },
        { id: 'c', content: 'I prefer conservative estimates.' },
        { id: '', content: 'dropped — no id' },
      ],
    }
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), { status: 200 })) as unknown as typeof fetch

    expect(await listActiveFinanceMemories()).toEqual([
      { id: 'a', content: 'Categorize finance transactions from "keells" as "Groceries".', kind: 'category_rule' },
      { id: 'b', content: 'Keep 6 months of expenses in cash.', kind: 'financial_rule' },
      { id: 'c', content: 'I prefer conservative estimates.', kind: 'other' },
    ])
  })

  it('proposeFinancialRule POSTs a financial_rule candidate; flagFinanceMemory POSTs feedback', async () => {
    const spy = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      return new Response(
        JSON.stringify(body.memory_id ? { ok: true } : { accepted: true }),
        { status: 200 },
      )
    })
    globalThis.fetch = spy as unknown as typeof fetch

    expect(await proposeFinancialRule('  Keep 6 months in cash  ')).toEqual({ submitted: true })
    await flagFinanceMemory('m-9')

    const bodies = spy.mock.calls.map(
      (c) => JSON.parse((c[1] as RequestInit).body as string) as Record<string, unknown>,
    )
    expect(bodies[0]).toMatchObject({ memory_type: 'financial_rule', scope: 'user', data_class: 'confidential' })
    expect(bodies[1]).toMatchObject({ memory_id: 'm-9', useful: false, user_corrected: true })
  })

  it('proposeFinancialRule ignores an empty rule', async () => {
    const spy = vi.fn()
    globalThis.fetch = spy as unknown as typeof fetch
    expect(await proposeFinancialRule('   ')).toEqual({ submitted: false })
    expect(spy).not.toHaveBeenCalled()
  })

  it('listPendingFinanceCandidates keeps only rule candidates', async () => {
    const payload = {
      candidates: [
        { memory_id: 'p1', memory_type: 'financial_rule', content: 'Keep 6 months in cash.', created_at: '2026-09-08T00:00:00Z' },
        { memory_id: 'p2', memory_type: 'category_rule', content: 'Categorize finance transactions from "keells" as "Groceries".' },
        { memory_id: 'p3', memory_type: 'temporary_context', content: 'unrelated repo candidate' },
        { memory_id: '', content: 'no id' },
      ],
    }
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), { status: 200 })) as unknown as typeof fetch

    expect(await listPendingFinanceCandidates()).toEqual([
      { id: 'p1', content: 'Keep 6 months in cash.', kind: 'financial_rule', createdAt: '2026-09-08T00:00:00Z' },
      { id: 'p2', content: 'Categorize finance transactions from "keells" as "Groceries".', kind: 'category_rule', createdAt: null },
    ])
  })

  it('approveMemory / rejectMemory POST reviewer=naveen and read review_status', async () => {
    const spy = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      return new Response(
        JSON.stringify({ review_status: _url.endsWith('approve') ? 'approved' : 'rejected', got: body }),
        { status: 200 },
      )
    })
    globalThis.fetch = spy as unknown as typeof fetch

    expect(await approveMemory('p1')).toEqual({ ok: true })
    expect(await rejectMemory('p2')).toEqual({ ok: true })
    const bodies = spy.mock.calls.map(
      (c) => JSON.parse((c[1] as RequestInit).body as string) as Record<string, unknown>,
    )
    expect(bodies[0]).toEqual({ memory_id: 'p1', reviewer: 'naveen' })
    expect(bodies[1]).toEqual({ memory_id: 'p2', reviewer: 'naveen' })
  })
})
