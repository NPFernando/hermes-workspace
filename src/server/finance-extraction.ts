/**
 * AI extraction of a transaction (income/expense) from either plain email
 * body text or a document image (receipt, bill, statement page). Feeds
 * pending_ingestions (finance-store.ts) — never writes a real finance
 * record itself, that only happens once the user confirms in the UI.
 *
 * Text extraction reuses the existing HARP-routed OpenRouter call path from
 * llm-signal-engine.ts (selectHarpRoutes/callWithFallback/readOpenRouterKey)
 * rather than duplicating it. Image extraction needs a VISION-capable
 * model, which HARP's free-tier chain isn't guaranteed to include (it's
 * tuned for text tasks) — so this keeps its own short, explicit vision
 * route list instead of trusting selectHarpRoutes() for this task type,
 * with Gemini (already configured via GOOGLE_API_KEY for tier-4 routing)
 * as the final fallback since OpenRouter's free vision models are the same
 * ones that get rate-limited elsewhere in this app.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openaiChat } from './openai-compat-api'
import {
  ensureDiscovery,
  getDiscoveredModels,
  getLocalProviderDef,
} from './local-provider-discovery'
import {
  callWithFallback,
  readOpenRouterKey,
  selectHarpRoutes,
} from './llm-signal-engine'
import type {
  ContractRisk,
  ExtractedContract,
  ExtractedContractNote,
  ExtractedFdCertificate,
  ExtractedSalarySlip,
  ExtractedTransaction,
} from './finance-store'

/**
 * Privacy control for finance AI. When enabled, no finance prompt or document
 * image is sent to OpenRouter/Gemini; extraction uses a discovered local
 * OpenAI-compatible provider only and fails closed if none is available.
 */
export function isFinanceAiLocalOnlyEnabled(): boolean {
  const value = (process.env.FINANCE_AI_LOCAL_ONLY || '').trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

type LocalFinanceImage = { base64: string; mimeType: string }

async function callLocalFinanceText(prompt: string): Promise<string | null> {
  await ensureDiscovery()
  const discoveredModels = getDiscoveredModels()
  if (discoveredModels.length === 0) return null
  const discovered = discoveredModels[0]
  const provider = getLocalProviderDef(discovered.provider)
  if (!provider) return null
  try {
    return await openaiChat([{ role: 'user', content: prompt }], {
      baseUrl: provider.baseUrl,
      model: discovered.id,
      temperature: 0.2,
      max_tokens: 4_000,
      signal: AbortSignal.timeout(60_000),
      omitAuth: true,
    })
  } catch {
    return null
  }
}

async function callLocalFinanceVision(
  prompt: string,
  images: Array<LocalFinanceImage>,
): Promise<string | null> {
  await ensureDiscovery()
  const discoveredModels = getDiscoveredModels()
  if (discoveredModels.length === 0) return null
  const discovered = discoveredModels[0]
  const provider = getLocalProviderDef(discovered.provider)
  if (!provider) return null
  try {
    return await openaiChat(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            ...images.map((image) => ({
              type: 'image_url' as const,
              image_url: {
                url: `data:${image.mimeType};base64,${image.base64}`,
              },
            })),
          ],
        },
      ],
      {
        baseUrl: provider.baseUrl,
        model: discovered.id,
        temperature: 0.2,
        max_tokens: 4_000,
        signal: AbortSignal.timeout(90_000),
        omitAuth: true,
      },
    )
  } catch {
    return null
  }
}

export type ExtractionResult =
  | { ok: true; data: ExtractedTransaction }
  | { ok: false; reason: string }

export type ContractExtractionResult =
  | { ok: true; data: ExtractedContract }
  | { ok: false; reason: string }

export type SalarySlipExtractionResult =
  | { ok: true; data: ExtractedSalarySlip }
  | { ok: false; reason: string }

export type ContractNoteExtractionResult =
  | { ok: true; data: ExtractedContractNote }
  | { ok: false; reason: string }

export type FdCertificateExtractionResult =
  | { ok: true; data: ExtractedFdCertificate }
  | { ok: false; reason: string }

const EXTRACTION_PROMPT_INSTRUCTIONS = `You extract a single financial transaction from the given content (a bill, receipt, invoice, bank/payment notification, or salary/income notice).

Respond with STRICT JSON only, no markdown fences, no commentary, matching exactly this shape:
{
  "kind": "income" | "expense",
  "amount": <number, the transaction amount, no currency symbol>,
  "currency": "<3-letter currency code, e.g. LKR, USD, AUD>",
  "vendorOrSource": "<merchant/payer name>",
  "date": "<YYYY-MM-DD, the transaction date if present, otherwise today's date>",
  "category": "<short category guess, e.g. Groceries, Utilities, Salary, Freelance, Dining>",
  "confidence": "high" | "medium" | "low"
}

If the content does not clearly describe a single financial transaction, respond with exactly: {"error": "no_transaction_found"}`

const STATEMENT_EXTRACTION_PROMPT_INSTRUCTIONS = `You extract every clearly identifiable posted financial transaction from the provided bank or card statement pages.

Respond with STRICT JSON only, no markdown fences, no commentary, matching exactly this shape:
{
  "transactions": [
    {
      "kind": "income" | "expense",
      "amount": <positive number, no currency symbol>,
      "currency": "<3-letter currency code, e.g. LKR, USD, AUD>",
      "vendorOrSource": "<merchant, payer, or transaction description>",
      "date": "<YYYY-MM-DD>",
      "category": "<short category guess or null>",
      "confidence": "high" | "medium" | "low"
    }
  ]
}

Include only posted transactions, not opening/closing balances, available credit, fees already represented as a separate row, headers, totals, or duplicate continuation rows. Infer income versus expense from the signed amount or statement context. If no transaction can be identified, return {"transactions": []}.`

