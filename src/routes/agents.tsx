import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { AgentsScreen } from '@/screens/agents/agents-screen'

export const Route = createFileRoute('/agents')({
  ssr: false,
  component: function AgentsRoute() {
    usePageTitle('Agent Team')
    return <AgentsScreen />
  },
})
