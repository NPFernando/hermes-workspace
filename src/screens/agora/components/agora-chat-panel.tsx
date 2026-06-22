/**
 * AgoraChatPanel — room chat composer + scrollback.
 */
import { useEffect, useRef, useState } from 'react'
import type { AgoraMessage, AgoraUser } from '../lib/agora-types'
import { cn } from '@/lib/utils'

interface AgoraChatPanelProps {
  self: AgoraUser
  others: Array<AgoraUser>
  messages: Array<AgoraMessage>
  onSend: (body: string) => void
}

export function AgoraChatPanel({ self, others, messages, onSend }: AgoraChatPanelProps) {
  const [draft, setDraft] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages.length, searchTerm])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSend(draft)
    setDraft('')
  }

  function nameFor(userId: string) {
    if (userId === self.profile.id) return self.profile.displayName
    const u = others.find((o) => o.profile.id === userId)
    return u?.profile.displayName ?? 'Stranger'
  }

  // Filter messages based on search term
  const filteredMessages = messages.filter(m => {
    if (!searchTerm) return true
    const term = searchTerm.toLowerCase()
    const body = m.body.toLowerCase()
    const senderName = nameFor(m.userId).toLowerCase()
    return body.includes(term) || senderName.includes(term)
  })

  return (
    <div
      className="flex h-full min-h-0 flex-col rounded-2xl bg-[var(--theme-card)] border border-[var(--theme-border)]"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--theme-border)]">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-70">Room Chat</span>
        <span className="text-[10px] opacity-50">{messages.length} msg</span>
      </div>
      
      {/* Search bar */}
      <div className="flex items-center px-3 py-2 border-b border-[var(--theme-border)]">
        <input
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search messages…"
          className="flex-1 rounded-lg px-2 py-2 sm:py-1 text-[12px] outline-none bg-[var(--theme-bg)] text-[var(--theme-text)] border border-[var(--theme-border)]"
        />
        {searchTerm && (
          <button
            onClick={() => setSearchTerm('')}
            className="ml-2 rounded-lg px-2 py-2 sm:py-1 text-[10px] font-semibold uppercase tracking-[0.05em] disabled:opacity-40 touch-manipulation"
            style={{
              background: 'var(--theme-accent)',
              color: 'var(--theme-bg)',
            }}
          >
            Clear
          </button>
        )}
      </div>
      
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-2 text-[12px] leading-snug">
        {filteredMessages.length === 0 ? (
          <div className="opacity-50 text-center mt-6 text-[11px]">No messages match your search</div>
        ) : (
          <div className="space-y-1.5">
            {filteredMessages.map((m) => (
              <div key={m.id} className="mb-1.5">
                <span
                  className={cn('font-semibold', m.userId === self.profile.id ? 'text-[var(--theme-accent)]' : 'text-[var(--theme-text)]')}
>
                {nameFor(m.userId)}:
                </span>{' '}
                <span className="opacity-90">{m.body}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      
      <form onSubmit={handleSubmit} className="flex gap-2 border-t p-2 border-[var(--theme-border)]">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Say something to the room…"
          maxLength={280}
          className="flex-1 rounded-lg px-2 py-1.5 text-[12px] outline-none bg-[var(--theme-bg)] text-[var(--theme-text)] border border-[var(--theme-border)]"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="rounded-lg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] disabled:opacity-40"
          style={{
            background: 'var(--theme-accent)',
            color: 'var(--theme-bg)',
          }}
        >
          Send
        </button>
      </form>
    </div>
  )
}
