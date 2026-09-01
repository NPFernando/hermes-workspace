import { useState } from 'react'

const inputClass =
  'flex-1 rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs text-[var(--theme-text)] outline-none'
const buttonClass =
  'rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs font-medium text-[var(--theme-text)] hover:bg-black/20 disabled:opacity-40'

/**
 * Phase 24 (AI-200/201): a same-origin, authenticated-user-only question/
 * answer exchange over the user's own finance data — no persistence, no
 * autonomous agent, ephemeral client-side state only. See the
 * ask_finance_question action (routes/api/finance.ts) for the bounded
 * context/LLM-call side of this.
 */
export function FinanceAnalystCard() {
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
      const data = (await res.json()) as { ok: boolean; answer?: string; error?: string }
      if (data.ok && data.answer) setAnswer(data.answer)
      else setError(data.error || 'Could not answer that question')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not answer that question')
    } finally {
      setAsking(false)
    }
  }

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
    </section>
  )
}
