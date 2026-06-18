import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'motion/react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowRight01Icon,
  BookOpen02Icon,
  Cancel01Icon,
  FlowIcon,
  Loading03Icon,
  Search01Icon,
  Telescope02Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Markdown } from '@/components/prompt-kit/markdown'

// ── Types ───────────────────────────────────────────────────────────────────

type ResearchPhase =
  | 'idle'
  | 'starting'
  | 'probing'
  | 'running'
  | 'done'
  | 'error'
  | 'cancelled'

type ProgressEvent = {
  status?: string
  phase?: string
  message?: string
  model?: string
  round?: number
  step?: string
  final?: boolean
  error?: string
}

type ProgressStep = {
  id: number
  phase: string
  message: string
  timestamp: number
}

type LibraryEntry = {
  session_id: string
  query: string
  status: string
  created_at?: string
  archived?: boolean
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function phaseLabel(phase: string | undefined): string {
  switch (phase) {
    case 'probing': return 'Probing model...'
    case 'thinking': return 'Thinking...'
    case 'searching': return 'Searching...'
    case 'extracting': return 'Extracting...'
    case 'synthesizing': return 'Synthesizing...'
    case 'done': return 'Complete'
    case 'error': return 'Error'
    case 'warning': return 'Warning'
    default: return phase ?? 'Working...'
  }
}

function phaseIcon(phase: string) {
  if (phase === 'done') return <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={2} className="text-green-400" />
  if (phase === 'error') return <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} className="text-red-400" />
  return <HugeiconsIcon icon={FlowIcon} size={14} strokeWidth={1.5} className="text-accent-500 opacity-70" />
}

// ── Main component ───────────────────────────────────────────────────────────

