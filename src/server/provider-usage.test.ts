import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  classifyUsageMeasure,
  fetchOpenAIUsage,
  fetchOpenRouterUsage,
} from './provider-usage'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('provider usage provenance', () => {
  it('classifies quota, spend, usage, and balances distinctly', () => {
    expect(
      classifyUsageMeasure('claude', { type: 'progress', label: 'Weekly' }),
    ).toBe('quota')
    expect(
      classifyUsageMeasure('openrouter', {
        type: 'text',
        label: 'Monthly key spend',
      }),
    ).toBe('spend')
    expect(
      classifyUsageMeasure('openai', { type: 'text', label: 'Input (30d)' }),
    ).toBe('usage')
    expect(
      classifyUsageMeasure('codex', { type: 'text', label: 'Credits balance' }),
    ).toBe('balance')
  })

  it('reads OpenRouter spend and period counters from the documented current-key endpoint', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-only-key')
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              usage: 25.5,
              usage_daily: 2.5,
              usage_weekly: 8,
              usage_monthly: 20,
              limit: 100,
              limit_remaining: 74.5,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchOpenRouterUsage()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/key',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-only-key' },
      }),
    )
    expect(result.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'All-time key spend',
          used: 25.5,
          limit: 100,
          measure: 'spend',
        }),
        expect.objectContaining({
          label: 'Daily key spend',
          value: '$2.50',
          measure: 'spend',
        }),
        expect.objectContaining({
          label: 'Monthly key spend',
          value: '$20.00',
          measure: 'spend',
        }),
      ]),
    )
  })

  it('collects every OpenAI usage page before reporting a 30-day token total', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only-admin-key')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { results: [{ input_tokens: 10_000, output_tokens: 20_000 }] },
            ],
            has_more: true,
            next_page: 'cursor-2',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { results: [{ input_tokens: 2_000, output_tokens: 5_000 }] },
            ],
            has_more: false,
            next_page: null,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchOpenAIUsage()
    expect(result.status).toBe('ok')
    expect(result.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Input (30d)',
          value: '0.01M tokens',
          measure: 'usage',
        }),
        expect.objectContaining({
          label: 'Output (30d)',
          value: '0.03M tokens',
          measure: 'usage',
        }),
      ]),
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondUrl = new URL(String(fetchMock.mock.calls[1][0]))
    expect(secondUrl.searchParams.get('page')).toBe('cursor-2')
    expect(secondUrl.searchParams.get('limit')).toBe('31')
    expect(
      result.lines.every((line) =>
        line.label.toLowerCase().includes('billing'),
      ),
    ).toBe(false)
  })

  it('refuses to present incomplete OpenAI pagination as a full 30-day total', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only-admin-key')
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [], has_more: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )

    const result = await fetchOpenAIUsage()
    expect(result.status).toBe('error')
    expect(result.message).toContain('pagination was incomplete')
    expect(result.lines).toEqual([])
  })
})
