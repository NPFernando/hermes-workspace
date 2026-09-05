import { createFileRoute } from '@tanstack/react-router'
import { ResearchScreen } from '@/screens/research/research-screen'
import { usePageTitle } from '@/hooks/use-page-title'

export const Route = createFileRoute('/research')({
  ssr: false,
  validateSearch: (search) => ({
    q: typeof search.q === 'string' ? search.q : undefined,
  }),
  component: ResearchRoute,
})

function ResearchRoute() {
  usePageTitle('Deep Research')
  return <ResearchScreen />
}
