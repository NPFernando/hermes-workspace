import { useEffect, useId, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  AlertCircleIcon,
  ArrowRight01Icon,
  CancelIcon,
  ConsoleIcon,
} from '@hugeicons/core-free-icons'
import { DashboardDialog } from './dashboard-dialog'
import {
  DashboardEmptyState,
  DashboardLoadingState,
  DashboardUnavailableState,
} from './dashboard-empty-state'
import type { DashboardOverview } from '@/server/dashboard-aggregator'

// Hugeicons free pack ships `ConsoleIcon` (terminal-prompt glyph) but
// no `TerminalIcon`. Aliasing keeps call sites readable.
const TerminalIcon = ConsoleIcon

const ERROR_RX = /\b(error|exception|traceback|failed|fatal)\b/i
const WARN_RX = /\b(warn|warning|deprecated)\b/i

function lineTone(line: string): string {
  if (ERROR_RX.test(line) || line.toLowerCase().includes('errno')) {
    return 'var(--theme-danger)'
  }
  if (WARN_RX.test(line)) return 'var(--theme-warning)'
  return 'var(--theme-text)'
}

/**
 * Compact rolling log tail card. Lives in the dashboard ops rail and
 * gives a fast pulse on whether anything is on fire. Click "Expand"
 * for the full tail modal, which paginates and filters server logs.
 *
 * Hides itself when the dashboard isn't returning logs (vanilla install
 * with auth disabled, or running without a dashboard).
 */