export function parseStatementExtractionJson(
  raw: string,
): Array<{ ok: true; data: ExtractedTransaction }> {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  try {
    const obj: unknown = JSON.parse(stripped)
    if (!obj || typeof obj !== 'object') return []
    const rawTransactions = (obj as Record<string, unknown>).transactions
    if (!Array.isArray(rawTransactions)) return []
    return rawTransactions
      .map((transaction) => {
        if (!transaction || typeof transaction !== 'object') return null
        const row = transaction as Record<string, unknown>
        return parseExtractionJson(JSON.stringify(row))
      })
      .filter(
        (result): result is { ok: true; data: ExtractedTransaction } =>
          result !== null && result.ok,
      )
  } catch {
    return []
  }
}

/**
 * Appends known vendor -> category corrections (learned from the user
 * overriding the AI's category guess at confirm time — see
 * recordCategoryCorrection in finance-store.ts) so repeat vendors start
 * from what the user actually picked instead of the model guessing again.
 * Kept short (10 max) since this goes straight into the prompt.
 */
export function promptWithCategoryHints(
  base: string,
  categoryHints?: Record<string, string>,
): string {
  const entries = categoryHints
    ? Object.entries(categoryHints).slice(0, 10)
    : []
  if (entries.length === 0) return base
  const hintLines = entries
    .map(([vendor, category]) => `- "${vendor}" -> "${category}"`)
    .join('\n')
  return `${base}\n\nKnown vendor -> category corrections from this user's past edits (use these when the vendor matches):\n${hintLines}`
}

export function parseExtractionJson(raw: string): ExtractionResult {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  try {
    const obj: unknown = JSON.parse(stripped)
    if (typeof obj !== 'object' || obj === null)
      return { ok: false, reason: 'malformed_response' }
    const o = obj as Record<string, unknown>
    if (o.error) return { ok: false, reason: String(o.error) }

    const kind = o.kind
    if (kind !== 'income' && kind !== 'expense')
      return { ok: false, reason: 'malformed_response' }
    const amount = typeof o.amount === 'number' ? o.amount : Number(o.amount)
    if (!Number.isFinite(amount))
      return { ok: false, reason: 'malformed_response' }
    const currency =
      typeof o.currency === 'string' && o.currency.trim()
        ? o.currency.trim()
        : 'LKR'
    const vendorOrSource =
      typeof o.vendorOrSource === 'string' && o.vendorOrSource.trim()
        ? o.vendorOrSource.trim()
        : 'Unknown'
    const date =
      typeof o.date === 'string' && o.date.trim()
        ? o.date.trim()
        : new Date().toISOString().slice(0, 10)
    const category =
      typeof o.category === 'string' && o.category.trim()
        ? o.category.trim()
        : undefined
    const confidence =
      o.confidence === 'high' ||
      o.confidence === 'medium' ||
      o.confidence === 'low'
        ? o.confidence
        : 'low'

    return {
      ok: true,
      data: {
        kind,
        amount,
        currency,
        vendorOrSource,
        date,
        category,
        confidence,
      },
    }
  } catch {
    return { ok: false, reason: 'malformed_response' }
  }
}

const SALARY_SLIP_EXTRACTION_PROMPT = `You extract payroll details from a salary slip or payslip. Respond with STRICT JSON only, no markdown fences, no commentary, matching exactly this shape:
{
  "employerName": "<employer name>",
  "employeeName": "<employee name or null>",
  "payPeriod": "<month or period shown, or null>",
  "paymentDate": "<YYYY-MM-DD or null>",
  "grossAmount": <number or null>,
  "deductions": <number or null, total deductions when shown>,
  "netAmount": <number, take-home/net pay>,
  "currency": "<3-letter currency code, e.g. LKR, USD, AUD>",
  "confidence": "high" | "medium" | "low"
}

Use the payment date only when it is explicitly shown; use null when a field is absent. Do not treat tax IDs, employee IDs, bank account numbers, or balances as pay amounts. If the content is not a salary slip, respond with exactly: {"error":"not_a_salary_slip"}`

export function parseSalarySlipExtractionJson(
  raw: string,
): SalarySlipExtractionResult {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  try {
    const obj: unknown = JSON.parse(stripped)
    if (!obj || typeof obj !== 'object')
      return { ok: false, reason: 'malformed_response' }
    const o = obj as Record<string, unknown>
    if (o.error) return { ok: false, reason: String(o.error) }
    const employerName =
      typeof o.employerName === 'string' && o.employerName.trim()
        ? o.employerName.trim()
        : 'Unknown employer'
    const netAmount =
      typeof o.netAmount === 'number' ? o.netAmount : Number(o.netAmount)
    if (!Number.isFinite(netAmount) || netAmount <= 0)
      return { ok: false, reason: 'missing_net_amount' }
    const optionalAmount = (value: unknown): number | undefined => {
      const amount = typeof value === 'number' ? value : Number(value)
      return Number.isFinite(amount) && amount >= 0 ? amount : undefined
    }
    const confidence =
      o.confidence === 'high' ||
      o.confidence === 'medium' ||
      o.confidence === 'low'
        ? o.confidence
        : 'low'
    const optionalText = (value: unknown): string | undefined =>
      typeof value === 'string' && value.trim() ? value.trim() : undefined
    return {
      ok: true,
      data: {
        employerName,
        employeeName: optionalText(o.employeeName),
        payPeriod: optionalText(o.payPeriod),
        paymentDate: optionalText(o.paymentDate),
        grossAmount: optionalAmount(o.grossAmount),
        deductions: optionalAmount(o.deductions),
        netAmount,
        currency:
          typeof o.currency === 'string' && o.currency.trim()
            ? o.currency.trim().toUpperCase()
            : 'LKR',
        confidence,
      },
    }
  } catch {
    return { ok: false, reason: 'malformed_response' }
  }
}

