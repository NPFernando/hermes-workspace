/**
 * Ingestion policies applied to every extracted bill/receipt before it reaches
 * the review queue:
 *
 * 1. Duplicates: an item that repeats a bill already on record, or an item
 *    already waiting for review (the same bill emailed twice, a reminder,
 *    a Gmail copy of an uploaded receipt), is marked `duplicate` and hidden.
 *    Only 'exact'/'likely' record matches count; a one-typo 'possible' match
 *    stays in review with the usual warning.
 * 2. Auto rules: approving an item from a sender can create a rule ("record
 *    this sender's bills automatically"). Later items from that sender are
 *    recorded without review, as `auto_confirmed`, if the extraction agrees
 *    with the rule (same kind and currency, not low confidence, a positive
 *    amount no larger than 3x the biggest amount approved for the rule).
 *    Anything else still goes to review. Every auto-recorded item can be
 *    undone, which deletes the record and returns the item to review.
 *
 * Rules live in settings.gmailIngest.autoRules (same place as knownSenders).
 */
import { randomUUID } from 'node:crypto'
import {
  addFinanceRecord,
  appendAuditLog,
  convertCurrency,
  deleteFinanceRecord,
  ensureFinanceStore,
  findPendingDuplicate,
  findPossibleDuplicate,
  listPendingIngestions,
  updatePendingIngestion,
  writeFinanceStore,
} from './finance-store'
import type { ExtractedTransaction, PendingIngestion } from './finance-store'

export type IngestionAutoRule = {
  id: string
  /** Exact From address (lowercase). */
  senderAddress?: string
  /** Registered known sender, for items that carry no senderAddress. */
  knownSenderId?: string
  label: string
  kind: 'income' | 'expense'
  vendorOrSource: string
  category?: string
  currency?: string
  enabled: boolean
  /** Largest amount approved for this rule — guards against odd extractions. */
  maxAmount: number
  matchCount: number
  lastMatchedAt?: string
  createdAt: string
  updatedAt: string
}

export const AUTO_RULE_MAX_AMOUNT_FACTOR = 3

type Settings = Record<string, unknown>

function gmailIngestOf(settings: Settings): Record<string, unknown> {
  return settings.gmailIngest && typeof settings.gmailIngest === 'object'
    ? { ...(settings.gmailIngest as Record<string, unknown>) }
    : {}
}

function readRules(settings: Settings): Array<IngestionAutoRule> {
  const rules = gmailIngestOf(settings).autoRules
  return Array.isArray(rules) ? (rules as Array<IngestionAutoRule>) : []
}

function writeRules(rules: Array<IngestionAutoRule>): void {
  const db = ensureFinanceStore()
  const settings = db.settings as Settings
  const gmailIngest = gmailIngestOf(settings)
  gmailIngest.autoRules = rules
  settings.gmailIngest = gmailIngest
  writeFinanceStore(db)
}

export function listIngestionAutoRules(): Array<IngestionAutoRule> {
  return readRules(ensureFinanceStore().settings)
}

function ruleMatchesSender(
  rule: IngestionAutoRule,
  item: Pick<PendingIngestion, 'senderAddress' | 'matchedSenderId'>,
): boolean {
  if (rule.senderAddress && item.senderAddress)
    return rule.senderAddress === item.senderAddress.toLowerCase()
  return Boolean(
    !rule.senderAddress &&
      rule.knownSenderId &&
      rule.knownSenderId === item.matchedSenderId,
  )
}

export function findRuleForItem(
  rules: Array<IngestionAutoRule>,
  item: Pick<PendingIngestion, 'senderAddress' | 'matchedSenderId'>,
  kind: 'income' | 'expense',
): IngestionAutoRule | undefined {
  return rules.find((r) => r.kind === kind && ruleMatchesSender(r, item))
}

/** Why a rule would not auto-record this extraction, or null if it would. */
export function ruleRejection(
  rule: IngestionAutoRule,
  extracted: ExtractedTransaction,
): string | null {
  if (!rule.enabled) return 'rule_disabled'
  if (extracted.kind !== rule.kind) return 'kind_mismatch'
  if (extracted.confidence === 'low') return 'low_confidence'
  if (!Number.isFinite(extracted.amount) || extracted.amount <= 0)
    return 'invalid_amount'
  if (
    rule.currency &&
    extracted.currency &&
    rule.currency.toUpperCase() !== extracted.currency.toUpperCase()
  )
    return 'currency_mismatch'
  if (
    rule.maxAmount > 0 &&
    extracted.amount > rule.maxAmount * AUTO_RULE_MAX_AMOUNT_FACTOR
  )
    return 'amount_unusually_high'
  return null
}

