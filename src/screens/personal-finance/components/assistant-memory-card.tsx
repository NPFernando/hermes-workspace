import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  assistantMemoryKey,
  fetchAssistantMemories,
} from '../personal-finance-queries'
import { buttonClass, wideInputClass } from '../shared-styles'
import type { AssistantMemory } from '../personal-finance-queries'

/**
 * "What the assistant knows" — the approved HARP memories scoped to this
 * user's finances: vendor→category rules learned from ingestion corrections,
 * and free-text financial rules the user has added. Everything is governed:
 * an added rule is a review-queue candidate (not shown here until approved),
 * and "not right" records a correction signal. Degrades quietly when HARP
 * memory is disabled or unreachable.
 */
const KIND_LABEL: Record<AssistantMemory['kind'], string> = {
  category_rule: 'Category rule',
  financial_rule: 'Financial rule',
  other: 'Preference',
}

async function post(action: string, extra: Record<string, unknown>) {
  const res = await fetch('/api/finance', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...extra }),
  })
  const data = (await res.json()) as { ok?: boolean; error?: string }
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${res.status}`)
  }
  return data
}

export function AssistantMemoryCard() {
  const queryClient = useQueryClient()
  const memoriesQuery = useQuery({
    queryKey: assistantMemoryKey,
    queryFn: fetchAssistantMemories,
    staleTime: 60_000,
  })
  const [rule, setRule] = useState('')

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: assistantMemoryKey })

  const addRule = useMutation({
    mutationFn: (text: string) => post('add_financial_rule', { rule: text }),
    onSuccess: () => {
      setRule('')
      invalidate()
    },
  })
  const flag = useMutation({
    mutationFn: (memoryId: string) =>
      post('flag_finance_memory', { memoryId }),
    onSuccess: invalidate,
  })

  if (memoriesQuery.isPending) return null

  const data = memoriesQuery.data
  const harpUnavailable = memoriesQuery.isError || !data?.harpEnabled
  const memories = data?.memories ?? []

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold text-[var(--theme-text)]">
        What the assistant knows
      </h2>
      <p className="text-xs text-[var(--theme-muted)]">
        Rules and preferences the assistant uses when categorising transactions
        and answering finance questions. Adding a rule sends it for review; it
        appears here once approved.
      </p>

      {harpUnavailable ? (
        <p className="mt-3 text-xs text-[var(--theme-muted)]">
          Assistant memory is unavailable right now — the rest of the dashboard
          is unaffected.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={rule}
              onChange={(e) => setRule(e.target.value)}
              placeholder='Add a rule, e.g. "keep 6 months of expenses in cash"'
              className={wideInputClass}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && rule.trim() && !addRule.isPending) {
                  addRule.mutate(rule.trim())
                }
              }}
            />
            <button
              type="button"
              className={buttonClass}
              disabled={!rule.trim() || addRule.isPending}
              onClick={() => addRule.mutate(rule.trim())}
            >
              {addRule.isPending ? 'Sending…' : 'Add rule'}
            </button>
          </div>
          {addRule.isSuccess && (
            <p className="mt-2 text-xs text-[var(--theme-success)]">
              Sent for review.
            </p>
          )}
          {addRule.isError && (
            <p className="mt-2 text-xs text-[var(--theme-danger)]">
              Couldn’t add the rule — try again.
            </p>
          )}

          {memories.length === 0 ? (
            <p className="mt-3 text-xs text-[var(--theme-muted)]">
              No approved rules yet.
            </p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {memories.map((m) => (
                <li
                  key={m.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_6%,transparent)] px-3 py-2 text-xs text-[var(--theme-text)]"
                >
                  <span>
                    <span className="text-[var(--theme-muted)]">
                      {KIND_LABEL[m.kind]}:
                    </span>{' '}
                    {m.content}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-[var(--theme-muted)] hover:text-[var(--theme-danger)] disabled:opacity-40"
                    disabled={flag.isPending}
                    title="This rule is wrong / no longer wanted"
                    onClick={() => flag.mutate(m.id)}
                  >
                    not right
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