export async function extractSalarySlipFromText(
  bodyText: string,
): Promise<SalarySlipExtractionResult> {
  const prompt = `${SALARY_SLIP_EXTRACTION_PROMPT}\n\nContent:\n${bodyText.slice(0, 8_000)}`
  if (isFinanceAiLocalOnlyEnabled()) {
    const localContent = await callLocalFinanceText(prompt)
    return localContent
      ? parseSalarySlipExtractionJson(localContent)
      : { ok: false, reason: 'local_provider_unavailable' }
  }
  const routes = selectHarpRoutes('structured_output', 'standard')
  if (routes.length > 0) {
    const result = await callWithFallback(routes, prompt)
    if (result) {
      const parsed = parseSalarySlipExtractionJson(result.content)
      if (parsed.ok) return parsed
    }
  }
  const geminiContent = await callGeminiText(prompt)
  return geminiContent
    ? parseSalarySlipExtractionJson(geminiContent)
    : { ok: false, reason: 'all_routes_failed' }
}

const CONTRACT_NOTE_EXTRACTION_PROMPT = `You extract a stock or securities contract note/trade confirmation. Respond with STRICT JSON only, no markdown fences, no commentary, matching exactly this shape:
{
  "symbol": "<ticker symbol>",
  "companyName": "<company name or null>",
  "side": "buy" | "sell",
  "quantity": <positive number of units/shares>,
  "price": <positive execution price per unit>,
  "grossAmount": <number or null>,
  "fees": <number or null, total commission/taxes/fees when shown>,
  "currency": "<3-letter currency code>",
  "broker": "<broker or platform or null>",
  "tradeDate": "<YYYY-MM-DD or null>",
  "settlementDate": "<YYYY-MM-DD or null>",
  "confidence": "high" | "medium" | "low"
}

Use the executed quantity and price, not an order quantity or a portfolio balance. If the content is not a trade confirmation, respond with exactly: {"error":"not_a_contract_note"}`

export function parseContractNoteExtractionJson(
  raw: string,
): ContractNoteExtractionResult {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  try {
    const obj: unknown = JSON.parse(stripped)
    if (!obj || typeof obj !== 'object')
      return { ok: false, reason: 'malformed_response' }
    const o = obj as Record<string, unknown>
    if (o.error) return { ok: false, reason: String(o.error) }
    const numberField = (value: unknown): number =>
      typeof value === 'number' ? value : Number(value)
    const quantity = numberField(o.quantity)
    const price = numberField(o.price)
    if (
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(price) ||
      price <= 0
    )
      return { ok: false, reason: 'missing_trade_quantity_or_price' }
    const symbol =
      typeof o.symbol === 'string' && o.symbol.trim()
        ? o.symbol.trim().toUpperCase()
        : ''
    if (!symbol) return { ok: false, reason: 'missing_symbol' }
    const optionalAmount = (value: unknown): number | undefined => {
      const amount = numberField(value)
      return Number.isFinite(amount) && amount >= 0 ? amount : undefined
    }
    const optionalText = (value: unknown): string | undefined =>
      typeof value === 'string' && value.trim() ? value.trim() : undefined
    const confidence =
      o.confidence === 'high' ||
      o.confidence === 'medium' ||
      o.confidence === 'low'
        ? o.confidence
        : 'low'
    return {
      ok: true,
      data: {
        symbol,
        companyName: optionalText(o.companyName),
        side: o.side === 'sell' ? 'sell' : 'buy',
        quantity,
        price,
        grossAmount: optionalAmount(o.grossAmount),
        fees: optionalAmount(o.fees),
        currency:
          typeof o.currency === 'string' && o.currency.trim()
            ? o.currency.trim().toUpperCase()
            : 'LKR',
        broker: optionalText(o.broker),
        tradeDate: optionalText(o.tradeDate),
        settlementDate: optionalText(o.settlementDate),
        confidence,
      },
    }
  } catch {
    return { ok: false, reason: 'malformed_response' }
  }
}

export async function extractContractNoteFromText(
  bodyText: string,
): Promise<ContractNoteExtractionResult> {
  const prompt = `${CONTRACT_NOTE_EXTRACTION_PROMPT}\n\nContent:\n${bodyText.slice(0, 8_000)}`
  if (isFinanceAiLocalOnlyEnabled()) {
    const localContent = await callLocalFinanceText(prompt)
    return localContent
      ? parseContractNoteExtractionJson(localContent)
      : { ok: false, reason: 'local_provider_unavailable' }
  }
  const routes = selectHarpRoutes('structured_output', 'standard')
  if (routes.length > 0) {
    const result = await callWithFallback(routes, prompt)
    if (result) {
      const parsed = parseContractNoteExtractionJson(result.content)
      if (parsed.ok) return parsed
    }
  }
  const geminiContent = await callGeminiText(prompt)
  return geminiContent
    ? parseContractNoteExtractionJson(geminiContent)
    : { ok: false, reason: 'all_routes_failed' }
}

const FD_CERTIFICATE_EXTRACTION_PROMPT = `You extract details from a fixed-deposit or term-deposit certificate. Respond with STRICT JSON only, no markdown fences, no commentary, matching exactly this shape:
{
  "bankName": "<bank or institution>",
  "certificateNumber": "<certificate/account reference or null>",
  "principal": <positive deposited principal>,
  "currency": "<3-letter currency code>",
  "interestRatePct": <annual interest rate as a percentage number, e.g. 8.5>,
  "interestPayout": "monthly" | "quarterly" | "annually" | "at_maturity",
  "startDate": "<YYYY-MM-DD or null>",
  "maturityDate": "<YYYY-MM-DD or null>",
  "autoRenew": true | false | null,
  "confidence": "high" | "medium" | "low"
}

Use the principal/deposit amount, not maturity value or interest earned. Convert a stated annual rate such as 8.5% p.a. to 8.5. If the document is not a fixed/term-deposit certificate, respond with exactly: {"error":"not_a_fd_certificate"}`

