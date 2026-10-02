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
 * The Personal Finance screen reads fields only the scoped payload carries
 * (`personalFinancePayload()` on the server). Mutation responses from
 * `POST /api/finance` are the unscoped trading payload (`financePayload()`),
 * which has no `currencyExposure`, `trends`, `baseCurrency`, ... — caching
 * one of those crashed the screen ("d is undefined").
 */
export function isPersonalFinancePayload(
  value: unknown,
): value is PersonalFinancePayload {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  return (
    typeof p.baseCurrency === 'string' &&
    typeof p.summary === 'object' &&
    p.summary !== null &&
    Array.isArray(p.currencyExposure) &&
    Array.isArray(p.trends) &&
    Array.isArray(p.budgetVsActual)
  )
}

/**
 * Returns a setter that writes a refreshed payload into the cache after a
 * successful mutation (panels pass it up via `onPayload`; a failed mutation
 * never calls it, so the last good payload stays). A response that is not the
 * personal-finance shape is never cached: the scoped query is refetched
 * instead, so the screen always renders a complete payload.
 */
export function useSetPersonalFinancePayload() {
  const queryClient = useQueryClient()
  return useCallback(
    (payload: unknown) => {
      if (isPersonalFinancePayload(payload)) {
        queryClient.setQueryData(personalFinanceKey, payload)
        return
      }
      void queryClient.invalidateQueries({ queryKey: personalFinanceKey })
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
