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
import { callWithFallback, readOpenRouterKey, selectHarpRoutes } from './llm-signal-engine'
import type { ExtractedTransaction } from './finance-store'

export type ExtractionResult =
  | { ok: true; data: ExtractedTransaction }
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

/**
 * Appends known vendor -> category corrections (learned from the user
 * overriding the AI's category guess at confirm time — see
 * recordCategoryCorrection in finance-store.ts) so repeat vendors start
 * from what the user actually picked instead of the model guessing again.
 * Kept short (10 max) since this goes straight into the prompt.
 */
export function promptWithCategoryHints(base: string, categoryHints?: Record<string, string>): string {
  const entries = categoryHints ? Object.entries(categoryHints).slice(0, 10) : []
  if (entries.length === 0) return base
  const hintLines = entries.map(([vendor, category]) => `- "${vendor}" -> "${category}"`).join('\n')
  return `${base}\n\nKnown vendor -> category corrections from this user's past edits (use these when the vendor matches):\n${hintLines}`
}

export function parseExtractionJson(raw: string): ExtractionResult {
  const stripped = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    const obj: unknown = JSON.parse(stripped)
    if (typeof obj !== 'object' || obj === null) return { ok: false, reason: 'malformed_response' }
    const o = obj as Record<string, unknown>
    if (o.error) return { ok: false, reason: String(o.error) }

    const kind = o.kind
    if (kind !== 'income' && kind !== 'expense') return { ok: false, reason: 'malformed_response' }
    const amount = typeof o.amount === 'number' ? o.amount : Number(o.amount)
    if (!Number.isFinite(amount)) return { ok: false, reason: 'malformed_response' }
    const currency = typeof o.currency === 'string' && o.currency.trim() ? o.currency.trim() : 'LKR'
    const vendorOrSource = typeof o.vendorOrSource === 'string' && o.vendorOrSource.trim()
      ? o.vendorOrSource.trim()
      : 'Unknown'
    const date = typeof o.date === 'string' && o.date.trim()
      ? o.date.trim()
      : new Date().toISOString().slice(0, 10)
    const category = typeof o.category === 'string' && o.category.trim() ? o.category.trim() : undefined
    const confidence = o.confidence === 'high' || o.confidence === 'medium' || o.confidence === 'low'
      ? o.confidence
      : 'low'

    return { ok: true, data: { kind, amount, currency, vendorOrSource, date, category, confidence } }
  } catch {
    return { ok: false, reason: 'malformed_response' }
  }
}

export async function extractTransactionFromText(
  bodyText: string,
  categoryHints?: Record<string, string>,
): Promise<ExtractionResult> {
  const instructions = promptWithCategoryHints(EXTRACTION_PROMPT_INSTRUCTIONS, categoryHints)
  const prompt = `${instructions}\n\nContent:\n${bodyText.slice(0, 8_000)}`

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

function readImageAsBase64(imagePath: string): { base64: string; mimeType: string } | null {
  try {
    const buffer = fs.readFileSync(imagePath)
    const ext = path.extname(imagePath).toLowerCase()
    const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png'
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
const VISION_ROUTE_MODELS = ['google/gemma-4-31b-it:free', 'google/gemma-4-26b-a4b-it:free']

async function callOpenRouterVision(model: string, prompt: string, base64: string, mimeType: string): Promise<string | null> {
  const apiKey = readOpenRouterKey()
  if (!apiKey) return null
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
            ],
          },
        ],
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(45_000),
    })
    if (!resp.ok) return null
    const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> }
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

async function callGemini(parts: Array<Record<string, unknown>>): Promise<string | null> {
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
    const textPart = data.candidates?.[0]?.content?.parts?.find((p) => typeof p.text === 'string')
    return textPart?.text ?? null
  } catch {
    return null
  }
}

async function callGeminiVision(prompt: string, base64: string, mimeType: string): Promise<string | null> {
  return callGemini([{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64 } }])
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
  const instructions = promptWithCategoryHints(EXTRACTION_PROMPT_INSTRUCTIONS, categoryHints)

  for (const model of VISION_ROUTE_MODELS) {
    const content = await callOpenRouterVision(model, instructions, image.base64, image.mimeType)
    if (content) return parseExtractionJson(content)
  }

  const geminiContent = await callGeminiVision(instructions, image.base64, image.mimeType)
  if (geminiContent) return parseExtractionJson(geminiContent)

  return { ok: false, reason: 'all_routes_failed' }
}
