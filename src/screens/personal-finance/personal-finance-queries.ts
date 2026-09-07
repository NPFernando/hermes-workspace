import type { PersonalFinancePayload } from './types'

/**
 * React Query keys + fetchers for the Personal Finance screen.
 *
 * The screen and its panels previously hand-rolled `fetch` + `useState` +
 * `useEffect` and threaded a single `payload` object down through ~20 panels
 * via an `onPayload` prop. The payload is now a React Query cache entry
 * (`personalFinanceKey`); mutations still return the full refreshed payload,
 * which callers write straight back with `queryClient.setQueryData` (see
 * `useSetPersonalFinancePayload`), so there is no extra round-trip.
 */
export const personalFinanceKey = ['finance', 'personal'] as const
// Sibling of personalFinanceKey, NOT a child — React Query matches
// invalidations by key prefix, so a future
// invalidateQueries({ queryKey: personalFinanceKey }) must not also blow away
// the pending-count poll.
export const pendingIngestionCountKey = [
  'finance',
  'personal-pending-count',
] as const

export async function fetchPersonalFinancePayload(): Promise<PersonalFinancePayload> {
  const response = await fetch('/api/finance?scope=personal_finance', {
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`Finance API returned HTTP ${response.status}`)
  }
  return (await response.json()) as PersonalFinancePayload
}

export async function fetchPendingIngestionCount(): Promise<number> {
  const res = await fetch('/api/finance', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'list_pending_ingestions' }),
  })
  const data = (await res.json()) as {
    ok?: boolean
    pendingIngestions?: Array<{ status: string }>
  }
  if (!data.ok) return 0
  return (data.pendingIngestions ?? []).filter(
    (p) => p.status === 'awaiting_review' || p.status === 'awaiting_password',
  ).length
}
