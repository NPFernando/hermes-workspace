'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  AlertDiamondIcon,
  ArrowUp02Icon,
  Cancel01Icon,
  CodeSimpleIcon,
  Loading03Icon,
  Tick01Icon,
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import { toast } from '@/components/ui/toast'

type ProductId = 'workspace' | 'agent'
type ProductUpdateStatus = {
  id: ProductId
  label: string
  installKind: 'git' | 'desktop' | 'docker' | 'unknown'
  version: string
  path: string | null
  repoPath: string | null
  branch: string | null
  currentHead: string | null
  latestHead: string | null
  updateAvailable: boolean
  canUpdate: boolean
  state: 'current' | 'available' | 'blocked' | 'unsupported' | 'error'
  reason: string | null
  blockingFiles?: Array<string>
  updateMode: string
}

type UpdateStatus = {
  ok: true
  checkedAt: number
  products: Record<ProductId, ProductUpdateStatus>
  updateAvailable: boolean
  pendingReleaseNotes?: Array<ReleaseNoteSection>
}

type ReleaseNoteSection = {
  product: ProductId
  label: string
  from: string | null
  to: string | null
  commits: Array<string>
}

type ApplyUpdateResult = {
  ok: boolean
  product: ProductId
  output?: string
  restartRequired?: boolean
  status?: ProductUpdateStatus
  releaseNotes?: Array<ReleaseNoteSection>
  error?: string
}

type Phase = 'idle' | 'updating' | 'done' | 'error'
type Notes = {
  id: string
  sections: Array<ReleaseNoteSection>
  updatedAt: number
}

// ── Naveen smart-update types ────────────────────────────────────────────────
type ConflictFile = {
  file: string
  upstreamDiffStat: string
  ourDiffStat: string
  upstreamDiff: string
  ourDiff: string
}
type NaveenUpdateStatus = {
  available: boolean
  ourAhead: number
  upstreamBehind: number
  mergeBase: string | null
  upstreamNewCommits: Array<string>
  customFilesUpstreamTouched: Array<string>
  potentialConflicts: Array<ConflictFile>
  canAutoRebase: boolean
  checkedAt: number
  error?: string
}
type ResolutionStrategy = 'keep_ours' | 'take_theirs'
type AiFileRecommendation = {
  file: string
  action: ResolutionStrategy | 'needs_manual_merge'
  confidence: number
  reason: string
}
type NaveenAiAnalysis = {
  recommendations: Array<AiFileRecommendation>
  summary: string
  checkedAt: number
}
type NaveenApplyResult = {
  ok: boolean
  output: string
  conflictFiles: Array<string>
  pushedToFork: boolean
  restartRequired: boolean
  error?: string
}
type NaveenPhase = 'idle' | 'applying' | 'done' | 'error'

const CHECK_INTERVAL_MS = 30 * 60 * 1000
const DISMISS_PREFIX = 'hermes-update-v2-dismissed:'
const NOTES_KEY = 'hermes-update-v2-release-notes'
const NOTES_SEEN_KEY = 'hermes-update-v2-release-notes-seen'

function shortSha(value: string | null | undefined): string {
  return value ? value.slice(0, 7) : 'unknown'
}

function productDismissKey(product: ProductUpdateStatus): string {
  return `${product.id}:${product.latestHead ?? product.version}`
}

function notesId(sections: Array<ReleaseNoteSection>): string {
  return sections
    .map((section) => `${section.product}:${section.from}:${section.to}`)
    .sort()
    .join('|')
}

