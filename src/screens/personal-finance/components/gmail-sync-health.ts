export type GmailSyncHealth = 'healthy' | 'stale' | 'failed' | 'never'

const STALE_AFTER_SECONDS = 26 * 60 * 60

export function gmailSyncHealth(
  lastSyncedAtSeconds: number | null,
  lastErrorAtSeconds: number | null,
  nowSeconds = Math.floor(Date.now() / 1000),
): GmailSyncHealth {
  if (lastSyncedAtSeconds === null) return 'never'
  if (lastErrorAtSeconds !== null && lastErrorAtSeconds > lastSyncedAtSeconds) {
    return 'failed'
  }
  return nowSeconds - lastSyncedAtSeconds > STALE_AFTER_SECONDS
    ? 'stale'
    : 'healthy'
}

export function formatSyncAge(
  timestampSeconds: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const elapsed = Math.max(0, nowSeconds - timestampSeconds)
  if (elapsed < 60) return 'just now'
  if (elapsed < 60 * 60) {
    const minutes = Math.floor(elapsed / 60)
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  }
  if (elapsed < 24 * 60 * 60) {
    const hours = Math.floor(elapsed / (60 * 60))
    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  }
  const days = Math.floor(elapsed / (24 * 60 * 60))
  return `${days} day${days === 1 ? '' : 's'} ago`
}
