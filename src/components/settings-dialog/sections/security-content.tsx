'use client'

import { CredentialRotationCard } from './credential-rotation-card'
import { SectionHeader } from './settings-dialog-primitives'

export function SecurityContent() {
  return (
    <div className="space-y-4">
      <SectionHeader
        title="Security"
        description="Review authentication safeguards and value-blind credential rotation reminders."
      />
      <CredentialRotationCard />
      <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-2.5 text-xs text-[var(--theme-muted)]">
        Secret values are never displayed here. Rotate credentials at their provider or secret manager, then record only the owner, source, and expiry metadata.
      </div>
    </div>
  )
}
