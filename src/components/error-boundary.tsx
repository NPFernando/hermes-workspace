import { Component, useEffect } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type ErrorBoundaryProps = {
  children: ReactNode
  className?: string
  title?: string
  description?: string
}

type ErrorBoundaryState = {
  error: Error | null
  recovering: boolean
}

const REACT_DOM_RECOVERY_KEY = 'hermes-react-dom-recovery-at'
const REACT_DOM_RECOVERY_TTL_MS = 30_000
const STALE_ASSET_RECOVERY_KEY = 'hermes-stale-asset-recovery-at'
const STALE_ASSET_RECOVERY_TTL_MS = 30_000

function isReactDomReconciliationError(error: Error): boolean {
  const message = `${error.name}: ${error.message}`
  return (
    message.includes('Failed to execute') &&
    (message.includes('insertBefore') || message.includes('removeChild')) &&
    message.includes('not a child of this node')
  )
}

/**
 * Detects the "stale tab after redeploy" failure: a live deploy rebuilds
 * dist/ (deleting the old hashed JS/CSS chunks) before an already-open tab
 * requests one of them, so the fetch 404s. Bundlers/browsers surface this
 * with a range of wordings depending on chunk vs. CSS vs. Vite's own
 * preload-error event, so match on the common substrings rather than one
 * exact string.
 */
export function isStaleAssetError(error: Error): boolean {
  const message = `${error.name}: ${error.message}`.toLowerCase()
  return (
    message.includes('failed to fetch dynamically imported module') ||
    message.includes('importing a module script failed') ||
    message.includes('loading chunk') ||
    message.includes('loading css chunk') ||
    message.includes('unable to preload css') ||
    message.includes('load failed') // Safari's generic dynamic-import/module error text
  )
}

/**
 * Shared "clear caches, mark that we already tried, reload once" recovery
 * used for both the React-DOM-reconciliation and stale-asset error classes.
 * The sessionStorage TTL guard prevents an infinite reload loop if the
 * reload doesn't actually fix the underlying issue.
 */
function recoverOnce(storageKey: string, ttlMs: number): boolean {
  if (typeof window === 'undefined') return false
  const previous = Number(window.sessionStorage.getItem(storageKey) ?? '0')
  const alreadyRetried = Number.isFinite(previous)
    ? Date.now() - previous < ttlMs
    : false
  if (alreadyRetried) return false

  window.sessionStorage.setItem(storageKey, String(Date.now()))
  void clearStaleRuntimeCaches().finally(() => {
    window.location.reload()
  })
  return true
}

async function clearStaleRuntimeCaches(): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(
        registrations.map((registration) => registration.update()),
      )
    }
  } catch {
    // Best-effort only. Recovery should not fail because SW APIs are blocked.
  }
  try {
    if ('caches' in window) {
      const keys = await window.caches.keys()
      await Promise.all(keys.map((key) => window.caches.delete(key)))
    }
  } catch {
    // Best-effort only.
  }
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    error: null,
    recovering: false,
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error, recovering: false }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled UI error', error, errorInfo)

    if (typeof window === 'undefined') return

    if (isReactDomReconciliationError(error)) {
      if (recoverOnce(REACT_DOM_RECOVERY_KEY, REACT_DOM_RECOVERY_TTL_MS)) {
        this.setState({ recovering: true })
      }
      return
    }

    if (isStaleAssetError(error)) {
      if (recoverOnce(STALE_ASSET_RECOVERY_KEY, STALE_ASSET_RECOVERY_TTL_MS)) {
        this.setState({ recovering: true })
      }
    }
  }

  reloadPage() {
    if (typeof window === 'undefined') return
    window.location.reload()
  }

  render() {
    const error = this.state.error
    if (!error) return this.props.children

    const title = this.props.title ?? 'Something went wrong'
    const description = this.state.recovering
      ? 'Recovering from a stale DOM/runtime mismatch or an outdated app build. The page will reload automatically.'
      : (this.props.description ??
        'The chat encountered an unexpected issue. Reload to try again.')

    return (
      <div
        className={cn(
          'flex h-full min-h-0 items-center justify-center bg-[var(--theme-panel)] p-6',
          this.props.className,
        )}
      >
        <div className="w-full max-w-md rounded-xl border border-[var(--theme-border)] bg-[var(--theme-hover)] p-6 text-center shadow-sm">
          <h2 className="text-balance text-xl font-medium text-[var(--theme-text)]">
            {title}
          </h2>
          <p className="mt-2 text-pretty text-sm text-[var(--theme-muted)]">
            {description}
          </p>
          <pre className="mt-3 max-h-32 overflow-auto rounded bg-red-50 p-2 text-left text-[10px] text-red-800">
            {error.message}
            {'\n'}
            {error.stack?.split('\n').slice(0, 5).join('\n')}
          </pre>
          <div className="mt-5 flex justify-center">
            <Button onClick={() => this.reloadPage()}>Reload</Button>
          </div>
        </div>
      </div>
    )
  }
}

/**
 * Belt-and-suspenders for stale-asset recovery: dynamic import failures
 * (e.g. TanStack Router lazy route loading) reject a promise rather than
 * throwing during render, so they can bypass React error boundaries
 * entirely and surface only as an `unhandledrejection`. Vite also emits its
 * own `vite:preloadError` event for this exact case. Mount this once near
 * the app root (see routes/__root.tsx) alongside the other global listener
 * components.
 */
export function StaleAssetRecoveryListener(): null {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const tryRecover = (error: unknown) => {
      if (!(error instanceof Error) || !isStaleAssetError(error)) return
      recoverOnce(STALE_ASSET_RECOVERY_KEY, STALE_ASSET_RECOVERY_TTL_MS)
    }

    const handleRejection = (event: PromiseRejectionEvent) => {
      tryRecover(event.reason)
    }
    // Vite-specific event fired when a dynamically-imported module fails to
    // load; calling preventDefault() suppresses Vite's own console warning
    // since we're already handling recovery here.
    const handleVitePreloadError = (event: Event) => {
      event.preventDefault()
      tryRecover((event as ErrorEvent).error ?? new Error(event.type))
    }

    window.addEventListener('unhandledrejection', handleRejection)
    window.addEventListener('vite:preloadError', handleVitePreloadError)
    return () => {
      window.removeEventListener('unhandledrejection', handleRejection)
      window.removeEventListener('vite:preloadError', handleVitePreloadError)
    }
  }, [])

  return null
}
