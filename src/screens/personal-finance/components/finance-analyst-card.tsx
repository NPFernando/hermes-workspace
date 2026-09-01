import { useState } from 'react'
import type { PersonalFinancePayload } from '../types'

const inputClass =
  'flex-1 rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs text-[var(--theme-text)] outline-none'
const buttonClass =
  'rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs font-medium text-[var(--theme-text)] hover:bg-black/20 disabled:opacity-40'

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/**
 * Phase 24 (AI-200/201/202): a same-origin, authenticated-user-only question/
 * answer exchange over the user's own finance data. AI-202 adds a capped
 * (last 10, showing the last 5) recent-questions list stored in
 * FinanceSettings.financeQaHistory — see the ask_finance_question action
 * (routes/api/finance.ts) for the bounded context/LLM-call/history side.
 */
export function FinanceAnalystCard({
  payload,
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (payload: PersonalFinancePayload) => void
}) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)

  async function ask() {
    if (!question.trim()) return
    setAsking(true)
    setError(null)
    setAnswer(null)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'ask_finance_question', question: question.trim() }),
      })
      const data = (await res.json()) as PersonalFinancePayload & { answer?: string; error?: string }
      if (data.ok && data.answer) {
        setAnswer(data.answer)
        onPayload(data)
      } else {
        setError(data.error || 'Could not answer that question')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not answer that question')
    } finally {
      setAsking(false)
    }
  }

  const recentHistory = [...payload.financeQaHistory].reverse().slice(0, 5)

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold text-[var(--theme-text)]">Ask about your finances</h2>
      <p className="mt-1 text-xs text-[var(--theme-muted)]">
        Ask a question about your spending, income, or net worth — answered from your own already-loaded data.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="e.g. How much did I spend this month?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void ask()
          }}
          className={inputClass}
        />
        <button type="button" disabled={asking} onClick={() => void ask()} className={buttonClass}>
          {asking ? 'Asking…' : 'Ask'}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
      {answer && <p className="mt-2 text-sm text-[var(--theme-text)]">{answer}</p>}

      {recentHistory.length > 0 && (
        <div className="mt-4 border-t border-[var(--theme-border)]/60 pt-3">
          <p className="text-[10px] uppercase tracking-wide text-[var(--theme-muted)]">Previous questions</p>
          <div className="mt-2 grid gap-2">
            {recentHistory.map((entry) => (
              <div key={entry.at}>
                <p className="text-xs font-medium text-[var(--theme-text)]">{entry.question}</p>
                <p className="text-xs text-[var(--theme-muted)]">{truncate(entry.answer, 160)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
