import { Suspense, lazy } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'

const TerminalWorkspace = lazy(() =>
  import('@/components/terminal/terminal-workspace').then((m) => ({
    default: m.TerminalWorkspace,
  })),
)

export const Route = createFileRoute('/terminal')({
  ssr: false,
  component: TerminalRoute,
  errorComponent: function TerminalError({ error }) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center bg-[var(--theme-panel)]">
        <h2 className="text-xl font-semibold text-[var(--theme-text)] mb-3">
          Terminal Error
        </h2>
        <p className="text-sm text-[var(--theme-muted)] mb-4 max-w-md">
          {error instanceof Error
            ? error.message
            : 'Failed to initialize terminal'}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-accent-500 text-white rounded-lg hover:bg-accent-600 transition-colors"
        >
          Reload Terminal
        </button>
      </div>
    )
  },
})

function TerminalRoute() {
  usePageTitle('Terminal')
  // Terminal is rendered persistently in WorkspaceShell — return null here to avoid double mount
  return null
}
