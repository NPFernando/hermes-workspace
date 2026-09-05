import { useState } from 'react'

type FinanceActionResponse = { ok?: boolean; error?: string } & Record<
  string,
  unknown
>

/**
 * Shared busy/error + `POST /api/finance` + refresh-parent-payload pattern.
 * Extracted from 6 near-identical hand-rolled copies in finance-screen.tsx
 * (StrategyOverridePanel, SignalSettingsPanel, TradingControls,
 * DecisionQualityPanel, SelfImprovementPanel, BudgetPanel). Generic over the
 * response shape so it doesn't need to import finance-screen.tsx's local
 * FinancePayload type back.
 */
export function useFinanceAction<T extends FinanceActionResponse>(
  onPayload: (payload: T) => void,
) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  /**
   * Resolves to the response data on success, or `undefined` on failure
   * (with `error` set) — never rejects. Every call site in the original 6
   * hand-rolled copies was fire-and-forget (`void post(...)`); matching
   * that here avoids turning those into unhandled promise rejections.
   */
  async function run(
    body: Record<string, unknown>,
    busyKey = 'default',
  ): Promise<T | undefined> {
    setBusy(busyKey)
    setError(null)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as T
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      onPayload(data)
      return data
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : 'Request failed',
      )
      return undefined
    } finally {
      setBusy(null)
    }
  }

  return { run, busy, isBusy: busy !== null, error, setError }
}
