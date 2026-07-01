import { CyclingStatus, WORKING_STEPS } from './cycling-status'
import { getAgentPersona, getLastAssistantMessage, getShortModelName } from './shared'
import type { useConductorGateway } from '../hooks/use-conductor-gateway'
import type { HistoryMessage } from './shared'
import { Markdown } from '@/components/prompt-kit/markdown'
import { cn } from '@/lib/utils'

export function getOutputDisplayName(projectPath: string | null | undefined): string {
  if (!projectPath) return 'Output ready'
  return projectPath.split('/').pop() || 'index.html'
}

export function formatMissionTimestamp(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

export function buildProjectPathCandidates(workers: Array<{ label: string }>, missionStartedAt: string | null | undefined): Array<string> {
  const timestamp = formatMissionTimestamp(missionStartedAt)
  const candidates = new Set<string>()

  for (const worker of workers) {
    const label = worker.label
    const slug = label.replace(/^worker-/, '').trim()
    if (!slug) continue

    candidates.add(`/tmp/dispatch-${slug}`)
    candidates.add(`/tmp/dispatch-${slug}-page`)

    if (timestamp) {
      candidates.add(`/tmp/dispatch-${slug}-${timestamp}`)
      candidates.add(`/tmp/dispatch-${slug}-${timestamp}-page`)
    }
  }

  return [...candidates]
}

export function formatElapsedTime(startIso: string | null | undefined, now: number): string {
  if (!startIso) return '0s'
  const startMs = new Date(startIso).getTime()
  if (!Number.isFinite(startMs)) return '0s'
  return formatElapsedMilliseconds(now - startMs)
}

export function formatElapsedMilliseconds(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

export function formatDurationRange(startIso: string | null | undefined, endIso: string | null | undefined, now: number): string {
  const endMs = endIso ? new Date(endIso).getTime() : now
  if (!Number.isFinite(endMs)) return formatElapsedTime(startIso, now)
  return formatElapsedTime(startIso, endMs)
}

export function formatRelativeTime(value: string | null | undefined, now: number): string {
  if (!value) return 'just now'
  const ms = new Date(value).getTime()
  if (!Number.isFinite(ms)) return 'just now'
  const diffSeconds = Math.max(0, Math.floor((now - ms) / 1000))
  if (diffSeconds < 10) return 'just now'
  if (diffSeconds < 60) return `${diffSeconds}s ago`
  const diffMinutes = Math.floor(diffSeconds / 60)
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  const diffHours = Math.floor(diffMinutes / 60)
  return `${diffHours}h ago`
}

export function truncateContinuationText(text: string, limit = 500): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

export function getWorkerDot(status: 'running' | 'complete' | 'stale' | 'idle') {
  if (status === 'complete') return { dotClass: 'bg-emerald-400', label: 'Complete' }
  if (status === 'running') return { dotClass: 'bg-sky-400 animate-pulse', label: 'Running' }
  if (status === 'idle') return { dotClass: 'bg-amber-400', label: 'Idle' }
  return { dotClass: 'bg-red-400', label: 'Stale' }
}

export function getWorkerBorderClass(status: 'running' | 'complete' | 'stale' | 'idle') {
  if (status === 'complete') return 'border-l-emerald-400'
  if (status === 'running') return 'border-l-sky-400'
  if (status === 'idle') return 'border-l-amber-400'
  return 'border-l-red-400'
}

export function WorkerCard({
  worker,
  index,
  conductor,
  now,
}: {
  worker: ReturnType<typeof useConductorGateway>['workers'][number]
  index: number
  conductor: Pick<ReturnType<typeof useConductorGateway>, 'workerOutputs' | 'isPaused' | 'pausedAtMs' | 'missionStartedAt'>
  now: number
}) {
  const dot = getWorkerDot(worker.status)
  const persona = getAgentPersona(index)
  const workerOutput = conductor.workerOutputs[worker.key] ?? getLastAssistantMessage(worker.raw.messages as Array<HistoryMessage> | undefined)
  const workerStartedAt = typeof worker.raw.createdAt === 'string' ? worker.raw.createdAt : typeof worker.raw.startedAt === 'string' ? worker.raw.startedAt : conductor.missionStartedAt
  const workerEndTime =
    worker.status === 'complete' || worker.status === 'stale' ? new Date(worker.updatedAt ?? new Date().toISOString()).getTime() : conductor.isPaused ? (conductor.pausedAtMs ?? now) : now

  return (
    <div key={worker.key} className={cn('overflow-hidden rounded-2xl border border-[var(--theme-border)] border-l-4 bg-[var(--theme-card)] px-4 py-3', getWorkerBorderClass(worker.status))}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn('size-2.5 rounded-full', dot.dotClass)} />
            <p className="truncate text-sm font-medium text-[var(--theme-text)]">
              {persona.emoji} {persona.name} <span className="text-[var(--theme-muted)]">·</span> {worker.label}
            </p>
          </div>
          <p className="mt-1 text-xs text-[var(--theme-muted-2)]">{worker.displayName}</p>
        </div>
        <span className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-card2)] px-2.5 py-1 micro-label">
          {dot.label}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card2)] px-3 py-2">
          <p className="text-[var(--theme-muted)]">Model</p>
          <p className="mt-1 truncate text-[var(--theme-text)]">{getShortModelName(worker.model)}</p>
        </div>
        <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card2)] px-3 py-2">
          <p className="text-[var(--theme-muted)]">Tokens</p>
          <p className="mt-1 text-[var(--theme-text)]">{worker.tokenUsageLabel}</p>
        </div>
        <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card2)] px-3 py-2">
          <p className="text-[var(--theme-muted)]">Elapsed</p>
          <p className="mt-1 text-[var(--theme-text)]">{formatElapsedTime(workerStartedAt, workerEndTime)}</p>
        </div>
        <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card2)] px-3 py-2">
          <p className="text-[var(--theme-muted)]">Last update</p>
          <p className="mt-1 text-[var(--theme-text)]">{formatRelativeTime(worker.updatedAt, now)}</p>
        </div>
      </div>

      <div className="mt-3 overflow-hidden rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-4 py-4">
        {workerOutput ? (
          <Markdown className="max-h-[400px] max-w-none overflow-auto text-sm text-[var(--theme-text)]">{workerOutput}</Markdown>
        ) : (
          <CyclingStatus steps={WORKING_STEPS} intervalMs={3500} isPaused={conductor.isPaused} />
        )}
      </div>
    </div>
  )
}

