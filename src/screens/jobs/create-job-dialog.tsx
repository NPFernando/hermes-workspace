'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { JobFormFields } from './job-form-fields'
import type { JobFormState } from './job-form-fields'
import type { JobProfileOption } from '@/lib/jobs-api'

type CreateJobDialogProps = {
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

function getInitialState(profile = 'default'): JobFormState {
  return {
    profile,
    name: '',
    schedule: 'every 30m',
    prompt: '',
    skillsInput: '',
    deliver: ['local'],
    repeatMode: 'unlimited',
    repeatCount: '1',
  }
}

export function CreateJobDialog({
  open,
  isSubmitting = false,
  profiles,
  onOpenChange,
  onSubmit,
}: CreateJobDialogProps) {
  const activeProfile =
    profiles.find((profile) => profile.active)?.name ?? profiles[0].name
  const [form, setForm] = useState(() => getInitialState(activeProfile))

  useEffect(() => {
    if (!open) {
      setForm(getInitialState(activeProfile))
      return
    }

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
  }, [open, onOpenChange, activeProfile])

  useEffect(() => {
    if (open) {
      setForm((current) => {
        if (profiles.some((profile) => profile.name === current.profile))
          return current
        return { ...current, profile: activeProfile }
      })
    }
  }, [activeProfile, open, profiles])

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
      {open ? (
        <motion.div
          key="create-job-dialog"
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
                <h2 className="text-lg font-semibold">Create Job</h2>
                <p className="mt-1 text-sm text-[var(--theme-muted)]">
                  Build a scheduled Hermes task with preset timing options.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-lg p-2 transition-colors text-[var(--theme-muted)]"
                aria-label="Close create job dialog"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={18} />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
              <JobFormFields form={form} setForm={setForm} profiles={profiles} />
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
                {isSubmitting ? 'Creating...' : 'Create'}
              </button>
            </div>
          </motion.form>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