function storeNotes(sections: Array<ReleaseNoteSection>): Notes | null {
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
      const parsed = JSON.parse(raw) as Partial<Notes>
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

export function UpdateCenterNotifier() {
  const queryClient = useQueryClient()
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  const [phases, setPhases] = useState<Record<ProductId, Phase>>({
    workspace: 'idle',
    agent: 'idle',
  })
  const [errors, setErrors] = useState<Record<ProductId, string>>({
    workspace: '',
    agent: '',
  })
  const [notes, setNotes] = useState<Notes | null>(null)

  // Naveen smart-update state
  const [naveenPhase, setNaveenPhase] = useState<NaveenPhase>('idle')
  const [naveenError, setNaveenError] = useState('')
  const [naveenDismissed, setNaveenDismissed] = useState(false)
  const [naveenModalOpen, setNaveenModalOpen] = useState(false)
  const [naveenAiAnalysis, setNaveenAiAnalysis] = useState<NaveenAiAnalysis | null>(null)
  const [naveenAiLoading, setNaveenAiLoading] = useState(false)
  const [perFileStrategy, setPerFileStrategy] = useState<Record<string, ResolutionStrategy>>({})

  useEffect(() => {
    const values = new Set<string>()
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(DISMISS_PREFIX))
        values.add(localStorage.getItem(key) || '')
    }
    setDismissed(values)
    // Do not open historical release notes on startup. Successful in-app
    // updates still call setNotes immediately after apply, but a routine
    // status poll should not interrupt users with stale "what changed" copy.
  }, [])

  const { data } = useQuery({
    queryKey: ['update-status-v2'],
    queryFn: async () => {
      const res = await fetch('/api/update/status')
      if (!res.ok) return null
      return res.json() as Promise<UpdateStatus>
    },
    refetchInterval: CHECK_INTERVAL_MS,
    staleTime: CHECK_INTERVAL_MS,
    retry: false,
  })

  const { data: naveenStatus } = useQuery({
    queryKey: ['naveen-update-status'],
    queryFn: async () => {
      const res = await fetch('/api/update/naveen-status')
      if (!res.ok) return null
      return res.json() as Promise<NaveenUpdateStatus>
    },
    refetchInterval: CHECK_INTERVAL_MS,
    staleTime: CHECK_INTERVAL_MS,
    retry: false,
  })

  useEffect(() => {
    if (!data?.pendingReleaseNotes?.length) return
    const stored = storeNotes(data.pendingReleaseNotes)
    if (stored) setNotes((current) => current ?? stored)
  }, [data?.pendingReleaseNotes])

  const visibleProducts = useMemo(() => {
    const products = data ? [data.products.workspace, data.products.agent] : []
    return products.filter((product) => {
      // Product decision: only show the top-of-app update banner when a
      // one-click update is actually safe. Dirty checkouts, non-main branches,
      // and blocked/conflicting states still exist, but they belong in an
      // advanced update center view rather than a disruptive banner. See
      // Eric feedback 2026-05-04.
      if (!product.updateAvailable) return false
      if (!product.canUpdate) return false
      if (phases[product.id] === 'done') return false
      return !dismissed.has(productDismissKey(product))
    })
  }, [data, dismissed, phases])

  function dismiss(product: ProductUpdateStatus) {
    const key = productDismissKey(product)
    localStorage.setItem(`${DISMISS_PREFIX}${product.id}`, key)
    setDismissed((prev) => new Set([...prev, key]))
  }

  async function update(product: ProductUpdateStatus) {
    if (!product.canUpdate) return
    setPhases((prev) => ({ ...prev, [product.id]: 'updating' }))
    setErrors((prev) => ({ ...prev, [product.id]: '' }))
    try {
      const res = await fetch(
        `/api/update/${product.id === 'workspace' ? 'workspace' : 'agent'}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      )
      const result = (await res.json()) as ApplyUpdateResult
      if (!res.ok || !result.ok) {
        setPhases((prev) => ({ ...prev, [product.id]: 'error' }))
        setErrors((prev) => ({
          ...prev,
          [product.id]: result.error || `${product.label} update failed`,
        }))
        return
      }
      setPhases((prev) => ({ ...prev, [product.id]: 'done' }))
      dismiss(product)
      const stored = result.releaseNotes?.length
        ? storeNotes(result.releaseNotes)
        : null
      if (stored) setNotes(stored)
      await queryClient.invalidateQueries({ queryKey: ['update-status-v2'] })
      toast(`${product.label} updated. Restart may be required.`, {
        type: 'success',
        duration: 7000,
      })
    } catch (err) {
      setPhases((prev) => ({ ...prev, [product.id]: 'error' }))
      setErrors((prev) => ({
        ...prev,
        [product.id]: err instanceof Error ? err.message : String(err),
      }))
    }
  }

  function closeNotes() {
    if (notes) localStorage.setItem(NOTES_SEEN_KEY, notes.id)
    setNotes(null)
  }

  // Naveen smart-update handlers
  async function openNaveenModal() {
    setNaveenModalOpen(true)
    if (!naveenAiAnalysis && naveenStatus?.potentialConflicts.length) {
      setNaveenAiLoading(true)
      try {
        // Check cache first
        const cacheRes = await fetch('/api/update/naveen-ai-analysis')
        const cacheData = (await cacheRes.json()) as { ok: boolean; analysis: NaveenAiAnalysis | null }
        if (cacheData.ok && cacheData.analysis) {
          setNaveenAiAnalysis(cacheData.analysis)
          // Pre-populate per-file strategy from AI recommendations
          const aiDefaults: Record<string, ResolutionStrategy> = {}
          for (const rec of cacheData.analysis.recommendations) {
            if (rec.action !== 'needs_manual_merge') aiDefaults[rec.file] = rec.action
          }
          setPerFileStrategy((prev) => ({ ...aiDefaults, ...prev }))
          setNaveenAiLoading(false)
          return
        }
        // Request fresh analysis
        const res = await fetch('/api/update/naveen-ai-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        const analysisData = (await res.json()) as { ok: boolean; analysis?: NaveenAiAnalysis }
        if (analysisData.ok && analysisData.analysis) {
          setNaveenAiAnalysis(analysisData.analysis)
          const aiDefaults: Record<string, ResolutionStrategy> = {}
          for (const rec of analysisData.analysis.recommendations) {
            if (rec.action !== 'needs_manual_merge') aiDefaults[rec.file] = rec.action
          }
          setPerFileStrategy((prev) => ({ ...aiDefaults, ...prev }))
        }
      } catch {
        /* analysis unavailable */
      } finally {
        setNaveenAiLoading(false)
      }
    }
  }

  async function applyNaveenUpdate() {
    setNaveenPhase('applying')
    setNaveenError('')
    try {
      const body =
        naveenStatus?.potentialConflicts.length
          ? { strategy: 'keep_ours', perFileStrategy }
          : { strategy: 'auto' }
      const res = await fetch('/api/update/naveen-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = (await res.json()) as NaveenApplyResult
      if (!res.ok || !result.ok) {
        setNaveenPhase('error')
        setNaveenError(result.error ?? 'Smart update failed')
        return
      }
      setNaveenPhase('done')
      setNaveenModalOpen(false)
      await queryClient.invalidateQueries({ queryKey: ['naveen-update-status'] })
      toast(
        result.restartRequired
          ? 'Smart update applied. Restart the service to activate.'
          : 'Smart update applied.',
        { type: 'success', duration: 8000 },
      )
      if (result.pushedToFork) {
        toast('Changes pushed to your GitHub fork.', { type: 'success', duration: 5000 })
      }
    } catch (err) {
      setNaveenPhase('error')
      setNaveenError(err instanceof Error ? err.message : String(err))
    }
  }

  const showNaveenCard =
    naveenStatus?.available === true &&
    !naveenDismissed &&
    naveenPhase !== 'done'

  return (
    <>
      <ReleaseNotes notes={notes} onClose={closeNotes} />
      {naveenModalOpen && naveenStatus && (
        <NaveenUpdateModal
          status={naveenStatus}
          phase={naveenPhase}
          error={naveenError}
          aiAnalysis={naveenAiAnalysis}
          aiLoading={naveenAiLoading}
          perFileStrategy={perFileStrategy}
          onStrategyChange={(file, strategy) =>
            setPerFileStrategy((prev) => ({ ...prev, [file]: strategy }))
          }
          onApply={applyNaveenUpdate}
          onClose={() => setNaveenModalOpen(false)}
        />
      )}
      <div className="pointer-events-none fixed left-1/2 top-[calc(var(--titlebar-h,0px)+1rem)] z-[9998] flex w-[92vw] max-w-md -translate-x-1/2 flex-col gap-3">
        <AnimatePresence>
          {visibleProducts.map((product) => (
            <UpdateCard
              key={product.id}
              product={product}
              phase={phases[product.id]}
              error={errors[product.id]}
              onDismiss={() => dismiss(product)}
              onUpdate={() => update(product)}
            />
          ))}
          {showNaveenCard && (
            <NaveenUpdateCard
              key="naveen-update"
              status={naveenStatus}
              phase={naveenPhase}
              error={naveenError}
              onOpen={openNaveenModal}
              onDismiss={() => setNaveenDismissed(true)}
            />
          )}
        </AnimatePresence>
      </div>
    </>
  )
}

function UpdateCard({
  product,
  phase,
  error,
  onDismiss,
  onUpdate,
}: {
  product: ProductUpdateStatus
  phase: Phase
  error: string
  onDismiss: () => void
  onUpdate: () => void
}) {
  const updating = phase === 'updating'
  const blocked = product.updateAvailable && !product.canUpdate
  const subtitle =
    phase === 'error'
      ? error
      : blocked
        ? product.reason || 'Update requires manual review.'
        : `${shortSha(product.currentHead)} → ${shortSha(product.latestHead)} · ${product.installKind}`

  return (
    <motion.div
      initial={{ opacity: 0, y: -24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -24, scale: 0.96 }}
      transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
      // Firefox/Linux right-clicks on this card were intermittently eaten by
      // the surrounding motion/backdrop layers, making the modal feel
      // unresponsive and preventing copy/open-in-new-tab actions. Let the
      // native context menu open on the card itself and keep the event from
      // bubbling to the backdrop. See #286.
      onContextMenu={(event) => event.stopPropagation()}
      className="pointer-events-auto overflow-hidden rounded-2xl shadow-2xl select-text"
      style={{
        background: 'var(--theme-card)',
        border: '1px solid var(--theme-border)',
        color: 'var(--theme-text)',
        boxShadow: 'var(--theme-shadow-3)',
      }}
    >
      {updating ? (
        <div
          className="h-0.5 animate-pulse"
          style={{ background: 'var(--theme-accent)' }}
        />
      ) : null}
      <div className="flex items-center gap-3 px-5 py-3.5">
        <div
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-xl',
            blocked || phase === 'error' ? 'bg-amber-500/15' : '',
          )}
          style={
            !blocked && phase !== 'error'
              ? {
                  background:
                    'color-mix(in srgb, var(--theme-accent) 14%, transparent)',
                }
              : undefined
          }
        >
          <HugeiconsIcon
            icon={
              updating
                ? Loading03Icon
                : phase === 'done'
                  ? Tick01Icon
                  : ArrowUp02Icon
            }
            size={18}
            strokeWidth={2}
            className={updating ? 'animate-spin' : undefined}
            style={{
              color:
                blocked || phase === 'error'
                  ? '#f59e0b'
                  : 'var(--theme-accent)',
            }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p
            className="text-sm font-semibold"
            style={{ color: 'var(--theme-text)' }}
          >
            {blocked
              ? `${product.label} update blocked`
              : `${product.label} update available`}
          </p>
          {/* Don't truncate when blocked — the full reason is what the
              user needs to act on. See #293. */}
          <p
            className={cn('text-xs', blocked ? '' : 'truncate')}
            style={{ color: 'var(--theme-muted)' }}
          >
            {subtitle}
          </p>
          {blocked && product.repoPath ? (
            <p
              className="mt-0.5 truncate font-mono text-[11px]"
              style={{ color: 'var(--theme-muted)' }}
              title={product.repoPath}
            >
              {product.repoPath}
            </p>
          ) : null}
          {blocked && product.blockingFiles && product.blockingFiles.length > 0 ? (
            <ul className="mt-1 max-h-24 overflow-auto pr-1">
              {product.blockingFiles.slice(0, 8).map((file) => (
                <li
                  key={file}
                  className="truncate font-mono text-[11px]"
                  style={{ color: 'var(--theme-muted)' }}
                  title={file}
                >
                  {file}
                </li>
              ))}
              {product.blockingFiles.length > 8 ? (
                <li
                  className="text-[11px] italic"
                  style={{ color: 'var(--theme-muted)' }}
                >
                  …and {product.blockingFiles.length - 8} more
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {product.canUpdate ? (
            <button
              type="button"
              onClick={onUpdate}
              disabled={updating}
              className="rounded-lg px-4 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ background: 'var(--theme-accent)' }}
            >
              {updating ? 'Updating' : 'Update'}
            </button>
          ) : (
            <span
              className="rounded-lg px-3 py-1.5 text-xs font-semibold"
              style={{
                background: 'var(--theme-card2)',
                color: 'var(--theme-muted)',
              }}
            >
              Review required
            </span>
          )}
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg p-1.5 transition-opacity hover:opacity-80"
            style={{ color: 'var(--theme-muted)' }}
            aria-label={`Dismiss ${product.label} update`}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} />
          </button>
        </div>
      </div>
    </motion.div>
  )
}

function ReleaseNotes({
  notes,
  onClose,
}: {
  notes: Notes | null
  onClose: () => void
}) {
  if (!notes) return null
  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[10000] flex items-start justify-center bg-black/45 px-4 pt-[calc(var(--titlebar-h,0px)+1.5rem)] backdrop-blur-sm sm:items-center sm:pt-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="w-full max-w-lg overflow-hidden rounded-2xl shadow-2xl select-text"
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.96 }}
          onContextMenu={(event) => event.stopPropagation()}
          style={{
            background: 'var(--theme-card)',
            border: '1px solid var(--theme-border)',
            color: 'var(--theme-text)',
            boxShadow: 'var(--theme-shadow-3)',
          }}
        >
          <div className="flex items-start gap-3 px-5 py-4">
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-xl"
              style={{
                background:
                  'color-mix(in srgb, var(--theme-accent) 14%, transparent)',
              }}
            >
              <HugeiconsIcon
                icon={Tick01Icon}
                size={20}
                strokeWidth={2}
                style={{ color: 'var(--theme-accent)' }}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold">Hermes updated</p>
              <p className="text-sm" style={{ color: 'var(--theme-muted)' }}>
                What changed in this update.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 transition-opacity hover:opacity-80"
              style={{ color: 'var(--theme-muted)' }}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={2} />
            </button>
          </div>
          <div className="max-h-[60vh] space-y-4 overflow-auto px-5 pb-5">
            {notes.sections.map((section) => (
              <section key={`${section.product}:${section.to}`}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">{section.label}</h3>
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[11px]"
                    style={{
                      background: 'var(--theme-card2)',
                      color: 'var(--theme-muted)',
                    }}
                  >
                    {shortSha(section.from)} → {shortSha(section.to)}
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {(section.commits.length
                    ? section.commits
                    : ['Updated to the latest available version.']
                  ).map((commit, index) => (
                    <li
                      key={`${section.product}-${index}-${commit}`}
                      className="rounded-xl px-3 py-2 text-sm"
                      style={{ background: 'var(--theme-card2)' }}
                    >
                      {commit}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <div
            className="flex justify-end border-t px-5 py-3"
            style={{ borderColor: 'var(--theme-border)' }}
          >
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-white"
              style={{ background: 'var(--theme-accent)' }}
            >
              Continue
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// ── NaveenUpdateCard ─────────────────────────────────────────────────────────

function NaveenUpdateCard({
  status,
  phase,
  error,
  onOpen,
  onDismiss,
}: {
  status: NaveenUpdateStatus
  phase: NaveenPhase
  error: string
  onOpen: () => void
  onDismiss: () => void
}) {
  const applying = phase === 'applying'
  const hasConflicts = status.potentialConflicts.length > 0
  const subtitle =
    phase === 'error'
      ? error
      : hasConflicts
        ? `${status.upstreamBehind} new commit${status.upstreamBehind > 1 ? 's' : ''} · ${status.potentialConflicts.length} custom file${status.potentialConflicts.length > 1 ? 's' : ''} need review`
        : `${status.upstreamBehind} new commit${status.upstreamBehind > 1 ? 's' : ''} · auto-rebase safe`

  return (
    <motion.div
      initial={{ opacity: 0, y: -24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -24, scale: 0.96 }}
      transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
      onContextMenu={(event) => event.stopPropagation()}
      className="pointer-events-auto overflow-hidden rounded-2xl shadow-2xl select-text"
      style={{
        background: 'var(--theme-card)',
        border: '1px solid var(--theme-border)',
        color: 'var(--theme-text)',
        boxShadow: 'var(--theme-shadow-3)',
      }}
    >
      {applying && (
        <div
          className="h-0.5 animate-pulse"
          style={{ background: 'linear-gradient(90deg, #a855f7, #3b82f6, #a855f7)' }}
        />
      )}
      <div className="flex items-center gap-3 px-5 py-3.5">
        <div
          className="flex size-9 shrink-0 items-center justify-center rounded-xl"
          style={{
            background: hasConflicts
              ? 'rgb(245 158 11 / 0.15)'
              : 'color-mix(in srgb, #a855f7 14%, transparent)',
          }}
        >
          <HugeiconsIcon
            icon={applying ? Loading03Icon : hasConflicts ? AlertDiamondIcon : CodeSimpleIcon}
            size={18}
            strokeWidth={2}
            className={applying ? 'animate-spin' : undefined}
            style={{ color: hasConflicts ? '#f59e0b' : '#a855f7' }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold" style={{ color: 'var(--theme-text)' }}>
            {applying ? 'Applying smart update…' : 'Upstream update available'}
          </p>
          <p className="truncate text-xs" style={{ color: 'var(--theme-muted)' }}>
            {subtitle}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onOpen}
            disabled={applying}
            className="rounded-lg px-4 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ background: hasConflicts ? '#f59e0b' : '#a855f7' }}
          >
            {applying ? 'Updating' : hasConflicts ? 'Review' : 'Update'}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg p-1.5 transition-opacity hover:opacity-80"
            style={{ color: 'var(--theme-muted)' }}
            aria-label="Dismiss upstream update"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} />
          </button>
        </div>
      </div>
    </motion.div>
  )
}

// ── NaveenUpdateModal ─────────────────────────────────────────────────────────

function NaveenUpdateModal({
  status,
  phase,
  error,
  aiAnalysis,
  aiLoading,
  perFileStrategy,
  onStrategyChange,
  onApply,
  onClose,
}: {
  status: NaveenUpdateStatus
  phase: NaveenPhase
  error: string
  aiAnalysis: NaveenAiAnalysis | null
  aiLoading: boolean
  perFileStrategy: Record<string, ResolutionStrategy>
  onStrategyChange: (file: string, strategy: ResolutionStrategy) => void
  onApply: () => void
  onClose: () => void
}) {
  const applying = phase === 'applying'
  const hasConflicts = status.potentialConflicts.length > 0

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-start justify-center bg-black/45 px-4 pt-[calc(var(--titlebar-h,0px)+1.5rem)] backdrop-blur-sm sm:items-center sm:pt-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        className="flex w-full max-w-xl flex-col overflow-hidden rounded-2xl shadow-2xl select-text"
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.96 }}
        onContextMenu={(e) => e.stopPropagation()}
        style={{
          background: 'var(--theme-card)',
          border: '1px solid var(--theme-border)',
          color: 'var(--theme-text)',
          boxShadow: 'var(--theme-shadow-3)',
        }}
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4">
          <div
            className="flex size-10 shrink-0 items-center justify-center rounded-xl"
            style={{ background: 'color-mix(in srgb, #a855f7 14%, transparent)' }}
          >
            <HugeiconsIcon
              icon={hasConflicts ? AlertDiamondIcon : CodeSimpleIcon}
              size={20}
              strokeWidth={2}
              style={{ color: '#a855f7' }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold">Smart upstream update</p>
            <p className="text-sm" style={{ color: 'var(--theme-muted)' }}>
              {status.upstreamBehind} new upstream commit{status.upstreamBehind > 1 ? 's' : ''} ·{' '}
              {hasConflicts
                ? `${status.potentialConflicts.length} custom file${status.potentialConflicts.length > 1 ? 's' : ''} need your decision`
                : 'No conflicts — safe to apply'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 transition-opacity hover:opacity-80"
            style={{ color: 'var(--theme-muted)' }}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={2} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="max-h-[60vh] space-y-4 overflow-auto px-5 pb-2">
          {/* Upstream commits */}
          <section>
            <h3 className="mb-2 text-sm font-semibold" style={{ color: 'var(--theme-text)' }}>
              New upstream commits
            </h3>
            <ul className="space-y-1">
              {status.upstreamNewCommits.map((commit, i) => (
                <li
                  key={i}
                  className="rounded-xl px-3 py-1.5 font-mono text-xs"
                  style={{ background: 'var(--theme-card2)', color: 'var(--theme-muted)' }}
                >
                  {commit}
                </li>
              ))}
            </ul>
          </section>

          {/* Custom files upstream touched but we didn't change */}
          {status.customFilesUpstreamTouched.length > status.potentialConflicts.length ? (
            <section>
              <h3 className="mb-2 text-sm font-semibold" style={{ color: 'var(--theme-text)' }}>
                Custom files upstream updated (no conflict)
              </h3>
              <ul className="space-y-1">
                {status.customFilesUpstreamTouched
                  .filter((f) => !status.potentialConflicts.some((c) => c.file === f))
                  .map((file) => (
                    <li
                      key={file}
                      className="rounded-xl px-3 py-1.5 font-mono text-xs"
                      style={{ background: 'var(--theme-card2)', color: 'var(--theme-muted)' }}
                    >
                      {file}
                    </li>
                  ))}
              </ul>
            </section>
          ) : null}

          {/* AI summary */}
          {hasConflicts && (
            <section
              className="rounded-xl px-4 py-3"
              style={{ background: 'color-mix(in srgb, #a855f7 8%, var(--theme-card2))' }}
            >
              <p className="mb-1 text-xs font-semibold" style={{ color: '#a855f7' }}>
                AI Analysis
              </p>
              {aiLoading ? (
                <div className="flex items-center gap-2" style={{ color: 'var(--theme-muted)' }}>
                  <HugeiconsIcon icon={Loading03Icon} size={14} strokeWidth={2} className="animate-spin" />
                  <span className="text-xs">Asking Astra to analyze conflicts…</span>
                </div>
              ) : aiAnalysis?.summary ? (
                <p className="text-xs" style={{ color: 'var(--theme-muted)' }}>
                  {aiAnalysis.summary}
                </p>
              ) : (
                <p className="text-xs" style={{ color: 'var(--theme-muted)' }}>
                  Analysis will appear here once loaded.
                </p>
              )}
            </section>
          )}

          {/* Per-file conflict resolution */}
          {status.potentialConflicts.map((conflict) => {
            const aiRec = aiAnalysis?.recommendations.find((r) => r.file === conflict.file)
            const currentStrategy = perFileStrategy[conflict.file] ?? 'keep_ours'
            return (
              <section
                key={conflict.file}
                className="rounded-xl border p-4 space-y-3"
                style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-card2)' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="font-mono text-xs font-semibold" style={{ color: 'var(--theme-text)' }}>
                    {conflict.file}
                  </p>
                  {aiRec && (
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
                      style={{
                        background:
                          aiRec.action === 'keep_ours'
                            ? 'rgb(34 197 94 / 0.15)'
                            : aiRec.action === 'take_theirs'
                              ? 'rgb(59 130 246 / 0.15)'
                              : 'rgb(245 158 11 / 0.15)',
                        color:
                          aiRec.action === 'keep_ours'
                            ? '#22c55e'
                            : aiRec.action === 'take_theirs'
                              ? '#3b82f6'
                              : '#f59e0b',
                      }}
                    >
                      AI: {aiRec.action.replace(/_/g, ' ')} ({aiRec.confidence}%)
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]" style={{ color: 'var(--theme-muted)' }}>
                  <div>
                    <span className="font-semibold">Upstream: </span>
                    {conflict.upstreamDiffStat}
                  </div>
                  <div>
                    <span className="font-semibold">Ours: </span>
                    {conflict.ourDiffStat}
                  </div>
                </div>
                {aiRec?.reason && (
                  <p className="text-[11px] italic" style={{ color: 'var(--theme-muted)' }}>
                    {aiRec.reason}
                  </p>
                )}
                {/* Strategy toggle */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onStrategyChange(conflict.file, 'keep_ours')}
                    className={cn(
                      'flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all',
                      currentStrategy === 'keep_ours'
                        ? 'text-white'
                        : 'opacity-50 hover:opacity-80',
                    )}
                    style={{
                      background:
                        currentStrategy === 'keep_ours' ? '#22c55e' : 'var(--theme-card)',
                      border: '1px solid var(--theme-border)',
                    }}
                  >
                    Keep mine
                  </button>
                  <button
                    type="button"
                    onClick={() => onStrategyChange(conflict.file, 'take_theirs')}
                    className={cn(
                      'flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all',
                      currentStrategy === 'take_theirs'
                        ? 'text-white'
                        : 'opacity-50 hover:opacity-80',
                    )}
                    style={{
                      background:
                        currentStrategy === 'take_theirs' ? '#3b82f6' : 'var(--theme-card)',
                      border: '1px solid var(--theme-border)',
                    }}
                  >
                    Take upstream
                  </button>
                </div>
              </section>
            )
          })}
        </div>

        {/* Error */}
        {phase === 'error' && error && (
          <div className="mx-5 mb-2 rounded-xl px-4 py-2 text-xs" style={{ background: 'rgb(239 68 68 / 0.12)', color: '#ef4444' }}>
            {error}
          </div>
        )}

        {/* Footer */}
        <div
          className="flex items-center justify-between border-t px-5 py-3"
          style={{ borderColor: 'var(--theme-border)' }}
        >
          <p className="text-xs" style={{ color: 'var(--theme-muted)' }}>
            {hasConflicts
              ? 'Rebase with chosen strategies · build · push to fork'
              : 'Auto-rebase · build · push to fork'}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-semibold"
              style={{ background: 'var(--theme-card2)', color: 'var(--theme-text)' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onApply}
              disabled={applying}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ background: '#a855f7' }}
            >
              {applying && (
                <HugeiconsIcon icon={Loading03Icon} size={14} strokeWidth={2} className="animate-spin" />
              )}
              {applying ? 'Applying…' : hasConflicts ? 'Apply Smart Update' : 'Apply Update'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

export const __updateReleaseNotesStorageForTests = {
  NOTES_SEEN_KEY,
  storeNotes,
}