export function parseFdCertificateExtractionJson(
  raw: string,
): FdCertificateExtractionResult {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  try {
    const obj: unknown = JSON.parse(stripped)
    if (!obj || typeof obj !== 'object')
      return { ok: false, reason: 'malformed_response' }
    const o = obj as Record<string, unknown>
    if (o.error) return { ok: false, reason: String(o.error) }
    const principal =
      typeof o.principal === 'number' ? o.principal : Number(o.principal)
    const interestRatePct =
      typeof o.interestRatePct === 'number'
        ? o.interestRatePct
        : Number(o.interestRatePct)
    if (!Number.isFinite(principal) || principal <= 0)
      return { ok: false, reason: 'missing_principal' }
    if (!Number.isFinite(interestRatePct) || interestRatePct < 0)
      return { ok: false, reason: 'missing_interest_rate' }
    const bankName =
      typeof o.bankName === 'string' && o.bankName.trim()
        ? o.bankName.trim()
        : 'Unknown bank'
    const optionalText = (value: unknown): string | undefined =>
      typeof value === 'string' && value.trim() ? value.trim() : undefined
    const interestPayout =
      o.interestPayout === 'monthly' ||
      o.interestPayout === 'quarterly' ||
      o.interestPayout === 'annually' ||
      o.interestPayout === 'at_maturity'
        ? o.interestPayout
        : 'at_maturity'
    const confidence =
      o.confidence === 'high' ||
      o.confidence === 'medium' ||
      o.confidence === 'low'
        ? o.confidence
        : 'low'
    return {
      ok: true,
      data: {
        bankName,
        certificateNumber: optionalText(o.certificateNumber),
        principal,
        currency:
          typeof o.currency === 'string' && o.currency.trim()
            ? o.currency.trim().toUpperCase()
            : 'LKR',
        interestRatePct,
        interestPayout,
        startDate: optionalText(o.startDate),
        maturityDate: optionalText(o.maturityDate),
        autoRenew: typeof o.autoRenew === 'boolean' ? o.autoRenew : undefined,
        confidence,
      },
    }
  } catch {
    return { ok: false, reason: 'malformed_response' }
  }
}

export async function extractFdCertificateFromText(
  bodyText: string,
): Promise<FdCertificateExtractionResult> {
  const prompt = `${FD_CERTIFICATE_EXTRACTION_PROMPT}\n\nContent:\n${bodyText.slice(0, 8_000)}`
  if (isFinanceAiLocalOnlyEnabled()) {
    const localContent = await callLocalFinanceText(prompt)
    return localContent
      ? parseFdCertificateExtractionJson(localContent)
      : { ok: false, reason: 'local_provider_unavailable' }
  }
  const routes = selectHarpRoutes('structured_output', 'standard')
  if (routes.length > 0) {
    const result = await callWithFallback(routes, prompt)
    if (result) {
      const parsed = parseFdCertificateExtractionJson(result.content)
      if (parsed.ok) return parsed
    }
  }
  const geminiContent = await callGeminiText(prompt)
  return geminiContent
    ? parseFdCertificateExtractionJson(geminiContent)
    : { ok: false, reason: 'all_routes_failed' }
}

export async function extractTransactionFromText(
  bodyText: string,
  categoryHints?: Record<string, string>,
): Promise<ExtractionResult> {
  const instructions = promptWithCategoryHints(
    EXTRACTION_PROMPT_INSTRUCTIONS,
    categoryHints,
  )
  const prompt = `${instructions}\n\nContent:\n${bodyText.slice(0, 8_000)}`

  if (isFinanceAiLocalOnlyEnabled()) {
    const localContent = await callLocalFinanceText(prompt)
    return localContent
      ? parseExtractionJson(localContent)
      : { ok: false, reason: 'local_provider_unavailable' }
  }

  // HARP's free-tier OpenRouter chain is tried first (same routing the rest
  // of the app uses), but its one usable free candidate is shared with, and
  // frequently rate-limited by, the LLM trading-signal engine — so fall
  // back to Gemini (already configured) rather than failing the whole
  // ingestion item when that happens.
  const routes = selectHarpRoutes('structured_output', 'standard')
  if (routes.length > 0) {
    const result = await callWithFallback(routes, prompt)
    if (result) {
      const parsed = parseExtractionJson(result.content)
      if (parsed.ok) return parsed
    }
  }

  const geminiContent = await callGeminiText(prompt)
  if (geminiContent) return parseExtractionJson(geminiContent)

  return { ok: false, reason: 'all_routes_failed' }
}

export type FinanceQaTurn = { question: string; answer: string }

/**
 * AI-204: builds the flat prompt string for answerFinanceQuestion(), with an
 * optional "Conversation so far" block folded in ahead of the Data/Question
 * sections. Pulled out as a pure function so multi-turn context assembly is
 * unit-testable without a network call. priorTurns is capped to the last 3
 * regardless of how many are passed in (defense-in-depth; the caller is also
 * expected to already cap — see ask_finance_question in routes/api/finance.ts).
 */
