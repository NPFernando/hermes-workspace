import { HugeiconsIcon } from '@hugeicons/react'
import { BrainIcon, CodeIcon, PuzzleIcon } from '@hugeicons/core-free-icons'
import { motion } from 'motion/react'
import { useEffect, useState } from 'react'

type ProfileSummary = {
  name: string
  model?: string
  active?: boolean
}

type SuggestionChip = {
  label: string
  prompt: string
  icon: unknown
}

const SUGGESTIONS: Array<SuggestionChip> = [
  {
    label: 'Analyze workspace',
    prompt:
      'Analyze this workspace structure and give me 3 engineering risks. Use tools and keep it concise.',
    icon: CodeIcon,
  },
  {
    label: 'Save a preference',
    prompt:
      'Save this to memory exactly: "For demos, respond in 3 bullets max and put risk first." Then confirm saved.',
    icon: BrainIcon,
  },
  {
    label: 'Create a file',
    prompt: 'Create demo-checklist.md with 5 launch checks for this app.',
    icon: PuzzleIcon,
  },
]

type ChatEmptyStateProps = {
  onSuggestionClick?: (prompt: string) => void
  compact?: boolean
}

export function ChatEmptyState({
  onSuggestionClick,
  compact = false,
}: ChatEmptyStateProps) {
  const [activeProfile, setActiveProfile] = useState<ProfileSummary | null>(null)

  useEffect(() => {
    fetch('/api/profiles/list')
      .then((res) => res.json())
      .then((data) => {
        const profiles = data?.profiles as Array<ProfileSummary> | undefined
        const active = profiles?.find((p) => p.active)
        if (active) setActiveProfile(active)
      })
      .catch(() => {
        // silently ignore — profile info is cosmetic
      })
  }, [])

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex h-full flex-col items-center justify-center px-4 py-8"
    >
      <div className="flex w-full max-w-lg flex-col items-center text-center">
        {/* Avatar — scales with viewport */}
        <div className="relative mb-5 sm:mb-6">
          <img
            src="/claude-avatar.webp"
            alt="Hermes Agent"
            className="relative size-16 sm:size-20 md:size-24 rounded-md border border-[var(--theme-border)] p-1 bg-[var(--theme-card)]"
          />
        </div>

        {/* Editorial micro-label */}
        <p className="micro-label mb-2">Hermes Workspace</p>

        {/* Display title — fluid scale */}
        <h2 className="editorial-display text-2xl sm:text-3xl md:text-4xl text-[var(--theme-text)] leading-tight">
          Begin a session
        </h2>

        {activeProfile && (
          <span className="mt-2 text-xs text-[var(--theme-accent)]">
            {activeProfile.name}
            {activeProfile.model ? ` · ${activeProfile.model}` : ''}
          </span>
        )}

        {!compact && (
          <p className="mt-3 text-xs sm:text-sm text-[var(--theme-muted)] leading-relaxed">
            Agent chat · live tools · memory · full observability
          </p>
        )}

        {/* Prompt chips — stack on narrow mobile, wrap on wider */}
        <div className="mt-5 sm:mt-6 flex flex-col sm:flex-row sm:flex-wrap justify-center gap-2 w-full sm:w-auto">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion.label}
              type="button"
              onClick={() => onSuggestionClick?.(suggestion.prompt)}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2.5 sm:px-3.5 sm:py-2 text-sm sm:text-xs font-medium transition-all bg-[var(--theme-card)] border border-[var(--theme-border)] text-[var(--theme-text)] hover:bg-[var(--theme-card2)] hover:border-[var(--theme-accent-border)] active:scale-[0.98] touch-manipulation"
            >
              <HugeiconsIcon
                icon={suggestion.icon as any}
                size={15}
                strokeWidth={1.5}
                className="shrink-0 text-[var(--theme-accent)]"
              />
              {suggestion.label}
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  )
}
