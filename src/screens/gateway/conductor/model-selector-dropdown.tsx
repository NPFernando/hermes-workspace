import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AvailableModel } from './shared'
import { cn } from '@/lib/utils'

export function getModelDisplayName(model: AvailableModel | undefined, modelId: string | null | undefined): string {
  if (!modelId) return 'Default (auto)'
  return model?.name?.trim() || model?.id?.trim() || modelId
}

export function getProviderLabel(provider: string | null | undefined): string {
  const raw = provider?.trim()
  if (!raw) return 'Unknown'
  return raw
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}

export function groupModelsByProvider(models: Array<AvailableModel>) {
  const groups = new Map<string, Array<AvailableModel>>()

  for (const model of models) {
    const provider = getProviderLabel(model.provider)
    const existing = groups.get(provider)
    if (existing) {
      existing.push(model)
    } else {
      groups.set(provider, [model])
    }
  }

  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([provider, providerModels]) => ({
      provider,
      models: [...providerModels].sort((a, b) => getModelDisplayName(a, a.id).localeCompare(getModelDisplayName(b, b.id))),
    }))
}

export function getDirectoryPathSegments(pathValue: string): Array<string> {
  const normalized = pathValue.trim()
  if (!normalized) return ['~']
  if (normalized === '~') return ['~']
  if (normalized.startsWith('~/')) {
    return ['~', ...normalized.slice(2).split('/').filter(Boolean)]
  }
  if (normalized === '/') return ['/']
  if (normalized.startsWith('/')) {
    return ['/', ...normalized.slice(1).split('/').filter(Boolean)]
  }
  return normalized.split('/').filter(Boolean)
}

export function buildDirectoryPathFromSegments(segments: Array<string>): string {
  if (segments.length === 0) return '~'
  if (segments[0] === '~') {
    return segments.length === 1 ? '~' : `~/${segments.slice(1).join('/')}`
  }
  if (segments[0] === '/') {
    return segments.length === 1 ? '/' : `/${segments.slice(1).join('/')}`
  }
  return segments.join('/')
}

export function getParentDirectory(pathValue: string): string {
  const segments = getDirectoryPathSegments(pathValue)
  if (segments.length <= 1) return pathValue.startsWith('/') ? '/' : '~'
  return buildDirectoryPathFromSegments(segments.slice(0, -1))
}

export function getDirectorySuggestions() {
  return ['~/conductor-projects', '~/Projects', '/tmp', '~/Desktop']
}

export function ModelSelectorDropdown({
  label,
  value,
  onChange,
  models,
  disabled = false,
}: {
  label: string
  value: string
  onChange: (nextValue: string) => void
  models: Array<AvailableModel>
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current) return
      if (containerRef.current.contains(event.target as Node)) return
      setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  const selectedModel = models.find((model) => (model.id ?? '') === value)
  const groupedModels = useMemo(() => groupModelsByProvider(models), [models])

  return (
    <div className="space-y-2">
      <span className="text-sm font-medium text-[var(--theme-text)]">{label}</span>
      <div className="relative" ref={containerRef}>
        <button
          type="button"
          onClick={() => {
            if (disabled) return
            setOpen((current) => !current)
          }}
          className={cn(
            'inline-flex min-h-[3rem] w-full items-center justify-between gap-3 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-4 py-3 text-left text-sm text-[var(--theme-text)] shadow-[0_8px_24px_color-mix(in_srgb,var(--theme-shadow)_18%,transparent)] transition-colors',
            disabled ? 'cursor-not-allowed opacity-60' : 'hover:border-[var(--theme-accent)] focus:border-[var(--theme-accent)]',
          )}
          aria-haspopup="listbox"
          aria-expanded={open}
          disabled={disabled}
        >
          <span className="inline-flex min-w-0 items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--theme-border)] bg-[var(--theme-card2)] px-3 py-1 text-xs font-medium text-[var(--theme-text)]">
              <span className={cn('size-2 rounded-full', value ? 'bg-[var(--theme-accent)]' : 'bg-[var(--theme-border2)]')} />
              <span className="truncate">{getModelDisplayName(selectedModel, value)}</span>
            </span>
          </span>
          <HugeiconsIcon icon={ArrowDown01Icon} size={16} strokeWidth={1.8} className={cn('shrink-0 text-[var(--theme-muted)] transition-transform', open && 'rotate-180')} />
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
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors',
                  !value ? 'bg-[var(--theme-accent-soft)] text-[var(--theme-text)]' : 'text-[var(--theme-text)] hover:bg-[var(--theme-bg)]',
                )}
                role="option"
                aria-selected={!value}
              >
                <span className={cn('size-2 rounded-full', !value ? 'bg-[var(--theme-accent)]' : 'bg-[var(--theme-border2)]')} />
                <span className="min-w-0 flex-1 truncate">Default (auto)</span>
                <span className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-card2)] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[var(--theme-muted)]">Auto</span>
              </button>

              {groupedModels.map((group) => (
                <div key={group.provider} className="mt-2 first:mt-3">
                  <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--theme-muted)]">{group.provider}</div>
                  <div className="space-y-1">
                    {group.models.map((model) => {
                      const modelId = model.id ?? ''
                      const active = modelId === value
                      return (
                        <button
                          key={`${group.provider}-${modelId}`}
                          type="button"
                          onClick={() => {
                            onChange(modelId)
                            setOpen(false)
                          }}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors',
                            active ? 'bg-[var(--theme-accent-soft)] text-[var(--theme-text)]' : 'text-[var(--theme-text)] hover:bg-[var(--theme-bg)]',
                          )}
                          role="option"
                          aria-selected={active}
                        >
                          <span className={cn('size-2 rounded-full', active ? 'bg-[var(--theme-accent)]' : 'bg-[var(--theme-border2)]')} />
                          <span className="min-w-0 flex-1 truncate">{getModelDisplayName(model, modelId)}</span>
                          <span className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-card2)] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[var(--theme-muted)]">
                            {group.provider}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

