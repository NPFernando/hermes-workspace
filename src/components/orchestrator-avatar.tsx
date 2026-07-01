import { memo, useCallback, useMemo, useState } from 'react'
import { ensureStyles, stateAnim } from './orchestrator-avatar/avatar-styles'
import {
  ClawCatSVG,
  DragonSVG,
  FoxSVG,
  GhostSVG,
  LobsterSVG,
  OctopusSVG,
  OwlSVG,
  PandaSVG,
  RobotSVG,
  WolfSVG,
} from './orchestrator-avatar/animal-svgs'
import type { OrchestratorState } from '@/hooks/use-orchestrator-state'
import { useOrchestratorState } from '@/hooks/use-orchestrator-state'
import {
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/* ── Avatar types ─────────────────────────────────────── */

export type AvatarStyle =
  // Greek god PNGs (premium tier, the "More" gallery)
  | 'hermes'
  | 'athena'
  | 'apollo'
  | 'artemis'
  | 'iris'
  | 'nike'
  | 'eros'
  | 'pan'
  | 'chronos'
  // Emoji-styled SVG avatars (default quick tier)
  | 'owl'
  | 'hermes-cat'
  | 'robot'
  | 'ghost'
  | 'fox'
  | 'wolf'
  | 'octopus'
  | 'dragon'
  | 'panda'

type AvatarOption = {
  id: AvatarStyle
  label: string
  emoji: string
  tier: 'emoji' | 'greek'
}

const AVATAR_OPTIONS: Array<AvatarOption> = [
  // Greek god PNG portraits (premium tier)
  { id: 'hermes', label: 'Hermes', emoji: '🩽', tier: 'greek' },
  { id: 'athena', label: 'Athena', emoji: '🦉', tier: 'greek' },
  { id: 'apollo', label: 'Apollo', emoji: '☀️', tier: 'greek' },
  { id: 'artemis', label: 'Artemis', emoji: '🌙', tier: 'greek' },
  { id: 'iris', label: 'Iris', emoji: '🌈', tier: 'greek' },
  { id: 'nike', label: 'Nike', emoji: '🏆', tier: 'greek' },
  { id: 'eros', label: 'Eros', emoji: '💘', tier: 'greek' },
  { id: 'pan', label: 'Pan', emoji: '🌿', tier: 'greek' },
  { id: 'chronos', label: 'Chronos', emoji: '⏳', tier: 'greek' },
  // Emoji SVG quick avatars
  { id: 'owl', label: 'Owl', emoji: '🦉', tier: 'emoji' },
  { id: 'hermes-cat', label: 'Cat', emoji: '🐱', tier: 'emoji' },
  { id: 'robot', label: 'Robot', emoji: '🤖', tier: 'emoji' },
  { id: 'fox', label: 'Fox', emoji: '🦊', tier: 'emoji' },
  { id: 'ghost', label: 'Ghost', emoji: '👻', tier: 'emoji' },
  { id: 'wolf', label: 'Wolf', emoji: '🐺', tier: 'emoji' },
  { id: 'octopus', label: 'Octopus', emoji: '🐙', tier: 'emoji' },
  { id: 'dragon', label: 'Dragon', emoji: '🐉', tier: 'emoji' },
  { id: 'panda', label: 'Panda', emoji: '🐼', tier: 'emoji' },
]

const GREEK_AVATARS = AVATAR_OPTIONS.filter((o) => o.tier === 'greek')
const EMOJI_AVATARS = AVATAR_OPTIONS.filter((o) => o.tier === 'emoji')

const STORAGE_KEY = 'hermes-workspace-orchestrator-avatar'

function getStoredAvatar(): AvatarStyle {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v && AVATAR_OPTIONS.some((o) => o.id === v)) return v as AvatarStyle
  } catch {
    /* noop */
  }
  return 'hermes'
}

/* ── Greek god PNG avatar factory ────────────────── */

