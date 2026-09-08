import { afterEach, describe, expect, it, vi } from 'vitest'

import { getHeadroomStats } from './headroom-client'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  delete process.env.HEADROOM_STATS_URL
})

const STATS = {
  summary: {
    api_requests: 13,
    compression: {
      requests_compressed: 2,
      avg_compression_pct: 28.9,
      best_compression_pct: 53.6,
      total_tokens_removed: 8454,
      total_tokens_before: 89244,
      total_tokens_saved_all_layers: 8454,
    },
    cost: { total_saved_usd: 1.25, savings_pct: 12.5 },
  },
  agent_usage: {
    agents: [
      {
        label: 'OpenAI',
        agent: 'openai',
        requests: 13,
        tokens_saved: 8454,
        savings_percent: 10.49,
        models: {
          'passthrough:models': 6,
          'nvidia/nemotron-3-super-120b-a12b:free': 6,
          'nvidia/nemotron-3-ultra-550b-a55b:free': 1,
        },
      },
    ],
  },
}

describe('getHeadroomStats', () => {
  it('projects the /stats payload into the panel shape', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(STATS), { status: 200 })) as typeof fetch

    const s = await getHeadroomStats()
    expect(s).toEqual({
      running: true,
      apiRequests: 13,
      requestsCompressed: 2,
      avgCompressionPct: 28.9,
      bestCompressionPct: 53.6,
      tokensSaved: 8454,
      tokensBefore: 89244,
      costSavedUsd: 1.25,
      savingsPct: 12.5,
      agents: [
        {
          label: 'OpenAI',
          requests: 13,
          tokensSaved: 8454,
          savingsPercent: 10.49,
          topModels: [
            { model: 'passthrough:models', requests: 6 },
            { model: 'nvidia/nemotron-3-super-120b-a12b:free', requests: 6 },
            { model: 'nvidia/nemotron-3-ultra-550b-a55b:free', requests: 1 },
          ],
        },
      ],
    })
  })

  it('returns null when the proxy is unreachable', async () => {
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED')
    }) as typeof fetch
    expect(await getHeadroomStats()).toBeNull()
  })

  it('returns null on a non-2xx response', async () => {
    globalThis.fetch = (async () =>
      new Response('nope', { status: 503 })) as typeof fetch
    expect(await getHeadroomStats()).toBeNull()
  })

  it('coerces missing/garbage numeric fields to 0 without throwing', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ summary: {} }), {
        status: 200,
      })) as typeof fetch
    const s = await getHeadroomStats()
    expect(s).toMatchObject({
      running: true,
      apiRequests: 0,
      tokensSaved: 0,
      avgCompressionPct: 0,
      agents: [],
    })
  })
})
