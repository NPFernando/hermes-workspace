// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'

// react-query imports React through CJS and hits the ESM/CJS dual-instance trap
// in this jsdom setup (see -assistant-memory-card.test.tsx). Fake useQuery with
// the test's React instance, re-running queryFn whenever the queryKey changes.
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({
    queryKey,
    queryFn,
  }: {
    queryKey: Array<unknown>
    queryFn: () => Promise<unknown>
  }) => {
    const [state, setState] = React.useState<{
      data?: unknown
      error?: unknown
    }>({})
    const key = JSON.stringify(queryKey)
    React.useEffect(() => {
      let live = true
      queryFn().then(
        (data) => live && setState({ data }),
        (error: unknown) => live && setState({ error }),
      )
      return () => {
        live = false
      }
    }, [key])
    return {
      data: state.data,
      error: state.error ?? null,
      isLoading: state.data === undefined && state.error === undefined,
    }
  },
}))

import { HarpRouteOutcomesPanel } from './harp-route-outcomes-panel'

const STATS = {
  ok: true,
  window_days: 30,
  outcomes: 7,
  min_samples: 5,
  demote_below: 0.5,
  classifier: { agreed: 3, corrected: 1, accuracy: 0.75 },
  routes: [
    {
      task_family: 'debugging',
      provider: 'openrouter',
      model: 'weak/model',
      n: 6,
      success: 1,
      failure: 5,
      escalated: 0,
      success_rate: 0.25,
      demoted: true,
      observed: 0,
      agents: [],
    },
    {
      task_family: 'code_review',
      provider: 'openai-codex',
      model: 'gpt-5.5',
      n: 1,
      success: 1,
      failure: 0,
      escalated: 0,
      success_rate: 0.667,
      demoted: false,
      observed: 1,
      agents: ['CASSIA', 'VESTA'],
    },
  ],
}

async function render(fetchImpl: typeof fetch) {
  vi.stubGlobal('fetch', vi.fn(fetchImpl))
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await React.act(async () => {
    root.render(<HarpRouteOutcomesPanel />)
  })
  const settle = async () => {
    for (let i = 0; i < 5; i += 1) {
      await React.act(async () => {
        await new Promise((r) => setTimeout(r, 0))
      })
    }
  }
  await settle()
  return {
    container,
    settle,
    cleanup: async () => {
      await React.act(async () => root.unmount())
      container.remove()
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('HarpRouteOutcomesPanel', () => {
  it('shows summary stats and flags demoted routes', async () => {
    const view = await render(async () => Response.json(STATS))
    const text = view.container.textContent
    expect(text).toContain('Route Outcomes')
    expect(text).toContain('7')
    expect(text).toContain('75%')
    expect(text).toContain('openrouter/weak/model')
    expect(text).toContain('demoted')
    expect(text).toContain('25%')
    expect(text).toContain('1 observed')
    expect(text).toContain('CASSIA')
    expect(text).toContain('VESTA')
    await view.cleanup()
  })

  it('refetches with the selected window', async () => {
    const view = await render(async () => Response.json(STATS))
    const button = Array.from(view.container.querySelectorAll('button')).find(
      (b) => b.textContent === '7d',
    )
    await React.act(async () => button?.click())
    await view.settle()
    const urls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]))
    expect(urls).toContain('/api/harp-route-stats?days=30')
    expect(urls).toContain('/api/harp-route-stats?days=7')
    await view.cleanup()
  })

  it('explains how to report outcomes when there are none, and surfaces errors', async () => {
    const empty = await render(async () =>
      Response.json({ ...STATS, outcomes: 0, routes: [] }),
    )
    expect(empty.container.textContent).toContain('No outcomes reported yet')
    await empty.cleanup()
    const covered = await render(async () =>
      Response.json({
        ...STATS,
        outcomes: 0,
        routes: [],
        coverage: {
          plans: 29,
          reported: 0,
          rate: 0,
          by_host: [{ host: 'paperclip', plans: 29, reported: 0 }],
          by_agent: [{ agent: 'MINERVA', plans: 5, reported: 1 }],
        },
      }),
    )
    expect(covered.container.textContent).toContain('0 of 29 plans reported')
    expect(covered.container.textContent).toContain('paperclip 0/29')
    expect(covered.container.textContent).toContain('Coverage by agent')
    expect(covered.container.textContent).toContain('MINERVA1/5')
    await covered.cleanup()
    const failing = await render(async () =>
      Response.json(
        { ok: false, error: 'HARP route stats are unavailable' },
        { status: 503 },
      ),
    )
    expect(failing.container.textContent).toContain(
      'HARP route stats are unavailable',
    )
    await failing.cleanup()
  })
})
