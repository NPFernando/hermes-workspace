import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Cancel01Icon,
  Delete02Icon,
  Settings01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { ModelSelector, normalizeModel } from './model-selector'
import type { AvailableModel } from './model-selector'
import type { OperationsAgent } from '../hooks/use-operations'
import { Button } from '@/components/ui/button'
import { fetchModels } from '@/lib/gateway-api'

export function OperationsAgentDetail({
  open,
  agent,
  onClose,
  onSave,
  onDelete,
  isSaving,
  isDeleting,
}: {
  open: boolean
  agent: OperationsAgent | null
  onClose: () => void
  onSave: (input: {
    agentId: string
    name: string
    model: string
    emoji: string
    systemPrompt: string
  }) => Promise<unknown>
  onDelete: (agentId: string) => Promise<unknown>
  isSaving: boolean
  isDeleting: boolean
}) {
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('🤖')
  const [model, setModel] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')

  useEffect(() => {
    if (!agent || !open) return
    setName(agent.name)
    setEmoji(agent.meta.emoji)
    setModel(agent.model || '')
    setSystemPrompt(agent.meta.systemPrompt)
  }, [agent, open])

  const modelsQuery = useQuery({
    queryKey: ['models'],
    queryFn: fetchModels,
    enabled: open,
  })

  const models = useMemo(
    () =>
      (modelsQuery.data?.models ?? [])
        .map(normalizeModel)
        .filter((entry): entry is AvailableModel => Boolean(entry)),
    [modelsQuery.data?.models],
  )

  if (!open || !agent) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--theme-bg)_48%,transparent)] px-4 py-6 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-3xl border border-[var(--theme-border2)] bg-[var(--theme-card)] p-5 shadow-[0_24px_80px_var(--theme-shadow)] sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex size-11 items-center justify-center rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-accent)]">
              <HugeiconsIcon
                icon={Settings01Icon}
                size={20}
                strokeWidth={1.8}
              />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--theme-muted)]">
                Agent Settings
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--theme-text)]">
                {agent.name}
              </h2>
              <p className="mt-2 text-sm text-[var(--theme-muted-2)]">
                Update this agent without leaving the roster.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-10 items-center justify-center rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card2)] text-lg text-[var(--theme-muted)] transition-colors hover:border-[var(--theme-accent)] hover:text-[var(--theme-accent-strong)]"
            aria-label="Close agent settings"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={18} strokeWidth={1.8} />
          </button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-[1.2fr_0.6fr]">
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--theme-text)]">
              Name
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-4 py-3 text-sm text-[var(--theme-text)] outline-none focus:border-[var(--theme-accent)]"
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--theme-text)]">
              Emoji
            </span>
            <input
              value={emoji}
              onChange={(event) => setEmoji(event.target.value)}
              className="w-full rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-4 py-3 text-sm text-[var(--theme-text)] outline-none focus:border-[var(--theme-accent)]"
            />
          </label>
        </div>

        <label className="mt-4 block space-y-2">
          <span className="text-sm font-medium text-[var(--theme-text)]">
            Model
          </span>
          <ModelSelector value={model} onChange={setModel} models={models} />
        </label>

        <label className="mt-4 block space-y-2">
          <span className="text-sm font-medium text-[var(--theme-text)]">
            System Prompt
          </span>
          <textarea
            value={systemPrompt}
            onChange={(event) => setSystemPrompt(event.target.value)}
            className="min-h-[220px] w-full rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-4 py-3 text-sm text-[var(--theme-text)] outline-none focus:border-[var(--theme-accent)]"
          />
        </label>

        <div className="mt-6 flex flex-col gap-3 border-t border-[var(--theme-border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <Button
            variant="ghost"
            className="justify-start text-[var(--theme-danger)] hover:bg-[var(--theme-danger-soft)]"
            onClick={() => void onDelete(agent.id)}
            disabled={isDeleting || isSaving}
          >
            <HugeiconsIcon icon={Delete02Icon} size={16} strokeWidth={1.8} />
            {isDeleting ? 'Deleting…' : 'Delete agent'}
          </Button>
          <div className="flex justify-end gap-3">
            <Button
              variant="secondary"
              className="border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] hover:bg-[var(--theme-card2)]"
              onClick={onClose}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              className="bg-[var(--theme-accent)] text-[var(--theme-text)] hover:bg-[var(--theme-accent-strong)]"
              onClick={() =>
                void onSave({
                  agentId: agent.id,
                  name,
                  model,
                  emoji,
                  systemPrompt,
                })
              }
              disabled={isSaving || isDeleting}
            >
              {isSaving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
