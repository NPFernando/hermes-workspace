import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type DifyApp = {
  id: string
  label: string
  configured: boolean
  enabled: boolean
}

type DifyInfo = {
  name?: string
  description?: string
  mode?: string
}

type DifyRunMode = 'workflow' | 'chat' | 'completion'

type StreamEvent = {
  event?: string
  code?: string
  status?: number
  task_id?: string
  workflow_run_id?: string
  answer?: string
  text?: string
  outputs?: Record<string, unknown>
  data?: Record<string, unknown>
  message?: string
  conversation_id?: string
}

type DifyInputField = {
  variable: string
  label: string
  type: 'text' | 'paragraph' | 'number' | 'select' | 'checkbox'
  required: boolean
  defaultValue?: string | number | boolean
  options?: Array<string>
  description?: string
}

type RecentRun = {
  id: string
  appId: string
  mode: DifyRunMode
  query: string
  conversationId: string
  output: string
  createdAt: string
}

type DifyAuditEntry = {
  action?: string
  appId?: string
  mode?: string
  outcome?: string
  status?: number
  durationMs?: number
  timestamp?: string
}

type DifyAuditSummary = {
  total: number
  success: number
  failure: number
  rateLimited: number
  averageDurationMs: number | null
  last24h: number
  lastEventAt: string | null
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string
  }
  if (!response.ok)
    throw new Error(payload.error || `Request failed (${response.status})`)
  return payload
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

export function extractEventData(raw: string): StreamEvent | null {
  const data = raw
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('')
  if (!data || data === '[DONE]') return null
  try {
    return JSON.parse(data) as StreamEvent
  } catch {
    return { text: data }
  }
}

export function streamFailureMessage(event: StreamEvent): string | null {
  const name = event.event?.toLowerCase() ?? ''
  if (!name.includes('error') && !name.endsWith('_failed')) return null
  const nestedMessage =
    event.data && typeof event.data.message === 'string'
      ? event.data.message
      : undefined
  return (
    event.message ||
    nestedMessage ||
    (event.code ? `Dify run failed (${event.code})` : 'Dify run failed')
  )
}

function getInputFields(
  parameters: Record<string, unknown>,
): Array<DifyInputField> {
  const form = parameters.user_input_form
  if (!Array.isArray(form)) return []
  return form.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const [typeKey, rawConfig] = Object.entries(entry)[0] ?? []
    if (!typeKey || !rawConfig || typeof rawConfig !== 'object') return []
    const config = rawConfig as Record<string, unknown>
    const variable = typeof config.variable === 'string' ? config.variable : ''
    if (!variable) return []
    const type =
      typeKey === 'paragraph'
        ? 'paragraph'
        : typeKey === 'number'
          ? 'number'
          : typeKey === 'select'
            ? 'select'
            : typeKey === 'checkbox'
              ? 'checkbox'
              : 'text'
    const options = Array.isArray(config.options)
      ? config.options.filter(
          (option): option is string => typeof option === 'string',
        )
      : undefined
    const defaultValue = config.default
    return [
      {
        variable,
        label: typeof config.label === 'string' ? config.label : variable,
        type,
        required: config.required === true,
        defaultValue:
          typeof defaultValue === 'string' ||
          typeof defaultValue === 'number' ||
          typeof defaultValue === 'boolean'
            ? defaultValue
            : undefined,
        options,
        description: typeof config.hint === 'string' ? config.hint : undefined,
      },
    ]
  })
}

function fieldDefaults(
  fields: Array<DifyInputField>,
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    fields.map((field) => [
      field.variable,
      field.defaultValue ?? (field.type === 'checkbox' ? false : ''),
    ]),
  )
}

const HISTORY_KEY = 'hermes.dify.recent-runs.v1'

