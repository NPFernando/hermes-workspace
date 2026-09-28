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
    live: { allPassed: boolean; blockers: Array<string>; gates: Array<Gate>; computedAt: string }
    stored: { snapshot: { allPassed: boolean; blockers: Array<string> } | null; approval: { status: string; expiresAt: string | null } | null }
  }
}

const gateGuidance: Record<string, string> = {
  paper_evidence:
    'Keep the paper scheduler running until the evidence is recent and the minimum sample is met.',
  sandbox_evidence:
    'Keep bounded testnet cycles running; the count can pass while performance-quality checks still block promotion.',
  ledger_integrity:
    'Repair malformed ledger rows or restore storage health before trusting any P&L.',
  strategy_sample_size:
    'Collect enough recent trades for each enabled strategy, or review the strategy configuration before promotion.',
  recovery_visibility:
    'Configure patient-hold visibility plus both drawdown and daily-loss halts.',
  account_connectivity:
    'Provide testnet and live credentials through the server secret manager; never paste keys into this dashboard.',
  kill_switch:
    'Disarm the emergency stop only after deliberately reviewing the active safeguards.',
  exposure_caps:
    'Set a positive per-order cap and bounded maximum exposure for the configured account.',
  patient_hold_isolation:
    'Keep patient-hold positions isolated from new-entry sizing and risk calculations.',
  emergency_stop_readiness:
    'Restore the audit log path and emergency-stop settings schema before proceeding.',
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
  const canApprove = live.allPassed && Boolean(phrase)
  const canActivate =
    live.allPassed && approval?.status === 'approved' && Boolean(phrase)
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
            {!gate.pass && gateGuidance[gate.id] && (
              <p className="mt-2 border-t border-[var(--theme-border)]/50 pt-2 text-[var(--theme-muted)]">
                Next: {gateGuidance[gate.id]}
              </p>
            )}
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
        <button type="button" disabled={busy !== null} onClick={() => action('verify_trading_connectivity')} className="rounded-xl border border-[var(--theme-border)] px-3 py-1.5 text-xs">Verify exchange connectivity (read-only)</button>
        <button type="button" disabled={busy !== null} onClick={() => action('request_live_readiness_approval')} className="rounded-xl border border-[var(--theme-border)] px-3 py-1.5 text-xs">Request approval</button>
        <input type="password" value={phrase} onChange={(event) => setPhrase(event.target.value)} placeholder="Activation phrase" className="w-64 rounded-xl border border-[var(--theme-border)] bg-transparent px-3 py-1.5 text-xs" />
        <button type="button" disabled={busy !== null || !canApprove} onClick={() => action('approve_live_readiness', { approval: phrase })} className="rounded-xl border border-amber-500/40 px-3 py-1.5 text-xs text-amber-300 disabled:opacity-40">Approve</button>
        <button type="button" disabled={busy !== null || !canActivate} onClick={() => action('activate_live_readiness', { approval: phrase })} className="rounded-xl border border-red-500/40 px-3 py-1.5 text-xs text-red-300 disabled:opacity-40">Activate live</button>
        <button type="button" disabled={busy !== null} onClick={() => action('deactivate_live_readiness', { reason: 'manual readiness deactivation' })} className="rounded-xl border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-300">Return to sandbox</button>
      </div>
    </section>
  )
}