function makeGreekPNG(name: string, label: string) {
  return function GreekPNG({
    state,
    size,
  }: {
    state: OrchestratorState
    size: number
  }) {
    ensureStyles()
    const animation = stateAnim(state)
    return (
      <div
        style={{
          width: size,
          height: size,
          position: 'relative',
          animation,
        }}
      >
        <img
          src={`/avatars/${name}.png`}
          alt={label}
          width={size}
          height={size}
          style={{
            width: size,
            height: size,
            objectFit: 'cover',
            borderRadius: '50%',
            display: 'block',
          }}
          draggable={false}
        />
        {state === 'thinking' && (
          <svg
            width={size}
            height={size}
            viewBox="0 0 32 32"
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
            }}
          >
            <circle
              cx={16}
              cy={16}
              r={15}
              fill="none"
              stroke="#eab308"
              strokeWidth={1.2}
              strokeDasharray="4 4"
              style={{ animation: 'oa-think-ring 2s linear infinite' }}
            />
          </svg>
        )}
      </div>
    )
  }
}

const HermesPNG = makeGreekPNG('hermes', 'Hermes')
const AthenaPNG = makeGreekPNG('athena', 'Athena')
const ApolloPNG = makeGreekPNG('apollo', 'Apollo')
const ArtemisPNG = makeGreekPNG('artemis', 'Artemis')
const IrisPNG = makeGreekPNG('iris', 'Iris')
const NikePNG = makeGreekPNG('nike', 'Nike')
const ErosPNG = makeGreekPNG('eros', 'Eros')
const PanPNG = makeGreekPNG('pan', 'Pan')
const ChronosPNG = makeGreekPNG('chronos', 'Chronos')

const AVATAR_RENDERERS: Record<
  AvatarStyle,
  React.FC<{ state: OrchestratorState; size: number }>
> = {
  // Greek PNGs
  hermes: HermesPNG,
  athena: AthenaPNG,
  apollo: ApolloPNG,
  artemis: ArtemisPNG,
  iris: IrisPNG,
  nike: NikePNG,
  eros: ErosPNG,
  pan: PanPNG,
  chronos: ChronosPNG,
  // Emoji SVGs
  wolf: WolfSVG,
  'hermes-cat': ClawCatSVG,
  robot: RobotSVG,
  fox: FoxSVG,
  owl: OwlSVG,
  ghost: GhostSVG,
  octopus: OctopusSVG,
  dragon: DragonSVG,
  panda: PandaSVG,
}

/* ── Dot colour per state ─────────────────────────────── */

const DOT_COLORS: Record<OrchestratorState, string> = {
  idle: '#6b7280',
  reading: '#3b82f6',
  thinking: '#eab308',
  responding: '#22c55e',
  'tool-use': '#8b5cf6',
  orchestrating: '#f97316',
}

/* ── Avatar Picker Popover ────────────────────────────── */

