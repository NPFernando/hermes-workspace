import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { TradingScreen } from '@/screens/trading/trading-screen'

export const Route = createFileRoute('/trading')({
  ssr: false,
  component: function TradingRoute() {
    usePageTitle('Trading')
    return <TradingScreen />
  },
})
