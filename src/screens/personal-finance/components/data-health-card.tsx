import { StatCard } from '../../finance/components/stat-card'
import type { PersonalFinancePayload } from '../types'

const STATUS_LABELS: Record<string, string> = {
  healthy: 'Healthy — JSON and Postgres in sync',
  json_primary: 'JSON only (Postgres mirroring disabled)',
  postgres_unavailable: 'Postgres mirror unavailable',
  postgres_behind: 'Postgres mirror behind',
  mirror_mismatch: 'Postgres mirror missing rows',
}

function healthTone(status: string): 'neutral' | 'good' | 'warn' | 'danger' {
  if (status === 'healthy') return 'good'
  if (status === 'postgres_behind' || status === 'mirror_mismatch') return 'warn'
  if (status === 'postgres_unavailable') return 'danger'
  return 'neutral'
}

const MAX_WARNING_LENGTH = 140

export function DataHealthCard({ payload }: { payload: PersonalFinancePayload }) {
  const health = payload.storage.health
  const label = STATUS_LABELS[health.status] ?? health.status
  const warningText = health.warnings.join(' ')
  const truncatedWarning =
    warningText.length > MAX_WARNING_LENGTH ? `${warningText.slice(0, MAX_WARNING_LENGTH)}…` : warningText
  const value = health.warnings.length > 0 ? `${label} · ${truncatedWarning}` : label
  return (
    <div className="mt-6 grid gap-2">
      <StatCard label="Data Health" value={value} tone={healthTone(health.status)} />
    </div>
  )
}
