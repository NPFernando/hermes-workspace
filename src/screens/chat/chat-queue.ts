export type QueuedChatPrompt = {
  id: string
  text: string
  createdAt: number
}

export type QueueCommand =
  | { kind: 'enqueue'; text: string }
  | { kind: 'list' }
  | { kind: 'clear' }
  | { kind: 'resume' }
  | { kind: 'remove'; index: number }

export const CHAT_QUEUE_STORAGE_PREFIX = 'claude.chat-queue.v1.'
export const MAX_CHAT_QUEUE_ITEMS = 50
export const MAX_CHAT_QUEUE_TEXT_LENGTH = 4_000
const CHAT_QUEUE_PAUSED_SUFFIX = '.paused'
const CHAT_QUEUE_LOCK_SUFFIX = '.lock'
export const CHAT_QUEUE_LOCK_TTL_MS = 15 * 60 * 1000

type ChatQueueLock = { owner: string; expiresAt: number }

function defaultQueueStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    // Queue entries are intentionally bounded, but survive a browser restart
    // so an unfinished work plan is not silently lost. If localStorage is
    // unavailable (private mode or a restrictive browser policy), fall back to
    // the existing per-tab session store.
    return window.localStorage
  } catch {
    try {
      return window.sessionStorage
    } catch {
      return undefined
    }
  }
}

function legacySessionStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return window.sessionStorage
  } catch {
    return undefined
  }
}

/** Parse only the /queue command; ordinary prompts beginning with /queued remain chat messages. */
export function parseQueueCommand(value: string): QueueCommand | null {
  const trimmed = value.trim()
  const match = /^\/queue(?:\s+([\s\S]*))?$/i.exec(trimmed)
  if (!match) return null

  const argument = (match[1] || '').trim()
  if (!argument) return { kind: 'list' }
  if (argument.toLowerCase() === 'clear') return { kind: 'clear' }
  if (argument.toLowerCase() === 'list') return { kind: 'list' }
  if (argument.toLowerCase() === 'resume') return { kind: 'resume' }
  const removeMatch = /^remove\s+(\d+)$/i.exec(argument)
  if (removeMatch) {
    return { kind: 'remove', index: Number(removeMatch[1]) - 1 }
  }
  return { kind: 'enqueue', text: argument }
}

export function getChatQueueStorageKey(sessionKey: string): string {
  return `${CHAT_QUEUE_STORAGE_PREFIX}${encodeURIComponent(sessionKey || 'main')}`
}

export function getChatQueuePausedStorageKey(sessionKey: string): string {
  return `${getChatQueueStorageKey(sessionKey)}${CHAT_QUEUE_PAUSED_SUFFIX}`
}

export function getChatQueueLockStorageKey(sessionKey: string): string {
  return `${getChatQueueStorageKey(sessionKey)}${CHAT_QUEUE_LOCK_SUFFIX}`
}

/**
 * Claim the queue for this browser tab while a queued prompt is in flight.
 * The short lease prevents a crashed tab from blocking the queue forever.
 * localStorage writes are verified after the write so normal same-origin tabs
 * do not both start the same prompt when they wake at the same time.
 */
export function tryAcquireChatQueueLock(
  sessionKey: string,
  storage: Storage | undefined = defaultQueueStorage(),
  now = Date.now(),
): string | null {
  const owner = `${now}-${Math.random().toString(36).slice(2)}`
  // Preserve best-effort local queue behavior if browser storage is blocked.
  if (!storage) return owner
  const key = getChatQueueLockStorageKey(sessionKey)
  try {
    const raw = storage.getItem(key)
    if (raw) {
      const current = JSON.parse(raw) as Partial<ChatQueueLock>
      if (
        typeof current.owner === 'string' &&
        typeof current.expiresAt === 'number' &&
        current.expiresAt > now
      ) {
        return null
      }
    }
    storage.setItem(
      key,
      JSON.stringify({ owner, expiresAt: now + CHAT_QUEUE_LOCK_TTL_MS }),
    )
    const written = JSON.parse(
      storage.getItem(key) || '{}',
    ) as Partial<ChatQueueLock>
    return written.owner === owner ? owner : null
  } catch {
    // Queue coordination is best-effort; never make chat sending fail.
    return owner
  }
}

export function releaseChatQueueLock(
  sessionKey: string,
  owner: string | null,
  storage: Storage | undefined = defaultQueueStorage(),
): void {
  if (!storage || !owner) return
  try {
    const key = getChatQueueLockStorageKey(sessionKey)
    const current = JSON.parse(
      storage.getItem(key) || '{}',
    ) as Partial<ChatQueueLock>
    if (current.owner === owner) storage.removeItem(key)
  } catch {
    // Best effort; the lease will expire if the storage becomes unavailable.
  }
}

