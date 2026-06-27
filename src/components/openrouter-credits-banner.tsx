import { useEffect, useRef, useState } from 'react'

type CreditsLevel = 'ok' | 'warning' | 'critical' | 'exhausted'

type CreditsData = {
  remaining: number
  level: CreditsLevel
}

const POLL_INTERVAL_MS = 30 * 60_000 // 30 min

// Per-session dismissed level — banner re-appears if level worsens
const DISMISSED_KEY = 'or-credits-dismissed-level'

const LEVEL_SEVERITY: Record<CreditsLevel, number> = {
  ok: 0,
  warning: 1,
  critical: 2,
  exhausted: 3,
}

function isDismissed(level: CreditsLevel): boolean {
  const stored = sessionStorage.getItem(DISMISSED_KEY) as CreditsLevel | null
  if (!stored) return false
  return LEVEL_SEVERITY[stored] >= LEVEL_SEVERITY[level]
}

function dismiss(level: CreditsLevel) {
  sessionStorage.setItem(DISMISSED_KEY, level)
}

async function fetchCredits(): Promise<CreditsData | null> {
  try {
    const res = await fetch('/api/openrouter-credits', { cache: 'no-store' })
    if (!res.ok) return null
    return res.json() as Promise<CreditsData>
  } catch {
    return null
  }
}

export function OpenRouterCreditsBanner() {
  const [data, setData] = useState<CreditsData | null>(null)
  const [visible, setVisible] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    async function check() {
      const credits = await fetchCredits()
      if (!mountedRef.current) return
      setData(credits)
      if (credits && credits.level !== 'ok' && !isDismissed(credits.level)) {
        setVisible(true)
      }
    }

    void check()
    const interval = window.setInterval(() => { void check() }, POLL_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [])

  function handleDismiss() {
    if (data) dismiss(data.level)
    setVisible(false)
  }

  if (!visible || !data || data.level === 'ok') return null

  const isExhausted = data.level === 'exhausted'
  const isCritical = data.level === 'critical'

  const borderColor = isExhausted || isCritical ? 'var(--theme-danger)' : '#f59e0b'
  const textColor = isExhausted || isCritical ? 'var(--theme-danger)' : '#f59e0b'
  const dotColor = borderColor

  const label = isExhausted
    ? 'OpenRouter paid credits exhausted — free-tier models only'
    : isCritical
    ? `OpenRouter credits critical: $${data.remaining} remaining`
    : `OpenRouter credits low: $${data.remaining} remaining`

  return (
    <div
      className="fixed inset-x-0 z-40 px-4"
      style={{ top: 'calc(var(--titlebar-h, 0px) + 4px)' }}
    >
      <div
        className="mx-auto flex max-w-5xl items-center justify-between gap-3 rounded-lg border px-4 py-2 shadow-md bg-[var(--theme-card)]"
        style={{ borderColor }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ background: dotColor }}
          />
          <p className="text-xs font-medium truncate" style={{ color: textColor }}>
            {label}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <a
            href="/settings?section=providers"
            className="text-xs font-medium underline-offset-2 hover:underline"
            style={{ color: textColor }}
          >
            Manage
          </a>
          <button
            type="button"
            onClick={handleDismiss}
            className="text-xs opacity-60 hover:opacity-100 transition-opacity"
            style={{ color: textColor }}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}
