'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { JobFormFields } from './job-form-fields'
import type { JobFormState } from './job-form-fields'
import type { ClaudeJob, JobProfileOption } from '@/lib/jobs-api'

type EditJobDialogProps = {
  job: ClaudeJob | null
  open: boolean
  isSubmitting?: boolean
  profiles: Array<JobProfileOption>
  onOpenChange: (open: boolean) => void
  onSubmit: (input: {
    profile: string
    name: string
    schedule: string
    prompt: string
    deliver?: Array<string>
    skills?: Array<string>
    repeat?: number
  }) => void | Promise<void>
}

function readScheduleValue(job: ClaudeJob): string {
  if (typeof job.schedule_display === 'string' && job.schedule_display.trim()) {
    return job.schedule_display.trim()
  }
  const schedule = job.schedule
  if (typeof schedule === 'object') {
    const record = schedule
    const candidates = [
      record.expression,
      record.cron,
      record.raw,
      record.value,
      record.schedule,
    ]
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim()
      }
    }
  }
  return ''
}

function getInitialState(job: ClaudeJob | null): JobFormState {
  const repeatTimes = job?.repeat?.times
  const repeatCompleted = job?.repeat?.completed ?? 0
  const remainingRepeats =
    typeof repeatTimes === 'number'
      ? Math.max(1, repeatTimes - repeatCompleted)
      : null

  return {
    profile: job?.profile ?? 'default',
    name: job?.name ?? '',
    schedule: job ? readScheduleValue(job) : 'every 30m',
    prompt: job?.prompt ?? '',
    skillsInput: Array.isArray(job?.skills) ? job.skills.join(', ') : '',
    deliver:
      Array.isArray(job?.deliver) && job.deliver.length > 0
        ? [...job.deliver]
        : ['local'],
    repeatMode: remainingRepeats === null ? 'unlimited' : 'limited',
    repeatCount: remainingRepeats === null ? '1' : String(remainingRepeats),
  }
}

export function EditJobDialog({
  job,
  open,
  isSubmitting = false,
  profiles,
  onOpenChange,
  onSubmit,
}: EditJobDialogProps) {
  const [form, setForm] = useState(() => getInitialState(job))

  useEffect(() => {
    if (!open) {
      setForm(getInitialState(job))
      return
    }

    setForm(getInitialState(job))

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onOpenChange(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [job, open, onOpenChange])

  function handleFormSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const skills = form.skillsInput
      .split(',')
      .map((skill) => skill.trim())
      .filter(Boolean)

    void onSubmit({
      profile: form.profile,
      name: form.name.trim(),
      schedule: form.schedule.trim(),
      prompt: form.prompt.trim(),
      deliver: form.deliver.length > 0 ? form.deliver : undefined,
      skills: skills.length > 0 ? Array.from(new Set(skills)) : undefined,
      repeat:
        form.repeatMode === 'limited'
          ? Math.max(1, Number.parseInt(form.repeatCount, 10) || 1)
          : undefined,
    })
  }

  return (
    <AnimatePresence>
      {open && job ? (
        <motion.div
          key="edit-job-dialog"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              onOpenChange(false)
            }
          }}
        >
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.5)' }}
            onClick={() => onOpenChange(false)}
          />
          <motion.form
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 10 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            onSubmit={handleFormSubmit}
            className="relative z-10 flex max-h-[85vh] w-[min(720px,96vw)] flex-col overflow-hidden rounded-2xl border shadow-2xl bg-[var(--theme-card)] border-[var(--theme-border)] text-[var(--theme-text)]"
          >
            <div className="flex items-start justify-between gap-4 border-b px-5 py-4 border-[var(--theme-border)]">
              <div>
                <h2 className="text-lg font-semibold">Edit Job</h2>
                <p className="mt-1 text-sm text-[var(--theme-muted)]">
                  Update the schedule, prompt, and routing for this Hermes task.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-lg p-2 transition-colors text-[var(--theme-muted)]"
                aria-label="Close edit job dialog"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={18} />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
              <JobFormFields
                form={form}
                setForm={setForm}
                profiles={profiles}
                job={job}
              />
            </div>

            <div className="flex items-center justify-end gap-2 border-t px-5 py-4 border-[var(--theme-border)]">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-xl px-4 py-2 text-sm transition-colors bg-[var(--theme-card)] text-[var(--theme-muted)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  isSubmitting ||
                  !form.name.trim() ||
                  !form.schedule.trim() ||
                  !form.prompt.trim()
                }
                className="rounded-xl px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50 bg-[var(--theme-accent)]"
              >
                {isSubmitting ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </motion.form>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
