/**
 * Shared storage + types for "what changed" release notes.
 *
 * Used by both UpdateCenterNotifier (post-apply notes) and NotificationHub
 * (startup digest), so the seen-state lives in one place and the two update
 * popups can never double-fire for the same payload.
 */

export type UpdateProductId = 'workspace' | 'agent'

export type ReleaseNoteSection = {
  product: UpdateProductId
  label: string
  from: string | null
  to: string | null
  commits: Array<string>
}

export type ReleaseNotes = {
  id: string
  sections: Array<ReleaseNoteSection>
  updatedAt: number
}

export const NOTES_KEY = 'hermes-update-v2-release-notes'
export const NOTES_SEEN_KEY = 'hermes-update-v2-release-notes-seen'

export function shortSha(value: string | null | undefined): string {
  return value ? value.slice(0, 7) : 'unknown'
}

export function notesId(sections: Array<ReleaseNoteSection>): string {
  return sections
    .map((section) => `${section.product}:${section.from}:${section.to}`)
    .sort()
    .join('|')
}

export function storeNotes(
  sections: Array<ReleaseNoteSection>,
): ReleaseNotes | null {
  if (!sections.length) return null
  const id = notesId(sections)
  const notes = { id, sections, updatedAt: Date.now() }
  // Only clear the "seen" marker when the release-notes payload actually
  // changed. Without this guard the modal pops up on every page refresh
  // because /api/update/status returns the same pendingReleaseNotes on every
  // poll, useEffect fires, and we used to drop the seen marker every time.
  // See #356.
  let existingId: string | null = null
  try {
    const raw = localStorage.getItem(NOTES_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ReleaseNotes>
      existingId = typeof parsed.id === 'string' ? parsed.id : null
    }
  } catch {
    existingId = null
  }
  if (existingId !== id) {
    localStorage.removeItem(NOTES_SEEN_KEY)
  }
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes))
  if (localStorage.getItem(NOTES_SEEN_KEY) === id) return null
  return notes
}

/** Read the last stored release notes regardless of seen-state (for
 * re-opening the digest from the notification inbox). */
export function readStoredNotes(): ReleaseNotes | null {
  try {
    const raw = localStorage.getItem(NOTES_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ReleaseNotes>
    if (typeof parsed.id !== 'string' || !Array.isArray(parsed.sections)) {
      return null
    }
    return parsed as ReleaseNotes
  } catch {
    return null
  }
}

export function markNotesSeen(notes: ReleaseNotes): void {
  try {
    localStorage.setItem(NOTES_SEEN_KEY, notes.id)
  } catch {
    /* storage unavailable */
  }
}
