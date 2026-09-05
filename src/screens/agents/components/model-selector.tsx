import { useEffect, useRef, useState } from 'react'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { GatewayModelCatalogEntry } from '@/lib/gateway-api'
import { cn } from '@/lib/utils'

export type AvailableModel = {
  id: string
  provider: string
  name: string
}

export function normalizeModel(
  model: GatewayModelCatalogEntry,
): AvailableModel | null {
  if (typeof model === 'string') {
    return {
      id: model,
      provider: model.includes('/')
        ? (model.split('/')[0] ?? 'model')
        : 'model',
      name: model.split('/').pop() ?? model,
    }
  }

  const id = model.id ?? model.alias ?? model.model ?? ''
  if (!id) return null

  return {
    id,
    provider: model.provider ?? id.split('/').at(0) ?? 'model',
    name:
      model.label ??
      model.displayName ??
      model.name ??
      id.split('/').at(-1) ??
      id,
  }
}

export function ModelSelector({
  value,
  onChange,
  models,
}: {
  value: string
  onChange: (nextValue: string) => void
  models: Array<AvailableModel>
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  const selected = (() => {
    if (!value) return null
    // If value includes provider prefix (e.g. 'anthropic/claude-sonnet-4-6'),
    // match provider+id together to avoid OpenRouter stealing the match
    const slashIndex = value.indexOf('/')
    if (slashIndex > 0) {
      const valueProvider = value.slice(0, slashIndex)
      const valueModelId = value.slice(slashIndex + 1)
      // First try exact provider+id match
      const exactMatch = models.find(
        (m) =>
          m.provider === valueProvider &&
          (m.id === value || m.id === valueModelId),
      )
      if (exactMatch) return exactMatch
    }
    // Fallback to plain id match
    const idMatch = models.find((m) => m.id === value)
    if (idMatch) return idMatch
    return {
      id: value,
      provider: slashIndex > 0 ? value.slice(0, slashIndex) : 'model',
      name: value.split('/').pop() ?? value,
    }
  })()

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex min-h-[3rem] w-full items-center justify-between gap-3 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-4 py-3 text-left text-sm text-[var(--theme-text)] shadow-[0_8px_24px_color-mix(in_srgb,var(--theme-shadow)_18%,transparent)]"
      >
        <span className="truncate">
          {selected
            ? `${selected.provider} / ${selected.name}`
            : 'Default (auto)'}
        </span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={16}
          strokeWidth={1.8}
          className={cn(
            'text-[var(--theme-muted)] transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open ? (
        <div className="absolute left-0 top-[calc(100%+0.5rem)] z-[80] w-full overflow-hidden rounded-2xl border border-[var(--theme-border2)] bg-[var(--theme-card)] shadow-[0_24px_80px_var(--theme-shadow)]">
          <div className="max-h-80 overflow-y-auto p-2">
            <button
              type="button"
              onClick={() => {
                onChange('')
                setOpen(false)
              }}
              className={cn(
                'flex w-full rounded-xl px-3 py-2.5 text-left text-sm',
                !value
                  ? 'bg-[var(--theme-accent-soft)]'
                  : 'hover:bg-[var(--theme-bg)]',
              )}
            >
              Default (auto)
            </button>
            {models.map((model) => (
              <button
                key={model.id}
                type="button"
                onClick={() => {
                  onChange(model.id)
                  setOpen(false)
                }}
                className={cn(
                  'mt-1 flex w-full rounded-xl px-3 py-2.5 text-left text-sm',
                  value === model.id
                    ? 'bg-[var(--theme-accent-soft)]'
                    : 'hover:bg-[var(--theme-bg)]',
                )}
              >
                {model.provider} / {model.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