export function DifyWorkbenchScreen() {
  const [selectedId, setSelectedId] = useState('')
  const [mode, setMode] = useState<DifyRunMode>('workflow')
  const [query, setQuery] = useState('')
  const [inputs, setInputs] = useState('{}')
  const [inputMode, setInputMode] = useState<'form' | 'json'>('form')
  const [fieldValues, setFieldValues] = useState<
    Record<string, string | number | boolean>
  >({})
  const [responseMode, setResponseMode] = useState<'streaming' | 'blocking'>(
    'streaming',
  )
  const [conversationId, setConversationId] = useState('')
  const [uploadedFiles, setUploadedFiles] = useState<
    Array<Record<string, unknown>>
  >([])
  const [uploading, setUploading] = useState(false)
  const [recentRuns, setRecentRuns] = useState<Array<RecentRun>>([])
  const [output, setOutput] = useState('')
  const [runId, setRunId] = useState('')
  const [taskId, setTaskId] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const abortControllerRef = useRef<AbortController | null>(null)

  const statusQuery = useQuery({
    queryKey: ['dify', 'status'],
    queryFn: () =>
      readJson<{
        enabled: boolean
        reachable: boolean
        reason?: string
        apps?: number
        appKeysConfigured?: number
        configErrors?: Array<string>
      }>('/api/dify'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
  const appsQuery = useQuery({
    queryKey: ['dify', 'apps'],
    queryFn: () => readJson<{ apps: Array<DifyApp> }>('/api/dify/apps'),
    enabled: statusQuery.data?.enabled === true,
  })
  const infoQuery = useQuery({
    queryKey: ['dify', 'info', selectedId],
    queryFn: () =>
      readJson<{ info: DifyInfo }>(
        `/api/dify/apps/${encodeURIComponent(selectedId)}/info`,
      ),
    enabled:
      selectedId.length > 0 &&
      appsQuery.data?.apps.some(
        (app) => app.id === selectedId && app.configured,
      ) === true,
  })
  const parametersQuery = useQuery({
    queryKey: ['dify', 'parameters', selectedId],
    queryFn: () =>
      readJson<{ parameters: Record<string, unknown> }>(
        `/api/dify/apps/${encodeURIComponent(selectedId)}/parameters`,
      ),
    enabled:
      selectedId.length > 0 &&
      appsQuery.data?.apps.some(
        (app) => app.id === selectedId && app.configured,
      ) === true,
  })
  const auditQuery = useQuery({
    queryKey: ['dify', 'history'],
    queryFn: () =>
      readJson<{ entries: Array<DifyAuditEntry> }>('/api/dify/history'),
    enabled: statusQuery.data?.enabled === true,
    staleTime: 15_000,
  })
  const metricsQuery = useQuery({
    queryKey: ['dify', 'metrics'],
    queryFn: () => readJson<{ summary: DifyAuditSummary }>('/api/dify/metrics'),
    enabled: statusQuery.data?.enabled === true,
    staleTime: 15_000,
  })

  const selectedApp = useMemo(
    () => appsQuery.data?.apps.find((app) => app.id === selectedId),
    [appsQuery.data?.apps, selectedId],
  )
  const selectedAppConfigured = selectedApp?.configured === true

  const inputFields = useMemo(
    () => getInputFields(parametersQuery.data?.parameters ?? {}),
    [parametersQuery.data?.parameters],
  )

  useEffect(() => {
    setFieldValues(fieldDefaults(inputFields))
    if (inputFields.length > 0) setInputMode('form')
  }, [inputFields])

  useEffect(() => {
    if (!selectedId && appsQuery.data?.apps.length) {
      const firstConfigured = appsQuery.data.apps.find((app) => app.configured)
      setSelectedId((firstConfigured ?? appsQuery.data.apps[0]).id)
    }
  }, [appsQuery.data?.apps, selectedId])

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(HISTORY_KEY)
      if (stored) setRecentRuns(JSON.parse(stored) as Array<RecentRun>)
    } catch {
      // Ignore unavailable or malformed browser storage.
    }
  }, [])

  function saveRecentRun(entry: Omit<RecentRun, 'id' | 'createdAt'>) {
    const next = [
      {
        ...entry,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      },
      ...recentRuns,
    ].slice(0, 10)
    setRecentRuns(next)
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
    } catch {
      // History is an enhancement; execution should still succeed.
    }
  }

  async function consumeStream(response: Response): Promise<string> {
    if (!response.body) throw new Error('Dify returned no response stream')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let text = ''
    let rendered = ''
    let streamDone = false
    const processEvent = (event: StreamEvent | null) => {
      if (!event) return
      const failure = streamFailureMessage(event)
      if (failure) throw new Error(failure)
      if (event.task_id) setTaskId(event.task_id)
      if (event.workflow_run_id) setRunId(event.workflow_run_id)
      if (event.conversation_id) setConversationId(event.conversation_id)
      const nextText = event.answer || event.text
      if (nextText) {
        text += nextText
        rendered = text
        setOutput(rendered)
      }
      if (event.outputs) {
        rendered = pretty(event.outputs)
        setOutput(rendered)
      }
      if (event.event === 'workflow_finished' && event.data) {
        rendered = pretty(event.data)
        setOutput(rendered)
      }
    }
    while (!streamDone) {
      const chunk = await reader.read()
      if (chunk.done) {
        streamDone = true
        continue
      }
      buffer += decoder.decode(chunk.value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop() || ''
      for (const part of parts) {
        processEvent(extractEventData(part))
      }
    }
    processEvent(extractEventData(buffer + decoder.decode()))
    return rendered
  }

  async function runApp() {
    if (!selectedId) return
    setRunning(true)
    setError('')
    setOutput('')
    setRunId('')
    setTaskId('')
    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller
    try {
      const parsed =
        inputMode === 'form'
          ? fieldValues
          : (JSON.parse(inputs || '{}') as unknown)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Inputs must be a JSON object')
      }
      if (
        inputMode === 'form' &&
        inputFields.some(
          (field) => field.required && fieldValues[field.variable] === '',
        )
      ) {
        throw new Error('Complete all required Dify inputs before running')
      }
      const response = await fetch(
        `/api/dify/apps/${encodeURIComponent(selectedId)}/run`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode,
            inputs: parsed,
            query: query || undefined,
            response_mode: responseMode,
            conversation_id: conversationId || undefined,
            files: uploadedFiles.length > 0 ? uploadedFiles : undefined,
          }),
          signal: controller.signal,
        },
      )
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string
        }
        throw new Error(payload.error || `Dify run failed (${response.status})`)
      }
      let finalOutput = ''
      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        finalOutput = await consumeStream(response)
      } else {
        const payload = (await response.json()) as Record<string, unknown>
        if (typeof payload.conversation_id === 'string') {
          setConversationId(payload.conversation_id)
        }
        finalOutput = pretty(payload)
        setOutput(finalOutput)
      }
      saveRecentRun({
        appId: selectedId,
        mode,
        query,
        conversationId,
        output: finalOutput,
      })
    } catch (runError) {
      if (runError instanceof DOMException && runError.name === 'AbortError') {
        setError('Dify run cancelled')
      } else {
        setError(
          runError instanceof Error ? runError.message : 'Dify run failed',
        )
      }
    } finally {
      setRunning(false)
      abortControllerRef.current = null
    }
  }

  async function uploadFile(file: File) {
    if (!selectedId) return
    setUploading(true)
    setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      const response = await fetch(
        `/api/dify/apps/${encodeURIComponent(selectedId)}/files`,
        { method: 'POST', body: form },
      )
      const payload = (await response.json().catch(() => ({}))) as {
        file?: Record<string, unknown>
        error?: string
      }
      if (!response.ok || !payload.file) {
        throw new Error(payload.error || `Upload failed (${response.status})`)
      }
      const uploaded = payload.file
      setUploadedFiles((current) => [
        ...current,
        {
          type: String(uploaded.mime_type ?? '').startsWith('image/')
            ? 'image'
            : 'document',
          transfer_method: 'local_file',
          upload_file_id: uploaded.id,
          name: uploaded.name,
        },
      ])
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : 'Upload failed',
      )
    } finally {
      setUploading(false)
    }
  }

  async function stopRun() {
    abortControllerRef.current?.abort()
    if (!selectedId || !taskId) {
      setRunning(false)
      return
    }
    try {
      const response = await fetch(
        `/api/dify/apps/${encodeURIComponent(selectedId)}/stop`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, mode }),
        },
      )
      if (!response.ok) throw new Error(`Stop failed (${response.status})`)
      setRunning(false)
    } catch (stopError) {
      setError(
        stopError instanceof Error
          ? stopError.message
          : 'Unable to stop the Dify run',
      )
    }
  }

  function loadRecentRun(entry: RecentRun) {
    setSelectedId(entry.appId)
    setMode(entry.mode)
    setQuery(entry.query)
    setConversationId(entry.conversationId)
    setOutput(entry.output)
  }

  async function reconnect() {
    if (!selectedId || !runId) return
    setRunning(true)
    setError('')
    try {
      const response = await fetch(
        `/api/dify/runs/${encodeURIComponent(selectedId)}/${encodeURIComponent(runId)}/events`,
      )
      if (!response.ok) throw new Error(`Reconnect failed (${response.status})`)
      await consumeStream(response)
    } catch (runError) {
      setError(
        runError instanceof Error ? runError.message : 'Reconnect failed',
      )
    } finally {
      setRunning(false)
    }
  }

  const status = statusQuery.data
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--theme-accent)]">
            Optional runtime
          </p>
          <h1 className="mt-1 text-2xl font-bold text-[var(--theme-text)]">
            Dify Workbench
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--theme-muted)]">
            Run published Dify apps from the workspace while keeping workflow
            editing in Dify.
          </p>
        </div>
        <div
          className={cn(
            'rounded-full border px-3 py-1 text-xs font-medium',
            status?.reachable
              ? 'border-green-300/40 bg-green-500/10 text-green-600'
              : 'border-[var(--theme-border)] bg-[var(--theme-card)] text-[var(--theme-muted)]',
          )}
        >
          {statusQuery.isPending
            ? 'Checking Dify…'
            : status?.reachable
              ? 'Dify connected'
              : status?.enabled
                ? 'Dify unavailable'
                : 'Dify disabled'}
        </div>
      </header>

      {statusQuery.isError ? (
        <section className="rounded-2xl border border-red-300/30 bg-red-500/10 p-5 text-sm text-red-600">
          {statusQuery.error instanceof Error
            ? statusQuery.error.message
            : 'Unable to read Dify status'}
        </section>
      ) : !status?.enabled ? (
        <section className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-5 text-sm text-[var(--theme-muted)]">
          {status?.configErrors?.length ? (
            <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-red-600">
              {status.configErrors.join(' · ')}
            </div>
          ) : null}
          Enable Dify with <code>DIFY_ENABLED=true</code>, configure{' '}
          <code>DIFY_BASE_URL</code> and <code>DIFY_APPS_JSON</code>, then
          refresh this page.
        </section>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
          <section className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-3">
            <h2 className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-[var(--theme-muted)]">
              Configured apps
            </h2>
            <div className="space-y-1">
              {appsQuery.data?.apps.map((app) => (
                <button
                  key={app.id}
                  type="button"
                  onClick={() => setSelectedId(app.id)}
                  className={cn(
                    'w-full rounded-xl px-3 py-3 text-left transition-colors',
                    selectedId === app.id
                      ? 'bg-[var(--theme-accent)]/15 text-[var(--theme-text)]'
                      : 'text-[var(--theme-muted)] hover:bg-[var(--theme-hover)]',
                  )}
                >
                  <div className="font-medium">{app.label}</div>
                  <div className="mt-0.5 text-[11px] opacity-70">{app.id}</div>
                  <div
                    className={cn(
                      'mt-1 text-[10px]',
                      app.configured ? 'text-green-600' : 'text-amber-600',
                    )}
                  >
                    {app.configured ? 'Ready to run' : 'Credentials missing'}
                  </div>
                </button>
              ))}
              {!appsQuery.isPending &&
              (appsQuery.data?.apps.length ?? 0) === 0 ? (
                <p className="px-2 py-3 text-xs text-[var(--theme-muted)]">
                  No apps configured.
                </p>
              ) : null}
            </div>
          </section>

          <section className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4 md:p-5">
            {!selectedApp ? (
              <div className="flex min-h-64 items-center justify-center text-sm text-[var(--theme-muted)]">
                Select a configured Dify app to inspect and run it.
              </div>
            ) : (
              <div className="space-y-4">
                {!selectedAppConfigured ? (
                  <div className="rounded-xl border border-amber-300/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
                    This app is registered, but its server-side API key is not
                    configured. Add the app&apos;s <code>keyEnv</code> secret
                    before requesting metadata or running it.
                  </div>
                ) : null}
                <div>
                  <h2 className="text-lg font-semibold text-[var(--theme-text)]">
                    {infoQuery.data?.info.name || selectedApp.label}
                  </h2>
                  <p className="mt-1 text-sm text-[var(--theme-muted)]">
                    {infoQuery.data?.info.description ||
                      'Published Dify application'}
                  </p>
                  <p className="mt-2 text-xs text-[var(--theme-muted)]">
                    Mode: {infoQuery.data?.info.mode || 'loading…'}
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm text-[var(--theme-muted)]">
                    Run type
                    <select
                      value={mode}
                      onChange={(event) =>
                        setMode(event.target.value as DifyRunMode)
                      }
                      className="mt-1 h-9 w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-hover)] px-2 text-sm text-[var(--theme-text)]"
                    >
                      <option value="workflow">Workflow</option>
                      <option value="chat">Chat</option>
                      <option value="completion">Completion</option>
                    </select>
                  </label>
                  <label className="text-sm text-[var(--theme-muted)]">
                    Query (chat apps)
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Optional chat prompt"
                      className="mt-1 h-9 w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-hover)] px-2 text-sm text-[var(--theme-text)]"
                    />
                  </label>
                  <label className="text-sm text-[var(--theme-muted)]">
                    Response mode
                    <select
                      value={responseMode}
                      onChange={(event) =>
                        setResponseMode(
                          event.target.value as 'streaming' | 'blocking',
                        )
                      }
                      className="mt-1 h-9 w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-hover)] px-2 text-sm text-[var(--theme-text)]"
                    >
                      <option value="streaming">Streaming</option>
                      <option value="blocking">Blocking</option>
                    </select>
                  </label>
                  <label className="text-sm text-[var(--theme-muted)]">
                    Conversation ID (optional)
                    <input
                      value={conversationId}
                      onChange={(event) =>
                        setConversationId(event.target.value)
                      }
                      placeholder="Reuse a Dify conversation"
                      className="mt-1 h-9 w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-hover)] px-2 text-sm text-[var(--theme-text)]"
                    />
                  </label>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-[var(--theme-muted)]">
                    Inputs
                  </span>
                  <div className="flex gap-1 rounded-lg border border-[var(--theme-border)] p-1">
                    {(['form', 'json'] as const).map((variant) => (
                      <button
                        key={variant}
                        type="button"
                        onClick={() => setInputMode(variant)}
                        className={cn(
                          'rounded px-2 py-1 text-xs capitalize',
                          inputMode === variant
                            ? 'bg-[var(--theme-accent)]/15 text-[var(--theme-text)]'
                            : 'text-[var(--theme-muted)]',
                        )}
                      >
                        {variant}
                      </button>
                    ))}
                  </div>
                </div>
                {inputMode === 'form' && inputFields.length > 0 ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    {inputFields.map((field) => (
                      <label
                        key={field.variable}
                        className="text-sm text-[var(--theme-muted)]"
                      >
                        {field.label}
                        {field.required ? ' *' : ''}
                        {field.type === 'paragraph' ? (
                          <textarea
                            required={field.required}
                            value={String(fieldValues[field.variable] ?? '')}
                            onChange={(event) =>
                              setFieldValues((current) => ({
                                ...current,
                                [field.variable]: event.target.value,
                              }))
                            }
                            rows={4}
                            className="mt-1 w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-hover)] p-2 text-sm text-[var(--theme-text)]"
                          />
                        ) : field.type === 'select' ? (
                          <select
                            required={field.required}
                            value={String(fieldValues[field.variable] ?? '')}
                            onChange={(event) =>
                              setFieldValues((current) => ({
                                ...current,
                                [field.variable]: event.target.value,
                              }))
                            }
                            className="mt-1 h-9 w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-hover)] px-2 text-sm text-[var(--theme-text)]"
                          >
                            <option value="">Select…</option>
                            {(field.options ?? []).map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        ) : field.type === 'checkbox' ? (
                          <input
                            type="checkbox"
                            checked={fieldValues[field.variable] === true}
                            onChange={(event) =>
                              setFieldValues((current) => ({
                                ...current,
                                [field.variable]: event.target.checked,
                              }))
                            }
                            className="ml-2 align-middle"
                          />
                        ) : (
                          <input
                            type={field.type === 'number' ? 'number' : 'text'}
                            required={field.required}
                            value={String(fieldValues[field.variable] ?? '')}
                            onChange={(event) =>
                              setFieldValues((current) => ({
                                ...current,
                                [field.variable]:
                                  field.type === 'number'
                                    ? event.target.value === ''
                                      ? ''
                                      : Number(event.target.value)
                                    : event.target.value,
                              }))
                            }
                            className="mt-1 h-9 w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-hover)] px-2 text-sm text-[var(--theme-text)]"
                          />
                        )}
                        {field.description ? (
                          <span className="mt-1 block text-[11px] opacity-70">
                            {field.description}
                          </span>
                        ) : null}
                      </label>
                    ))}
                  </div>
                ) : (
                  <label className="block text-sm text-[var(--theme-muted)]">
                    Inputs JSON
                    <textarea
                      value={inputs}
                      onChange={(event) => setInputs(event.target.value)}
                      rows={8}
                      className="mt-1 w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-hover)] p-3 font-mono text-xs text-[var(--theme-text)] outline-none focus:border-[var(--theme-accent)]"
                      aria-label="Dify workflow inputs JSON"
                    />
                  </label>
                )}

                <label className="block text-sm text-[var(--theme-muted)]">
                  Attach file (optional, max 10 MB)
                  <input
                    type="file"
                    disabled={!selectedAppConfigured || uploading || running}
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file) void uploadFile(file)
                      event.currentTarget.value = ''
                    }}
                    className="mt-1 block w-full text-xs text-[var(--theme-muted)]"
                  />
                </label>
                {uploadedFiles.length > 0 ? (
                  <div className="flex flex-wrap gap-2 text-xs text-[var(--theme-muted)]">
                    {uploadedFiles.map((file, index) => (
                      <span
                        key={`${String(file.id ?? 'file')}-${index}`}
                        className="rounded bg-[var(--theme-hover)] px-2 py-1"
                      >
                        {String(file.name ?? file.id ?? 'Uploaded file')}
                      </span>
                    ))}
                  </div>
                ) : null}
                {parametersQuery.data?.parameters ? (
                  <details className="rounded-xl border border-[var(--theme-border)] p-3 text-xs text-[var(--theme-muted)]">
                    <summary className="cursor-pointer">
                      View published input schema
                    </summary>
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap">
                      {pretty(parametersQuery.data.parameters)}
                    </pre>
                  </details>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={() => void runApp()}
                    disabled={!selectedAppConfigured || running}
                  >
                    {running
                      ? 'Running…'
                      : selectedAppConfigured
                        ? 'Run app'
                        : 'Configure credentials first'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void stopRun()}
                    disabled={!running || !taskId}
                  >
                    Stop
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void reconnect()}
                    disabled={!runId || running}
                  >
                    Reconnect run
                  </Button>
                </div>

                {recentRuns.length > 0 ? (
                  <details className="rounded-xl border border-[var(--theme-border)] p-3 text-xs text-[var(--theme-muted)]">
                    <summary className="cursor-pointer">
                      Recent runs ({recentRuns.length})
                    </summary>
                    <div className="mt-2 space-y-1">
                      {recentRuns.slice(0, 5).map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() => loadRecentRun(entry)}
                          className="block w-full rounded px-2 py-1 text-left hover:bg-[var(--theme-hover)]"
                        >
                          {entry.mode} · {entry.query || 'No query'} ·{' '}
                          {new Date(entry.createdAt).toLocaleString()}
                        </button>
                      ))}
                    </div>
                  </details>
                ) : null}
                {auditQuery.data?.entries.length ? (
                  <details className="rounded-xl border border-[var(--theme-border)] p-3 text-xs text-[var(--theme-muted)]">
                    <summary className="cursor-pointer">
                      Server activity ({auditQuery.data.entries.length})
                    </summary>
                    <div className="mt-2 space-y-1">
                      {auditQuery.data.entries
                        .slice(0, 8)
                        .map((entry, index) => (
                          <div
                            key={`${entry.timestamp ?? 'event'}-${index}`}
                            className="flex flex-wrap gap-x-2 gap-y-1"
                          >
                            <span>{entry.action ?? 'dify_event'}</span>
                            <span>{entry.outcome ?? 'unknown'}</span>
                            {entry.status ? (
                              <span>HTTP {entry.status}</span>
                            ) : null}
                            {entry.durationMs ? (
                              <span>{entry.durationMs}ms</span>
                            ) : null}
                            {entry.timestamp ? (
                              <time>
                                {new Date(entry.timestamp).toLocaleString()}
                              </time>
                            ) : null}
                          </div>
                        ))}
                    </div>
                  </details>
                ) : null}
                {metricsQuery.data?.summary ? (
                  <details className="rounded-xl border border-[var(--theme-border)] p-3 text-xs text-[var(--theme-muted)]">
                    <summary className="cursor-pointer">
                      Operational metrics
                    </summary>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                      <span>Requests: {metricsQuery.data.summary.total}</span>
                      <span>Success: {metricsQuery.data.summary.success}</span>
                      <span>Failed: {metricsQuery.data.summary.failure}</span>
                      <span>
                        Rate limited: {metricsQuery.data.summary.rateLimited}
                      </span>
                      <span>
                        Avg latency:{' '}
                        {metricsQuery.data.summary.averageDurationMs === null
                          ? '—'
                          : `${metricsQuery.data.summary.averageDurationMs}ms`}
                      </span>
                    </div>
                  </details>
                ) : null}

                {error ? (
                  <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">
                    {error}
                  </p>
                ) : null}
                {output ? (
                  <pre className="max-h-[28rem] overflow-auto rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-3 text-xs text-[var(--theme-text)] whitespace-pre-wrap">
                    {output}
                  </pre>
                ) : null}
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  )
}
