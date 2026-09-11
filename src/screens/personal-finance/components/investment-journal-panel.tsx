import { useState } from 'react'
import { ConfirmDialog } from '../../../components/confirm-dialog'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { formatDateOnly } from '../utils'
import { buttonClass, dangerButtonClass, inputClass } from '../shared-styles'
import { stringField } from '../field-helpers'
import type { PersonalFinancePayload } from '../types'

type JournalEntryType = 'thesis' | 'review' | 'buy' | 'sell' | 'note'

export type InvestmentThesisHealth = {
  key: string
  symbol: string
  status: 'no_thesis' | 'healthy' | 'needs_review' | 'overdue'
  thesisDate?: string
  reviewDate?: string
  nextReviewDate?: string
  whyBought?: string
}

function journalDate(entry: Record<string, unknown>, field: string): string {
  return stringField(entry, field)
}

/** CSE-210/CSE-211: summarize only explicit journal evidence; never infer a trade. */
export function buildInvestmentThesisHealth(
  entries: Array<Record<string, unknown>>,
  asOf = new Date().toISOString().slice(0, 10),
): Array<InvestmentThesisHealth> {
  const groups = new Map<string, Array<Record<string, unknown>>>()
  for (const entry of entries) {
    const key = stringField(entry, 'stockHoldingId') || `portfolio:${stringField(entry, 'symbol') || 'Portfolio'}`
    groups.set(key, [...(groups.get(key) ?? []), entry])
  }

  return Array.from(groups.entries()).map(([key, group]) => {
    const ordered = [...group].sort((a, b) => journalDate(b, 'entryDate').localeCompare(journalDate(a, 'entryDate')))
    const thesisEntry = ordered.find(
      (entry) => stringField(entry, 'entryType') === 'thesis' || Boolean(stringField(entry, 'thesis')),
    )
    const reviewEntry = ordered.find((entry) => stringField(entry, 'entryType') === 'review')
    const buyEntry = ordered.find((entry) => stringField(entry, 'entryType') === 'buy')
    const thesisDate = thesisEntry ? journalDate(thesisEntry, 'entryDate') : undefined
    const reviewDate = reviewEntry ? journalDate(reviewEntry, 'entryDate') : undefined
    const nextReviewDate = ordered.find((entry) => journalDate(entry, 'nextReviewDate'))
      ? journalDate(ordered.find((entry) => journalDate(entry, 'nextReviewDate'))!, 'nextReviewDate')
      : undefined
    const whyBought = buyEntry
      ? journalDate(buyEntry, 'content')
      : thesisEntry
        ? journalDate(thesisEntry, 'thesis') || journalDate(thesisEntry, 'content')
        : undefined
    const status: InvestmentThesisHealth['status'] = !thesisEntry
      ? 'no_thesis'
      : nextReviewDate && nextReviewDate <= asOf
        ? 'overdue'
        : reviewDate && reviewDate >= (thesisDate ?? '')
          ? 'healthy'
          : 'needs_review'

    return {
      key,
      symbol: stringField(ordered[0], 'symbol') || 'Portfolio',
      status,
      thesisDate,
      reviewDate,
      nextReviewDate,
      whyBought,
    }
  })
}

const entryTypeLabels: Record<JournalEntryType, string> = {
  thesis: 'Investment thesis',
  review: 'Review',
  buy: 'Buy decision',
  sell: 'Sell decision',
  note: 'Note',
}