export function LogsTailCard({
  logs,
  loading = false,
  unavailable = false,
}: {
  logs: DashboardOverview['logs']
  loading?: boolean
  unavailable?: boolean
}) {
  const [showModal, setShowModal] = useState(false)
  if (loading) return <DashboardLoadingState title="Live logs" />
  if (!logs) {
    if (unavailable) return <DashboardUnavailableState title="Live logs" />
    return (
      <DashboardEmptyState
        title="Live logs"
        description="Live log telemetry is not available for this workspace."
        statusLabel="not available"
      />
    )
  }

  const previewLines = logs.lines.slice(-6)

  return (
    <>
      <div
        className="relative flex flex-col gap-2 overflow-hidden rounded-xl border border-[var(--theme-border)] p-3"
        style={{
          background:
            'linear-gradient(150deg, color-mix(in srgb, var(--theme-card) 96%, transparent), color-mix(in srgb, var(--theme-card) 92%, transparent))',
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <HugeiconsIcon
              icon={TerminalIcon}
              size={14}
              strokeWidth={1.5}
              className="text-[var(--theme-muted)]"
            />
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--theme-muted)]">
              Logs · {logs.file}
            </h2>
          </div>
          <div className="flex items-center gap-2 text-[10px]">
            {logs.errorCount > 0 ? (
              <span
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono uppercase tracking-[0.1em]"
                style={{
                  background:
                    'color-mix(in srgb, var(--theme-danger) 15%, transparent)',
                  color: 'var(--theme-danger)',
                }}
              >
                <HugeiconsIcon
                  icon={AlertCircleIcon}
                  size={10}
                  strokeWidth={1.5}
                />
                {logs.errorCount}
              </span>
            ) : null}
            {logs.warnCount > 0 ? (
              <span
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono uppercase tracking-[0.1em]"
                style={{
                  background:
                    'color-mix(in srgb, var(--theme-warning) 15%, transparent)',
                  color: 'var(--theme-warning)',
                }}
              >
                {logs.warnCount} warn
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="inline-flex items-center gap-1 rounded border border-[var(--theme-border)] px-2 py-0.5 font-mono uppercase tracking-[0.15em] text-[var(--theme-muted)] motion-safe:transition-colors hover:bg-[var(--theme-card)]/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-card)]"
            >
              <span>Tail</span>
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                size={12}
                strokeWidth={1.8}
              />
            </button>
          </div>
        </div>
        <div
          className="rounded border border-[var(--theme-border)] p-2 font-mono text-[10px] leading-snug max-h-24 overflow-hidden"
          style={{
            background:
              'color-mix(in srgb, var(--theme-card) 88%, transparent)',
          }}
        >
          {previewLines.length === 0 ? (
            <span className="text-[var(--theme-muted)]">
              no recent log lines.
            </span>
          ) : (
            previewLines.map((line, i) => (
              <div
                key={i}
                className="truncate"
                style={{ color: lineTone(line) }}
                title={line}
              >
                {line.replace(/\n+$/, '')}
              </div>
            ))
          )}
        </div>
      </div>

      {showModal ? (
        <LogsModal initial={logs} onClose={() => setShowModal(false)} />
      ) : null}
    </>
  )
}

function LogsModal({
  initial,
  onClose,
}: {
  initial: NonNullable<DashboardOverview['logs']>
  onClose: () => void
}) {
  const [logs, setLogs] = useState<typeof initial>(initial)
  const [loading, setLoading] = useState(false)
  const [refreshError, setRefreshError] = useState(false)
  const [filter, setFilter] = useState<'all' | 'errors' | 'warns'>('all')
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  // Refresh log tail every 3s while modal is open. Keep one bounded request
  // at a time so a slow gateway cannot create overlapping fetches.
  useEffect(() => {
    let cancelled = false
    const isCancelled = () => cancelled
    let refreshing = false
    let activeController: AbortController | null = null
    const tick = async () => {
      if (cancelled || refreshing) return
      refreshing = true
      const controller = new AbortController()
      activeController = controller
      const timeout = globalThis.setTimeout(() => controller.abort(), 4_000)
      setLoading(true)
      try {
        const res = await fetch('/api/dashboard/overview?logs=200', {
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`logs ${res.status}`)
        const data = await res.json()
        if (!isCancelled() && data?.logs) {
          setLogs(data.logs)
          setRefreshError(false)
        }
      } catch {
        if (!isCancelled()) setRefreshError(true)
      } finally {
        globalThis.clearTimeout(timeout)
        activeController = null
        refreshing = false
        if (!isCancelled()) setLoading(false)
      }
    }
    tick()
    const interval = setInterval(tick, 3000)
    return () => {
      cancelled = true
      clearInterval(interval)
      activeController?.abort()
    }
  }, [])

  const filtered = logs.lines.filter((line) => {
    if (filter === 'errors') {
      return ERROR_RX.test(line) || line.toLowerCase().includes('errno')
    }
    if (filter === 'warns') return WARN_RX.test(line)
    return true
  })

  return (
    <DashboardDialog
      titleId={titleId}
      onClose={onClose}
      className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border bg-[var(--theme-card)] border-[var(--theme-border)]"
    >
      <div className="flex items-center justify-between border-b px-4 py-3 border-[var(--theme-border)]">
        <div className="flex items-center gap-3">
          <HugeiconsIcon
            icon={TerminalIcon}
            size={16}
            strokeWidth={1.5}
            className="text-[var(--theme-text)]"
          />
          <div>
            <h2
              id={titleId}
              className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--theme-text)]"
            >
              Live tail · {logs.file}
            </h2>
            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--theme-muted)]">
              {logs.lines.length} lines · {logs.errorCount} errors ·{' '}
              {logs.warnCount} warns
              {loading
                ? ' · refreshing…'
                : refreshError
                  ? ' · refresh unavailable'
                  : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(['all', 'errors', 'warns'] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              aria-pressed={filter === opt}
              onClick={() => setFilter(opt)}
              className="rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-inset"
              style={{
                borderColor: 'var(--theme-border)',
                background:
                  filter === opt
                    ? 'color-mix(in srgb, var(--theme-accent) 18%, transparent)'
                    : 'transparent',
                color:
                  filter === opt ? 'var(--theme-accent)' : 'var(--theme-muted)',
              }}
            >
              {opt}
            </button>
          ))}
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded p-1 hover:bg-[var(--theme-card)]/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-card)] lg:min-h-0 lg:min-w-0"
          >
            <HugeiconsIcon
              icon={CancelIcon}
              size={16}
              strokeWidth={1.5}
              className="text-[var(--theme-muted)]"
            />
          </button>
        </div>
      </div>
      <div
        className="flex-1 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed"
        style={{
          background: 'color-mix(in srgb, var(--theme-card) 88%, transparent)',
        }}
      >
        {refreshError ? (
          <p
            role="status"
            aria-live="polite"
            className="mb-3 rounded border border-[var(--theme-warning)]/30 bg-[var(--theme-warning)]/10 px-2 py-1.5 text-[10px] text-[var(--theme-warning)]"
          >
            Live refresh is temporarily unavailable. Showing the last received
            log snapshot; automatic retry continues.
          </p>
        ) : null}
        {filtered.length === 0 ? (
          <div className="py-6 text-center text-[11px] text-[var(--theme-muted)]">
            No matching log lines.
          </div>
        ) : (
          filtered.map((line, i) => (
            <div
              key={i}
              className="whitespace-pre-wrap"
              style={{ color: lineTone(line) }}
            >
              {line.replace(/\n+$/, '')}
            </div>
          ))
        )}
      </div>
    </DashboardDialog>
  )
}