/** Extend an active queue lease without allowing a non-owner tab to steal it. */
export function refreshChatQueueLock(
  sessionKey: string,
  owner: string | null,
  storage: Storage | undefined = defaultQueueStorage(),
  now = Date.now(),
): boolean {
  if (!storage || !owner) return Boolean(owner)
  try {
    const key = getChatQueueLockStorageKey(sessionKey)
    const current = JSON.parse(
      storage.getItem(key) || '{}',
    ) as Partial<ChatQueueLock>
    if (current.owner !== owner) return false
    storage.setItem(
      key,
      JSON.stringify({ owner, expiresAt: now + CHAT_QUEUE_LOCK_TTL_MS }),
    )
    return true
  } catch {
    // A transient storage failure should not interrupt an active response.
    return true
  }
}

function isQueuedPrompt(value: unknown): value is QueuedChatPrompt {
  if (!value || typeof value !== 'object') return false
  const prompt = value as Partial<QueuedChatPrompt>
  return (
    typeof prompt.id === 'string' &&
    typeof prompt.text === 'string' &&
    prompt.text.trim().length > 0 &&
    typeof prompt.createdAt === 'number'
  )
}

export function readChatQueue(
  sessionKey: string,
  storage: Storage | undefined = defaultQueueStorage(),
): Array<QueuedChatPrompt> {
  if (!storage) return []
  try {
    const raw = storage.getItem(getChatQueueStorageKey(sessionKey))
    if (!raw) {
      // Migrate queues created by the earlier sessionStorage implementation.
      const legacy = legacySessionStorage()
      if (legacy && legacy !== storage) {
        const legacyRaw = legacy.getItem(getChatQueueStorageKey(sessionKey))
        if (legacyRaw) {
          storage.setItem(getChatQueueStorageKey(sessionKey), legacyRaw)
          const legacyPaused = legacy.getItem(
            getChatQueuePausedStorageKey(sessionKey),
          )
          if (legacyPaused === '1') {
            storage.setItem(getChatQueuePausedStorageKey(sessionKey), '1')
          }
          legacy.removeItem(getChatQueueStorageKey(sessionKey))
          legacy.removeItem(getChatQueuePausedStorageKey(sessionKey))
          return readChatQueue(sessionKey, storage)
        }
      }
      return []
    }
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed
          .filter(isQueuedPrompt)
          .filter((prompt) => prompt.text.length <= MAX_CHAT_QUEUE_TEXT_LENGTH)
          .slice(0, MAX_CHAT_QUEUE_ITEMS)
      : []
  } catch {
    return []
  }
}

export function writeChatQueue(
  sessionKey: string,
  queue: Array<QueuedChatPrompt>,
  storage: Storage | undefined = defaultQueueStorage(),
): void {
  if (!storage) return
  try {
    if (queue.length === 0) {
      storage.removeItem(getChatQueueStorageKey(sessionKey))
      storage.removeItem(getChatQueuePausedStorageKey(sessionKey))
      return
    }
    storage.setItem(
      getChatQueueStorageKey(sessionKey),
      JSON.stringify(
        queue
          .filter(isQueuedPrompt)
          .filter((prompt) => prompt.text.length <= MAX_CHAT_QUEUE_TEXT_LENGTH)
          .slice(0, MAX_CHAT_QUEUE_ITEMS),
      ),
    )
  } catch {
    // Queueing must never make sending a normal chat message fail.
  }
}

export function readChatQueuePaused(
  sessionKey: string,
  storage: Storage | undefined = defaultQueueStorage(),
): boolean {
  if (!storage) return false
  try {
    return storage.getItem(getChatQueuePausedStorageKey(sessionKey)) === '1'
  } catch {
    return false
  }
}

export function writeChatQueuePaused(
  sessionKey: string,
  paused: boolean,
  storage: Storage | undefined = defaultQueueStorage(),
): void {
  if (!storage) return
  try {
    if (paused) storage.setItem(getChatQueuePausedStorageKey(sessionKey), '1')
    else storage.removeItem(getChatQueuePausedStorageKey(sessionKey))
  } catch {
    // Queue state is best-effort and must not break chat sending.
  }
}

export function createQueuedChatPrompt(text: string): QueuedChatPrompt {
  return {
    id: crypto.randomUUID(),
    text: text.trim(),
    createdAt: Date.now(),
  }
}

