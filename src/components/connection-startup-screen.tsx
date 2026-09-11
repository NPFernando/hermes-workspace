import { useEffect, useRef, useState } from 'react'
import type { AuthStatus } from '@/lib/claude-auth'
import { writeTextToClipboard } from '@/lib/clipboard'
import { fetchClaudeAuthStatus } from '@/lib/claude-auth'
import { safeErrorMessage } from '@/lib/error-utils'

/* eslint-disable @typescript-eslint/no-unnecessary-condition -- state changes from async connection polling */

const POLL_INTERVAL_MS = 2_000
const FAILURE_REVEAL_MS = 5_000
// Fire one silent auto-start attempt this many ms after we still can't connect.
const AUTO_START_DELAY_MS = 4_000

type Platform = 'macos' | 'windows' | 'linux' | 'unknown'

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'unknown'
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('win')) return 'windows'
  if (ua.includes('mac')) return 'macos'
  if (ua.includes('linux')) return 'linux'
  return 'unknown'
}

function getSetupSteps(
  platform: Platform,
): Array<{ title: string; command: string; note?: string }> {
  return [
    {
      title: 'Use any OpenAI-compatible backend',
      command: 'Set HERMES_API_URL to your backend base URL',
      note: 'Portable chat works with any backend that exposes /v1/chat/completions (Ollama, LiteLLM, vLLM, etc.)',
    },
    {
      title: 'Optional: install Hermes Agent locally',
      command:
        'curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash',
      note: 'Vanilla hermes-agent unlocks sessions, skills, memory, jobs, and config automatically — no fork required',
    },
    {
      title: 'Set up your agent',
      command: 'hermes setup',
      note: 'Pick your providers once; Hermes Agent stores them under ~/.hermes',
    },
    {
      title: 'Start the gateway',
      command: 'hermes gateway run',
      note: 'This starts the HTTP API on :8642 for the workspace',
    },
  ]
}

type Props = { onConnected: (status: AuthStatus) => void }

declare global {
  interface Window {
    __dismissSplash?: () => void
  }
}

