import * as fs from 'node:fs'
import * as path from 'node:path'
import { FINANCE_DATA_DIR } from './finance-store'
import type { FinanceDatabase } from './finance-store'

export type FinanceDocumentSummary = {
  id: string
  name: string
  kind: 'finance_account' | 'income_source' | 'income_record' | 'expense_record' | 'stock_holding' | 'fixed_deposit' | 'tax_record' | 'insurance_policy' | 'pending_ingestion'
  status: string
  source: string
  label: string
  createdAt: string
  updatedAt: string
  bytes: number | null
  recordId?: string
  pendingId?: string
}

function fileMetadata(documentRef: unknown): { name: string; bytes: number | null } {
  if (typeof documentRef !== 'string' || !documentRef.trim()) {
    return { name: 'Unnamed document', bytes: null }
  }
  const resolved = path.resolve(documentRef)
  const financeRoot = path.resolve(FINANCE_DATA_DIR)
  if (!resolved.startsWith(financeRoot + path.sep)) {
    return { name: path.basename(documentRef) || 'Unnamed document', bytes: null }
  }
  try {
    const stat = fs.statSync(resolved)
    return {
      name: path.basename(resolved) || 'Unnamed document',
      bytes: stat.isFile() ? stat.size : null,
    }
  } catch {
    return { name: path.basename(resolved) || 'Missing document', bytes: null }
  }
}

/** DOC-100: safe metadata inventory; never returns document paths or contents. */
export function listFinanceDocuments(db: FinanceDatabase): Array<FinanceDocumentSummary> {
  const documents: Array<FinanceDocumentSummary> = []
  for (const account of db.finance_accounts) {
    if (!account.documentRef) continue
    const file = fileMetadata(account.documentRef)
    documents.push({
      id: `finance_account:${account.id}`,
      name: file.name,
      kind: 'finance_account',
      status: 'linked',
      source: account.source,
      label: account.name || 'Bank account',
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      bytes: file.bytes,
      recordId: account.id,
    })
  }
  for (const source of db.income_sources) {
    if (!source.documentRef) continue
    const file = fileMetadata(source.documentRef)
    documents.push({
      id: `income_source:${source.id}`,
      name: file.name,
      kind: 'income_source',
      status: source.status,
      source: source.source,
      label: source.employerName || source.jobTitle || 'Income source',
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
      bytes: file.bytes,
      recordId: source.id,
    })
  }
  for (const record of db.income_records) {
    if (!record.documentRef) continue
    const file = fileMetadata(record.documentRef)
    documents.push({
      id: `income_record:${record.id}`,
      name: file.name,
      kind: 'income_record',
      status: 'confirmed',
      source: record.source,
      label: record.sourceName || 'Income record',
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      bytes: file.bytes,
      recordId: record.id,
    })
  }
  for (const record of db.expense_records) {
    if (!record.documentRef) continue
    const file = fileMetadata(record.documentRef)
    documents.push({
      id: `expense_record:${record.id}`,
      name: file.name,
      kind: 'expense_record',
      status: 'confirmed',
      source: record.source,
      label: record.vendor || 'Expense record',
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      bytes: file.bytes,
      recordId: record.id,
    })
  }
  for (const record of db.fixed_deposits) {
    if (!record.documentRef) continue
    const file = fileMetadata(record.documentRef)
    documents.push({
      id: `fixed_deposit:${record.id}`,
      name: file.name,
      kind: 'fixed_deposit',
      status: record.status,
      source: record.source,
      label: record.bankName || 'Fixed deposit',
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      bytes: file.bytes,
      recordId: record.id,
    })
  }
  for (const holding of db.stock_holdings) {
    if (!holding.documentRef) continue
    const file = fileMetadata(holding.documentRef)
    documents.push({
      id: `stock_holding:${holding.id}`,
      name: file.name,
      kind: 'stock_holding',
      status: 'linked',
      source: holding.source,
      label: holding.symbol || holding.companyName || 'Investment holding',
      createdAt: holding.createdAt,
      updatedAt: holding.updatedAt,
      bytes: file.bytes,
      recordId: holding.id,
    })
  }
  for (const record of db.tax_records) {
    if (!record.documentRef) continue
    const file = fileMetadata(record.documentRef)
    documents.push({
      id: `tax_record:${record.id}`,
      name: file.name,
      kind: 'tax_record',
      status: record.requiresConfirmation ? 'awaiting_review' : 'reviewed',
      source: record.source,
      label: `${record.taxYear} ${record.incomeType}`.trim() || 'Tax record',
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      bytes: file.bytes,
      recordId: record.id,
    })
  }
  for (const policy of db.insurance_policies) {
    if (!policy.documentRef) continue
    const file = fileMetadata(policy.documentRef)
    documents.push({
      id: `insurance_policy:${policy.id}`,
      name: file.name,
      kind: 'insurance_policy',
      status: policy.status,
      source: policy.source,
      label: `${policy.provider} · ${policy.insuredItem}`,
      createdAt: policy.createdAt,
      updatedAt: policy.updatedAt,
      bytes: file.bytes,
      recordId: policy.id,
    })
  }
  for (const pending of db.pending_ingestions) {
    const file = fileMetadata(pending.sourceRef)
    documents.push({
      id: `pending_ingestion:${pending.id}`,
      name: file.name,
      kind: 'pending_ingestion',
      status: pending.status,
      source: pending.source,
      label: pending.documentType,
      createdAt: pending.createdAt,
      updatedAt: pending.updatedAt,
      bytes: file.bytes,
      pendingId: pending.id,
    })
  }
  return documents.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name))
}
