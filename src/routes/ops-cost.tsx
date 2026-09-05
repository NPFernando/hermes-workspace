import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { OpsCostScreen } from '@/screens/ops/ops-cost-screen'

export const Route = createFileRoute('/ops-cost')({
  ssr: false,
  component: function OpsCostRoute() {
    usePageTitle('Cost & Routing')
    return <OpsCostScreen />
  },
  errorComponent: function OpsCostError({ error }) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center bg-[var(--theme-panel)]">
        <h2 className="text-xl font-semibold text-[var(--theme-text)] mb-3">
          Failed to Load Cost &amp; Routing
        </h2>
        <p className="text-sm text-[var(--theme-muted)] mb-4 max-w-md">
          {error instanceof Error
            ? error.message
            : 'An unexpected error occurred'}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-accent-500 text-white rounded-lg hover:bg-accent-600 transition-colors"
        >
          Reload Page
        </button>
      </div>
    )
  },
  pendingComponent: function OpsCostPending() {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="spinner-accent spinner-xl mb-3" />
          <p className="text-sm text-[var(--theme-muted)]">
            Loading cost &amp; routing…
          </p>
        </div>
      </div>
    )
  },
})