export function buildFinanceAnswerPrompt(
  question: string,
  context: unknown,
  priorTurns: Array<FinanceQaTurn> = [],
): string {
  const recentTurns = priorTurns.slice(-3)
  const conversationBlock =
    recentTurns.length > 0
      ? `Conversation so far:
${recentTurns.map((turn) => `Q: ${turn.question}\nA: ${turn.answer}`).join('\n')}

`
      : ''

  return `You are a personal finance analyst. Answer the user's question using ONLY the JSON data below (which includes the user's personal finances and, if they trade, a tradingSummary of their trading performance) — do not assume anything not present in it. If the data doesn't contain what's needed to answer, say so honestly rather than guessing.

Respond with STRICT JSON only, no markdown fences, no commentary, matching exactly this shape:
{
  "text": "<your answer, 1-4 concise sentences>",
  "chart": null | { "title": "<short chart title>", "data": [{ "label": "<string>", "value": <number> }, ...] }
}
Only include "chart" (non-null) when the question specifically calls for a breakdown/comparison across categories, vendors, or months that a bar chart would make clearer — plain factual questions (e.g. a single total) should have "chart": null.

${conversationBlock}Data:
${JSON.stringify(context)}

Question: ${question}`
}

export type FinanceAnswerChart = {
  title: string
  data: Array<{ label: string; value: number }>
}

/**
 * AI-203: parses the strict-JSON response answerFinanceQuestion()'s prompt
 * requests, following the exact fence-stripping/JSON.parse/type-guard
 * pattern already used by parseExtractionJson/parseContractExtractionJson.
 * Never throws — a model that ignores the JSON instruction (common on
 * weaker fallback tiers) degrades to the raw response as plain text with no
 * chart, rather than failing the whole answer.
 */
export function parseFinanceAnswerJson(raw: string): {
  text: string
  chart: FinanceAnswerChart | null
} {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  try {
    const obj: unknown = JSON.parse(stripped)
    if (typeof obj !== 'object' || obj === null)
      return { text: raw.trim(), chart: null }
    const o = obj as Record<string, unknown>
    if (typeof o.text !== 'string' || !o.text.trim())
      return { text: raw.trim(), chart: null }

    let chart: FinanceAnswerChart | null = null
    if (o.chart && typeof o.chart === 'object') {
      const c = o.chart as Record<string, unknown>
      const title =
        typeof c.title === 'string' && c.title.trim() ? c.title.trim() : null
      const rawData = Array.isArray(c.data) ? c.data : null
      if (title && rawData) {
        const data = rawData
          .filter(
            (row): row is { label: string; value: number } =>
              !!row &&
              typeof row === 'object' &&
              typeof (row as Record<string, unknown>).label === 'string' &&
              Number.isFinite(Number((row as Record<string, unknown>).value)),
          )
          .map((row) => ({ label: row.label, value: Number(row.value) }))
          .slice(0, 10)
        if (data.length > 0) chart = { title, data }
      }
    }

    return { text: o.text.trim(), chart }
  } catch {
    return { text: raw.trim(), chart: null }
  }
}

/**
 * Phase 24 (AI-200/201): answers a free-text question about the user's own
 * finances using ONLY the bounded, pre-aggregated context the caller
 * provides (buildFinanceQueryContext in finance-store.ts) — never a raw
 * transaction dump. Same two-tier HARP -> Gemini fallback as
 * extractTransactionFromText(). AI-204: optionally folds in the last few
 * prior turns of this conversation so follow-up questions carry context.
 * AI-203: the response is strict JSON (parsed via parseFinanceAnswerJson)
 * so the model can optionally return chart data alongside its text answer.
 */
export async function answerFinanceQuestion(
  question: string,
  context: unknown,
  priorTurns: Array<FinanceQaTurn> = [],
): Promise<
  | { ok: true; answer: string; chart: FinanceAnswerChart | null }
  | { ok: false; reason: string }
> {
  const prompt = buildFinanceAnswerPrompt(question, context, priorTurns)

  if (isFinanceAiLocalOnlyEnabled()) {
    const localContent = await callLocalFinanceText(prompt)
    if (!localContent)
      return { ok: false, reason: 'local_provider_unavailable' }
    const parsed = parseFinanceAnswerJson(localContent)
    return { ok: true, answer: parsed.text, chart: parsed.chart }
  }

  const routes = selectHarpRoutes('text_summary', 'standard')
  if (routes.length > 0) {
    const result = await callWithFallback(routes, prompt)
    if (result?.content) {
      const parsed = parseFinanceAnswerJson(result.content)
      return { ok: true, answer: parsed.text, chart: parsed.chart }
    }
  }

  const geminiContent = await callGeminiText(prompt)
  if (geminiContent) {
    const parsed = parseFinanceAnswerJson(geminiContent)
    return { ok: true, answer: parsed.text, chart: parsed.chart }
  }

  return { ok: false, reason: 'all_routes_failed' }
}

const IMAGE_MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  // iPhone cameras (and many recent Android phones) default to HEIC/HEIF —
  // Gemini's generateContent API accepts these natively, so labeling them
  // correctly (instead of the previous silent fallback to image/png) is
  // enough to let extraction actually work, no conversion needed:
  // https://ai.google.dev/gemini-api/docs/image-understanding
  '.heic': 'image/heic',
  '.heif': 'image/heif',
}

/** Defaults to image/jpeg for an unrecognized extension — the far more common camera/photo format than PNG. */
export function mimeTypeForImageExtension(ext: string): string {
  return IMAGE_MIME_TYPES_BY_EXTENSION[ext.toLowerCase()] ?? 'image/jpeg'
}

function readImageAsBase64(
  imagePath: string,
): { base64: string; mimeType: string } | null {
  try {
    const buffer = fs.readFileSync(imagePath)
    const mimeType = mimeTypeForImageExtension(path.extname(imagePath))
    return { base64: buffer.toString('base64'), mimeType }
  } catch {
    return null
  }
}

/**
 * Free vision-capable OpenRouter models, checked directly against
 * OpenRouter's live model list (architecture.input_modalities includes
 * "image") rather than assumed — kept short and explicit since HARP's own
 * routing isn't vision-aware. Tried in order before falling back to Gemini.
 */
const VISION_ROUTE_MODELS = [
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
]

