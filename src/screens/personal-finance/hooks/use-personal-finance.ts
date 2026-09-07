import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import {
  fetchPendingIngestionCount,
  fetchPersonalFinancePayload,
  pendingIngestionCountKey,
  personalFinanceKey,
} from '../personal-finance-queries'
import type { PersonalFinancePayload } from '../types'

/**
 * The Personal Finance payload as a React Query cache entry. `staleTime` +
 * `refetchOnWindowFocus` replace the old fetch-once-on-mount behaviour, so
 * returning to the tab after external engine activity (ingestion, trading,
 * cron digests) shows fresh numbers without a manual reload.
 */
export function usePersonalFinance() {
  return useQuery({
    queryKey: personalFinanceKey,
    queryFn: fetchPersonalFinancePayload,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })
}

/**
 * Returns a setter that writes a full payload into the cache. Every mutating
 * panel already receives the whole refreshed payload back from
 * `POST /api/finance` and passed it up via `onPayload`; that callback is now
 * this setter, so a successful mutation updates the cache with zero extra
 * fetches, and a failed one (which never calls `onPayload`) leaves the last
 * good payload in place.
 */
export function useSetPersonalFinancePayload() {
  const queryClient = useQueryClient()
  return useCallback(
    (payload: PersonalFinancePayload) => {
      queryClient.setQueryData(personalFinanceKey, payload)
    },
    [queryClient],
  )
}

/** Badge count for the Ingestion tab; polled, same 30s cadence as before. */
export function usePendingIngestionCount(): number {
  const { data } = useQuery({
    queryKey: pendingIngestionCountKey,
    queryFn: fetchPendingIngestionCount,
    refetchInterval: 30_000,
    staleTime: 20_000,
  })
  return data ?? 0
}
