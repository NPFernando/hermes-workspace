import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { PersonalFinancePayload } from '../types'

const inputClass =
  'flex-1 rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs text-[var(--theme-text)] outline-none'
const buttonClass =
  'rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs font-medium text-[var(--theme-text)] hover:bg-black/20 disabled:opacity-40'

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function formatNumber(v: number): string {
  return v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)
}

type AnalystChart = { title: string; data: Array<{ label: string; value: number }> }

/**
 * Phase 24 (AI-200/201/202/203/204): a same-origin, authenticated-user-only
 * question/answer exchange over the user's own finance data. AI-202 adds a
 * capped (last 10, showing the last 5) recent-questions list stored in
 * FinanceSettings.financeQaHistory. AI-204 adds in-session-only conversation
 * memory (`turns`, separate from that persisted list) so follow-up questions
 * carry context. AI-203 lets the live answer optionally include a chart
 * (rendered with the same recharts bar-chart shape as FinanceTrendsCard's
 * "Spending by category" — not persisted in financeQaHistory or turns) — see
 * the ask_finance_question action (routes/api/finance.ts) for the bounded
 * context/LLM-call/history side.
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
  const [chart, setChart] = useState<AnalystChart | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  // AI-204: in-session-only conversation turns, separate from the persisted
  // payload.financeQaHistory audit log — resets on reload, explicitly
  // clearable via "New conversation" below.
  const [turns, setTurns] = useState<Array<{ question: string; answer: string }>>([])

  async function ask() {
    const asked = question.trim()
    if (!asked) return
    setAsking(true)
    setError(null)
    setAnswer(null)
    setChart(null)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'ask_finance_question',
          question: asked,
          priorTurns: turns.slice(-3),
        }),
      })
      const data = (await res.json()) as PersonalFinancePayload & {
        answer?: string
        chart?: AnalystChart | null
        error?: string
      }
      if (data.ok && data.answer) {
        setAnswer(data.answer)
        setChart(data.chart ?? null)
        setTurns((prior) => [...prior, { question: asked, answer: data.answer as string }])
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

  function startNewConversation() {
    setTurns([])
    setAnswer(null)
    setChart(null)
    setError(null)
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
        {turns.length > 0 && (
          <button type="button" onClick={startNewConversation} className={buttonClass}>
            New conversation
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
      {answer && <p className="mt-2 text-sm text-[var(--theme-text)]">{answer}</p>}
      {chart && (
        <div className="mt-3">
          <p className="text-xs font-medium text-[var(--theme-text)]">{chart.title}</p>
          <div className="mt-2 h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart.data} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--theme-border)" opacity={0.4} horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fill: 'var(--theme-muted)' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={formatNumber}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  tick={{ fontSize: 10, fill: 'var(--theme-muted)' }}
                  axisLine={false}
                  tickLine={false}
                  width={90}
                />
                <Tooltip
                  contentStyle={{ background: 'var(--theme-panel)', border: '1px solid var(--theme-border)', borderRadius: 8, fontSize: 11 }}
                  formatter={(value: number) => value.toLocaleString()}
                />
                <Bar dataKey="value" fill="#38bdf8" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

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
