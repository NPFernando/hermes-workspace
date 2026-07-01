import { SparklesIcon } from '@hugeicons/core-free-icons'
import { SettingsSection } from './settings-primitives'
import type { ChangeKind } from '@/lib/changelog'
import { CHANGELOG } from '@/lib/changelog'


const KIND_LABEL: Record<ChangeKind, string> = {
  added:    'New',
  fixed:    'Fix',
  improved: 'Better',
  removed:  'Removed',
}
const KIND_CLASS: Record<ChangeKind, string> = {
  added:    'bg-emerald-500/10 text-emerald-500',
  fixed:    'bg-rose-500/10 text-rose-400',
  improved: 'bg-[var(--theme-accent)]/10 text-[var(--theme-accent)]',
  removed:  'bg-[var(--theme-muted)]/10 text-[var(--theme-muted)]',
}

export function WhatsNewSection() {
  return (
    <SettingsSection
      title="What's New"
      description="Version history — changes, fixes, and improvements across workspace and Android app."
      icon={SparklesIcon}
    >
      <div className="space-y-5">
        {CHANGELOG.map((entry, idx) => (
          <div key={entry.version} className={idx > 0 ? 'border-t border-[var(--theme-border)] pt-5' : ''}>
            {/* Version header */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[var(--theme-accent)]/10 px-2.5 py-0.5 text-[11px] font-semibold text-[var(--theme-accent)]">
                v{entry.version}
              </span>
              {entry.apkVersion && (
                <span className="rounded-full bg-[var(--theme-hover)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--theme-muted)]">
                  APK v{entry.apkVersion}
                </span>
              )}
              <span className="text-xs text-[var(--theme-muted)]">{entry.date}</span>
              <span className="flex-1 text-xs text-[var(--theme-text)] font-medium">{entry.summary}</span>
            </div>

            {/* Changes */}
            <div className="space-y-2">
              {entry.changes.map((c, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${KIND_CLASS[c.kind]}`}>
                    {KIND_LABEL[c.kind]}
                  </span>
                  <span className="text-xs text-[var(--theme-muted)] leading-relaxed">{c.text}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SettingsSection>
  )
}
