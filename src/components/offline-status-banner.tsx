import { useEffect, useState } from 'react'

/** Live-network status only; service-worker/API responses remain uncached. */
export function OfflineStatusBanner() {
  const [online, setOnline] = useState(true)

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  if (online) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 top-3 z-[100] mx-auto flex max-w-xl items-center justify-between gap-3 rounded-xl border border-amber-400/40 bg-[var(--theme-panel)]/95 px-3 py-2 text-xs text-[var(--theme-text)] shadow-xl backdrop-blur"
    >
      <span>
        Offline mode: cached screens remain available, but live agent and API
        actions are paused.
      </span>
      <button
        type="button"
        className="shrink-0 rounded-lg border border-[var(--theme-border)] px-2 py-1 font-medium hover:bg-[var(--theme-hover)]"
        onClick={() => window.location.reload()}
      >
        Retry
      </button>
    </div>
  )
}
