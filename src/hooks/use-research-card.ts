import { useCallback, useEffect, useRef, useState } from 'react'

export interface ResearchStep {
  id: string
  name: string
  label: string
  args: string
  delay: number
  duration: number
  durationMs: number
  status: 'pending' | 'running' | 'done'
}

export interface UseResearchCardResult {
  isVisible: boolean
  isActive: boolean
  currentStep: number
  steps: Array<ResearchStep>
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
  totalDurationMs: number
  dismiss: () => void
}

// Module-level store: sessionKey → Odysseus session ID
const _active = new Map<string, string>()
let _version = 0
const _listeners = new Set<() => void>()

function notifyListeners() {
  _version++
  for (const fn of _listeners) fn()
}

export function setActiveResearch(sessionKey: string, odysseusSessionId: string) {
  _active.set(sessionKey, odysseusSessionId)
  notifyListeners()
}

export function clearActiveResearch(sessionKey: string) {
  _active.delete(sessionKey)
  notifyListeners()
}

type ProgressEvent = {
  status?: string
  phase?: string
  message?: string
  final?: boolean
  error?: string
}

function phaseLabel(phase: string | undefined): string {
  switch (phase) {
    case 'probing': return 'Probing model...'
    case 'thinking': return 'Thinking...'
    case 'searching': return 'Searching...'
    case 'extracting': return 'Extracting sources...'
    case 'synthesizing': return 'Synthesizing report...'
    case 'done': return 'Research complete'
    case 'error': return 'Research failed'
    default: return phase ?? 'Working...'
  }
}

export function useResearchCard(opts?: {
  sessionKey?: string | null
  isStreaming?: boolean
  resetKey?: string
}): UseResearchCardResult {
  const sessionKey = opts?.sessionKey ?? null
  const resetKey = opts?.resetKey

  const [collapsed, setCollapsed] = useState(true)
  const [steps, setSteps] = useState<Array<ResearchStep>>([])
  const [isActive, setIsActive] = useState(false)
  const [startTime] = useState(() => Date.now())
  const [now, setNow] = useState(Date.now())
  const [dismissed, setDismissed] = useState(false)
  // Track store version to re-render when active sessions change
  const [, setStoreVersion] = useState(0)
  const esRef = useRef<EventSource | null>(null)
  const stepCounterRef = useRef(0)
  const trackedIdRef = useRef<string | null>(null)

  // Subscribe to module-level store changes
  useEffect(() => {
    const handler = () => setStoreVersion((v) => v + 1)
    _listeners.add(handler)
    return () => { _listeners.delete(handler) }
  }, [])

  // Reset on resetKey change
  useEffect(() => {
    esRef.current?.close()
    esRef.current = null
    trackedIdRef.current = null
    setSteps([])
    setIsActive(false)
    setDismissed(false)
    stepCounterRef.current = 0
  }, [resetKey])

  // Open SSE stream when a research session becomes active for this sessionKey
  useEffect(() => {
    if (!sessionKey || dismissed) return
    const odysseusId = _active.get(sessionKey)
    if (!odysseusId || odysseusId === trackedIdRef.current) return

    // New research session detected
    trackedIdRef.current = odysseusId
    esRef.current?.close()
    setSteps([])
    setIsActive(true)
    setCollapsed(false)
    stepCounterRef.current = 0

    const es = new EventSource(`/api/odysseus/research/stream/${odysseusId}`)
    esRef.current = es

    es.onmessage = (evt) => {
      try {
        const event = JSON.parse(evt.data as string) as ProgressEvent
        const phase = event.phase ?? event.status ?? 'running'
        const label = event.message ?? phaseLabel(phase)
        const isFinal = event.final === true || event.status === 'done' || event.status === 'error' || event.status === 'cancelled'

        stepCounterRef.current += 1
        const step: ResearchStep = {
          id: String(stepCounterRef.current),
          name: phase,
          label,
          args: '',
          delay: 0,
          duration: 0,
          durationMs: Date.now() - startTime,
          status: isFinal ? 'done' : 'running',
        }

        setSteps((prev) => [...prev, step])
        setNow(Date.now())

        if (isFinal) {
          setIsActive(false)
          es.close()
          clearActiveResearch(sessionKey)
        }
      } catch {
        // ignore parse errors
      }
    }

    es.onerror = () => {
      setIsActive(false)
      es.close()
    }

    return () => {
      es.close()
    }
  }, [sessionKey, dismissed, startTime, _version])

  // Tick for totalDurationMs while active
  useEffect(() => {
    if (!isActive) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [isActive])

  const dismiss = useCallback(() => {
    esRef.current?.close()
    setDismissed(true)
    setSteps([])
    setIsActive(false)
    if (sessionKey) clearActiveResearch(sessionKey)
  }, [sessionKey])

  const odysseusId = sessionKey ? _active.get(sessionKey) : undefined
  const isVisible = !dismissed && (steps.length > 0 || (!!odysseusId && isActive))
  const currentStep = steps.filter((s) => s.status === 'done').length

  return {
    isVisible,
    isActive,
    currentStep,
    steps,
    collapsed,
    setCollapsed,
    totalDurationMs: now - startTime,
    dismiss,
  }
}
