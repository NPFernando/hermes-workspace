import { HugeiconsIcon } from '@hugeicons/react'
import type * as React from 'react'

export type SectionProps = {
  title: string
  description: string
  icon: React.ComponentProps<typeof HugeiconsIcon>['icon']
  children: React.ReactNode
}

export function SettingsSection({ title, description, icon, children }: SectionProps) {
  return (
    <section className="surface-card card-glow rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-4 shadow-sm backdrop-blur-xl md:p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="inline-flex size-9 items-center justify-center rounded-xl border border-[var(--theme-border)] bg-[var(--theme-hover)]">
          <HugeiconsIcon icon={icon} size={20} strokeWidth={1.5} />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-medium text-[var(--theme-text)] text-balance">
            {title}
          </h2>
          <p className="text-sm text-[var(--theme-muted)] text-pretty">{description}</p>
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

export type RowProps = {
  label: string
  description?: string
  children: React.ReactNode
}

export function SettingsRow({ label, description, children }: RowProps) {
  return (
    <div className="flex flex-col items-start gap-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--theme-text)] text-balance">
          {label}
        </p>
        {description ? (
          <p className="text-xs text-[var(--theme-muted)] text-pretty">{description}</p>
        ) : null}
      </div>
      <div className="flex w-full items-center gap-2 md:w-auto md:justify-end">
        {children}
      </div>
    </div>
  )
}
