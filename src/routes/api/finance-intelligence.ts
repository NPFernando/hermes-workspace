import type {
  NewsItem,
  RiskLevel,
  RiskScore,
  SentimentScore,
} from './finance-store'

export const INTELLIGENCE_FORMULA_VERSION = 'research-v1'
const NEWS_MAX_AGE_MS = 48 * 60 * 60 * 1000
const FEAR_GREED_MAX_AGE_MS = 36 * 60 * 60 * 1000

export type IntelligenceLabel =
  | 'positive'
  | 'neutral'
  | 'negative'
  | 'mixed'
  | 'unknown'
export type ClassifiedNews = {
  id: string
  score: number
  label: IntelligenceLabel
  confidence: number
  keywords: Array<string>
}
export type CompositeIntelligence = {
  symbol: string
  score: number | null
  label: IntelligenceLabel
  confidence: number
  freshness: number
  sourceIds: Array<string>
  disagreement: boolean
  blockers: Array<string>
  observedAt: string
  expiresAt: string
  formulaVersion: typeof INTELLIGENCE_FORMULA_VERSION
}

const POSITIVE = [
  'approval',
  'adoption',
  'growth',
  'surge',
  'rally',
  'gain',
  'inflow',
  'upgrade',
  'record high',
]
const NEGATIVE = [
  'hack',
  'exploit',
  'ban',
  'lawsuit',
  'crash',
  'plunge',
  'outflow',
  'liquidation',
  'investigation',
]

