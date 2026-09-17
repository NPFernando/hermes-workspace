import { createFileRoute } from '@tanstack/react-router'
import { Suspense, lazy } from 'react'
import BackendUnavailableState from '@/components/backend-unavailable-state'
import { usePageTitle } from '@/hooks/use-page-title'
import { getUnavailableReason } from '@/lib/feature-gates'
import { useFeatureAvailable } from '@/hooks/use-feature-available'

const McpScreen = lazy(() =>
  import('@/screens/mcp/mcp-screen').then((module) => ({
    default: module.McpScreen,
  })),
)

export const Route = createFileRoute('/mcp')({
  ssr: false,
  component: McpRoute,
})

function McpRoute() {
  usePageTitle('MCP Servers')
  const native = useFeatureAvailable('mcp')
  const fallback = useFeatureAvailable('mcpFallback')
  if (!native && !fallback) {
    return (
      <BackendUnavailableState
        feature="MCP Servers"
        description={getUnavailableReason('mcp')}
      />
    )
  }
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-sm text-[var(--theme-muted)]">
          Loading MCP Servers…
        </div>
      }
    >
      <McpScreen />
    </Suspense>
  )
}
