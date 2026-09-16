import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { DifyIntegration, DifyStatus } from '@/server/dify'
import { usePageTitle } from '@/hooks/use-page-title'
import { FeatureNotReady } from '@/components/feature-not-ready'

export const Route = createFileRoute('/dify')({ ssr: false, component: DifyRoute })

type IntegrationResponse = DifyIntegration & { ok?: boolean; error?: string }

function DifyRoute() {
  usePageTitle('Dify Workbench')
  const [status, setStatus] = useState<DifyStatus | null>(null)
  const [integration, setIntegration] = useState<IntegrationResponse | null>(null)
  const [workflowId, setWorkflowId] = useState('')
  const [prompt, setPrompt] = useState('')
  const [output, setOutput] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refreshIntegration() {
    const response = await fetch('/api/dify-integration', { cache: 'no-store' })
    const data = (await response.json()) as IntegrationResponse
    if (response.ok) {
      setIntegration(data)
      if (!workflowId && data.workflows?.[0]) setWorkflowId(data.workflows[0].id)
    }
  }

  useEffect(() => {
    void Promise.all([
      fetch('/api/dify-status', { cache: 'no-store' }).then((response) => response.json() as Promise<DifyStatus>),
      refreshIntegration(),
    ]).then(([nextStatus]) => setStatus(nextStatus)).catch(() => {
      setStatus({ enabled: false, configured: false, available: false, url: null, detail: 'Dify status is unavailable.' })
    })
  }, [])

  if (!status) return <main className="min-h-dvh bg-[var(--theme-bg)] p-6 text-[var(--theme-muted)]">Loading Dify Workbench…</main>
  if (!status.enabled) return <FeatureNotReady feature="Dify Workbench" reason="Enable DIFY_WORKBENCH_ENABLED and configure DIFY_WORKBENCH_URL on the server to use this optional integration." />

  async function runWorkflow() {
    setBusy(true)
    setError(null)
    setOutput(null)
    try {
      const response = await fetch('/api/dify-integration', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workflowId, inputs: { prompt } }),
      })
      const data = (await response.json()) as { ok?: boolean; error?: string; outputs?: unknown; history?: DifyIntegration['history'] }
      if (!response.ok || !data.ok) throw new Error(data.error || `Dify returned HTTP ${response.status}`)
      setOutput(typeof data.outputs === 'string' ? data.outputs : JSON.stringify(data.outputs, null, 2))
      await refreshIntegration()
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Dify workflow failed.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="min-h-dvh overflow-y-auto bg-[var(--theme-bg)] p-4 text-[var(--theme-text)] md:p-8">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--theme-success)]">Workbench</p><h1 className="mt-1 text-3xl font-semibold">Dify Workbench</h1></div>
      <span className={`rounded-full px-3 py-1 text-xs font-medium ${status.available ? 'bg-[var(--theme-success)]/15 text-[var(--theme-success)]' : 'bg-[var(--theme-warning)]/15 text-[var(--theme-warning)]'}`}>{status.available ? 'Provider healthy' : 'Provider unavailable'}</span>
    </div>
    {!status.available && <p className="mb-4 rounded-2xl border border-[var(--theme-warning)]/40 bg-[var(--theme-warning)]/10 p-3 text-sm text-[var(--theme-muted)]">{status.detail}</p>}
    <div className="grid max-w-5xl gap-4 lg:grid-cols-[1.2fr_0.8fr]">
      <section className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-5">
        <h2 className="text-lg font-semibold">Public workflow runner</h2>
        <p className="mt-1 text-sm text-[var(--theme-muted)]">Only explicitly configured workflows can run. Inputs are public-only and are never saved in Hermes history.</p>
        {integration?.workflows?.length ? <>
          <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-[var(--theme-muted)]" htmlFor="dify-workflow">Provider / workflow</label>
          <select id="dify-workflow" value={workflowId} onChange={(event) => setWorkflowId(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3">
            {integration.workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.provider} · {workflow.name}</option>)}
          </select>
          <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-[var(--theme-muted)]" htmlFor="dify-prompt">Public prompt</label>
          <textarea id="dify-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={8000} rows={7} placeholder="Example: summarize this public release note…" className="mt-1 w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-3" />
          <button type="button" disabled={busy || !prompt.trim() || !status.available} onClick={() => void runWorkflow()} className="mt-3 min-h-11 rounded-xl bg-[var(--theme-success)] px-4 font-semibold text-[var(--theme-bg)] disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Running…' : 'Run workflow'}</button>
        </> : <p className="mt-4 rounded-xl border border-[var(--theme-border)] p-3 text-sm text-[var(--theme-muted)]">{integration?.detail || 'No Dify workflows are configured.'}</p>}
        {error && <p className="mt-3 rounded-xl border border-[var(--theme-danger)]/40 bg-[var(--theme-danger)]/10 p-3 text-sm text-[var(--theme-danger)]">{error}</p>}
        {output && <pre className="mt-4 max-h-80 overflow-auto rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-3 text-xs whitespace-pre-wrap">{output}</pre>}
      </section>
      <section className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-5">
        <h2 className="text-lg font-semibold">Execution history</h2>
        <p className="mt-1 text-sm text-[var(--theme-muted)]">Metadata only: workflow, provider, status, timing, and run ID.</p>
        <div className="mt-4 space-y-2">
          {(integration?.history ?? []).slice(0, 12).map((run) => <div key={run.id} className="rounded-xl border border-[var(--theme-border)] p-3 text-xs">
            <div className="flex justify-between gap-2"><span className="font-medium">{run.workflowName}</span><span className={run.status === 'succeeded' ? 'text-[var(--theme-success)]' : 'text-[var(--theme-danger)]'}>{run.status}</span></div>
            <div className="mt-1 text-[var(--theme-muted)]">{run.provider} · {new Date(run.finishedAt).toLocaleString()}</div>
            {run.runId && <div className="mt-1 truncate text-[var(--theme-muted)]">run: {run.runId}</div>}
            {run.error && <div className="mt-1 text-[var(--theme-danger)]">{run.error}</div>}
          </div>)}
          {!integration?.history?.length && <p className="text-sm text-[var(--theme-muted)]">No executions yet.</p>}
        </div>
      </section>
    </div>
    <p className="mt-4 max-w-5xl text-xs text-[var(--theme-muted)]">Privacy mode: {integration?.privacy.mode ?? 'public-only'} · {integration?.privacy.historyStores ?? 'metadata-only'}. Hermes never sends private finance, astrology, repository, account, credential, or contact data to Dify.</p>
    {status.url && <a href={status.url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-11 items-center rounded-xl border border-[var(--theme-border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--theme-panel)]">Open full Dify Workbench ↗</a>}
  </main>
}