/** Exact shape confirm_pending_ingestion has always used, plus the income
 *  amount fields (originalAmount/originalCurrency/convertedLkrAmount), which
 *  the extracted `amount`/`currency` never populated before — confirmed
 *  income items were stored as 0. */
export function recordFromIngestion(
  pending: Pick<PendingIngestion, 'source' | 'sourceRef'>,
  kind: 'income' | 'expense',
  payload: Record<string, unknown>,
): string {
  const id = randomUUID()
  if (kind === 'income') {
    const amount = Number(payload.amount)
    const currency =
      typeof payload.currency === 'string' && payload.currency
        ? payload.currency.toUpperCase()
        : 'LKR'
    const lkr =
      currency === 'LKR' ? amount : convertCurrency(amount, currency, 'LKR')
    addFinanceRecord('income', {
      ...payload,
      id,
      source: pending.source,
      documentRef: pending.sourceRef,
      sourceName: payload.vendorOrSource,
      dateReceived: payload.date,
      originalAmount: amount,
      originalCurrency: currency,
      ...(lkr !== undefined
        ? {
            convertedLkrAmount: lkr,
            exchangeRateUsed: amount ? lkr / amount : 1,
          }
        : {}),
    })
  } else {
    addFinanceRecord('expense', {
      ...payload,
      id,
      source: pending.source,
      documentRef: pending.sourceRef,
      vendor: payload.vendorOrSource,
      date: payload.date,
    })
  }
  return id
}

/** Creates (or refreshes) the rule for this item's sender after a manual approval. */
export function upsertRuleFromApproval(
  pending: PendingIngestion,
  payload: {
    kind: 'income' | 'expense'
    vendorOrSource: string
    amount: number
    currency?: string
    category?: string
  },
): IngestionAutoRule | null {
  const senderAddress = pending.senderAddress?.toLowerCase()
  if (!senderAddress && !pending.matchedSenderId) return null
  const rules = listIngestionAutoRules()
  const now = new Date().toISOString()
  const existing = findRuleForItem(rules, pending, payload.kind)
  const rule: IngestionAutoRule = existing
    ? {
        ...existing,
        enabled: true,
        vendorOrSource: payload.vendorOrSource || existing.vendorOrSource,
        category: payload.category ?? existing.category,
        currency: payload.currency ?? existing.currency,
        maxAmount: Math.max(existing.maxAmount, payload.amount || 0),
        updatedAt: now,
      }
    : {
        id: randomUUID(),
        senderAddress,
        knownSenderId: senderAddress ? undefined : pending.matchedSenderId,
        label:
          pending.matchedSenderLabel ||
          payload.vendorOrSource ||
          senderAddress ||
          'Sender',
        kind: payload.kind,
        vendorOrSource: payload.vendorOrSource,
        category: payload.category,
        currency: payload.currency,
        enabled: true,
        maxAmount: payload.amount || 0,
        matchCount: 0,
        createdAt: now,
        updatedAt: now,
      }
  writeRules(
    existing
      ? rules.map((r) => (r.id === rule.id ? rule : r))
      : [...rules, rule],
  )
  appendAuditLog('ingestion_rule_upserted', {
    id: rule.id,
    kind: rule.kind,
    label: rule.label,
  })
  return rule
}

export function setIngestionRuleEnabled(
  id: string,
  enabled: boolean,
): IngestionAutoRule {
  const rules = listIngestionAutoRules()
  const rule = rules.find((r) => r.id === id)
  if (!rule) throw new Error(`Ingestion rule not found: ${id}`)
  const updated = { ...rule, enabled, updatedAt: new Date().toISOString() }
  writeRules(rules.map((r) => (r.id === id ? updated : r)))
  appendAuditLog('ingestion_rule_toggled', { id, enabled })
  return updated
}

