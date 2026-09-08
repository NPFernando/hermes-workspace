// @vitest-environment jsdom
/**
 * AssistantMemoryCard — the "What the assistant knows" panel.
 * Covers: quiet unavailable state, the pending-review approve action wiring,
 * and the category-rule inline edit toggle.
 *
 * React.act + createRoot (not @testing-library/react) to dodge the vitest
 * ESM/CJS dual-React issue, matching -marketplace-install-confirmation.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'

const state = vi.hoisted(() => ({
  memories: {
    harpEnabled: true,
    memories: [] as Array<Record<string, unknown>>,
    pending: [] as Array<Record<string, unknown>>,
  },
}))

// react-query's provider/hooks import React through CJS and hit the ESM/CJS
// dual-instance trap in this jsdom setup. Fake the three hooks the card uses
// with the same React instance as the test — enough to drive its render paths.
vi.mock('@tanstack/react-query', () => {
  const useQuery = ({ queryFn }: { queryFn: () => Promise<unknown> }) => {
    const [data, setData] = React.useState<unknown>(undefined)
    React.useEffect(() => {
      let live = true
      void queryFn().then((v) => live && setData(v))
      return () => {
        live = false
      }
    }, [])
    return { data, isPending: data === undefined, isError: false }
  }
  const useMutation = ({
    mutationFn,
    onSuccess,
  }: {
    mutationFn: (v: unknown) => Promise<unknown>
    onSuccess?: () => void
  }) => {
    const [st, setSt] = React.useState<'idle' | 'pending' | 'success' | 'error'>(
      'idle',
    )
    return {
      mutate: (v: unknown) => {
        setSt('pending')
        void mutationFn(v).then(
          () => {
            setSt('success')
            onSuccess?.()
          },
          () => setSt('error'),
        )
      },
      isPending: st === 'pending',
      isError: st === 'error',
      isSuccess: st === 'success',
    }
  }
  return {
    useQuery,
    useMutation,
    useQueryClient: () => ({ invalidateQueries: () => undefined }),
  }
})

vi.mock('../personal-finance-queries', () => ({
  assistantMemoryKey: ['finance', 'assistant-memory'],
  fetchAssistantMemories: () => Promise.resolve(state.memories),
}))
vi.mock('../shared-styles', () => ({
  buttonClass: 'btn',
  wideInputClass: 'input',
}))

// eslint-disable-next-line import/first
import { AssistantMemoryCard } from './assistant-memory-card'

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  state.memories = { harpEnabled: true, memories: [], pending: [] }
  fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

async function render() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await React.act(async () => {
    root.render(React.createElement(AssistantMemoryCard))
  })
  // let the (already-resolved) query flush into the tree
  await React.act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  return {
    container,
    unmount: async () => {
      await React.act(async () => root.unmount())
      document.body.removeChild(container)
    },
  }
}

describe('AssistantMemoryCard', () => {
  it('shows a quiet unavailable message and no input when HARP is off', async () => {
    state.memories = { harpEnabled: false, memories: [], pending: [] }
    const { container, unmount } = await render()
    expect(container.textContent).toContain('Assistant memory is unavailable')
    expect(container.querySelector('input')).toBeNull()
    await unmount()
  })

  it('renders pending candidates and POSTs approve_finance_memory on approve', async () => {
    state.memories = {
      harpEnabled: true,
      memories: [],
      pending: [
        {
          id: 'cand-1',
          content: 'Keep 6 months of expenses in cash',
          kind: 'financial_rule',
          createdAt: null,
        },
      ],
    }
    const { container, unmount } = await render()
    expect(container.textContent).toContain('Pending your review (1)')

    const approve = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'approve',
    )
    expect(approve).toBeTruthy()
    await React.act(async () => {
      approve!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/finance')
    expect(JSON.parse(init.body as string)).toEqual({
      action: 'approve_finance_memory',
      memoryId: 'cand-1',
    })
    await unmount()
  })

  it('reveals the category input when "edit" is clicked on a category rule', async () => {
    state.memories = {
      harpEnabled: true,
      memories: [
        {
          id: 'm-1',
          content: 'Categorize finance transactions from "Keells" as "Groceries".',
          kind: 'category_rule',
        },
      ],
      pending: [],
    }
    const { container, unmount } = await render()
    // Only the "Add a rule" input is present before editing.
    expect(container.querySelectorAll('input')).toHaveLength(1)

    const edit = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'edit',
    )
    expect(edit).toBeTruthy()
    await React.act(async () => {
      edit!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    const inputs = [...container.querySelectorAll('input')] as HTMLInputElement[]
    expect(inputs).toHaveLength(2)
    // the edit input is seeded with the rule's current category
    expect(inputs.some((i) => i.value === 'Groceries')).toBe(true)
    await unmount()
  })
})
