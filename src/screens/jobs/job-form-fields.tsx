'use client'

import type { ClaudeJob, JobProfileOption } from '@/lib/jobs-api'
import { cn } from '@/lib/utils'

export const SCHEDULE_PRESETS = [
  { label: 'Every 15m', value: 'every 15m' },
  { label: 'Every 30m', value: 'every 30m' },
  { label: 'Every 1h', value: 'every 1h' },
  { label: 'Every 6h', value: 'every 6h' },
  { label: 'Daily', value: '0 9 * * *' },
  { label: 'Weekly', value: '0 9 * * 1' },
] as const

export const DELIVERY_OPTIONS = ['local', 'telegram', 'discord'] as const

export type JobFormState = {
  profile: string
  name: string
  schedule: string
  prompt: string
  skillsInput: string
  deliver: Array<string>
  repeatMode: 'unlimited' | 'limited'
  repeatCount: string
}

export function toggleJobDelivery(
  current: JobFormState,
  target: string,
): JobFormState {
  const nextDeliver = current.deliver.includes(target)
    ? current.deliver.filter((item) => item !== target)
    : [...current.deliver, target]

  return { ...current, deliver: nextDeliver }
}

const fieldClass =
  'w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:ring-1 bg-[var(--theme-input)] border-[var(--theme-border)] text-[var(--theme-text)]'

const presetButtonClass = (isActive: boolean) =>
  cn(
    'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
    isActive
      ? 'bg-[var(--theme-accent)] border-[var(--theme-accent)] text-white'
      : 'bg-[var(--theme-card)] border-[var(--theme-border)] text-[var(--theme-text)]',
  )

export function JobFormFields({
  form,
  setForm,
  profiles,
  job,
}: {
  form: JobFormState
  setForm: (updater: (current: JobFormState) => JobFormState) => void
  profiles: Array<JobProfileOption>
  /** Pass the job being edited so the profile-move hint can render; omit for create. */
  job?: ClaudeJob | null
}) {
  return (
    <>
      <section className="space-y-2">
        <label className="text-sm font-medium">Profile</label>
        <select
          value={form.profile}
          onChange={(event) =>
            setForm((current) => ({ ...current, profile: event.target.value }))
          }
          required
          className={fieldClass}
        >
          {profiles.map((profile) => (
            <option key={profile.name} value={profile.name}>
              {profile.name}
              {profile.active ? ' (active)' : ''}
            </option>
          ))}
        </select>
        {job?.profile && form.profile !== job.profile ? (
          <p className="text-xs text-[var(--theme-muted)]">
            Saving will recreate this cron job in {form.profile} and remove it
            from {job.profile}.
          </p>
        ) : (
          <p className="text-xs text-[var(--theme-muted)]">
            Cron jobs are stored under the selected Hermes profile.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <label className="text-sm font-medium">Name</label>
        <input
          value={form.name}
          onChange={(event) =>
            setForm((current) => ({ ...current, name: event.target.value }))
          }
          placeholder="Daily research summary"
          required
          className={fieldClass}
        />
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Schedule</h3>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Choose a preset or enter a custom schedule string below.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {SCHEDULE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() =>
                setForm((current) => ({ ...current, schedule: preset.value }))
              }
              className={presetButtonClass(form.schedule === preset.value)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Custom schedule</label>
          <input
            value={form.schedule}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                schedule: event.target.value,
              }))
            }
            placeholder="every 30m or 0 9 * * *"
            required
            className={fieldClass}
          />
          <p className="text-xs text-[var(--theme-muted)]">
            Advanced users can enter cron expressions directly.
          </p>
        </div>
      </section>

      <section className="space-y-2">
        <label className="text-sm font-medium">Prompt</label>
        <textarea
          value={form.prompt}
          onChange={(event) =>
            setForm((current) => ({ ...current, prompt: event.target.value }))
          }
          placeholder="What should Hermes Agent do?"
          required
          rows={5}
          className={cn(fieldClass, 'resize-none')}
        />
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-medium">Options</h3>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Optional routing and repeat controls.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Skills</label>
          <input
            value={form.skillsInput}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                skillsInput: event.target.value,
              }))
            }
            placeholder="research, writing, synthesis"
            className={fieldClass}
          />
          <p className="text-xs text-[var(--theme-muted)]">
            Comma-separated for now.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Deliver to</label>
          <div className="flex flex-wrap gap-2">
            {DELIVERY_OPTIONS.map((option) => {
              const isActive = form.deliver.includes(option)
              const needsGateway = option === 'telegram' || option === 'discord'
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() =>
                    setForm((current) => toggleJobDelivery(current, option))
                  }
                  title={
                    needsGateway
                      ? `Requires Hermes Agent gateway with ${option} configured`
                      : undefined
                  }
                  className="rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition-colors"
                  style={{
                    background: isActive
                      ? 'var(--theme-accent)'
                      : 'var(--theme-card)',
                    borderColor: isActive
                      ? 'var(--theme-accent)'
                      : 'var(--theme-border)',
                    color: isActive
                      ? '#fff'
                      : needsGateway
                        ? 'var(--theme-muted)'
                        : 'var(--theme-text)',
                  }}
                >
                  {option}
                  {needsGateway ? ' ⚡' : ''}
                </button>
              )
            })}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Repeat</label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                setForm((current) => ({ ...current, repeatMode: 'unlimited' }))
              }
              className={presetButtonClass(form.repeatMode === 'unlimited')}
            >
              Unlimited
            </button>
            <button
              type="button"
              onClick={() =>
                setForm((current) => ({ ...current, repeatMode: 'limited' }))
              }
              className={presetButtonClass(form.repeatMode === 'limited')}
            >
              Set count
            </button>
          </div>
          {form.repeatMode === 'limited' ? (
            <input
              type="number"
              min={1}
              step={1}
              value={form.repeatCount}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  repeatCount: event.target.value,
                }))
              }
              className={fieldClass}
            />
          ) : null}
        </div>
      </section>
    </>
  )
}
