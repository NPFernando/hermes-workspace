import { useState } from 'react'
import { ConfirmDialog } from '../../../components/confirm-dialog'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { buttonClass, confirmButtonClass, dangerButtonClass, inputClass } from '../shared-styles'
import { numberField, stringField } from '../field-helpers'
import type { PersonalFinancePayload } from '../types'

/** DOC-109: informational policy register; it does not affect net worth. */
export function InsurancePoliciesPanel({
  payload,
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (payload: PersonalFinancePayload) => void
}) {
  const { run: post, busy, error, setError } = useFinanceAction<PersonalFinancePayload>(onPayload)
  const [provider, setProvider] = useState('')
  const [policyType, setPolicyType] = useState('health')
  const [insuredItem, setInsuredItem] = useState('')
  const [premiumAmount, setPremiumAmount] = useState('')
  const [premiumFrequency, setPremiumFrequency] = useState('annual')
  const [coverageAmount, setCoverageAmount] = useState('')
  const [currency, setCurrency] = useState('LKR')
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10))
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Record<string, string>>({})
  const [attachingId, setAttachingId] = useState<string | null>(null)

  async function addPolicy() {
    if (!provider.trim() || !insuredItem.trim()) {
      setError('Provider and insured item are required')
      return
    }
    const data = await post({
      action: 'add_record',
      kind: 'insurance_policy',
      payload: {
        provider: provider.trim(), policyType, insuredItem: insuredItem.trim(),
        premiumAmount: premiumAmount.trim() ? Number(premiumAmount) : undefined,
        premiumFrequency, coverageAmount: coverageAmount.trim() ? Number(coverageAmount) : undefined,
        currency, startDate,
      },
    }, 'insurance-policy')
    if (data) {
      setProvider(''); setInsuredItem(''); setPremiumAmount(''); setCoverageAmount('')
    }
  }

  function beginEdit(policy: Record<string, unknown>) {
    const id = stringField(policy, 'id')
    setEditId(id)
    setEditDraft({
      provider: stringField(policy, 'provider'), policyType: stringField(policy, 'policyType'),
      insuredItem: stringField(policy, 'insuredItem'), premiumAmount: String(numberField(policy, 'premiumAmount')),
      premiumFrequency: stringField(policy, 'premiumFrequency'), coverageAmount: String(numberField(policy, 'coverageAmount')),
      currency: stringField(policy, 'currency') || 'LKR', startDate: stringField(policy, 'startDate'),
      endDate: stringField(policy, 'endDate'), status: stringField(policy, 'status') || 'active',
    })
  }

  async function saveEdit(id: string) {
    if (!editDraft.provider.trim() || !editDraft.insuredItem.trim()) {
      setError('Provider and insured item are required')
      return
    }
    const data = await post({
      action: 'update_record', kind: 'insurance_policy', id,
      payload: {
        provider: editDraft.provider.trim(), policyType: editDraft.policyType,
        insuredItem: editDraft.insuredItem.trim(), premiumAmount: editDraft.premiumAmount.trim() ? Number(editDraft.premiumAmount) : undefined,
        premiumFrequency: editDraft.premiumFrequency, coverageAmount: editDraft.coverageAmount.trim() ? Number(editDraft.coverageAmount) : undefined,
        currency: editDraft.currency, startDate: editDraft.startDate, endDate: editDraft.endDate || undefined, status: editDraft.status,
      },
    }, `edit-${id}`)
    if (data) setEditId(null)
  }

  async function attachDocument(id: string, file: File | undefined) {
    if (!file) return
    setAttachingId(id)
    setError(null)
    try {
      const form = new FormData()
      form.set('file', file); form.set('documentType', 'insurance_document'); form.set('insurancePolicyId', id)
      const response = await fetch('/api/finance-upload', { method: 'POST', body: form })
      const data = (await response.json()) as { ok?: boolean; error?: string }
      if (!response.ok || !data.ok) setError(data.error || 'Could not attach insurance document')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not attach insurance document')
    } finally { setAttachingId(null) }
  }

  async function deletePolicy(id: string) {
    const data = await post({ action: 'delete_record', kind: 'insurance_policy', id }, `delete-${id}`)
    if (data) setConfirmDeleteId(null)
  }

  const policies = payload.data.insurance_policies
  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold">Insurance policies</h2>
      <p className="text-xs text-[var(--theme-muted)]">Keep policy coverage and renewal details together. Premiums and coverage are informational and do not change net worth.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input className={inputClass} placeholder="Provider" value={provider} onChange={(e) => setProvider(e.target.value)} />
        <select className={inputClass} value={policyType} onChange={(e) => setPolicyType(e.target.value)}><option value="health">Health</option><option value="life">Life</option><option value="vehicle">Vehicle</option><option value="home">Home</option><option value="other">Other</option></select>
        <input className={inputClass} placeholder="Insured item/person" value={insuredItem} onChange={(e) => setInsuredItem(e.target.value)} />
        <input className={inputClass} type="number" min="0" placeholder="Premium" value={premiumAmount} onChange={(e) => setPremiumAmount(e.target.value)} />
        <select className={inputClass} value={premiumFrequency} onChange={(e) => setPremiumFrequency(e.target.value)}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option><option value="one_time">One-time</option></select>
        <input className={inputClass} type="number" min="0" placeholder="Coverage" value={coverageAmount} onChange={(e) => setCoverageAmount(e.target.value)} />
        <select className={inputClass} value={currency} onChange={(e) => setCurrency(e.target.value)}><option>LKR</option><option>USD</option><option>AUD</option></select>
        <input className={inputClass} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} aria-label="Policy start date" />
        <button type="button" className={buttonClass} disabled={busy === 'insurance-policy'} onClick={() => void addPolicy()}>{busy === 'insurance-policy' ? 'Saving…' : 'Add policy'}</button>
      </div>
      {error && <p className="mt-2 text-xs text-[var(--theme-danger)]">{error}</p>}
      <div className="mt-4 grid gap-2">
        {policies.length === 0 && <p className="text-sm text-[var(--theme-muted)]">No insurance policies added yet.</p>}
        {policies.map((policy, index) => {
          const id = stringField(policy, 'id') || String(index)
          const editing = editId === id
          return <div key={id} className="rounded-2xl border border-[var(--theme-border)]/70 p-3">
            {editing ? <div className="flex flex-wrap gap-2">
              {(['provider', 'policyType', 'insuredItem', 'premiumAmount', 'premiumFrequency', 'coverageAmount', 'currency', 'startDate', 'endDate'] as const).map((key) => <input key={key} className={inputClass} type={key.includes('Date') ? 'date' : key.endsWith('Amount') ? 'number' : 'text'} placeholder={key} value={editDraft[key] || ''} onChange={(e) => setEditDraft((prev) => ({ ...prev, [key]: e.target.value }))} />)}
              <select className={inputClass} value={editDraft.status || 'active'} onChange={(e) => setEditDraft((prev) => ({ ...prev, status: e.target.value }))}><option value="active">Active</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option></select>
              <button type="button" className={confirmButtonClass} disabled={busy === `edit-${id}`} onClick={() => void saveEdit(id)}>Save</button><button type="button" className={buttonClass} onClick={() => setEditId(null)}>Cancel</button>
            </div> : <div className="flex flex-wrap items-center justify-between gap-2">
              <div><p className="font-medium">{stringField(policy, 'provider')} · {stringField(policy, 'insuredItem')}</p><p className="text-xs text-[var(--theme-muted)]">{stringField(policy, 'policyType')} · {stringField(policy, 'status')} · {stringField(policy, 'premiumFrequency') || 'premium not set'}{stringField(policy, 'documentRef') ? ' · document linked' : ''}</p></div>
              <div className="flex flex-wrap gap-2"><label className={`${buttonClass} cursor-pointer`}>{attachingId === id ? 'Linking…' : stringField(policy, 'documentRef') ? 'Replace document' : 'Attach document'}<input type="file" accept="application/pdf,image/*" className="sr-only" disabled={attachingId !== null} onChange={(e) => { void attachDocument(id, e.target.files?.[0]); e.currentTarget.value = '' }} /></label><button type="button" className={buttonClass} onClick={() => beginEdit(policy)}>Edit</button><button type="button" className={dangerButtonClass} onClick={() => setConfirmDeleteId(id)}>Delete</button></div>
            </div>}
          </div>
        })}
      </div>
      {confirmDeleteId && <ConfirmDialog title="Delete insurance policy?" body="This removes the policy register entry. Its uploaded file is retained only if another record references it." confirmLabel="Delete" onConfirm={() => void deletePolicy(confirmDeleteId)} onCancel={() => setConfirmDeleteId(null)} />}
    </section>
  )
}