export function ResearchScreen() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [maxRounds, setMaxRounds] = useState(0)
  const [maxTime, setMaxTime] = useState(300)
  const [phase, setPhase] = useState<ResearchPhase>('idle')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [steps, setSteps] = useState<Array<ProgressStep>>([])
  const [result, setResult] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'new' | 'library'>('new')
  const stepCounterRef = useRef(0)
  const eventSourceRef = useRef<EventSource | null>(null)
  const stepsEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll steps
  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [steps])

  // Cleanup EventSource on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close()
    }
  }, [])

  const appendStep = useCallback((stepPhase: string, message: string) => {
    stepCounterRef.current += 1
    setSteps((prev) => [
      ...prev,
      { id: stepCounterRef.current, phase: stepPhase, message, timestamp: Date.now() },
    ])
  }, [])

  const startResearch = useCallback(async () => {
    if (!query.trim()) return
    setPhase('starting')
    setSteps([])
    setResult(null)
    setErrorMsg(null)
    setSessionId(null)
    eventSourceRef.current?.close()

    try {
      const res = await fetch('/api/odysseus/research/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          max_rounds: maxRounds,
          max_time: maxTime,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { detail?: string }).detail ?? `HTTP ${res.status}`)
      }
      const data = (await res.json()) as { session_id: string }
      const sid = data.session_id
      setSessionId(sid)
      setPhase('probing')
      appendStep('probing', 'Research started — probing model...')

      // Connect to SSE stream
      const es = new EventSource(`/api/odysseus/research/stream/${sid}`)
      eventSourceRef.current = es

      es.onmessage = (evt) => {
        try {
          const event = JSON.parse(evt.data) as ProgressEvent
          const evPhase = event.phase ?? event.status ?? 'running'
          const msg = event.message ?? phaseLabel(evPhase)
          appendStep(evPhase, msg)

          if (event.final || event.status === 'done' || event.status === 'error' || event.status === 'cancelled') {
            es.close()
            if (event.status === 'error') {
              setPhase('error')
              setErrorMsg(event.error ?? 'Research failed')
            } else if (event.status === 'cancelled') {
              setPhase('cancelled')
            } else {
              setPhase('done')
              // Fetch final result
              void fetchResult(sid)
            }
          } else {
            setPhase((event.phase as ResearchPhase | undefined) ?? 'running')
          }
        } catch {
          // ignore parse errors
        }
      }

      es.onerror = () => {
        es.close()
        setPhase((p) => (p === 'done' ? 'done' : 'error'))
        setErrorMsg((e) => e ?? 'Stream connection lost')
      }
    } catch (err) {
      setPhase('error')
      setErrorMsg(err instanceof Error ? err.message : 'Unknown error')
    }
  }, [query, maxRounds, maxTime, appendStep])

  const fetchResult = async (sid: string) => {
    try {
      const res = await fetch(`/api/odysseus/research/result-peek/${sid}`, {
        method: 'POST',
      })
      if (res.ok) {
        const data = (await res.json()) as { result?: string }
        setResult(data.result ?? null)
      }
    } catch {
      // ignore — result fetch is best-effort
    }
  }

  const cancelResearch = useCallback(() => {
    eventSourceRef.current?.close()
    if (sessionId) {
      void fetch(`/api/odysseus/research/cancel/${sessionId}`, { method: 'POST' })
    }
    setPhase('cancelled')
  }, [sessionId])

  const reset = useCallback(() => {
    eventSourceRef.current?.close()
    setPhase('idle')
    setSessionId(null)
    setSteps([])
    setResult(null)
    setErrorMsg(null)
  }, [])

  // Bootstrap: ensure Odysseus has an LLM endpoint registered
  useQuery({
    queryKey: ['odysseus-bootstrap'],
    queryFn: () => fetch('/api/odysseus-bootstrap', { method: 'POST' }).then((r) => r.json()),
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  })

  // ── Library data ───────────────────────────────────────────────────────────
  const { data: library } = useQuery<Array<LibraryEntry>>({
    queryKey: ['odysseus-research-library'],
    queryFn: async () => {
      const res = await fetch('/api/odysseus/research/library')
      if (!res.ok) return []
      const data = (await res.json()) as { research?: Array<LibraryEntry> }
      return data.research ?? []
    },
    enabled: activeTab === 'library',
    staleTime: 30_000,
  })

  const loadSavedResult = useCallback(async (entry: LibraryEntry) => {
    setActiveTab('new')
    setQuery(entry.query)
    setSessionId(entry.session_id)
    setSteps([])
    setErrorMsg(null)
    eventSourceRef.current?.close()

    if (entry.status === 'done') {
      try {
        const res = await fetch(`/api/odysseus/research/result-peek/${entry.session_id}`, { method: 'POST' })
        if (res.ok) {
          const data = (await res.json()) as { result?: string }
          if (data.result) {
            setResult(data.result)
            setPhase('done')
            appendStep('done', 'Loaded saved research report')
            return
          }
        }
      } catch {
        // fall through to idle
      }
    }
    setPhase('idle')
    setResult(null)
  }, [appendStep])

  const isRunning = phase === 'starting' || phase === 'probing' || phase === 'running'

  return (
    <div data-route-page className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-primary-200 px-4 py-3">
        <HugeiconsIcon icon={Search01Icon} size={20} strokeWidth={1.5} className="text-accent-500 shrink-0" />
        <h1 className="text-base font-semibold">Deep Research</h1>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('new')}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm transition-colors',
              activeTab === 'new'
                ? 'bg-accent-500/10 text-accent-500'
                : 'text-primary-500 hover:text-primary-900 dark:hover:text-neutral-100',
            )}
          >
            New
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('library')}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm transition-colors',
              activeTab === 'library'
                ? 'bg-accent-500/10 text-accent-500'
                : 'text-primary-500 hover:text-primary-900 dark:hover:text-neutral-100',
            )}
          >
            Library
          </button>
        </div>
      </div>

      {/* Content */}
      {activeTab === 'library' ? (
        <LibraryView
          entries={library ?? []}
          onSelect={loadSavedResult}
        />
      ) : (
        <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-y-auto p-4 md:p-6">

          {/* Query form */}
          {phase === 'idle' && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mx-auto w-full max-w-2xl"
            >
              <p className="mb-4 text-sm text-primary-500">
                Enter a research question. Odysseus will iteratively search, extract, and synthesize a detailed report.
              </p>
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void startResearch()
                }}
                placeholder="What do you want to research?"
                rows={4}
                className="w-full rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm outline-none transition-colors focus:border-accent-400"
              />
              <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-primary-500">
                <label className="flex items-center gap-2">
                  <span>Rounds</span>
                  <select
                    value={maxRounds}
                    onChange={(e) => setMaxRounds(Number(e.target.value))}
                    className="rounded-lg border border-primary-200 bg-transparent px-2 py-1 text-xs"
                  >
                    <option value={0}>Auto</option>
                    {[3, 5, 8, 10, 15, 20].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  <span>Max time</span>
                  <select
                    value={maxTime}
                    onChange={(e) => setMaxTime(Number(e.target.value))}
                    className="rounded-lg border border-primary-200 bg-transparent px-2 py-1 text-xs"
                  >
                    {[60, 120, 180, 300, 600, 900, 1200].map((s) => (
                      <option key={s} value={s}>{s < 60 ? `${s}s` : `${s / 60}m`}</option>
                    ))}
                  </select>
                </label>
                <Button
                  size="sm"
                  onClick={() => void startResearch()}
                  disabled={!query.trim()}
                  className="ml-auto gap-2"
                >
                  Start research
                  <HugeiconsIcon icon={ArrowRight01Icon} size={16} strokeWidth={2} />
                </Button>
              </div>
            </motion.div>
          )}

          {/* Progress */}
          <AnimatePresence>
            {(isRunning || phase === 'done' || phase === 'error' || phase === 'cancelled') && steps.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="mx-auto w-full max-w-2xl"
              >
                {/* Query label */}
                <div className="mb-4 flex items-start justify-between gap-4">
                  <p className="text-sm font-medium text-primary-900 leading-snug">
                    {query}
                  </p>
                  <div className="flex shrink-0 gap-2">
                    {isRunning && (
                      <Button size="sm" variant="outline" onClick={cancelResearch} className="gap-1.5 text-xs">
                        <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={2} />
                        Cancel
                      </Button>
                    )}
                    {!isRunning && (
                      <Button size="sm" variant="outline" onClick={reset} className="text-xs">
                        New research
                      </Button>
                    )}
                  </div>
                </div>

                {/* Steps */}
                <div className="space-y-1.5 rounded-xl border border-primary-200 bg-primary-50/50 p-3">
                  {steps.map((step) => (
                    <div key={step.id} className="flex items-start gap-2 text-xs">
                      <span className="mt-0.5 shrink-0">{phaseIcon(step.phase)}</span>
                      <span className="text-primary-600">{step.message}</span>
                    </div>
                  ))}
                  {isRunning && (
                    <div className="flex items-center gap-2 text-xs text-accent-500">
                      <HugeiconsIcon icon={Loading03Icon} size={14} strokeWidth={2} className="animate-spin" />
                      <span>Researching...</span>
                    </div>
                  )}
                  <div ref={stepsEndRef} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error */}
          {phase === 'error' && errorMsg && (
            <div className="mx-auto w-full max-w-2xl rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-400">
              {errorMsg}
            </div>
          )}

          {/* Result */}
          <AnimatePresence>
            {phase === 'done' && result && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="mx-auto w-full max-w-2xl"
              >
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary-400">
                  Research Report
                </div>
                <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4 text-sm text-[var(--theme-text)] [&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-semibold">
                  <Markdown>{result}</Markdown>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Post-research actions */}
          <AnimatePresence>
            {phase === 'done' && sessionId && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mx-auto w-full max-w-2xl flex flex-wrap gap-2"
              >
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => window.open(`/api/odysseus/research/report/${sessionId}`, '_blank')}
                >
                  <HugeiconsIcon icon={Telescope02Icon} size={14} strokeWidth={1.5} />
                  View full report
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      const res = await fetch(`/api/odysseus/research/spinoff/${sessionId}`, { method: 'POST' })
                      if (res.ok) {
                        const data = (await res.json()) as { session_id?: string }
                        if (data.session_id) {
                          void navigate({ to: '/chat/$sessionKey', params: { sessionKey: data.session_id } })
                        }
                      }
                    } catch {
                      // ignore
                    }
                  }}
                >
                  Continue in chat
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

// ── Library ──────────────────────────────────────────────────────────────────

function LibraryView({
  entries,
  onSelect,
}: {
  entries: Array<LibraryEntry>
  onSelect: (e: LibraryEntry) => void
}) {
  if (entries.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-primary-400">
        <div className="text-center">
          <HugeiconsIcon icon={BookOpen02Icon} size={32} strokeWidth={1} className="mx-auto mb-2 opacity-40" />
          No past research found
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-2xl space-y-2">
        {entries.filter((e) => !e.archived).map((entry) => (
          <button
            key={entry.session_id}
            type="button"
            onClick={() => onSelect(entry)}
            className="w-full rounded-xl border border-primary-200 bg-primary-50/50 p-3 text-left text-sm transition-colors hover:border-accent-400/50 hover:bg-accent-50/20 dark:hover:border-accent-500/30"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium text-primary-900 line-clamp-2">
                {entry.query}
              </span>
              <span
                className={cn(
                  'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
                  entry.status === 'done'
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    : 'bg-primary-100 text-primary-500',
                )}
              >
                {entry.status}
              </span>
            </div>
            {entry.created_at && (
              <span className="mt-1 block text-xs text-primary-400">
                {new Date(entry.created_at).toLocaleString()}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
