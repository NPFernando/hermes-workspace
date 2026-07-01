import { useEffect, useState } from 'react'

const PLANNING_STEPS = ['Planning the mission…', 'Analyzing requirements…', 'Preparing agents…', 'Writing the spec…']
export const WORKING_STEPS = [
  '📋 Reviewing the brief…',
  '🔍 Scanning existing patterns…',
  '✏️ Drafting the implementation…',
  '☕ Grabbing a coffee…',
  '🧠 Thinking through edge cases…',
  '🎨 Polishing the design…',
  '🔧 Wiring up components…',
  '📐 Checking the layout…',
  '🚀 Almost there…',
]

export function CyclingStatus({ steps, intervalMs = 3000, isPaused = false }: { steps: Array<string>; intervalMs?: number; isPaused?: boolean }) {
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (isPaused) return
    const timer = window.setInterval(() => setStep((current) => (current + 1) % steps.length), intervalMs)
    return () => window.clearInterval(timer)
  }, [isPaused, steps.length, intervalMs])

  if (isPaused) {
    return (
      <div className="flex items-center gap-3 py-3">
        <div className="flex size-3.5 items-center justify-center rounded-full border border-amber-400/60 bg-amber-500/10 text-[9px] text-amber-300">||</div>
        <p className="text-sm text-[var(--theme-muted)]">Paused</p>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 py-3">
      <div className="spinner-accent spinner-sm" />
      <p className="text-sm text-[var(--theme-muted)] transition-opacity duration-500">{steps[step]}</p>
    </div>
  )
}

export function PlanningIndicator() {
  return <CyclingStatus steps={PLANNING_STEPS} intervalMs={2500} />
}

