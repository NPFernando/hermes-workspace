import { useState } from 'react'
import { ConfirmDialog } from '../../../components/confirm-dialog'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { formatLkr } from '../utils'
import {
  buttonClass,
  confirmButtonClass,
  dangerButtonClass,
  inputClass,
} from '../shared-styles'
import { numberField, stringField } from '../field-helpers'
import { savingsGoalTimeline } from './savings-goal-timeline'
import type { PersonalFinancePayload } from '../types'

const STATUSES = ['active', 'paused', 'achieved', 'abandoned']
const KINDS = ['general', 'sinking']

type Draft = {
  name: string
  targetAmount: string
  currentAmount: string
  currency: string
  targetDate: string
  monthlyContribution: string
  priority: string
  status: string
  goalKind: string
}

/**
 * Full editor for savings goals / sinking funds — replaces the generic
 * DataTable (review U4). `SavingsGoalsProgress` (Overview) stays the visual
 * progress view; `SinkingFundsPanel` stays the schedule tracker. This is
 * where every field is created / edited / deleted.
 */
export function SavingsGoalsPanel({
  payload,
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (p: PersonalFinancePayload) => void
}) {
  const {
    run: post,
    busy,
    error: err,
    setError: setErr,
  } = useFinanceAction<PersonalFinancePayload>(onPayload)

  const [name, setName] = useState('')
  const [targetAmount, setTargetAmount] = useState('')
  const [currency, setCurrency] = useState(payload.baseCurrency)
  const [goalKind, setGoalKind] = useState('general')

  const [editOpenId, setEditOpenId] = useState<string | null>(null)
  const [editDrafts, setEditDrafts] = useState<Record<string, Draft>>({})
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const goals = [...payload.data.savings_goals].sort(
    (a, b) => numberField(a, 'priority') - numberField(b, 'priority'),
  )

  async function add() {
    if (!name.trim()) {
      setErr('Name is required')
      return
    }
    const data = await post(
      {
        action: 'add_record',
        kind: 'goal',
        payload: {
          name: name.trim(),
          targetAmount: Number(targetAmount) || 0,
          currency,
          goalKind,
        },
      },
      'add',
    )
    if (data) {
      setName('')
      setTargetAmount('')
    }
  }

  function startEdit(g: Record<string, unknown>) {
    const id = stringField(g, 'id')
    setEditDrafts((prev) => ({
      ...prev,
      [id]: {
        name: stringField(g, 'name'),
        targetAmount: String(numberField(g, 'targetAmount')),
        currentAmount: String(numberField(g, 'currentAmount')),
        currency: stringField(g, 'currency') || 'LKR',
        targetDate: stringField(g, 'targetDate'),
        monthlyContribution: String(numberField(g, 'monthlyContribution')),
        priority: String(numberField(g, 'priority')),
        status: stringField(g, 'status') || 'active',
        goalKind: stringField(g, 'goalKind') || 'general',
      },
    }))
    setEditOpenId(id)
  }

  async function saveEdit(id: string) {
    const d = editDrafts[id]
    if (!d.name.trim()) {
      setErr('Name is required')
      return
    }
    const data = await post(
      {
        action: 'update_record',
        kind: 'goal',
        id,
        payload: {
          name: d.name.trim(),
          targetAmount: Number(d.targetAmount) || 0,
          currentAmount: Number(d.currentAmount) || 0,
          currency: d.currency,
          targetDate: d.targetDate || undefined,
          monthlyContribution: Number(d.monthlyContribution) || 0,
          priority: Number(d.priority) || 0,
          status: d.status,
          goalKind: d.goalKind,
        },
      },
      `edit-${id}`,
    )
    if (data) setEditOpenId(null)
  }

  async function del(id: string) {
    const data = await post(
      { action: 'delete_record', kind: 'goal', id },
      `delete-${id}`,
    )
    if (data) setConfirmDeleteId(null)
  }

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold">
        Savings goals &amp; sinking funds
      </h2>
      <p className="text-xs text-[var(--theme-muted)]">
        Every field for a goal — the Overview shows progress; this is the
        editor.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Goal name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
        <input
          type="number"
          placeholder="Target amount"
          value={targetAmount}
          onChange={(e) => setTargetAmount(e.target.value)}
          className={`${inputClass} w-36`}
        />
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className={inputClass}
        >
          {[...new Set([payload.baseCurrency, 'LKR', 'USD', 'AUD'])].map(
            (c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ),
          )}
        </select>
        <select
          value={goalKind}
          onChange={(e) => setGoalKind(e.target.value)}
          className={inputClass}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy === 'add'}
          onClick={() => void add()}
          className={buttonClass}
        >
          {busy === 'add' ? 'Saving…' : 'Add goal'}
        </button>
      </div>

      {err && <p className="mt-2 text-xs text-[var(--theme-danger)]">{err}</p>}

      <div className="mt-4 grid gap-2">
        {goals.length === 0 && (
          <p className="text-sm text-[var(--theme-muted)]">No goals yet.</p>
        )}
        {goals.map((g, index) => {
          const id = stringField(g, 'id') || String(index)
          const isEditing = editOpenId === id
          const cur = stringField(g, 'currency') || 'LKR'
          const timeline = savingsGoalTimeline({
            currentAmount: numberField(g, 'currentAmount'),
            targetAmount: numberField(g, 'targetAmount'),
            monthlyContribution: numberField(g, 'monthlyContribution'),
            targetDate: stringField(g, 'targetDate'),
            status: stringField(g, 'status'),
          })
          return (
            <div
              key={id}
              className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3"
            >
              {isEditing ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={editDrafts[id].name}
                    onChange={(e) =>
                      setEditDrafts((p) => ({
                        ...p,
                        [id]: { ...p[id], name: e.target.value },
                      }))
                    }
                    className={inputClass}
                  />
                  <input
                    type="number"
                    placeholder="Target"
                    value={editDrafts[id].targetAmount}
                    onChange={(e) =>
                      setEditDrafts((p) => ({
                        ...p,
                        [id]: { ...p[id], targetAmount: e.target.value },
                      }))
                    }
                    className={`${inputClass} w-28`}
                  />
                  <input
                    type="number"
                    placeholder="Current"
                    value={editDrafts[id].currentAmount}
                    onChange={(e) =>
                      setEditDrafts((p) => ({
                        ...p,
                        [id]: { ...p[id], currentAmount: e.target.value },
                      }))
                    }
                    className={`${inputClass} w-28`}
                  />
                  <select
                    value={editDrafts[id].currency}
                    onChange={(e) =>
                      setEditDrafts((p) => ({
                        ...p,
                        [id]: { ...p[id], currency: e.target.value },
                      }))
                    }
                    className={inputClass}
                  >
                    {['LKR', 'USD', 'AUD'].map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={editDrafts[id].targetDate}
                    onChange={(e) =>
                      setEditDrafts((p) => ({
                        ...p,
                        [id]: { ...p[id], targetDate: e.target.value },
                      }))
                    }
                    className={inputClass}
                  />
                  <input
                    type="number"
                    placeholder="Monthly"
                    value={editDrafts[id].monthlyContribution}
                    onChange={(e) =>
                      setEditDrafts((p) => ({
                        ...p,
                        [id]: {
                          ...p[id],
                          monthlyContribution: e.target.value,
                        },
                      }))
                    }
                    className={`${inputClass} w-24`}
                  />
                  <input
                    type="number"
                    placeholder="Priority"
                    value={editDrafts[id].priority}
                    onChange={(e) =>
                      setEditDrafts((p) => ({
                        ...p,
                        [id]: { ...p[id], priority: e.target.value },
                      }))
                    }
                    className={`${inputClass} w-20`}
                  />
                  <select
                    value={editDrafts[id].status}
                    onChange={(e) =>
                      setEditDrafts((p) => ({
                        ...p,
                        [id]: { ...p[id], status: e.target.value },
                      }))
                    }
                    className={inputClass}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <select
                    value={editDrafts[id].goalKind}
                    onChange={(e) =>
                      setEditDrafts((p) => ({
                        ...p,
                        [id]: { ...p[id], goalKind: e.target.value },
                      }))
                    }
                    className={inputClass}
                  >
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={busy === `edit-${id}`}
                    onClick={() => void saveEdit(id)}
                    className={confirmButtonClass}
                  >
                    {busy === `edit-${id}` ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditOpenId(null)}
                    className={buttonClass}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-[var(--theme-text)]">
                    <span className="font-medium">
                      {stringField(g, 'name')}
                    </span>{' '}
                    <span className="text-xs text-[var(--theme-muted)]">
                      · {stringField(g, 'goalKind') || 'general'} ·{' '}
                      {formatLkr(numberField(g, 'currentAmount'), cur)} /{' '}
                      {formatLkr(numberField(g, 'targetAmount'), cur)} ·{' '}
                      {stringField(g, 'status') || 'active'}
                      {stringField(g, 'targetDate') &&
                        ` · by ${stringField(g, 'targetDate')}`}
                    </span>
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => startEdit(g)}
                      className={buttonClass}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busy === `delete-${id}`}
                      onClick={() => setConfirmDeleteId(id)}
                      className={dangerButtonClass}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
              {!isEditing && timeline.state !== 'paused' && (
                <p className="mt-2 text-xs text-[var(--theme-muted)]">
                  {timeline.state === 'achieved'
                    ? 'Goal reached.'
                    : timeline.state === 'no_target'
                      ? 'Set a target amount to estimate when you’ll reach this goal.'
                      : timeline.state === 'no_contribution'
                        ? 'Add a monthly contribution to estimate when you’ll reach this goal.'
                        : `At ${formatLkr(numberField(g, 'monthlyContribution'), cur)}/month: about ${timeline.monthsRemaining} month${timeline.monthsRemaining === 1 ? '' : 's'} — ${timeline.projectedDate}. No interest or investment growth assumed.`}
                  {timeline.state === 'projected' &&
                    timeline.requiredMonthlyContribution !== null &&
                    timeline.targetDateMonths !== null &&
                    timeline.requiredMonthlyContribution >
                      numberField(g, 'monthlyContribution') &&
                    ` To reach the target date, about ${formatLkr(timeline.requiredMonthlyContribution, cur)}/month is needed.`}
                </p>
              )}
            </div>
          )
        })}
      </div>

      {confirmDeleteId && (
        <ConfirmDialog
          title="Delete this goal?"
          body="This can't be undone."
          confirmLabel="Delete"
          busy={busy === `delete-${confirmDeleteId}`}
          onConfirm={() => void del(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </section>
  )
}
