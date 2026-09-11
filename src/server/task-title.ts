/**
 * Stable comparison key for task titles submitted by people or automation.
 * Display titles are kept unchanged; only duplicate detection uses this key.
 */
export function normalizeTaskTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase()
}
