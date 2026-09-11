import { StatCard } from '../../finance/components/stat-card'
import { formatDateTime } from '../utils'
import type { PersonalFinancePayload } from '../types'

const STATUS_LABELS: Record<string, string> = {
  healthy: 'Up to date',
  json_primary: 'Local storage active',
  postgres_unavailable: 'Cloud sync unavailable',
  postgres_behind: 'Cloud sync catching up',
  mirror_mismatch: 'Cloud sync needs attention',
}

function healthTone(status: string): 'neutral' | 'good' | 'warn' | 'danger' {
  if (status === 'healthy') return 'good'
  if (status === 'postgres_behind' || status === 'mirror_mismatch')
    return 'warn'
  if (status === 'postgres_unavailable') return 'danger'
  return 'neutral'
}

function backupTone(status: string): 'neutral' | 'good' | 'warn' | 'danger' {
  if (status === 'healthy') return 'good'
  if (status === 'stale' || status === 'missing') return 'warn'
  return 'neutral'
}

const MAX_WARNING_LENGTH = 140

export function DataHealthCard({
  payload,
}: {
  payload: PersonalFinancePayload
}) {
  const health = payload.storage.health
  const label = STATUS_LABELS[health.status] ?? health.status
  const warningText = health.warnings
    .join(' ')
    .replace(/Postgres mirror/gi, 'Cloud sync')
    .replace(/JSON finance storage/gi, 'local storage')
    .replace(/JSON fallback/gi, 'local fallback')
  const truncatedWarning =
    warningText.length > MAX_WARNING_LENGTH
      ? `${warningText.slice(0, MAX_WARNING_LENGTH)}…`
      : warningText
  const value =
    health.warnings.length > 0 ? `${label} · ${truncatedWarning}` : label
  const backup = payload.backupHealth
  const backupLabel =
    backup.status === 'healthy'
      ? 'Healthy'
      : backup.status === 'stale'
        ? 'Stale'
        : backup.status === 'missing'
          ? 'No snapshot'
          : 'Not configured'
  const latest = backup.latestCreatedAt
    ? ` · latest ${formatDateTime(backup.latestCreatedAt)}`
    : ''
  return (
    <div className="mt-6 grid gap-2 sm:grid-cols-2">
      <StatCard
        label="Data Health"
        value={value}
        tone={healthTone(health.status)}
      />
      <StatCard
        label="Encrypted Backup"
        value={`${backupLabel} · ${backup.backupCount}/${backup.retention} retained${latest}`}
        tone={backupTone(backup.status)}
      />
    </div>
  )
}
