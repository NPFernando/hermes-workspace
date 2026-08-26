import { useCallback, useEffect, useRef, useState } from 'react'
import { useFinanceAction } from '../finance/hooks/use-finance-action'
import { StatCard } from '../finance/components/stat-card'
import { DataTable } from '../finance/components/data-table'

type PersonalFinancePayload = {
  ok: boolean
  summary: {
    netWorthLkr: number
    cashBalanceLkr: number
    netSavingsLkr: number
    savingsRate: number
    totalIncomeLkr: number
    totalExpensesLkr: number
    taxReserveLkr: number
    accountCount: number
  }
  budgetVsActual: Array<{
    category: string
    month: string
    currency: string
    budget: number
    actual: number
    variance: number
    percentUsed: number
    overBudget: boolean
  }>
  data: {
    finance_accounts: Array<Record<string, unknown>>
    income_records: Array<Record<string, unknown>>
    expense_records: Array<Record<string, unknown>>
    budget_categories: Array<Record<string, unknown>>
    savings_goals: Array<Record<string, unknown>>
    tax_records: Array<Record<string, unknown>>
  }
}

function formatLkr(value: number): string {
  return `LKR ${Math.round(value).toLocaleString('en-LK')}`
}

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`
}

function budgetTone(percentUsed: number): 'good' | 'warn' | 'danger' {
  if (percentUsed > 100) return 'danger'
  if (percentUsed >= 80) return 'warn'
  return 'good'
}

function BudgetPanel({
  payload,
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (p: PersonalFinancePayload) => void
}) {
  const currentMonth = new Date().toISOString().slice(0, 7)
  const { run: post, busy, error: err, setError: setErr } = useFinanceAction<PersonalFinancePayload>(onPayload)
  const [budgetMonth, setBudgetMonth] = useState(currentMonth)
  const [budgetCategory, setBudgetCategory] = useState('')
  const [budgetAmount, setBudgetAmount] = useState('')
  const [budgetCurrency, setBudgetCurrency] = useState('LKR')
  const [expenseDate, setExpenseDate] = useState(
    new Date().toISOString().slice(0, 10),
  )
  const [expenseVendor, setExpenseVendor] = useState('')
  const [expenseCategory, setExpenseCategory] = useState('')
  const [expenseAmount, setExpenseAmount] = useState('')
  const [expenseCurrency, setExpenseCurrency] = useState('LKR')

  async function submitBudget() {
    if (!budgetCategory.trim()) {
      setErr('Category is required')
      return
    }
    const data = await post(
      {
        action: 'add_record',
        kind: 'budget_category',
        payload: {
          month: budgetMonth,
          category: budgetCategory.trim(),
          currency: budgetCurrency,
          budgetAmount: Number(budgetAmount) || 0,
        },
      },
      'budget',
    )
    if (data) {
      setBudgetCategory('')
      setBudgetAmount('')
    }
  }

  async function submitExpense() {
    if (!expenseVendor.trim() || !expenseCategory.trim()) {
      setErr('Vendor and category are required')
      return
    }
    const data = await post(
      {
        action: 'add_record',
        kind: 'expense',
        payload: {
          date: expenseDate,
          vendor: expenseVendor.trim(),
          category: expenseCategory.trim(),
          currency: expenseCurrency,
          amount: Number(expenseAmount) || 0,
        },
      },
      'expense',
    )
    if (data) {
      setExpenseVendor('')
      setExpenseCategory('')
      setExpenseAmount('')
    }
  }

  const inputClass =
    'rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs text-[var(--theme-text)] outline-none'
  const buttonClass =
    'rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs font-medium text-[var(--theme-text)] hover:bg-black/20 disabled:opacity-40'

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Budget vs. actual spending</h2>
          <p className="text-xs text-[var(--theme-muted)]">
            Set a monthly budget per category, log expenses, and see how
            actual spending compares — updates instantly below. Enter budgets
            in LKR; actual spend is always compared in LKR-converted terms.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3">
          <h3 className="text-sm font-semibold">Add a budget</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              type="month"
              value={budgetMonth}
              onChange={(e) => setBudgetMonth(e.target.value)}
              className={inputClass}
            />
            <input
              type="text"
              placeholder="Category (e.g. Groceries)"
              value={budgetCategory}
              onChange={(e) => setBudgetCategory(e.target.value)}
              className={inputClass}
            />
            <input
              type="number"
              placeholder="Budget amount"
              value={budgetAmount}
              onChange={(e) => setBudgetAmount(e.target.value)}
              className={`${inputClass} w-32`}
            />
            <select
              value={budgetCurrency}
              onChange={(e) => setBudgetCurrency(e.target.value)}
              className={inputClass}
            >
              <option value="LKR">LKR</option>
              <option value="USD">USD</option>
              <option value="AUD">AUD</option>
            </select>
            <button
              type="button"
              disabled={busy === 'budget'}
              onClick={() => void submitBudget()}
              className={buttonClass}
            >
              {busy === 'budget' ? 'Saving...' : 'Add budget'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3">
          <h3 className="text-sm font-semibold">Log an expense</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              type="date"
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
              className={inputClass}
            />
            <input
              type="text"
              placeholder="Vendor"
              value={expenseVendor}
              onChange={(e) => setExpenseVendor(e.target.value)}
              className={inputClass}
            />
            <input
              type="text"
              placeholder="Category"
              value={expenseCategory}
              onChange={(e) => setExpenseCategory(e.target.value)}
              className={inputClass}
            />
            <input
              type="number"
              placeholder="Amount"
              value={expenseAmount}
              onChange={(e) => setExpenseAmount(e.target.value)}
              className={`${inputClass} w-28`}
            />
            <select
              value={expenseCurrency}
              onChange={(e) => setExpenseCurrency(e.target.value)}
              className={inputClass}
            >
              <option value="LKR">LKR</option>
              <option value="USD">USD</option>
              <option value="AUD">AUD</option>
            </select>
            <button
              type="button"
              disabled={busy === 'expense'}
              onClick={() => void submitExpense()}
              className={buttonClass}
            >
              {busy === 'expense' ? 'Saving...' : 'Log expense'}
            </button>
          </div>
        </div>
      </div>

      {err && <p className="mt-3 text-xs text-red-300">{err}</p>}

      <div className="mt-4">
        <h3 className="text-sm font-semibold">
          This month ({currentMonth})
        </h3>
        {payload.budgetVsActual.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--theme-muted)]">
            No budgets set for this month yet — add one above to see how
            actual spending compares.
          </p>
        ) : (
          <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {payload.budgetVsActual.map((row) => (
              <StatCard
                key={`${row.month}-${row.category}`}
                label={`${row.category} — ${Math.round(row.percentUsed)}% used`}
                value={`${formatLkr(row.actual)} / ${formatLkr(row.budget)}`}
                tone={budgetTone(row.percentUsed)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

type ExtractedTransaction = {
  kind: 'income' | 'expense'
  amount: number
  currency: string
  vendorOrSource: string
  date: string
  category?: string
  confidence: 'high' | 'medium' | 'low'
}

type PendingIngestion = {
  id: string
  status: 'awaiting_password' | 'awaiting_review' | 'confirmed' | 'rejected'
  source: 'gmail' | 'upload'
  passwordHint?: string
  extracted?: ExtractedTransaction
  rawPreviewImagePath?: string
  error?: string
}

const confidenceTone: Record<ExtractedTransaction['confidence'], string> = {
  high: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-100',
  medium: 'border-amber-400/30 bg-amber-500/15 text-amber-100',
  low: 'border-red-400/30 bg-red-500/15 text-red-100',
}

/**
 * AI-assisted intake: upload a receipt/bill photo or PDF, or sync Gmail —
 * every extracted item lands here for review and never touches real
 * income/expense records until the user confirms it.
 */
function PendingIngestionPanel({
  onConfirmed,
}: {
  onConfirmed: (payload: PersonalFinancePayload) => void
}) {
  const [items, setItems] = useState<Array<PendingIngestion>>([])
  const [uploading, setUploading] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({})
  const [editDrafts, setEditDrafts] = useState<Record<string, Partial<ExtractedTransaction>>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [gmailConnected, setGmailConnected] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const { run: confirm } = useFinanceAction<PersonalFinancePayload>(onConfirmed)

  useEffect(() => {
    fetch('/api/auth/gmail-connect?check=1', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { connected?: boolean }) => setGmailConnected(Boolean(data.connected)))
      .catch(() => {})
  }, [])

  async function syncGmail() {
    setSyncing(true)
    setNote(null)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'sync_gmail_now' }),
      })
      const data = (await res.json()) as {
        ok: boolean
        error?: string
        result?: { found: number; queued: number; skippedAlreadyQueued: number }
      }
      if (!data.ok) setNote(data.error || 'Gmail sync failed')
      else if (data.result) setNote(`Found ${data.result.found}, queued ${data.result.queued} for review.`)
      await load()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Gmail sync failed')
    } finally {
      setSyncing(false)
    }
  }

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'list_pending_ingestions' }),
      })
      const data = (await res.json()) as { ok: boolean; pendingIngestions?: Array<PendingIngestion> }
      if (data.ok) {
        setItems((data.pendingIngestions ?? []).filter((p) => p.status === 'awaiting_password' || p.status === 'awaiting_review'))
      }
    } catch {
      /* transient */
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function uploadFile(file: File) {
    setUploading(true)
    setNote(null)
    try {
      const form = new FormData()
      form.set('file', file)
      const res = await fetch('/api/finance-upload', { method: 'POST', body: form })
      const data = (await res.json()) as { ok: boolean; error?: string }
      if (!data.ok) setNote(data.error || 'Upload failed')
      await load()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function submitPassword(id: string) {
    const password = (passwordDrafts[id] ?? '').trim()
    if (!password) return
    setBusyId(id)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'submit_ingestion_password', id, password }),
      })
      const data = (await res.json()) as { ok: boolean; error?: string }
      if (!data.ok) setNote(data.error || 'Could not unlock document')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  async function reject(id: string) {
    setBusyId(id)
    try {
      await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'reject_pending_ingestion', id }),
      })
      await load()
    } finally {
      setBusyId(null)
    }
  }

  async function confirmItem(item: PendingIngestion) {
    const draft = { ...item.extracted, ...editDrafts[item.id] }
    if (!draft.kind || !Number.isFinite(draft.amount)) {
      setNote('Amount and type are required before confirming.')
      return
    }
    setBusyId(item.id)
    try {
      const data = await confirm(
        { action: 'confirm_pending_ingestion', id: item.id, payload: draft },
        `confirm-${item.id}`,
      )
      if (data) await load()
    } finally {
      setBusyId(null)
    }
  }

  function updateDraft(id: string, patch: Partial<ExtractedTransaction>) {
    setEditDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  const inputClass =
    'rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs text-[var(--theme-text)] outline-none'
  const buttonClass =
    'rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs font-medium text-[var(--theme-text)] hover:bg-black/20 disabled:opacity-40'

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">AI-assisted intake</h2>
          <p className="text-xs text-[var(--theme-muted)]">
            Upload a photo or document of a bill/receipt and AI extracts the details — nothing
            is added to your records until you review and confirm it below.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void uploadFile(file)
            }}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className={buttonClass}
          >
            {uploading ? 'Processing…' : 'Upload receipt / bill'}
          </button>
          {gmailConnected ? (
            <button type="button" disabled={syncing} onClick={() => void syncGmail()} className={buttonClass}>
              {syncing ? 'Syncing…' : 'Sync Gmail now'}
            </button>
          ) : (
            <a href="/api/auth/gmail-connect" className={buttonClass}>
              Connect Gmail
            </a>
          )}
        </div>
      </div>

      {note && <p className="mt-2 text-xs text-red-300">{note}</p>}

      {items.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--theme-muted)]">
          Nothing pending — upload a receipt or bill to try it.
        </p>
      ) : (
        <div className="mt-4 grid gap-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-start gap-3 rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3"
            >
              {item.rawPreviewImagePath && (
                <img
                  src={`/api/finance-upload?id=${item.id}`}
                  alt="Document preview"
                  className="h-24 w-24 rounded-xl border border-[var(--theme-border)]/60 object-cover"
                />
              )}

              <div className="min-w-[220px] flex-1">
                <div className="flex items-center gap-2 text-xs text-[var(--theme-muted)]">
                  <span className="uppercase tracking-wide">{item.source}</span>
                  <span>·</span>
                  <span>{item.status.replace('_', ' ')}</span>
                </div>

                {item.status === 'awaiting_password' && (
                  <div className="mt-2">
                    {item.passwordHint && (
                      <p className="text-xs text-[var(--theme-muted)]">Hint: {item.passwordHint}</p>
                    )}
                    {item.error && <p className="mt-1 text-xs text-red-300">{item.error}</p>}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <input
                        type="password"
                        placeholder="Document password"
                        value={passwordDrafts[item.id] ?? ''}
                        onChange={(e) => setPasswordDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                        className={inputClass}
                      />
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => void submitPassword(item.id)}
                        className={buttonClass}
                      >
                        Unlock
                      </button>
                    </div>
                  </div>
                )}

                {item.status === 'awaiting_review' && (
                  <div className="mt-2">
                    {item.error && !item.extracted && (
                      <p className="text-xs text-amber-200">
                        Automatic extraction failed ({item.error}) — enter the details manually below.
                      </p>
                    )}
                    {item.extracted && (
                      <span
                        className={`mb-2 inline-block rounded-lg border px-2 py-0.5 text-[10px] uppercase tracking-wide ${confidenceTone[item.extracted.confidence]}`}
                      >
                        {item.extracted.confidence} confidence
                      </span>
                    )}
                    <div className="mt-1 flex flex-wrap gap-2">
                      <select
                        value={(editDrafts[item.id] ?? {}).kind ?? item.extracted?.kind ?? 'expense'}
                        onChange={(e) => updateDraft(item.id, { kind: e.target.value as 'income' | 'expense' })}
                        className={inputClass}
                      >
                        <option value="expense">Expense</option>
                        <option value="income">Income</option>
                      </select>
                      <input
                        type="number"
                        placeholder="Amount"
                        defaultValue={item.extracted?.amount}
                        onChange={(e) => updateDraft(item.id, { amount: Number(e.target.value) })}
                        className={`${inputClass} w-28`}
                      />
                      <input
                        type="text"
                        placeholder="Currency"
                        defaultValue={item.extracted?.currency ?? 'LKR'}
                        onChange={(e) => updateDraft(item.id, { currency: e.target.value })}
                        className={`${inputClass} w-20`}
                      />
                      <input
                        type="text"
                        placeholder="Vendor / source"
                        defaultValue={item.extracted?.vendorOrSource}
                        onChange={(e) => updateDraft(item.id, { vendorOrSource: e.target.value })}
                        className={inputClass}
                      />
                      <input
                        type="date"
                        defaultValue={item.extracted?.date}
                        onChange={(e) => updateDraft(item.id, { date: e.target.value })}
                        className={inputClass}
                      />
                      <input
                        type="text"
                        placeholder="Category"
                        defaultValue={item.extracted?.category}
                        onChange={(e) => updateDraft(item.id, { category: e.target.value })}
                        className={inputClass}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                {item.status === 'awaiting_review' && (
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => void confirmItem(item)}
                    className="rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-50"
                  >
                    Confirm
                  </button>
                )}
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => void reject(item.id)}
                  className="rounded-xl border border-red-400/30 bg-red-500/15 px-4 py-2 text-sm font-medium text-red-100 hover:bg-red-500/25 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export function PersonalFinanceScreen() {
  const [payload, setPayload] = useState<PersonalFinancePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const response = await fetch('/api/finance', { cache: 'no-store' })
        if (!response.ok)
          throw new Error(`Finance API returned HTTP ${response.status}`)
        const data = (await response.json()) as PersonalFinancePayload
        if (!cancelled) {
          setPayload(data)
          setError(null)
        }
      } catch (nextError) {
        if (!cancelled)
          setError(
            nextError instanceof Error
              ? nextError.message
              : 'Finance API failed',
          )
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <main className="min-h-dvh bg-[var(--theme-bg)] p-6 text-[var(--theme-muted)]">
        Loading Personal Finance section…
      </main>
    )
  }

  if (error || !payload) {
    return (
      <main className="min-h-dvh bg-[var(--theme-bg)] p-6 text-red-200">
        <h1 className="text-2xl font-semibold">Personal finance unavailable</h1>
        <p className="mt-2 text-sm">{error ?? 'No payload returned.'}</p>
      </main>
    )
  }

  const { summary } = payload

  return (
    <main className="min-h-dvh overflow-y-auto bg-[var(--theme-bg)] px-4 py-5 text-[var(--theme-text)] md:px-8 md:py-8">
      <section className="rounded-[2rem] border border-[var(--theme-border)] bg-gradient-to-br from-[var(--theme-panel)] via-[var(--theme-panel)] to-emerald-950/20 p-6 shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200/80">
          DollarWise-style personal finance
        </p>
        <h1 className="mt-2 text-3xl font-semibold md:text-4xl">
          Money clarity, without trading controls
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--theme-muted)]">
          Track accounts, spending, budgets, savings goals, and tax records —
          separate from the automated trading workspace.
        </p>
      </section>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Net worth" value={formatLkr(summary.netWorthLkr)} />
        <StatCard label="Cash balance" value={formatLkr(summary.cashBalanceLkr)} />
        <StatCard label="Net savings" value={formatLkr(summary.netSavingsLkr)} tone={summary.netSavingsLkr >= 0 ? 'good' : 'danger'} />
        <StatCard label="Savings rate" value={formatPct(summary.savingsRate)} tone={summary.savingsRate >= 20 ? 'good' : 'warn'} />
        <StatCard label="Total income" value={formatLkr(summary.totalIncomeLkr)} tone="good" />
        <StatCard label="Total expenses" value={formatLkr(summary.totalExpensesLkr)} tone={summary.totalExpensesLkr > summary.totalIncomeLkr && summary.totalIncomeLkr > 0 ? 'danger' : 'neutral'} />
        <StatCard label="Tax reserve" value={formatLkr(summary.taxReserveLkr)} />
        <StatCard label="Tracked accounts" value={String(summary.accountCount)} />
      </section>

      <PendingIngestionPanel onConfirmed={setPayload} />

      <BudgetPanel payload={payload} onPayload={setPayload} />

      <section className="mt-6 grid gap-4">
        <DataTable title="Accounts" rows={payload.data.finance_accounts} columns={['name', 'type', 'currency', 'balance', 'platform']} />
        <DataTable title="Income records" rows={payload.data.income_records} columns={['dateReceived', 'sourceName', 'incomeType', 'originalCurrency', 'originalAmount', 'convertedLkrAmount', 'taxable']} />
        <DataTable title="Expense records" rows={payload.data.expense_records} columns={['date', 'vendor', 'category', 'currency', 'amount', 'convertedLkrAmount', 'recurring']} />
        <DataTable title="Budget categories" rows={payload.data.budget_categories} columns={['month', 'category', 'currency', 'budgetAmount']} />
        <DataTable title="Savings goals" rows={payload.data.savings_goals} columns={['name', 'targetAmount', 'currentAmount', 'currency', 'targetDate', 'status']} />
        <DataTable title="Tax records" rows={payload.data.tax_records} columns={['taxYear', 'incomeType', 'convertedLkrAmount', 'taxPaid', 'taxDue', 'requiresConfirmation']} />
      </section>

      <p className="mt-6 rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4 text-sm text-amber-100">
        Tax figures are estimates; confirm them against official sources before filing.
      </p>
    </main>
  )
}
