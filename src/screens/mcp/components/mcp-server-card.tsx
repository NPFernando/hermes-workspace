import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  useConfigureMcpServer,
  useDeleteMcpServer,
  useTestMcpServer,
} from '../hooks/use-mcp-mutations'
import { useMcpCapabilityMode } from '../hooks/use-mcp-capability-mode'
import { useMcpOauth } from '../hooks/use-mcp-oauth'
import { isArgPlaceholder, isUrlPlaceholder } from '../lib/placeholder-detect'
import type { McpServer, McpTestResult } from '@/types/mcp'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'

interface Props {
  server: McpServer
  onEdit: (server: McpServer) => void
}

const STATUS_COLORS: Record<McpServer['status'], string> = {
  connected:
    'border border-[var(--theme-success)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] text-[var(--theme-success)]',
  failed:
    'border border-[var(--theme-danger)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] text-[var(--theme-danger)]',
  unknown:
    'border border-[var(--theme-border)] bg-[var(--theme-hover)] text-[var(--theme-muted)]',
}

function Badge({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${className}`}
    >
      {children}
    </span>
  )
}

export function McpServerCard({ server, onEdit }: Props) {
  const test = useTestMcpServer()
  const configure = useConfigureMcpServer()
  const remove = useDeleteMcpServer()
  const oauth = useMcpOauth()
  const { mode: capabilityMode } = useMcpCapabilityMode()
  const fallbackMode = capabilityMode === 'fallback'
  // Test + Refresh work in fallback mode via the hermes CLI bridge
  // (workspace shells out to `hermes mcp test <name>`). Logs and Reauth
  // still require the live runtime /api/mcp endpoints.
  const liveOnlyTitle = fallbackMode
    ? 'Requires hermes-agent /api/mcp runtime endpoint (not available in local fallback mode).'
    : ''
  const qc = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [testResult, setTestResult] = useState<McpTestResult | null>(null)

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/85 p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-medium text-ink">
              {server.name}
            </h3>
            <Badge className={STATUS_COLORS[server.status]}>
              {server.status}
            </Badge>
            <Badge className="border border-[var(--theme-border)] bg-[var(--theme-hover)] text-[var(--theme-muted)]">
              {server.transportType}
            </Badge>
          </div>
          <p className="truncate font-mono text-xs text-[var(--theme-muted)]">
            {server.transportType === 'http' ? server.url : server.command}
          </p>
        </div>
        <Switch
          checked={server.enabled}
          disabled={configure.isPending}
          onCheckedChange={(checked) =>
            configure.mutate({ name: server.name, enabled: checked })
          }
          aria-label={server.enabled ? 'Disable server' : 'Enable server'}
        />
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-[var(--theme-muted)]">
        <div className="flex items-center gap-1.5">
          <dt>Tools:</dt>
          <dd className="font-medium text-ink tabular-nums">
            {server.discoveredToolsCount}
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt>Auth:</dt>
          <dd className="font-medium text-ink">{server.authType}</dd>
        </div>
      </dl>

      {server.lastError ? (
        <p className="rounded-md border border-[var(--theme-danger)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] px-2 py-1.5 text-[11px] text-[var(--theme-danger)] dark:border-[var(--theme-danger)] dark:bg-[color-mix(in_srgb,var(--theme-danger)_40%,transparent)] dark:text-[var(--theme-danger)]">
          {server.lastError}
        </p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
        <Button
          variant="outline"
          size="sm"
          disabled={test.isPending}
          onClick={async () => {
            const result = await test.mutateAsync({ name: server.name })
            setTestResult(result)
            qc.invalidateQueries({ queryKey: ['mcp', 'servers'] })
          }}
        >
          {test.isPending ? 'Testing…' : 'Test'}
        </Button>
        {server.authType === 'oauth' ? (
          <Button
            variant="outline"
            size="sm"
            disabled={oauth.isPending || fallbackMode}
            title={liveOnlyTitle}
            onClick={() => {
              void oauth.start(server)
            }}
          >
            {oauth.isPending ? 'Reauth…' : 'Reauth'}
          </Button>
        ) : null}
        {/* Logs button hidden until hermes-agent dashboard exposes the
            /api/mcp/{name}/logs SSE endpoint. Re-enable when the runtime
            endpoint is available; the McpLogsDrawer component is still
            available at ./mcp-logs-drawer. */}
        <Button variant="outline" size="sm" onClick={() => onEdit(server)}>
          Edit
        </Button>
        {confirmDelete ? (
          <>
            <Button
              variant="destructive"
              size="sm"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ name: server.name })}
            >
              Confirm Delete
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="border-[var(--theme-danger)] text-[var(--theme-danger)] hover:bg-[color-mix(in_srgb,var(--theme-danger)_12%,transparent)] dark:border-[var(--theme-danger)] dark:text-[var(--theme-danger)] dark:hover:bg-[color-mix(in_srgb,var(--theme-danger)_40%,transparent)]"
            onClick={() => setConfirmDelete(true)}
          >
            Delete
          </Button>
        )}
      </div>

      {testResult ? (
        <p className="text-xs text-[var(--theme-muted)]">
          {testResult.ok
            ? `Connected (${testResult.latencyMs ?? '?'}ms, ${testResult.discoveredTools.length} tools)`
            : `Failed: ${testResult.error || 'unknown error'}`}
        </p>
      ) : null}
      {testResult && !testResult.ok && testResult.error
        ? (() => {
            const stdioErrorRe =
              /Connection closed|EACCES|ENOENT|exited unexpectedly/i
            const httpErrorRe = /fetch failed|network error|ENOTFOUND/i
            const hasStdioPlaceholder =
              server.transportType === 'stdio' &&
              server.args.some((a) => isArgPlaceholder(a))
            const hasHttpPlaceholder =
              server.transportType === 'http' &&
              Boolean(server.url && isUrlPlaceholder(server.url))
            const showHint =
              (stdioErrorRe.test(testResult.error) && hasStdioPlaceholder) ||
              (httpErrorRe.test(testResult.error) && hasHttpPlaceholder)
            if (!showHint) return null
            return (
              <p className="rounded-md border border-[var(--theme-warning)] bg-[color-mix(in_srgb,var(--theme-warning)_10%,transparent)] px-2 py-1.5 text-[11px] text-[var(--theme-warning)] dark:border-[var(--theme-warning)] dark:bg-[color-mix(in_srgb,var(--theme-warning)_40%,transparent)] dark:text-[var(--theme-warning)]">
                Edit server args/url — looks like a placeholder. Click Edit to
                fix.
              </p>
            )
          })()
        : null}
      {oauth.isError && oauth.error ? (
        <p className="text-xs text-[var(--theme-danger)] dark:text-[var(--theme-danger)]">
          Reauth failed: {oauth.error.message}
        </p>
      ) : null}
      {oauth.data?.status === 'connected' ? (
        <p className="text-xs text-[var(--theme-success)] dark:text-[var(--theme-success)]">
          Reauth succeeded.
        </p>
      ) : null}
    </article>
  )
}
