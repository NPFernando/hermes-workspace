import { useState } from 'react'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'

type Gate = {
  id: string
  label: string
  pass: boolean
  detail: string
  evidenceAgeMs: number | null
}

type ReadinessPayload = {
  ok?: boolean
  liveReadiness: {
    live: { allPassed: boolean; blockers: string[]; gates: Gate[]; computedAt: string }
    stored: { snapshot: { allPassed: boolean; blockers: string[] } | null; approval: { status: string; expiresAt: string | null } | null }
  }
}

export function LiveReadinessCard({
  payload,
  onPayload,
}: {
  payload: ReadinessPayload
  onPayload: (payload: ReadinessPayload) => void
}) {
  const { run, busy, error } = useFinanceAction<ReadinessPayload>(onPayload)
  const [phrase, setPhrase] = useState('')
  const live = payload.liveReadiness.live
  const approval = payload.liveReadiness.stored.approval
  const action = (name: string, body: Record<string, unknown> = {}) =>
    void run({ action: name, ...body }, name)

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Live execution readiness</h2>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Fail-closed checklist for a future real-money activation. Paper and
            Binance sandbox/testnet remain the active development stages.
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${live.allPassed ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>
          {live.allPassed ? 'All gates passed' : `${live.blockers.length} blocker${live.blockers.length === 1 ? '' : 's'}`}
        </span>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {live.gates.map((gate) => (
          <div key={gate.id} className="rounded-2xl border border-[var(--theme-border)]/70 p-3 text-xs">
            <div className="flex justify-between gap-2 font-medium">
              <span>{gate.label}</span>
              <span className={gate.pass ? 'text-emerald-400' : 'text-amber-400'}>{gate.pass ? 'PASS' : 'BLOCKED'}</span>
            </div>
            <p className="mt-1 text-[var(--theme-muted)]">{gate.detail}</p>
          </div>
        ))}
      </div>
      {approval && (
        <p className="mt-3 text-xs text-[var(--theme-muted)]">
          Approval status: <strong>{approval.status}</strong>
          {approval.expiresAt ? ` · expires ${new Date(approval.expiresAt).toLocaleString()}` : ''}
        </p>
      )}
      {error && <p className="mt-3 text-xs text-[var(--theme-danger)]">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy !== null} onClick={() => action('assess_live_readiness')} className="rounded-xl border border-[var(--theme-border)] px-3 py-1.5 text-xs">Assess gates</button>
        <button type="button" disabled={busy !== null} onClick={() => action('request_live_readiness_approval')} className="rounded-xl border border-[var(--theme-border)] px-3 py-1.5 text-xs">Request approval</button>
        <input type="password" value={phrase} onChange={(event) => setPhrase(event.target.value)} placeholder="Activation phrase" className="w-64 rounded-xl border border-[var(--theme-border)] bg-transparent px-3 py-1.5 text-xs" />
        <button type="button" disabled={busy !== null || !phrase} onClick={() => action('approve_live_readiness', { approval: phrase })} className="rounded-xl border border-amber-500/40 px-3 py-1.5 text-xs text-amber-300">Approve</button>
        <button type="button" disabled={busy !== null || !phrase} onClick={() => action('activate_live_readiness', { approval: phrase })} className="rounded-xl border border-red-500/40 px-3 py-1.5 text-xs text-red-300">Activate live</button>
        <button type="button" disabled={busy !== null} onClick={() => action('deactivate_live_readiness', { reason: 'manual readiness deactivation' })} className="rounded-xl border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-300">Return to sandbox</button>
      </div>
    </section>
  )
}
