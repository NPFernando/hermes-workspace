import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { Swarm2Screen } from '@/screens/swarm2/swarm2-screen'

export const Route = createFileRoute('/swarm')({
  ssr: false,
  component: function SwarmRoute() {
    usePageTitle('Swarm')
    return <Swarm2Screen />
  },
  errorComponent: function SwarmError({ error }) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center bg-[var(--theme-panel)]">
        <h2 className="text-xl font-semibold text-[var(--theme-text)] mb-3">
          Failed to Load Swarm
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
  pendingComponent: function SwarmPending() {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="spinner-accent spinner-xl mb-3" />
          <p className="text-sm text-[var(--theme-muted)]">Loading swarm...</p>
        </div>
      </div>
    )
  },
})
