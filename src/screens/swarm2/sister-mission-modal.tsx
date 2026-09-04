'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { MagicWand01Icon } from '@hugeicons/core-free-icons'
import type { SisterOption } from '@/screens/chat/components/sister-picker'
import {
  SisterPicker,
  dedupeSistersForPicker,
} from '@/screens/chat/components/sister-picker'

type SisterMissionModalProps = {
  open: boolean
  onClose: () => void
  onSelect: (sister: SisterOption, prompt: string) => void
}

async function fetchSisters(): Promise<Array<SisterOption>> {
  const res = await fetch('/api/sisters')
  if (!res.ok) return []
  const data = await res.json()
  if (!data.ok) return []
  return data.sisters.map((s: Record<string, unknown>) => ({
    id: String(s.id ?? ''),
    name: String(s.name ?? ''),
    emoji: String(s.emoji ?? '🤖'),
    description: String(s.role ?? ''),
    systemPrompt: String(s.systemPrompt ?? ''),
    type: (s.type as SisterOption['type']) ?? 'ai_sister',
    role: String(s.role ?? ''),
  }))
}

export function SisterMissionModal({
  open,
  onClose,
  onSelect,
}: SisterMissionModalProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState<string | null>(null)

  const sistersQuery = useQuery({
    queryKey: ['sisters-for-swarm'],
    queryFn: fetchSisters,
    staleTime: 120_000,
    enabled: open,
  })

  const sisters = dedupeSistersForPicker(sistersQuery.data ?? [])

  function handleDispatch() {
    if (!selectedId) {
      setError('Select a sister first')
      return
    }
    if (!prompt.trim()) {
      setError('Enter a mission prompt')
      return
    }
    const sister = sisters.find((s) => s.id === selectedId)
    if (!sister) {
      setError('Sister not found')
      return
    }
    onSelect(sister, prompt.trim())
    setSelectedId(null)
    setPrompt('')
    setError(null)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 py-6 backdrop-blur-sm">
      <div className="flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--theme-text)]">
            <span className="mr-2">👯</span>Route to Sister
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] px-2.5 py-1 text-sm text-[var(--theme-muted)] hover:text-[var(--theme-text)]"
          >
            Close
          </button>
        </div>

        {sistersQuery.isLoading ? (
          <div className="flex items-center justify-center py-8 text-[var(--theme-muted)]">
            <span className="animate-pulse">Loading sisters…</span>
          </div>
        ) : (
          <SisterPicker
            sisters={sisters}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        )}

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the mission for this sister…"
          rows={3}
          className="w-full resize-none rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-sm text-[var(--theme-text)] placeholder-[var(--theme-muted-2)] outline-none"
        />

        {error && (
          <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-1.5 text-sm text-[var(--theme-muted)] hover:text-[var(--theme-text)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!selectedId || !prompt.trim() || sistersQuery.isLoading}
            onClick={handleDispatch}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--theme-accent)] px-3 py-1.5 text-sm font-medium text-primary-950 disabled:opacity-50"
          >
            <HugeiconsIcon icon={MagicWand01Icon} size={16} />
            Route to Sister
          </button>
        </div>
      </div>
    </div>
  )
}
