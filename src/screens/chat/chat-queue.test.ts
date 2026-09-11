import { describe, expect, it } from 'vitest'

import {
  MAX_CHAT_QUEUE_ITEMS,
  MAX_CHAT_QUEUE_TEXT_LENGTH,
  getChatQueuePausedStorageKey,
  getChatQueueLockStorageKey,
  getChatQueueStorageKey,
  parseQueueCommand,
  readChatQueue,
  readChatQueuePaused,
  refreshChatQueueLock,
  releaseChatQueueLock,
  tryAcquireChatQueueLock,
  writeChatQueue,
  writeChatQueuePaused,
} from './chat-queue'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  }
}

describe('/queue command', () => {
  it('uses stable, session-scoped storage keys', () => {
    expect(getChatQueueStorageKey('session/one')).toBe(
      'claude.chat-queue.v1.session%2Fone',
    )
    expect(getChatQueuePausedStorageKey('session/one')).toBe(
      'claude.chat-queue.v1.session%2Fone.paused',
    )
  })

  it('parses enqueue, list, and clear commands without matching /queued', () => {
    expect(parseQueueCommand('/queue review the open PR')).toEqual({
      kind: 'enqueue',
      text: 'review the open PR',
    })
    expect(parseQueueCommand('/queue')).toEqual({ kind: 'list' })
    expect(parseQueueCommand('/queue clear')).toEqual({ kind: 'clear' })
    expect(parseQueueCommand('/queue resume')).toEqual({ kind: 'resume' })
    expect(parseQueueCommand('/queue remove 2')).toEqual({
      kind: 'remove',
      index: 1,
    })
    expect(parseQueueCommand('/queued message')).toBeNull()
  })

  it('persists FIFO queue entries per session and clears the storage key', () => {
    const storage = memoryStorage()
    const first = { id: '1', text: 'first', createdAt: 1 }
    const second = { id: '2', text: 'second', createdAt: 2 }

    writeChatQueue('session-a', [first, second], storage)
    writeChatQueue(
      'session-b',
      [{ id: '3', text: 'other', createdAt: 3 }],
      storage,
    )

    expect(readChatQueue('session-a', storage)).toEqual([first, second])
    expect(readChatQueue('session-b', storage)).toEqual([
      { id: '3', text: 'other', createdAt: 3 },
    ])

    writeChatQueue('session-a', [], storage)
    expect(readChatQueue('session-a', storage)).toEqual([])
    expect(readChatQueuePaused('session-a', storage)).toBe(false)
    expect(readChatQueue('session-b', storage)).toHaveLength(1)

    writeChatQueuePaused('session-b', true, storage)
    expect(readChatQueuePaused('session-b', storage)).toBe(true)
    writeChatQueuePaused('session-b', false, storage)
    expect(readChatQueuePaused('session-b', storage)).toBe(false)
  })

  it('bounds restored and persisted queue data', () => {
    const storage = memoryStorage()
    const entries = Array.from(
      { length: MAX_CHAT_QUEUE_ITEMS + 3 },
      (_, i) => ({
        id: String(i),
        text: `message-${i}`,
        createdAt: i,
      }),
    )
    writeChatQueue('bounded', entries, storage)
    expect(readChatQueue('bounded', storage)).toHaveLength(MAX_CHAT_QUEUE_ITEMS)

    writeChatQueue(
      'long',
      [
        {
          id: 'long',
          text: 'x'.repeat(MAX_CHAT_QUEUE_TEXT_LENGTH + 1),
          createdAt: 1,
        },
      ],
      storage,
    )
    expect(readChatQueue('long', storage)).toEqual([])
  })

  it('treats storage failures as unavailable without throwing', () => {
    const storage = {
      getItem: () => {
        throw new Error('storage unavailable')
      },
      removeItem: () => {
        throw new Error('storage unavailable')
      },
      setItem: () => {
        throw new Error('storage unavailable')
      },
    } as unknown as Storage
    const prompt = { id: '1', text: 'safe', createdAt: 1 }

    expect(readChatQueue('broken', storage)).toEqual([])
    expect(readChatQueuePaused('broken', storage)).toBe(false)
    expect(() => writeChatQueue('broken', [prompt], storage)).not.toThrow()
    expect(() => writeChatQueue('broken', [], storage)).not.toThrow()
    expect(() => writeChatQueuePaused('broken', true, storage)).not.toThrow()
    expect(() => writeChatQueuePaused('broken', false, storage)).not.toThrow()
  })

  it('allows one tab to claim a queue and prevents a second live claim', () => {
    const storage = memoryStorage()
    const first = tryAcquireChatQueueLock('session-a', storage, 100)
    expect(first).toEqual(expect.any(String))
    expect(tryAcquireChatQueueLock('session-a', storage, 101)).toBeNull()
    expect(storage.getItem(getChatQueueLockStorageKey('session-a'))).toContain(
      first,
    )

    releaseChatQueueLock('session-a', first, storage)
    expect(tryAcquireChatQueueLock('session-a', storage, 102)).toEqual(
      expect.any(String),
    )
  })

  it('reclaims an expired queue lease and ignores a non-owner release', () => {
    const storage = memoryStorage()
    const first = tryAcquireChatQueueLock('session-b', storage, 100)
    expect(first).not.toBeNull()
    releaseChatQueueLock('session-b', 'other-owner', storage)
    expect(
      tryAcquireChatQueueLock('session-b', storage, 100 + 15 * 60 * 1000 + 1),
    ).toEqual(expect.any(String))
  })

  it('renews only the active owner lease for long-running responses', () => {
    const storage = memoryStorage()
    const owner = tryAcquireChatQueueLock('session-1', storage, 1_000)
    expect(owner).toBeTruthy()
    expect(refreshChatQueueLock('session-1', owner, storage, 2_000)).toBe(true)
    const renewed = JSON.parse(
      storage.getItem(getChatQueueLockStorageKey('session-1')) || '{}',
    ) as { owner?: string; expiresAt?: number }
    expect(renewed.owner).toBe(owner)
    expect(renewed.expiresAt).toBe(2_000 + 15 * 60 * 1_000)
    expect(
      refreshChatQueueLock('session-1', 'other-owner', storage, 3_000),
    ).toBe(false)
  })
})

