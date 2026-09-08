import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  __resetHarpMemoryClient,
  getCachedCategoryPreferences,
  getUserFinanceMemoriesForPrompt,
  proposeCategoryPreference,
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
})
