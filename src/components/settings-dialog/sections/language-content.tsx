import { Row, SectionHeader } from './settings-dialog-primitives'
import type { LocaleId } from '@/lib/i18n'
import { LOCALE_LABELS, getLocale, setLocale } from '@/lib/i18n'

export function LanguageContent() {
  return (
    <div className="space-y-4">
      <SectionHeader
        title="Language"
        description="Choose the display language for the workspace UI."
      />
      <Row
        label="Interface Language"
        description="Translates navigation, labels, and buttons."
      >
        <select
          value={getLocale()}
          onChange={(e) => {
            setLocale(e.target.value as LocaleId)
            window.location.reload()
          }}
          className="h-9 w-full rounded-lg border border-[var(--theme-border)] border-[var(--theme-border)] bg-[var(--theme-input)] px-3 text-sm text-[var(--theme-text)] outline-none md:max-w-xs"
        >
          {(Object.entries(LOCALE_LABELS) as Array<[LocaleId, string]>).map(
            ([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ),
          )}
        </select>
      </Row>
    </div>
  )
}
