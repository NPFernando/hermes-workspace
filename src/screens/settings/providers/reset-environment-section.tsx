import { RefreshIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'

export function ResetEnvironmentSection() {
  const queryClient = useQueryClient()
  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/env-reset', { method: 'POST' })
      if (!res.ok) throw new Error(`Reset failed: ${res.status}`)
      return res.json() as Promise<{ ok: boolean; mcpProbesCleared: number; gateway: { available: boolean } }>
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries()
      const probeMsg = data.mcpProbesCleared > 0 ? `, ${data.mcpProbesCleared} MCP probe${data.mcpProbesCleared === 1 ? '' : 's'} cleared` : ''
      toast(`Environment reset${probeMsg}. Gateway: ${data.gateway.available ? 'online' : 'offline'}`, { type: 'success' })
    },
    onError: (err) => {
      toast(err instanceof Error ? err.message : 'Reset failed', { type: 'error' })
    },
  })

  return (
    <section className="mx-auto w-full max-w-[1480px]">
      <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4 shadow-sm md:p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--theme-text)]">Reset Environment</h3>
            <p className="mt-0.5 text-xs text-[var(--theme-muted)]">
              Clears cached MCP probes and re-checks gateway connectivity. Use after restarting Hermes Agent.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => resetMutation.mutate()}
            disabled={resetMutation.isPending}
            className="shrink-0 gap-1.5"
          >
            <HugeiconsIcon
              icon={RefreshIcon}
              size={14}
              className={resetMutation.isPending ? 'animate-spin' : ''}
            />
            {resetMutation.isPending ? 'Resetting…' : 'Reset'}
          </Button>
        </div>
      </div>
    </section>
  )
}

