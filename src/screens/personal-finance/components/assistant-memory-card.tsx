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

/** Pull vendor + category out of a `Categorize … from "X" as "Y".` rule. */
function parseCategoryRule(
  content: string,
): { vendor: string; category: string } | null {
  const m = content.match(/from "([^"]+)" as "([^"]+)"/i)
  return m ? { vendor: m[1], category: m[2] } : null
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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editCategory, setEditCategory] = useState('')
  const setCategoryRule = useMutation({
    mutationFn: (v: { vendor: string; category: string; replacesId: string }) =>
      post('set_category_rule', v),
    onSuccess: () => {
      setEditingId(null)
      setEditCategory('')
      invalidate()
    },
  })
  const review = useMutation({
    mutationFn: (v: { memoryId: string; approve: boolean }) =>
      post(
        v.approve ? 'approve_finance_memory' : 'reject_finance_memory',
        { memoryId: v.memoryId },
      ),
    onSuccess: invalidate,
  })

  if (memoriesQuery.isPending) return null

  const data = memoriesQuery.data
  const harpUnavailable = memoriesQuery.isError || !data?.harpEnabled
  const memories = data?.memories ?? []
  const pending = data?.pending ?? []

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

          {pending.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-[var(--theme-warning)]">
                Pending your review ({pending.length})
              </p>
              <ul className="mt-1.5 space-y-1.5">
                {pending.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-start justify-between gap-3 rounded-xl border border-[color-mix(in_srgb,var(--theme-warning)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_8%,transparent)] px-3 py-2 text-xs text-[var(--theme-text)]"
                  >
                    <span>
                      <span className="text-[var(--theme-muted)]">
                        {KIND_LABEL[p.kind]}:
                      </span>{' '}
                      {p.content}
                    </span>
                    <span className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        className="text-[var(--theme-success)] hover:underline disabled:opacity-40"
                        disabled={review.isPending}
                        onClick={() =>
                          review.mutate({ memoryId: p.id, approve: true })
                        }
                      >
                        approve
                      </button>
                      <button
                        type="button"
                        className="text-[var(--theme-danger)] hover:underline disabled:opacity-40"
                        disabled={review.isPending}
                        onClick={() =>
                          review.mutate({ memoryId: p.id, approve: false })
                        }
                      >
                        reject
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {memories.length === 0 ? (
            <p className="mt-3 text-xs text-[var(--theme-muted)]">
              No approved rules yet.
            </p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {memories.map((m) => {
                const parsed =
                  m.kind === 'category_rule' ? parseCategoryRule(m.content) : null
                const isEditing = editingId === m.id
                return (
                  <li
                    key={m.id}
                    className="rounded-xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_6%,transparent)] px-3 py-2 text-xs text-[var(--theme-text)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span>
                        <span className="text-[var(--theme-muted)]">
                          {KIND_LABEL[m.kind]}:
                        </span>{' '}
                        {m.content}
                      </span>
                      <span className="flex shrink-0 gap-2">
                        {parsed && (
                          <button
                            type="button"
                            className="text-[var(--theme-muted)] hover:text-[var(--theme-text)] disabled:opacity-40"
                            onClick={() => {
                              setEditingId(isEditing ? null : m.id)
                              setEditCategory(parsed.category)
                            }}
                          >
                            {isEditing ? 'cancel' : 'edit'}
                          </button>
                        )}
                        <button
                          type="button"
                          className="text-[var(--theme-muted)] hover:text-[var(--theme-danger)] disabled:opacity-40"
                          disabled={flag.isPending}
                          title="This rule is wrong / no longer wanted"
                          onClick={() => flag.mutate(m.id)}
                        >
                          not right
                        </button>
                      </span>
                    </div>
                    {isEditing && parsed && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-[var(--theme-muted)]">
                          {parsed.vendor} →
                        </span>
                        <input
                          value={editCategory}
                          onChange={(e) => setEditCategory(e.target.value)}
                          className={wideInputClass}
                          placeholder="new category"
                          onKeyDown={(e) => {
                            if (
                              e.key === 'Enter' &&
                              editCategory.trim() &&
                              editCategory.trim() !== parsed.category &&
                              !setCategoryRule.isPending
                            ) {
                              setCategoryRule.mutate({
                                vendor: parsed.vendor,
                                category: editCategory.trim(),
                                replacesId: m.id,
                              })
                            }
                          }}
                        />
                        <button
                          type="button"
                          className={buttonClass}
                          disabled={
                            !editCategory.trim() ||
                            editCategory.trim() === parsed.category ||
                            setCategoryRule.isPending
                          }
                          onClick={() =>
                            setCategoryRule.mutate({
                              vendor: parsed.vendor,
                              category: editCategory.trim(),
                              replacesId: m.id,
                            })
                          }
                        >
                          {setCategoryRule.isPending ? 'Sending…' : 'Save for review'}
                        </button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
