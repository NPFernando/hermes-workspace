import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { FinanceScreen } from '@/screens/finance/finance-screen'

export const Route = createFileRoute('/finance')({
  ssr: false,
  component: function FinanceRoute() {
    usePageTitle('Finance')
    return <FinanceScreen />
  },
})
