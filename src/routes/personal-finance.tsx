import { createFileRoute } from '@tanstack/react-router'
import { Suspense, lazy } from 'react'
import { usePageTitle } from '@/hooks/use-page-title'

const PersonalFinanceScreen = lazy(() => import('@/screens/personal-finance/personal-finance-screen').then((module) => ({ default: module.PersonalFinanceScreen })))

export const Route = createFileRoute('/personal-finance')({
  ssr: false,
  component: function PersonalFinanceRoute() {
    usePageTitle('Personal Finance')
    return <Suspense fallback={<main className="min-h-dvh bg-[var(--theme-bg)] p-6 text-[var(--theme-muted)]">Loading Personal Finance…</main>}><PersonalFinanceScreen /></Suspense>
  },
})
