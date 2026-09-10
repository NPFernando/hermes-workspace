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
}: {
  payload: PersonalFinancePayload
}) {
  const { paydays, contracts, fdMaturities } = payload.upcomingMoney
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
  if (rows.length === 0) return null

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold text-[var(--theme-text)]">
        Upcoming money
      </h2>
      <p className="text-xs text-[var(--theme-muted)]">
        Paydays, fixed deposit maturities, and contract expirations needing
        attention soon.
      </p>
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