export function ConnectionStartupScreen({ onConnected }: Props) {
  const [failureState, setFailureState] = useState<'pending' | 'shown'>(
    'pending',
  )
  const showFailureState: boolean = failureState === 'shown'
  const [serverStarting, setServerStarting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [serverLog, setServerLog] = useState<Array<string>>([])
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [showManual, setShowManual] = useState(false)

  const platform = useRef<Platform>(detectPlatform())
  const steps = getSetupSteps(platform.current)

  const onConnectedRef = useRef(onConnected)
  useEffect(() => {
    onConnectedRef.current = onConnected
  }, [onConnected])

  const isDone = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const dismiss = window.__dismissSplash
    if (!dismiss) return
    const timer = setTimeout(() => dismiss(), 60)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    isDone.current = false
    let pollTimer: ReturnType<typeof setTimeout> | null = null
    let autoStartTimer: ReturnType<typeof setTimeout> | null = null
    let autoStartFired = false

    const failureTimer = setTimeout(() => {
      if (!isDone.current) {
        setFailureState('shown')
      }
    }, FAILURE_REVEAL_MS)

    // After a short grace period, fire /api/start-claude once silently.
    // If hermes-agent is installed and just not running, this brings it back
    // up without making the user click anything. The polling loop will see it.
    const fireSilentAutoStart = async () => {
      if (autoStartFired || isDone.current) return
      autoStartFired = true
      try {
        const res = await fetch('/api/start-claude', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
        const ct = res.headers.get('content-type') || ''
        if (!ct.includes('application/json')) return
        const data = (await res.json()) as { ok?: boolean; message?: string }
        if (res.ok && data.ok) {
          // surface a one-line note so users see what happened if they're
          // looking at the failure panel
          setServerLog([
            String(
              data.message ||
                'Auto-started Hermes Agent gateway — reconnecting…',
            ),
          ])
        }
      } catch {
        // silent: manual auto-start button stays available
      }
    }
    autoStartTimer = setTimeout(() => {
      void fireSilentAutoStart()
    }, AUTO_START_DELAY_MS)

    const tryConnect = async () => {
      try {
        const status = await fetchClaudeAuthStatus()
        if (isDone.current) return
        isDone.current = true
        clearTimeout(failureTimer)
        clearTimeout(autoStartTimer)
        if (pollTimer) clearTimeout(pollTimer)
        onConnectedRef.current(status)
      } catch {
        if (isDone.current) return
        pollTimer = setTimeout(tryConnect, POLL_INTERVAL_MS)
      }
    }

    void tryConnect()

    return () => {
      isDone.current = true
      if (pollTimer) clearTimeout(pollTimer)
      clearTimeout(autoStartTimer)
      clearTimeout(failureTimer)
    }
  }, [])

  useEffect(() => {
    if (copiedIdx === null) return
    const timer = setTimeout(() => setCopiedIdx(null), 2_000)
    return () => clearTimeout(timer)
  }, [copiedIdx])

  const handleCopy = async (text: string, idx: number) => {
    try {
      await writeTextToClipboard(text)
      setCopiedIdx(idx)
    } catch {
      /* clipboard not available */
    }
  }

  const handleAutoStart = async () => {
    setServerStarting(true)
    setServerError(null)
    setServerLog(['Looking for hermes-agent...'])
    try {
      const res = await fetch('/api/start-claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const contentType = res.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        const msg = `Unexpected response (${res.status})`
        setServerLog([`Error: ${msg}`])
        setServerError(msg)
        setServerStarting(false)
        return
      }

      const data = (await res.json()) as Record<string, unknown>
      if (res.ok && data.ok) {
        setServerLog([
          String(data.message || 'Started — waiting for connection...'),
        ])
        setServerStarting(false)
        return
      }

      const msg = String(data.error || 'Could not find hermes-agent')
      const hint = data.hint ? String(data.hint) : ''
      setServerLog([`Error: ${msg}`])
      if (hint) setServerLog((prev) => [...prev, `Hint: ${hint}`])
      setServerError(msg)
      setServerStarting(false)
      // Show manual steps when auto-start fails
      setShowManual(true)
    } catch (err) {
      const msg = safeErrorMessage(err)
      setServerLog([`Failed: ${msg}`])
      setServerError(msg)
      setServerStarting(false)
      setShowManual(true)
    }
  }

  // The root document owns the pre-hydration loading marker. Once React has
  // mounted, replace the blank waiting interval with one small non-blocking
  // status pill. This avoids a second full-screen loader while still giving
  // users feedback during a slow backend connection.
  if (!showFailureState) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-3 top-[calc(var(--titlebar-h,0px)+0.75rem)] z-[100] flex justify-end sm:inset-x-auto sm:right-4"
      >
        <div className="flex items-center gap-2 rounded-full border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-bg)_94%,transparent)] px-3 py-1.5 text-[10px] font-medium text-[var(--theme-muted)] shadow-lg backdrop-blur-md">
          <span
            aria-hidden
            className="size-1.5 rounded-full bg-[var(--theme-accent)] motion-safe:animate-pulse"
          />
          Connecting to backend…
        </div>
      </div>
    )
  }

  return (
    <div
      role="region"
      aria-labelledby="connection-startup-title"
      className="pointer-events-none fixed inset-x-3 top-[calc(var(--titlebar-h,0px)+1rem)] z-[100] flex max-h-[calc(100dvh-2rem)] items-start justify-center overflow-y-auto text-[var(--theme-text)] sm:inset-x-auto sm:right-4 sm:w-[min(30rem,calc(100vw-2rem))]"
      style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
    >
      <div className="pointer-events-auto flex w-full flex-col rounded-xl border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-bg)_96%,transparent)] p-3 text-left shadow-2xl backdrop-blur-md sm:p-4">
        <h1
          id="connection-startup-title"
          className="text-sm font-semibold tracking-tight text-[var(--theme-text)]"
        >
          Backend connection needed
        </h1>

        {/* Connecting spinner */}
        <div
          className={[
            'mt-4 flex items-center gap-3 text-sm text-[var(--theme-muted)] motion-safe:transition-opacity duration-300',
            showFailureState ? 'opacity-0 h-0' : 'opacity-100',
          ].join(' ')}
          aria-hidden={showFailureState}
        >
          <span className="inline-block h-5 w-5 motion-safe:animate-spin rounded-full border-2 border-[var(--theme-border)] border-t-[var(--theme-accent)]" />
          <span>Connecting to your backend...</span>
        </div>

        {/* Failure state — setup guide */}
        <div
          className={[
            'w-full overflow-hidden motion-safe:transition-all duration-500 ease-out',
            showFailureState
              ? 'mt-6 max-h-[60rem] translate-y-0 opacity-100'
              : 'max-h-0 translate-y-2 opacity-0',
          ].join(' ')}
        >
          <div className="w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)]/95 p-3 shadow-xl backdrop-blur-sm sm:p-4">
            <p className="text-xs leading-5 text-[var(--theme-muted)]">
              Connect an OpenAI-compatible backend. Hermes Agent gateway APIs
              unlock enhanced features automatically when available.
            </p>

            {/* Auto-start section */}
            <div className="mt-3">
              <button
                type="button"
                disabled={serverStarting}
                onClick={handleAutoStart}
                className={[
                  'min-h-11 w-full rounded-lg px-4 py-2.5 text-sm font-semibold motion-safe:transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-bg)]',
                  serverStarting
                    ? 'cursor-not-allowed bg-[var(--theme-accent)]/30 text-[var(--theme-muted)]'
                    : 'bg-[var(--theme-accent)] text-[var(--theme-on-accent,white)] hover:opacity-90',
                ].join(' ')}
              >
                {serverStarting ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="inline-block h-4 w-4 motion-safe:animate-spin rounded-full border-2 border-white/30 border-t-white/90" />
                    Detecting...
                  </span>
                ) : (
                  'Auto-Start Hermes Agent Gateway'
                )}
              </button>

              {/* Server log */}
              {serverLog.length > 0 ? (
                <div
                  className={[
                    'mt-3 rounded-xl border p-3',
                    serverError
                      ? 'border-red-500/20 bg-red-950/30'
                      : 'border-emerald-500/20 bg-emerald-950/30',
                  ].join(' ')}
                  role={serverError ? 'alert' : 'status'}
                  aria-live="polite"
                >
                  <pre className="whitespace-pre-wrap font-mono text-xs leading-5 text-[var(--theme-muted)]">
                    {serverLog.join('\n')}
                  </pre>
                </div>
              ) : null}
            </div>

            {/* Divider */}
            <div className="my-3 flex items-center gap-3">
              <div className="h-px flex-1 bg-[var(--theme-border)]" />
              <button
                type="button"
                onClick={() => setShowManual(!showManual)}
                aria-expanded={showManual}
                aria-controls="manual-setup-steps"
                className="rounded px-2 py-1 text-xs font-medium text-[var(--theme-muted)] motion-safe:transition hover:text-[var(--theme-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-card)]"
              >
                {showManual ? 'Hide' : 'Show'} manual setup
              </button>
              <div className="h-px flex-1 bg-[var(--theme-border)]" />
            </div>

            {/* Manual setup steps */}
            <div
              id="manual-setup-steps"
              inert={!showManual}
              className={[
                'overflow-hidden motion-safe:transition-all duration-300',
                showManual ? 'max-h-[40rem] opacity-100' : 'max-h-0 opacity-0',
              ].join(' ')}
            >
              <div className="space-y-4">
                {steps.map((step, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/60 p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--theme-accent)]/15 text-xs font-bold text-[var(--theme-accent)]">
                          {idx + 1}
                        </span>
                        <span className="text-sm font-medium text-[var(--theme-text)]">
                          {step.title}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopy(step.command, idx)}
                        className="min-h-9 shrink-0 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-hover)] px-2.5 py-1 text-xs font-medium text-[var(--theme-muted)] transition hover:text-[var(--theme-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-card)]"
                      >
                        {copiedIdx === idx ? '✓ Copied' : 'Copy'}
                      </button>
                    </div>
                    <pre className="mt-2 overflow-x-auto rounded-lg bg-[var(--theme-bg)] p-3 font-mono text-xs leading-5 text-[var(--theme-text)]/80">
                      <code>{step.command}</code>
                    </pre>
                    {step.note ? (
                      <p className="mt-2 text-xs text-[var(--theme-muted)]">
                        {step.note}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>

              {/* Env var hint */}
              <div className="mt-4 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/60 p-3">
                <p className="text-xs font-medium text-[var(--theme-muted)]">
                  Point{' '}
                  <code className="rounded bg-[var(--theme-hover)] px-1.5 py-0.5 font-mono text-[var(--theme-text)]/80">
                    HERMES_API_URL
                  </code>{' '}
                  at any OpenAI-compatible backend:
                </p>
                <pre className="mt-2 overflow-x-auto font-mono text-xs text-[var(--theme-muted)]">
                  HERMES_API_URL=http://your-server:8642 pnpm dev
                </pre>
              </div>
            </div>
          </div>
        </div>

        {!showFailureState ? (
          <p className="mt-6 text-xs text-[var(--theme-muted)]">
            This page auto-refreshes when a compatible backend is detected
          </p>
        ) : null}
      </div>
    </div>
  )
}
