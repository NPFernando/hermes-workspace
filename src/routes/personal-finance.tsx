import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { PersonalFinanceScreen } from '@/screens/personal-finance/personal-finance-screen'

export const Route = createFileRoute('/personal-finance')({
  ssr: false,
  component: function PersonalFinanceRoute() {
    usePageTitle('Personal Finance')
    return <PersonalFinanceScreen />
  },
})
