import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { formatLkr } from '../utils'
import { dangerTone, warningTone } from '../shared-styles'
import type { PersonalFinancePayload } from '../types'

type Row = { key: string; name: string; kindLabel: string; text: string; tone: string; sortKey: number }

/**
 * PF review item 7: the payday / contract / FD-maturity windows are now
 * computed server-side (`getUpcomingMoney`) and carried on the payload — they
 * used to be recomputed here from raw records via a stack of client badge
 * helpers, and a THIRD time in Python in personal-finance-digest.sh. This
 * component only maps the structured events to badges.
 */
export function UpcomingMoney({
  payload,
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (p: PersonalFinancePayload) => void
}) {
  const { paydays, contracts, fdMaturities, scheduled } = payload.upcomingMoney
  const { run, busy } = useFinanceAction<PersonalFinancePayload>(onPayload)
  const rows: Array<Row> = []

  for (const p of paydays) {
    rows.push({
      key: `payday-${p.name}`,
      name: p.name,
      kindLabel: 'Payday',
      text:
        p.state === 'overdue'
          ? `Overdue by ${p.days}d`
          : p.days === 0
            ? 'Due today'
            : p.days > 0
              ? `Due in ${p.days}d`
              : `${-p.days}d past payday`,
      tone: p.state === 'overdue' ? dangerTone : warningTone,
      sortKey: p.state === 'overdue' ? -p.days : p.days,
    })
  }
  for (const c of contracts) {
    rows.push({
      key: `contract-${c.name}`,
      name: c.name,
      kindLabel: 'Contract',
      text: c.days < 0 ? `Contract ended ${-c.days}d ago` : `Contract ends in ${c.days}d`,
      tone: c.days < 0 ? dangerTone : warningTone,
      sortKey: c.days,
    })
  }
  for (const f of fdMaturities) {
    rows.push({
      key: `fd-${f.name}`,
      name: f.name,
      kindLabel: 'Fixed deposit',
      text: f.days < 0 ? `Matured ${-f.days}d ago` : `Matures in ${f.days}d`,
      tone: f.days < 0 ? dangerTone : warningTone,
      sortKey: f.days,
    })
  }

  rows.sort((a, b) => a.sortKey - b.sortKey)
  if (rows.length === 0 && scheduled.length === 0) return null

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold text-[var(--theme-text)]">
        Upcoming money
      </h2>
      <p className="text-xs text-[var(--theme-muted)]">
        Paydays, fixed deposit maturities, contract expirations, and planned
        transactions needing attention soon.
      </p>

      {scheduled.length > 0 && (
        <div className="mt-3 grid gap-2">
          {scheduled.map((s) => (
            <div
              key={`sched-${s.id}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-accent)_10%,transparent)] p-3"
            >
              <div>
                <p className="text-sm font-medium text-[var(--theme-text)]">
                  {s.counterparty}{' '}
                  <span className="text-xs font-normal text-[var(--theme-muted)]">
                    · {s.kind === 'income' ? 'Planned income' : 'Planned expense'}{' '}
                    · {formatLkr(s.amount, 'LKR')}
                  </span>
                </p>
                <p className="text-xs text-[var(--theme-muted)]">
                  {s.days < 0
                    ? `Was due ${-s.days}d ago (${s.dueDate})`
                    : s.days === 0
                      ? `Due today (${s.dueDate})`
                      : `Due in ${s.days}d (${s.dueDate})`}
                </p>
              </div>
              <button
                type="button"
                disabled={busy === `post-${s.id}`}
                onClick={() =>
                  void run(
                    { action: 'post_scheduled', id: s.id },
                    `post-${s.id}`,
                  )
                }
                className="rounded-lg border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_12%,transparent)] px-2 py-1 text-xs font-medium text-[var(--theme-text)] hover:bg-[color-mix(in_srgb,var(--theme-text)_20%,transparent)] disabled:opacity-50"
              >
                {busy === `post-${s.id}` ? 'Posting…' : 'Post now'}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 grid gap-2">
        {rows.map((e) => (
          <div
            key={e.key}
            className="flex items-center justify-between rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3"
          >
            <div>
              <p className="text-sm font-medium text-[var(--theme-text)]">
                {e.name}
              </p>
              <p className="text-xs text-[var(--theme-muted)]">{e.kindLabel}</p>
            </div>
            <span
              className={`rounded-lg border px-2 py-1 text-[10px] uppercase ${e.tone}`}
            >
              {e.text}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