function bounded(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function validDate(value: string | undefined): number | null {
  if (!value) return null
  const result = Date.parse(value)
  return Number.isFinite(result) ? result : null
}

function labelFor(score: number): IntelligenceLabel {
  if (score >= 15) return 'positive'
  if (score <= -15) return 'negative'
  return 'neutral'
}

/** Classifies headline text only. It never fetches, executes, or imports trading code. */
export function classifyNewsItem(
  item: Pick<NewsItem, 'id' | 'summary'>,
): ClassifiedNews {
  const text = item.summary.toLowerCase()
  const positive = POSITIVE.filter((keyword) => text.includes(keyword))
  const negative = NEGATIVE.filter((keyword) => text.includes(keyword))
  const keywords = [...positive, ...negative].sort()
  if (positive.length > 0 && negative.length > 0) {
    return { id: item.id, score: 0, label: 'mixed', confidence: 0.35, keywords }
  }
  const direction = positive.length > 0 ? 1 : negative.length > 0 ? -1 : 0
  return {
    id: item.id,
    score: direction * Math.min(100, 30 + keywords.length * 20),
    label:
      direction === 0 ? 'neutral' : direction > 0 ? 'positive' : 'negative',
    confidence:
      direction === 0 ? 0.1 : Math.min(0.8, 0.4 + keywords.length * 0.15),
    keywords,
  }
}

function currentFearGreed(
  scores: Array<SentimentScore>,
  symbol: string,
  nowMs: number,
): SentimentScore | null {
  return (
    scores
      .filter((score) => score.symbol === symbol && score.kind === 'fear_greed')
      .filter((score) => validDate(score.observedAt) !== null)
      .filter(
        (score) =>
          nowMs - (validDate(score.observedAt) ?? 0) <= FEAR_GREED_MAX_AGE_MS,
      )
      .filter((score) => score.score >= 0 && score.score <= 100)
      .sort(
        (a, b) =>
          (validDate(b.observedAt) ?? 0) - (validDate(a.observedAt) ?? 0),
      )[0] ?? null
  )
}

/**
 * Deterministically combines stored news and optional stored Fear & Greed.
 * A result without fresh, non-conflicting headline evidence intentionally abstains.
 */
export function buildCompositeSentiment(input: {
  symbol: string
  items?: Array<NewsItem>
  sentimentScores?: Array<SentimentScore>
  now: Date
}): CompositeIntelligence {
  const symbol = input.symbol.trim().toUpperCase()
  const nowMs = input.now.getTime()
  const items = Array.isArray(input.items) ? input.items : []
  const sentimentScores = Array.isArray(input.sentimentScores)
    ? input.sentimentScores
    : []
  const unique = new Map<string, NewsItem>()
  for (const item of items) {
    if (item.relatedSymbol === symbol && !unique.has(item.id))
      unique.set(item.id, item)
  }
  const fresh = [...unique.values()]
    .map((item) => ({
      item,
      publishedAt: validDate(item.publishDate) ?? validDate(item.createdAt),
    }))
    .filter(
      (entry): entry is { item: NewsItem; publishedAt: number } =>
        entry.publishedAt !== null,
    )
    .filter(
      (entry) =>
        entry.publishedAt <= nowMs &&
        nowMs - entry.publishedAt <= NEWS_MAX_AGE_MS,
    )
    .sort((a, b) => a.item.id.localeCompare(b.item.id))

  const sourceIds = fresh.map(({ item }) => item.id)
  const blockers: Array<string> = []
  if (fresh.length === 0) blockers.push('no fresh stored news')
  const weighted = fresh.map(({ item, publishedAt }) => {
    const classified = classifyNewsItem(item)
    const freshness = 1 - (nowMs - publishedAt) / NEWS_MAX_AGE_MS
    return { ...classified, weight: Math.max(0.1, freshness) }
  })
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0)
  const newsScore =
    totalWeight === 0
      ? null
      : weighted.reduce((sum, item) => sum + item.score * item.weight, 0) /
        totalWeight
  const hasPositive = weighted.some((item) => item.score > 0)
  const hasNegative = weighted.some((item) => item.score < 0)
  const disagreement = hasPositive && hasNegative
  if (disagreement) blockers.push('conflicting headline evidence')

  const fg = currentFearGreed(sentimentScores, symbol, nowMs)
  if (fg) sourceIds.push(fg.id)
  const fgScore = fg ? bounded((50 - fg.score) * 2, -100, 100) : null
  const score =
    newsScore === null
      ? null
      : bounded(newsScore * 0.75 + (fgScore ?? newsScore) * 0.25, -100, 100)
  const freshness =
    fresh.length === 0
      ? 0
      : Math.min(
          ...fresh.map(
            ({ publishedAt }) => 1 - (nowMs - publishedAt) / NEWS_MAX_AGE_MS,
          ),
        )
  const confidence =
    score === null || disagreement
      ? 0
      : bounded(
          (weighted.reduce((sum, item) => sum + item.confidence, 0) /
            weighted.length) *
            freshness *
            Math.min(1, fresh.length / 3),
          0,
          1,
        )
  if (score === null || confidence < 0.35)
    blockers.push('insufficient confidence')

  return {
    symbol,
    score: score === null ? null : Number(score.toFixed(4)),
    label:
      score === null ? 'unknown' : disagreement ? 'mixed' : labelFor(score),
    confidence: Number(confidence.toFixed(4)),
    freshness: Number(freshness.toFixed(4)),
    sourceIds: [...new Set(sourceIds)].sort(),
    disagreement,
    blockers,
    observedAt: input.now.toISOString(),
    expiresAt: new Date(nowMs + NEWS_MAX_AGE_MS).toISOString(),
    formulaVersion: INTELLIGENCE_FORMULA_VERSION,
  }
}

export function assessResearchRisk(
  composite: CompositeIntelligence,
): Pick<
  RiskScore,
  'riskLevel' | 'riskScore' | 'confidenceScore' | 'blockers' | 'inputs'
> {
  const riskLevel: RiskLevel =
    composite.blockers.length > 0
      ? 'high_risk'
      : composite.confidence >= 0.6
        ? 'low_risk'
        : 'medium_risk'
  return {
    riskLevel,
    riskScore:
      riskLevel === 'high_risk' ? 80 : riskLevel === 'medium_risk' ? 50 : 25,
    confidenceScore: composite.confidence,
    blockers: composite.blockers,
    inputs: {
      sourceIds: composite.sourceIds,
      freshness: composite.freshness,
      disagreement: composite.disagreement,
    },
  }
}

/** Read-only research recommendation; never a plan or executable trading signal. */
export function buildPaperDecision(composite: CompositeIntelligence): {
  decision: 'HOLD'
  abstain: true
  reason: string
} {
  return {
    decision: 'HOLD',
    abstain: true,
    reason:
      composite.blockers.join('; ') || 'research only — no execution signal',
  }
}
