import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Cancel01Icon, Settings01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { ModelSelector, normalizeModel } from './model-selector'
import type { AvailableModel } from './model-selector'
import type { OperationsSettings } from '../hooks/use-operations'
import { Button } from '@/components/ui/button'
import { fetchModels } from '@/lib/gateway-api'

export function OperationsSettingsModal({
  open,
  settings,
  onClose,
  onSave,
}: {
  open: boolean
  settings: OperationsSettings
  onClose: () => void
  onSave: (settings: OperationsSettings) => void
}) {
  const [draft, setDraft] = useState(settings)

  useEffect(() => {
    setDraft(settings)
  }, [settings, open])

  const modelsQuery = useQuery({
    queryKey: ['models'],
    queryFn: fetchModels,
    enabled: open,
  })

  const models = useMemo(
    () =>
      (modelsQuery.data?.models ?? [])
        .map(normalizeModel)
        .filter((model): model is AvailableModel => Boolean(model)),
    [modelsQuery.data?.models],
  )

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--theme-bg)_48%,transparent)] px-4 py-6 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-3xl border border-[var(--theme-border2)] bg-[var(--theme-card)] p-6 shadow-[0_30px_100px_var(--theme-shadow)]"
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
              <h2 className="text-xl font-semibold text-[var(--theme-text)]">
                Operations Settings
              </h2>
              <p className="mt-1 text-sm text-[var(--theme-muted-2)]">
                Defaults stored locally for the Operations screen.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-bg)] p-2 text-[var(--theme-muted)] hover:text-[var(--theme-text)]"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={18} strokeWidth={1.8} />
          </button>
        </div>

        <div className="mt-6 space-y-4">
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--theme-text)]">
              Default model for new agents
            </span>
            <ModelSelector
              value={draft.defaultModel}
              onChange={(defaultModel) =>
                setDraft((current) => ({ ...current, defaultModel }))
              }
              models={models}
            />
          </label>

          <label className="flex items-center justify-between rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-4 py-3">
            <span>
              <span className="block text-sm font-medium text-[var(--theme-text)]">
                Auto-approve
              </span>
              <span className="block text-sm text-[var(--theme-muted-2)]">
                Reserved for future workflow automation.
              </span>
            </span>
            <input
              type="checkbox"
              checked={draft.autoApprove}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  autoApprove: event.target.checked,
                }))
              }
              className="size-4 accent-[var(--theme-accent)]"
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--theme-text)]">
              Activity feed length
            </span>
            <input
              type="number"
              min={1}
              max={20}
              value={draft.activityFeedLength}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  activityFeedLength: Number(event.target.value) || 5,
                }))
              }
              className="w-full rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-4 py-3 text-sm text-[var(--theme-text)] outline-none focus:border-[var(--theme-accent)]"
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="secondary"
            className="border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] hover:bg-[var(--theme-card2)]"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            className="bg-[var(--theme-accent)] text-[var(--theme-text)] hover:bg-[var(--theme-accent-strong)]"
            onClick={() => {
              onSave(draft)
              onClose()
            }}
          >
            Save Settings
          </Button>
        </div>
      </div>
    </div>
  )
}
