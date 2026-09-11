import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { DifyWorkbenchScreen } from '@/screens/dify/dify-workbench-screen'

export const Route = createFileRoute('/dify')({
  ssr: false,
  component: DifyRoute,
})

function DifyRoute() {
  usePageTitle('Dify Workbench')
  return <DifyWorkbenchScreen />
}