function AvatarPicker({
  current,
  onSelect,
}: {
  current: AvatarStyle
  onSelect: (s: AvatarStyle) => void
}) {
  const isGreek = GREEK_AVATARS.some((o) => o.id === current)
  const [showGreek, setShowGreek] = useState<boolean>(isGreek)

  return (
    <div
      className="flex flex-col gap-3 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-hover)]/95 p-3 shadow-xl backdrop-blur-xl"
      style={{ minWidth: 240, maxWidth: 320 }}
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-[var(--theme-muted)]">
          {showGreek ? 'Greek Gods' : 'Choose Avatar'}
        </p>
        <button
          type="button"
          onClick={() => setShowGreek((s) => !s)}
          className="rounded-md px-2 py-0.5 text-[10px] font-medium text-accent-700 transition-colors hover:bg-accent-500/10"
        >
          {showGreek ? '← Standard' : 'More →'}
        </button>
      </div>

      {showGreek ? (
        <div className="grid grid-cols-3 gap-2">
          {GREEK_AVATARS.map((opt) => {
            const active = current === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onSelect(opt.id)}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-xl p-1.5 transition-all',
                  active
                    ? 'bg-accent-500/20 ring-2 ring-accent-500'
                    : 'hover:bg-[var(--theme-hover)]/60',
                )}
              >
                <img
                  src={`/avatars/${opt.id}.png`}
                  alt={opt.label}
                  className={cn(
                    'h-14 w-14 rounded-lg object-cover transition-transform',
                    active ? 'scale-105' : 'hover:scale-105',
                  )}
                  draggable={false}
                />
                <span className="text-[10px] font-medium text-[var(--theme-muted)]">
                  {opt.label}
                </span>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {EMOJI_AVATARS.map((opt) => {
            const active = current === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onSelect(opt.id)}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-xl p-2 transition-all',
                  active
                    ? 'bg-accent-500/20 ring-2 ring-accent-500 scale-105'
                    : 'hover:bg-[var(--theme-hover)]/60 hover:scale-105',
                )}
              >
                <span className="text-2xl">{opt.emoji}</span>
                <span className="text-[10px] font-medium text-[var(--theme-muted)]">
                  {opt.label}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── Main export ──────────────────────────────────────── */

type OrchestratorAvatarProps = {
  size?: number
  /** When true, hides tooltip, edit pencil, and picker — just the avatar + state dot */
  compact?: boolean
}

function OrchestratorAvatarComponent({ size = 48, compact = false }: OrchestratorAvatarProps) {
  const { state, label } = useOrchestratorState()
  const [avatarStyle, setAvatarStyle] = useState<AvatarStyle>(getStoredAvatar)
  const [showPicker, setShowPicker] = useState(false)

  const Renderer = AVATAR_RENDERERS[avatarStyle]
  const dotColor = DOT_COLORS[state]

  const handleSelect = useCallback((s: AvatarStyle) => {
    setAvatarStyle(s)
    setShowPicker(false)
    try {
      localStorage.setItem(STORAGE_KEY, s)
    } catch {
      /* noop */
    }
  }, [])

  const tooltipText = useMemo(() => `⚡ Agent — ${label}`, [label])

  if (compact) {
    return (
      <div
        className="relative flex items-center justify-center rounded-full"
        style={{ width: size + 4, height: size + 4 }}
      >
        <Renderer state={state} size={size} />
        <span
          className="absolute bottom-0 right-0 block rounded-full border-2 border-surface"
          style={{
            width: Math.max(6, size / 6),
            height: Math.max(6, size / 6),
            backgroundColor: dotColor,
            transition: 'background-color 300ms ease',
          }}
        />
      </div>
    )
  }

  return (
    <div className="relative flex flex-col items-center gap-1">
      <TooltipProvider>
        <TooltipRoot>
          <TooltipTrigger
            render={
              <div
                className="relative flex items-center justify-center rounded-full transition-all duration-300"
                style={{ width: size + 4, height: size + 4 }}
              >
                <Renderer state={state} size={size} />
                {/* State dot */}
                <span
                  className="absolute bottom-0 right-0 block rounded-full border-2 border-[var(--theme-border)]"
                  style={{
                    width: Math.max(8, size / 6),
                    height: Math.max(8, size / 6),
                    backgroundColor: dotColor,
                    transition: 'background-color 300ms ease',
                  }}
                />
              </div>
            }
          />
          <TooltipContent side="right" className="text-xs">
            {tooltipText}
          </TooltipContent>
        </TooltipRoot>
      </TooltipProvider>

      {/* Edit pencil overlay */}
      <button
        type="button"
        onClick={() => setShowPicker((v) => !v)}
        className="absolute -right-1 -top-1 rounded-full border border-[var(--theme-border)] bg-[var(--theme-hover)]/90 p-1 text-[var(--theme-muted)] shadow-sm transition-all hover:bg-[var(--theme-hover)] hover:text-[var(--theme-text)] hover:scale-110"
        aria-label="Change avatar"
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
          <path d="M12.146.854a.5.5 0 0 1 .708 0l2.292 2.292a.5.5 0 0 1 0 .708L5.854 13.146a.5.5 0 0 1-.233.131l-3.5 1a.5.5 0 0 1-.617-.617l1-3.5a.5.5 0 0 1 .131-.233L12.146.854zM11.5 2.5 13.5 4.5" />
        </svg>
      </button>

      {/* Picker popover — fixed so it can't be clipped by parent overflow */}
      {showPicker && (
        <>
          <div
            className="fixed inset-0 z-[100] bg-black/20 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={() => setShowPicker(false)}
          />
          <div className="fixed left-1/2 top-1/2 z-[101] -translate-x-1/2 -translate-y-1/2 animate-in zoom-in-95 fade-in duration-200">
            <AvatarPicker current={avatarStyle} onSelect={handleSelect} />
          </div>
        </>
      )}
    </div>
  )
}

export const OrchestratorAvatar = memo(OrchestratorAvatarComponent)