export function InvestmentJournalPanel({
  payload,
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (p: PersonalFinancePayload) => void
}) {
  const { run: post, busy, error, setError } =
    useFinanceAction<PersonalFinancePayload>(onPayload)
  const [stockHoldingId, setStockHoldingId] = useState('')
  const [entryDate, setEntryDate] = useState(
    new Date().toISOString().slice(0, 10),
  )
  const [entryType, setEntryType] = useState<JournalEntryType>('note')
  const [content, setContent] = useState('')
  const [thesis, setThesis] = useState('')
  const [invalidationCondition, setInvalidationCondition] = useState('')
  const [nextReviewDate, setNextReviewDate] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const holdings = payload.data.stock_holdings
  const entries = [...payload.data.investment_journal].sort((a, b) =>
    stringField(b, 'entryDate').localeCompare(stringField(a, 'entryDate')),
  )
  const thesisHealth = buildInvestmentThesisHealth(entries)

  async function addEntry() {
    if (!content.trim()) {
      setError('Journal content is required')
      return
    }
    const holding = holdings.find(
      (item) => stringField(item, 'id') === stockHoldingId,
    )
    const data = await post(
      {
        action: 'add_record',
        kind: 'investment_journal',
        payload: {
          stockHoldingId: stockHoldingId || undefined,
          symbol: holding ? stringField(holding, 'symbol') : 'Portfolio',
          entryDate,
          entryType,
          content: content.trim(),
          thesis: thesis.trim() || undefined,
          invalidationCondition: invalidationCondition.trim() || undefined,
          nextReviewDate: nextReviewDate || undefined,
        },
      },
      'investment-journal',
    )
    if (data) {
      setContent('')
      setThesis('')
      setInvalidationCondition('')
      setNextReviewDate('')
    }
  }

  async function deleteEntry(id: string) {
    const data = await post(
      {
        action: 'delete_record',
        kind: 'investment_journal',
        id,
        confirm: true,
      },
      `delete-journal-${id}`,
    )
    if (data) setConfirmDeleteId(null)
  }

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold">Investment journal</h2>
      <p className="text-xs text-[var(--theme-muted)]">
        Record why you bought, what changed, and when to review. Entries are
        informational only and never place trades.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <select
          value={stockHoldingId}
          onChange={(event) => setStockHoldingId(event.target.value)}
          className={inputClass}
          aria-label="Journal holding"
        >
          <option value="">Whole portfolio</option>
          {holdings.map((holding) => (
            <option key={stringField(holding, 'id')} value={stringField(holding, 'id')}>
              {stringField(holding, 'symbol') || 'Unnamed holding'}
            </option>
          ))}
        </select>
        <select
          value={entryType}
          onChange={(event) => setEntryType(event.target.value as JournalEntryType)}
          className={inputClass}
          aria-label="Journal entry type"
        >
          {Object.entries(entryTypeLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <input
          type="date"
          value={entryDate}
          onChange={(event) => setEntryDate(event.target.value)}
          className={inputClass}
          aria-label="Journal entry date"
        />
        <input
          type="date"
          value={nextReviewDate}
          onChange={(event) => setNextReviewDate(event.target.value)}
          className={inputClass}
          title="Optional next review date"
          aria-label="Next review date"
        />
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="What is the reasoning, evidence, or change?"
          className={`${inputClass} min-h-10 min-w-64 flex-1`}
          rows={1}
        />
        <textarea
          value={thesis}
          onChange={(event) => setThesis(event.target.value)}
          placeholder="Thesis (optional)"
          title="The belief or evidence supporting the position"
          className={`${inputClass} min-h-10 min-w-64 flex-1`}
          rows={1}
        />
        <textarea
          value={invalidationCondition}
          onChange={(event) => setInvalidationCondition(event.target.value)}
          placeholder="What would invalidate it? (optional)"
          title="Evidence that would make the thesis no longer valid"
          className={`${inputClass} min-h-10 min-w-64 flex-1`}
          rows={1}
        />
        <button
          type="button"
          disabled={busy === 'investment-journal'}
          onClick={() => void addEntry()}
          className={buttonClass}
        >
          {busy === 'investment-journal' ? 'Saving…' : 'Add journal entry'}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-[var(--theme-danger)]">{error}</p>}
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {thesisHealth.map((item) => {
          const label =
            item.status === 'healthy'
              ? 'Reviewed'
              : item.status === 'overdue'
                ? 'Review overdue'
                : item.status === 'needs_review'
                  ? 'Needs review'
                  : 'No thesis recorded'
          const tone = item.status === 'healthy'
            ? 'text-[var(--theme-success)]'
            : item.status === 'no_thesis'
              ? 'text-[var(--theme-muted)]'
              : 'text-[var(--theme-warning)]'
          return (
            <div key={item.key} className="rounded-2xl border border-[var(--theme-border)]/70 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{item.symbol}</p>
                <span className={`text-xs ${tone}`}>{label}</span>
              </div>
              {item.whyBought && (
                <p className="mt-1 line-clamp-2 text-xs text-[var(--theme-muted)]">
                  Why I bought: {item.whyBought}
                </p>
              )}
              {item.nextReviewDate && (
                <p className="mt-1 text-[11px] text-[var(--theme-muted)]">
                  Next review: {formatDateOnly(item.nextReviewDate)}
                </p>
              )}
            </div>
          )
        })}
      </div>
      <div className="mt-4 grid gap-2">
        {entries.length === 0 && (
          <p className="text-sm text-[var(--theme-muted)]">No journal entries yet.</p>
        )}
        {entries.slice(0, 30).map((entry) => {
          const id = stringField(entry, 'id')
          const holdingId = stringField(entry, 'stockHoldingId')
          const holding = holdings.find((item) => stringField(item, 'id') === holdingId)
          const symbol = holding ? stringField(holding, 'symbol') : stringField(entry, 'symbol')
          const type = stringField(entry, 'entryType') as JournalEntryType
          return (
            <div
              key={id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">
                  {entryTypeLabels[type]} · {symbol || 'Portfolio'} ·{' '}
                  {formatDateOnly(stringField(entry, 'entryDate'))}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--theme-text)]">
                  {stringField(entry, 'content')}
                </p>
                {stringField(entry, 'thesis') && (
                  <p className="mt-1 whitespace-pre-wrap text-xs text-[var(--theme-muted)]">
                    Thesis: {stringField(entry, 'thesis')}
                  </p>
                )}
                {stringField(entry, 'invalidationCondition') && (
                  <p className="mt-1 whitespace-pre-wrap text-xs text-[var(--theme-warning)]">
                    Invalidation: {stringField(entry, 'invalidationCondition')}
                  </p>
                )}
                {stringField(entry, 'nextReviewDate') && (
                  <p className="mt-1 text-[11px] text-[var(--theme-muted)]">
                    Review on {formatDateOnly(stringField(entry, 'nextReviewDate'))}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setConfirmDeleteId(id)}
                className={dangerButtonClass}
              >
                Delete
              </button>
            </div>
          )
        })}
      </div>
      {confirmDeleteId && (
        <ConfirmDialog
          title="Delete this journal entry?"
          body="This cannot be undone."
          confirmLabel="Delete"
          busy={busy === `delete-journal-${confirmDeleteId}`}
          onConfirm={() => void deleteEntry(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </section>
  )
}
