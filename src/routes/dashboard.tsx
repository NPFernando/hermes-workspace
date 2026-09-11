import { createFileRoute } from '@tanstack/react-router'
import { Suspense, lazy } from 'react'
import { usePageTitle } from '@/hooks/use-page-title'

const DashboardScreen = lazy(() => import('@/screens/dashboard/dashboard-screen').then((module) => ({ default: module.DashboardScreen })))

export const Route = createFileRoute('/dashboard')({
  ssr: false,
  component: DashboardRoute,
})

function DashboardRoute() {
  usePageTitle('Dashboard')
  return <Suspense fallback={<main className="min-h-dvh bg-[var(--theme-bg)] p-6 text-[var(--theme-muted)]">Loading Dashboard…</main>}><DashboardScreen /></Suspense>
}