async function callOpenRouterVision(
  model: string,
  prompt: string,
  base64: string,
  mimeType: string,
): Promise<string | null> {
  const apiKey = readOpenRouterKey()
  if (!apiKey) return null
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${base64}` },
              },
            ],
          },
        ],
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(45_000),
    })
    if (!resp.ok) return null
    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    return data.choices?.[0]?.message?.content ?? null
  } catch {
    return null
  }
}

function readGoogleApiKey(): string | null {
  if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY
  try {
    const envPath = path.join(os.homedir(), '.hermes', '.env')
    const content = fs.readFileSync(envPath, 'utf-8')
    const match = content.match(/^GOOGLE_API_KEY=(.+)$/m)
    return match ? match[1].trim().replace(/^["']|["']$/g, '') : null
  } catch {
    return null
  }
}

async function callGemini(
  parts: Array<Record<string, unknown>>,
): Promise<string | null> {
  const apiKey = readGoogleApiKey()
  if (!apiKey) return null
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0.2 },
        }),
        signal: AbortSignal.timeout(45_000),
      },
    )
    if (!resp.ok) return null
    const data = (await resp.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    // Gemini's response can include a leading "thoughtSignature" part before
    // the actual text part — find the first part that actually has text
    // rather than assuming index 0.
    const textPart = data.candidates?.[0]?.content?.parts?.find(
      (p) => typeof p.text === 'string',
    )
    return textPart?.text ?? null
  } catch {
    return null
  }
}

async function callGeminiVision(
  prompt: string,
  base64: string,
  mimeType: string,
): Promise<string | null> {
  return callGemini([
    { text: prompt },
    { inline_data: { mime_type: mimeType, data: base64 } },
  ])
}

async function callGeminiText(prompt: string): Promise<string | null> {
  return callGemini([{ text: prompt }])
}

export async function extractTransactionFromImage(
  imagePath: string,
  categoryHints?: Record<string, string>,
): Promise<ExtractionResult> {
  const image = readImageAsBase64(imagePath)
  if (!image) return { ok: false, reason: 'image_not_found' }
  const instructions = promptWithCategoryHints(
    EXTRACTION_PROMPT_INSTRUCTIONS,
    categoryHints,
  )

  if (isFinanceAiLocalOnlyEnabled()) {
    const localContent = await callLocalFinanceVision(instructions, [image])
    return localContent
      ? parseExtractionJson(localContent)
      : { ok: false, reason: 'local_provider_unavailable' }
  }

  for (const model of VISION_ROUTE_MODELS) {
    const content = await callOpenRouterVision(
      model,
      instructions,
      image.base64,
      image.mimeType,
    )
    if (content) return parseExtractionJson(content)
  }

  const geminiContent = await callGeminiVision(
    instructions,
    image.base64,
    image.mimeType,
  )
  if (geminiContent) return parseExtractionJson(geminiContent)

  return { ok: false, reason: 'all_routes_failed' }
}

export async function extractTransactionsFromImages(
  imagePaths: Array<string>,
  categoryHints?: Record<string, string>,
): Promise<
  | { ok: true; data: Array<ExtractedTransaction> }
  | { ok: false; reason: string }
> {
  const images = imagePaths
    .slice(0, 12)
    .map((imagePath) => readImageAsBase64(imagePath))
    .filter(
      (image): image is { base64: string; mimeType: string } => image !== null,
    )
  if (images.length === 0) return { ok: false, reason: 'image_not_found' }
  const prompt = promptWithCategoryHints(
    STATEMENT_EXTRACTION_PROMPT_INSTRUCTIONS,
    categoryHints,
  )
  if (isFinanceAiLocalOnlyEnabled()) {
    const localContent = await callLocalFinanceVision(prompt, images)
    if (!localContent)
      return { ok: false, reason: 'local_provider_unavailable' }
    const parsed = parseStatementExtractionJson(localContent)
    return parsed.length > 0
      ? { ok: true, data: parsed.map((result) => result.data) }
      : { ok: false, reason: 'no_transactions_found' }
  }
  for (const model of VISION_ROUTE_MODELS) {
    const content = await callOpenRouterVisionMulti(model, prompt, images)
    if (content) {
      const parsed = parseStatementExtractionJson(content)
      if (parsed.length > 0)
        return { ok: true, data: parsed.map((result) => result.data) }
    }
  }
  const geminiContent = await callGeminiVisionMulti(prompt, images)
  if (geminiContent) {
    const parsed = parseStatementExtractionJson(geminiContent)
    if (parsed.length > 0)
      return { ok: true, data: parsed.map((result) => result.data) }
  }
  return { ok: false, reason: 'no_transactions_found' }
}

const SALARY_SLIP_MAX_PAGES = 4

/** AI-405: retain payroll fields instead of reducing a payslip to a generic transaction. */
export async function extractSalarySlipFromImages(
  imagePaths: Array<string>,
): Promise<SalarySlipExtractionResult> {
  const images = imagePaths
    .slice(0, SALARY_SLIP_MAX_PAGES)
    .map((imagePath) => readImageAsBase64(imagePath))
    .filter(
      (image): image is { base64: string; mimeType: string } => image !== null,
    )
  if (images.length === 0) return { ok: false, reason: 'image_not_found' }
  if (isFinanceAiLocalOnlyEnabled()) {
    const localContent = await callLocalFinanceVision(
      SALARY_SLIP_EXTRACTION_PROMPT,
      images,
    )
    return localContent
      ? parseSalarySlipExtractionJson(localContent)
      : { ok: false, reason: 'local_provider_unavailable' }
  }
  for (const model of VISION_ROUTE_MODELS) {
    const content = await callOpenRouterVisionMulti(
      model,
      SALARY_SLIP_EXTRACTION_PROMPT,
      images,
    )
    if (content) {
      const parsed = parseSalarySlipExtractionJson(content)
      if (parsed.ok) return parsed
    }
  }
  const geminiContent = await callGeminiVisionMulti(
    SALARY_SLIP_EXTRACTION_PROMPT,
    images,
  )
  return geminiContent
    ? parseSalarySlipExtractionJson(geminiContent)
    : { ok: false, reason: 'all_routes_failed' }
}

/** AI-406: extracts an executed trade without mutating holdings or cash. */
export async function extractContractNoteFromImages(
  imagePaths: Array<string>,
): Promise<ContractNoteExtractionResult> {
  const images = imagePaths
    .slice(0, 4)
    .map((imagePath) => readImageAsBase64(imagePath))
    .filter(
      (image): image is { base64: string; mimeType: string } => image !== null,
    )
  if (images.length === 0) return { ok: false, reason: 'image_not_found' }
  if (isFinanceAiLocalOnlyEnabled()) {
    const localContent = await callLocalFinanceVision(
      CONTRACT_NOTE_EXTRACTION_PROMPT,
      images,
    )
    return localContent
      ? parseContractNoteExtractionJson(localContent)
      : { ok: false, reason: 'local_provider_unavailable' }
  }
  for (const model of VISION_ROUTE_MODELS) {
    const content = await callOpenRouterVisionMulti(
      model,
      CONTRACT_NOTE_EXTRACTION_PROMPT,
      images,
    )
    if (content) {
      const parsed = parseContractNoteExtractionJson(content)
      if (parsed.ok) return parsed
    }
  }
  const geminiContent = await callGeminiVisionMulti(
    CONTRACT_NOTE_EXTRACTION_PROMPT,
    images,
  )
  return geminiContent
    ? parseContractNoteExtractionJson(geminiContent)
    : { ok: false, reason: 'all_routes_failed' }
}

/** AI-407: extracts a fixed-deposit certificate without committing an asset. */
export async function extractFdCertificateFromImages(
  imagePaths: Array<string>,
): Promise<FdCertificateExtractionResult> {
  const images = imagePaths
    .slice(0, 4)
    .map((imagePath) => readImageAsBase64(imagePath))
    .filter(
      (image): image is { base64: string; mimeType: string } => image !== null,
    )
  if (images.length === 0) return { ok: false, reason: 'image_not_found' }
  if (isFinanceAiLocalOnlyEnabled()) {
    const localContent = await callLocalFinanceVision(
      FD_CERTIFICATE_EXTRACTION_PROMPT,
      images,
    )
    return localContent
      ? parseFdCertificateExtractionJson(localContent)
      : { ok: false, reason: 'local_provider_unavailable' }
  }
  for (const model of VISION_ROUTE_MODELS) {
    const content = await callOpenRouterVisionMulti(
      model,
      FD_CERTIFICATE_EXTRACTION_PROMPT,
      images,
    )
    if (content) {
      const parsed = parseFdCertificateExtractionJson(content)
      if (parsed.ok) return parsed
    }
  }
  const geminiContent = await callGeminiVisionMulti(
    FD_CERTIFICATE_EXTRACTION_PROMPT,
    images,
  )
  return geminiContent
    ? parseFdCertificateExtractionJson(geminiContent)
    : { ok: false, reason: 'all_routes_failed' }
}

/**
 * Employment contract extraction: reads the full document (all pages, not
 * just page 1 like the single-transaction flow above — contracts routinely
 * spread salary/dates/clauses across multiple pages) and returns both the
 * structured job fields AND a plain-English risk review in one pass, since
 * the vision model is already reading the whole document. This is not legal
 * advice — the prompt asks the model to flag concerns, not render verdicts,
 * and the UI carries an explicit disclaimer alongside the output.
 */
const CONTRACT_MAX_PAGES = 10

const CONTRACT_EXTRACTION_PROMPT_INSTRUCTIONS = `You are reviewing an employment contract/offer letter on behalf of the EMPLOYEE (not the employer). Read all provided pages and respond with STRICT JSON only, no markdown fences, no commentary, matching exactly this shape:
{
  "employerName": "<company name>",
  "employmentType": "full_time" | "contract" | "freelance" | "other",
  "monthlyIncomeAmount": <number, monthly salary/rate converted to a monthly figure if the contract states annual/hourly, or null if not stated>,
  "currency": "<3-letter currency code, e.g. LKR, USD, AUD>",
  "contractStartDate": "<YYYY-MM-DD or null>",
  "contractEndDate": "<YYYY-MM-DD, or null for full-time/indefinite employment>",
  "jobTitle": "<job title/role, or null>",
  "paydayDayOfMonth": <number 1-31, ONLY when the contract states a clear fixed day salary is paid on each month (e.g. "paid on the 5th" -> 5), otherwise null>,
  "paySchedule": "<short free-text description of pay timing whenever ANY pay-timing language exists, e.g. "Last business day of each month", or null if nothing is stated>,
  "confidence": "high" | "medium" | "low",
  "riskSummary": "<2-3 plain-English sentences on how favorable or unfavorable this contract looks for the employee overall>",
  "risks": [
    { "severity": "high" | "medium" | "low", "clause": "<short label, e.g. 'Termination notice'>", "concern": "<what is unusual, one-sided, or risky about it for the employee, in plain English>" }
  ]
}

Look specifically for things like: notice-period asymmetry (employer owes less notice than employee), weak or absent severance, unusually broad or long non-compete/non-solicit terms, termination without cause with little/no protection, missing cost-of-living/inflation adjustment, unpaid or uncapped overtime expectations, one-sided IP assignment, mandatory individual arbitration waiving the right to sue, and any probation terms that strip protections for an extended period. List every genuine concern you find (up to 10), ranked most severe first. If the contract is largely standard/fair, say so plainly in riskSummary and return an empty risks array. This is not legal advice — flag concerns, do not declare the contract legal or illegal.

If the content does not appear to be an employment contract/offer letter, respond with exactly: {"error": "not_a_contract"}`

export function parseContractExtractionJson(
  raw: string,
): ContractExtractionResult {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  try {
    const obj: unknown = JSON.parse(stripped)
    if (typeof obj !== 'object' || obj === null)
      return { ok: false, reason: 'malformed_response' }
    const o = obj as Record<string, unknown>
    if (o.error) return { ok: false, reason: String(o.error) }

    const employerName =
      typeof o.employerName === 'string' && o.employerName.trim()
        ? o.employerName.trim()
        : 'Unknown employer'
    const employmentType =
      o.employmentType === 'full_time' ||
      o.employmentType === 'contract' ||
      o.employmentType === 'freelance'
        ? o.employmentType
        : 'other'
    const monthlyIncomeAmount =
      typeof o.monthlyIncomeAmount === 'number' &&
      Number.isFinite(o.monthlyIncomeAmount)
        ? o.monthlyIncomeAmount
        : undefined
    const currency =
      typeof o.currency === 'string' && o.currency.trim()
        ? o.currency.trim()
        : 'LKR'
    const contractStartDate =
      typeof o.contractStartDate === 'string' && o.contractStartDate.trim()
        ? o.contractStartDate.trim()
        : undefined
    const contractEndDate =
      typeof o.contractEndDate === 'string' && o.contractEndDate.trim()
        ? o.contractEndDate.trim()
        : undefined
    const jobTitle =
      typeof o.jobTitle === 'string' && o.jobTitle.trim()
        ? o.jobTitle.trim()
        : undefined
    const paydayDayOfMonth =
      typeof o.paydayDayOfMonth === 'number' &&
      Number.isInteger(o.paydayDayOfMonth) &&
      o.paydayDayOfMonth >= 1 &&
      o.paydayDayOfMonth <= 31
        ? o.paydayDayOfMonth
        : undefined
    const paySchedule =
      typeof o.paySchedule === 'string' && o.paySchedule.trim()
        ? o.paySchedule.trim().slice(0, 200)
        : undefined
    const confidence =
      o.confidence === 'high' ||
      o.confidence === 'medium' ||
      o.confidence === 'low'
        ? o.confidence
        : 'low'
    const riskSummary =
      typeof o.riskSummary === 'string'
        ? o.riskSummary.trim().slice(0, 600)
        : ''

    const rawRisks = Array.isArray(o.risks) ? o.risks : []
    const risks: Array<ContractRisk> = rawRisks
      .slice(0, 10)
      .map((r): ContractRisk | null => {
        if (typeof r !== 'object' || r === null) return null
        const ro = r as Record<string, unknown>
        const severity =
          ro.severity === 'high' ||
          ro.severity === 'medium' ||
          ro.severity === 'low'
            ? ro.severity
            : 'low'
        const clause =
          typeof ro.clause === 'string' && ro.clause.trim()
            ? ro.clause.trim()
            : ''
        const concern =
          typeof ro.concern === 'string' && ro.concern.trim()
            ? ro.concern.trim()
            : ''
        if (!clause || !concern) return null
        return { severity, clause, concern }
      })
      .filter((r): r is ContractRisk => r !== null)

    return {
      ok: true,
      data: {
        employerName,
        employmentType,
        monthlyIncomeAmount,
        currency,
        contractStartDate,
        contractEndDate,
        jobTitle,
        paydayDayOfMonth,
        paySchedule,
        confidence,
        riskSummary,
        risks,
      },
    }
  } catch {
    return { ok: false, reason: 'malformed_response' }
  }
}

async function callOpenRouterVisionMulti(
  model: string,
  prompt: string,
  images: Array<{ base64: string; mimeType: string }>,
): Promise<string | null> {
  const apiKey = readOpenRouterKey()
  if (!apiKey) return null
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              ...images.map((image) => ({
                type: 'image_url' as const,
                image_url: {
                  url: `data:${image.mimeType};base64,${image.base64}`,
                },
              })),
            ],
          },
        ],
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!resp.ok) return null
    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    return data.choices?.[0]?.message?.content ?? null
  } catch {
    return null
  }
}

async function callGeminiVisionMulti(
  prompt: string,
  images: Array<{ base64: string; mimeType: string }>,
): Promise<string | null> {
  return callGemini([
    { text: prompt },
    ...images.map((image) => ({
      inline_data: { mime_type: image.mimeType, data: image.base64 },
    })),
  ])
}

export async function extractEmploymentContract(
  imagePaths: Array<string>,
): Promise<ContractExtractionResult> {
  const images = imagePaths
    .slice(0, CONTRACT_MAX_PAGES)
    .map((imagePath) => readImageAsBase64(imagePath))
    .filter(
      (image): image is { base64: string; mimeType: string } => image !== null,
    )
  if (images.length === 0) return { ok: false, reason: 'image_not_found' }

  if (isFinanceAiLocalOnlyEnabled()) {
    const localContent = await callLocalFinanceVision(
      CONTRACT_EXTRACTION_PROMPT_INSTRUCTIONS,
      images,
    )
    return localContent
      ? parseContractExtractionJson(localContent)
      : { ok: false, reason: 'local_provider_unavailable' }
  }

  for (const model of VISION_ROUTE_MODELS) {
    const content = await callOpenRouterVisionMulti(
      model,
      CONTRACT_EXTRACTION_PROMPT_INSTRUCTIONS,
      images,
    )
    if (content) return parseContractExtractionJson(content)
  }

  const geminiContent = await callGeminiVisionMulti(
    CONTRACT_EXTRACTION_PROMPT_INSTRUCTIONS,
    images,
  )
  if (geminiContent) return parseContractExtractionJson(geminiContent)

  return { ok: false, reason: 'all_routes_failed' }
}
