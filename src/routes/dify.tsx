import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { DifyStatus } from '@/server/dify'
import { usePageTitle } from '@/hooks/use-page-title'
import { FeatureNotReady } from '@/components/feature-not-ready'

export const Route = createFileRoute('/dify')({ ssr: false, component: DifyRoute })

function DifyRoute() {
  usePageTitle('Dify Workbench')
  const [status, setStatus] = useState<DifyStatus | null>(null)
  useEffect(() => { void fetch('/api/dify-status', { cache: 'no-store' }).then((response) => response.json()).then(setStatus).catch(() => setStatus({ enabled: false, configured: false, available: false, url: null, detail: 'Dify status is unavailable.' })) }, [])
  if (!status) return <main className="min-h-dvh bg-[var(--theme-bg)] p-6 text-[var(--theme-muted)]">Loading Dify Workbench…</main>
  if (!status.enabled) return <FeatureNotReady feature="Dify Workbench" reason="Enable DIFY_WORKBENCH_ENABLED and configure DIFY_WORKBENCH_URL on the server to use this optional integration." />
  return <main className="min-h-dvh overflow-y-auto bg-[var(--theme-bg)] p-4 text-[var(--theme-text)] md:p-8">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--theme-success)]">Workbench</p><h1 className="mt-1 text-3xl font-semibold">Dify Workbench</h1></div><span className={`rounded-full px-3 py-1 text-xs font-medium ${status.available ? 'bg-[var(--theme-success)]/15 text-[var(--theme-success)]' : 'bg-[var(--theme-warning)]/15 text-[var(--theme-warning)]'}`}>{status.available ? 'Provider healthy' : 'Provider unavailable'}</span></div>
    {!status.available && <p className="mb-4 rounded-2xl border border-[var(--theme-warning)]/40 bg-[var(--theme-warning)]/10 p-3 text-sm text-[var(--theme-muted)]">{status.detail}</p>}
    {status.available && status.url && <iframe title="Dify Workbench" src={status.url} className="min-h-[calc(100dvh-10rem)] w-full rounded-2xl border border-[var(--theme-border)] bg-white" />}
  </main>
}
