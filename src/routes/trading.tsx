import { createFileRoute } from '@tanstack/react-router'
import { Suspense, lazy } from 'react'
import { usePageTitle } from '@/hooks/use-page-title'

const TradingScreen = lazy(() =>
  import('@/screens/trading/trading-screen').then((module) => ({
    default: module.TradingScreen,
  })),
)

export const Route = createFileRoute('/trading')({
  ssr: false,
  component: function TradingRoute() {
    usePageTitle('Trading')
    return (
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-sm text-[var(--theme-muted)]">
            Loading Trading…
          </div>
        }
      >
        <TradingScreen />
      </Suspense>
    )
  },
})
