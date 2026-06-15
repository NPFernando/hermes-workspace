import { useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { chatQueryKeys } from '../chat-queries'
import {
  updateSessionTitleState,
  useSessionTitleInfo,
} from '../session-title-store'
import { textFromMessage } from '../utils'
import type { ChatMessage, SessionMeta } from '../types'

const MAX_TITLE_LENGTH = 50

const GENERIC_TITLE_PATTERNS = [
  /^a new session/i,
  /^new session/i,
  /^untitled/i,
  /^session \d/i,
  /^conversation$/i,
  /^chat$/i,
  /^[0-9a-f]{6,}/i,
  /^\w{8} \(\d{4}-\d{2}-\d{2}\)$/,
]

function isGenericTitle(title: string): boolean {
  const trimmed = title.trim()
  if (!trimmed || trimmed === 'New Session') return true
  return GENERIC_TITLE_PATTERNS.some((pattern) => pattern.test(trimmed))
}

function truncateTitle(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= MAX_TITLE_LENGTH) return normalized
  return `${normalized.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`
}

function getFirstUserMessage(messages: Array<ChatMessage>): string {
  const firstUser = messages.find((message) => message.role === 'user')
  return firstUser ? textFromMessage(firstUser).trim() : ''
}

function hasAssistantResponse(messages: Array<ChatMessage>): boolean {
  return messages.some((message) => {
    if (message.role !== 'assistant') return false
    return textFromMessage(message).trim().length > 0
  })
}

async function generateAiTitle(messages: Array<ChatMessage>): Promise<string> {
  const context = messages.slice(0, 2).map((m) => ({
    role: m.role,
    content: textFromMessage(m).trim(),
  }))
  const res = await fetch('/api/sessions/generate-title', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: context }),
  })
  if (!res.ok) throw new Error(`generate-title: ${res.status}`)
  const data = (await res.json()) as { ok: boolean; title?: string; error?: string }
  if (!data.ok || !data.title) throw new Error(data.error ?? 'empty title')
  return data.title
}

type UseAutoSessionTitleInput = {
  friendlyId: string
  sessionKey: string | undefined
  activeSession?: SessionMeta
  messages: Array<ChatMessage>
  messageCount?: number
  enabled: boolean
}

type UpdateTitlePayload = {
  friendlyId: string
  sessionKey: string
  title: string
}

export function useAutoSessionTitle({
  friendlyId,
  sessionKey,
  activeSession,
  messages,
  enabled,
}: UseAutoSessionTitleInput) {
  const queryClient = useQueryClient()
  const titleInfo = useSessionTitleInfo(friendlyId)
  const lastAttemptRef = useRef<Record<string, boolean>>({})

  const shouldGenerate =
    enabled &&
    !!friendlyId &&
    friendlyId !== 'new' &&
    !!sessionKey &&
    sessionKey !== 'new' &&
    !!getFirstUserMessage(messages) &&
    hasAssistantResponse(messages) &&
    (!activeSession?.label || isGenericTitle(activeSession.label)) &&
    (!activeSession?.title || isGenericTitle(activeSession.title)) &&
    (!activeSession?.derivedTitle || isGenericTitle(activeSession.derivedTitle)) &&
    !(titleInfo.source === 'manual' && titleInfo.title) &&
    !(titleInfo.status === 'ready' && titleInfo.title && !isGenericTitle(titleInfo.title)) &&
    titleInfo.status !== 'generating'

  const applyTitle = (
    friendlyIdToUpdate: string,
    title: string,
    source: 'auto' | 'manual' = 'auto',
  ) => {
    updateSessionTitleState(friendlyIdToUpdate, {
      title,
      source,
      status: 'ready',
      error: null,
    })
    queryClient.setQueryData(
      chatQueryKeys.sessions,
      function updateSessions(existing: unknown) {
        if (!Array.isArray(existing)) return existing
        return existing.map((session) => {
          if (
            session &&
            typeof session === 'object' &&
            (session as SessionMeta).friendlyId === friendlyIdToUpdate
          ) {
            return {
              ...(session as SessionMeta),
              label: title,
              title,
              derivedTitle: title,
              titleStatus: 'ready',
              titleSource: source,
              titleError: null,
            }
          }
          return session
        })
      },
    )
  }

  const mutation = useMutation({
    mutationFn: async (payload: UpdateTitlePayload) => {
      const res = await fetch('/api/sessions', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionKey: payload.sessionKey,
          friendlyId: payload.friendlyId,
          label: payload.title,
        }),
      })
      if (!res.ok) {
        const message = await res.text().catch(() => 'Failed to update title')
        throw new Error(message)
      }
      return payload
    },
    onSuccess: (payload) => {
      applyTitle(payload.friendlyId, payload.title, 'auto')
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.sessions })
    },
    onError: (error, payload) => {
      updateSessionTitleState(payload.friendlyId, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error ?? ''),
      })
    },
  })

  const { mutate, isPending } = mutation

  useEffect(() => {
    if (!shouldGenerate) return
    if (isPending) return
    const key = `${sessionKey}:${friendlyId}`
    if (lastAttemptRef.current[key]) return
    lastAttemptRef.current[key] = true

    updateSessionTitleState(friendlyId, { status: 'generating', error: null })

    generateAiTitle(messages)
      .then((aiTitle) => {
        mutate({ friendlyId, sessionKey: sessionKey ?? friendlyId, title: aiTitle })
      })
      .catch(() => {
        // Fallback: use truncated first user message
        const fallback = truncateTitle(getFirstUserMessage(messages))
        if (fallback) {
          mutate({ friendlyId, sessionKey: sessionKey ?? friendlyId, title: fallback })
        } else {
          updateSessionTitleState(friendlyId, { status: 'idle', error: null })
          lastAttemptRef.current[key] = false
        }
      })
  }, [friendlyId, isPending, messages, mutate, sessionKey, shouldGenerate])
}