export function deleteIngestionRule(id: string): void {
  writeRules(listIngestionAutoRules().filter((r) => r.id !== id))
  appendAuditLog('ingestion_rule_deleted', { id })
}

export type PolicyOutcome = 'review' | 'duplicate' | 'auto_confirmed'

/**
 * Applies duplicate detection and auto rules to one queued item. Only items
 * awaiting review with a transaction extraction are touched; contracts,
 * password-locked and failed extractions stay as they are.
 */
export function applyIngestionPolicies(id: string): PolicyOutcome {
  const all = listPendingIngestions()
  const item = all.find((p) => p.id === id)
  const e = item?.extracted
  if (
    !item ||
    !e ||
    item.status !== 'awaiting_review' ||
    item.documentType === 'contract'
  )
    return 'review'

  const recordDup = findPossibleDuplicate(
    e.kind,
    e.vendorOrSource,
    e.date,
    e.amount,
  )
  // The user said "not a duplicate" once — never hide it again.
  const checkDuplicates = !item.duplicateDismissed
  if (checkDuplicates && recordDup && recordDup.confidence !== 'possible') {
    updatePendingIngestion(id, {
      status: 'duplicate',
      duplicateOfRecordId: recordDup.id,
    })
    return 'duplicate'
  }
  const pendingDup = checkDuplicates ? findPendingDuplicate(item, all) : null
  if (pendingDup) {
    updatePendingIngestion(id, {
      status: 'duplicate',
      duplicateOfPendingId: pendingDup.id,
    })
    return 'duplicate'
  }

  const rules = listIngestionAutoRules()
  const rule = findRuleForItem(rules, item, e.kind)
  if (!rule || ruleRejection(rule, e)) return 'review'
  if (recordDup) return 'review' // one-typo look-alike: let a human decide

  const recordId = recordFromIngestion(item, rule.kind, {
    kind: rule.kind,
    amount: e.amount,
    currency: e.currency,
    vendorOrSource: rule.vendorOrSource || e.vendorOrSource,
    date: e.date,
    category: rule.category ?? e.category,
    confidence: e.confidence,
  })
  updatePendingIngestion(id, {
    status: 'auto_confirmed',
    autoRuleId: rule.id,
    confirmedRecordId: recordId,
  })
  const now = new Date().toISOString()
  writeRules(
    listIngestionAutoRules().map((r) =>
      r.id === rule.id
        ? { ...r, matchCount: r.matchCount + 1, lastMatchedAt: now }
        : r,
    ),
  )
  appendAuditLog('ingestion_auto_confirmed', { id, ruleId: rule.id, recordId })
  return 'auto_confirmed'
}

export type PolicySweepResult = { duplicates: number; autoConfirmed: number }

/** Re-applies policies to everything still awaiting review, oldest first, so
 *  the earliest copy of a bill is the one kept. */
export function sweepPendingIngestions(): PolicySweepResult {
  const ids = listPendingIngestions()
    .filter((p) => p.status === 'awaiting_review' && p.extracted)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((p) => p.id)
  const result: PolicySweepResult = { duplicates: 0, autoConfirmed: 0 }
  for (const id of ids) {
    const outcome = applyIngestionPolicies(id)
    if (outcome === 'duplicate') result.duplicates += 1
    if (outcome === 'auto_confirmed') result.autoConfirmed += 1
  }
  return result
}

/** Undo an automatic recording: delete the record, return the item to
 *  review, and pause the rule so it does not immediately re-record it. */
export function undoAutoIngestion(id: string): PendingIngestion {
  const item = listPendingIngestions().find((p) => p.id === id)
  if (!item || item.status !== 'auto_confirmed')
    throw new Error('Only automatically recorded items can be undone.')
  const kind = item.extracted?.kind
  if (item.confirmedRecordId && kind) {
    try {
      deleteFinanceRecord(kind, item.confirmedRecordId)
    } catch {
      /* record already deleted by hand */
    }
  }
  if (item.autoRuleId) {
    try {
      setIngestionRuleEnabled(item.autoRuleId, false)
    } catch {
      /* rule already deleted */
    }
  }
  appendAuditLog('ingestion_auto_undone', { id, ruleId: item.autoRuleId })
  return updatePendingIngestion(id, {
    status: 'awaiting_review',
    autoRuleId: undefined,
    confirmedRecordId: undefined,
  })
}
