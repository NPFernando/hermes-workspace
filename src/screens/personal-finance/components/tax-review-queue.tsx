import { useMemo, useState } from 'react'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { formatMoney } from '../utils'
import { buttonClass, inputClass, warningTone } from '../shared-styles'
import { numberField, stringField } from '../field-helpers'
import type { PersonalFinancePayload } from '../types'

export function TaxReviewQueue({
  payload,
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (payload: PersonalFinancePayload) => void
}) {
  const [search, setSearch] = useState('')
  const { run: post, busy, error } = useFinanceAction<PersonalFinancePayload>(onPayload)
  const pending = useMemo(() => {
    const query = search.trim().toLowerCase()
    return payload.data.tax_records.filter((record) => {
      if (record.requiresConfirmation !== true) return false
      if (!query) return true
      return ['taxYear', 'incomeType', 'deductionCategory', 'supportingDocument']
        .map((key) => stringField(record, key).toLowerCase())
        .some((value) => value.includes(query))
    })
  }, [payload.data.tax_records, search])

  async function markReviewed(record: Record<string, unknown>) {
    const id = stringField(record, 'id')
    if (!id) return
    await post(
      {
        action: 'update_record',
        kind: 'tax',
        id,
        payload: { requiresConfirmation: false },
      },
      `tax-review-${id}`,
    )
  }

  return (
    <section className="mb-5 rounded-3xl border border-[color-mix(in_srgb,var(--theme-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_8%,transparent)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Tax review queue</h2>
          <p className="text-xs text-[var(--theme-muted)]">
            Review estimated figures before filing. Mark a record reviewed only
            after checking the supporting source.
          </p>
        </div>
        <span className={`rounded-xl border px-3 py-1.5 text-xs font-medium ${warningTone}`}>
          {pending.length} awaiting review
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search year, income, deduction…"
          aria-label="Search tax review queue"
          className={`${inputClass} min-w-[240px] flex-1`}
        />
        <a
          href="/api/finance?scope=personal_finance&format=tax-csv"
          download
          className={buttonClass}
        >
          Export tax CSV
        </a>
      </div>
      {error && <p className="mt-2 text-xs text-[var(--theme-danger)]">{error}</p>}
      {pending.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--theme-muted)]">
          {search ? 'No review items match this search.' : 'No tax records are awaiting review.'}
        </p>
      ) : (
        <div className="mt-3 grid gap-2">
          {pending.map((record, index) => {
            const id = stringField(record, 'id') || String(index)
            const currency = stringField(record, 'currency') || 'LKR'
            return (
              <div
                key={id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--theme-border)]/70 bg-[var(--theme-panel)]/60 p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {stringField(record, 'taxYear') || 'Unknown year'} ·{' '}
                    {stringField(record, 'incomeType') || 'Income'}
                  </p>
                  <p className="text-xs text-[var(--theme-muted)]">
                    Taxable {formatMoney(numberField(record, 'estimatedTaxableAmount'), currency)} · due{' '}
                    {formatMoney(numberField(record, 'taxDue'), currency)}
                    {stringField(record, 'deductionCategory')
                      ? ` · ${stringField(record, 'deductionCategory')}`
                      : ''}
                  </p>
                </div>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy === `tax-review-${id}`}
                  onClick={() => void markReviewed(record)}
                >
                  {busy === `tax-review-${id}` ? 'Saving…' : 'Mark reviewed'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

/** DOC-108: link official tax returns, certificates, or statements to a tax record. */
export function TaxDocumentsPanel({
  payload,
}: {
  payload: PersonalFinancePayload
}) {
  const [attachingId, setAttachingId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function attachDocument(id: string, file: File | undefined) {
    if (!file) return
    setAttachingId(id)
    setMessage(null)
    try {
      const form = new FormData()
      form.set('file', file)
      form.set('documentType', 'tax_document')
      form.set('taxRecordId', id)
      const response = await fetch('/api/finance-upload', { method: 'POST', body: form })
      const data = (await response.json()) as { ok?: boolean; error?: string }
      if (!response.ok || !data.ok) {
        setMessage(data.error || 'Could not attach tax document')
        return
      }
      setMessage('Tax document linked securely.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not attach tax document')
    } finally {
      setAttachingId(null)
    }
  }

  return (
    <section className="mb-5 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Tax documents</h2>
          <p className="text-xs text-[var(--theme-muted)]">
            Keep official tax statements and certificates linked to the record they support.
          </p>
        </div>
        {message && <p className="text-xs text-[var(--theme-muted)]">{message}</p>}
      </div>
      {payload.data.tax_records.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--theme-muted)]">Add a tax record before attaching a document.</p>
      ) : (
        <div className="mt-3 grid gap-2">
          {payload.data.tax_records.map((record) => {
            const id = stringField(record, 'id')
            if (!id) return null
            const hasDocument = Boolean(stringField(record, 'documentRef'))
            return (
              <div key={id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--theme-border)]/70 p-3">
                <div>
                  <p className="text-sm font-medium">
                    {stringField(record, 'taxYear') || 'Unknown year'} · {stringField(record, 'incomeType') || 'Income'}
                  </p>
                  <p className="text-xs text-[var(--theme-muted)]">
                    {hasDocument ? 'A supporting document is linked in the vault.' : 'No supporting document linked yet.'}
                  </p>
                </div>
                <label className={`${buttonClass} cursor-pointer`}>
                  {attachingId === id ? 'Linking…' : hasDocument ? 'Replace document' : 'Attach document'}
                  <input
                    type="file"
                    accept="application/pdf,image/*"
                    className="sr-only"
                    disabled={attachingId !== null}
                    onChange={(event) => {
                      void attachDocument(id, event.target.files?.[0])
                      event.currentTarget.value = ''
                    }}
                  />
                </label>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
