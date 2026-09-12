type FxEntry = {
  id: string
  totalReturnLkr: number
  insufficientHistory: boolean
}

type FxHolding = Record<string, unknown>

type ExchangeRate = {
  base: string
  target: string
  rate: number
  date: string
}

export type FxRateScenario = {
  exposedMarketValueLkr: number
  currencyMoveLkr: number
  projectedReturnLkr: number
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function latestRate(
  rates: Array<ExchangeRate>,
  base: string,
  target: string,
): number | null {
  const matching = rates
    .filter(
      (row) =>
        row.base === base &&
        row.target === target &&
        Number.isFinite(row.rate) &&
        row.rate > 0,
    )
    .sort((a, b) => b.date.localeCompare(a.date))
  return matching[0]?.rate ?? null
}

/** Estimates FX-only return sensitivity; native holding prices stay unchanged. */
export function fxRateScenario(
  currentReportedReturnLkr: number,
  entries: Array<FxEntry>,
  holdings: Array<FxHolding>,
  rates: Array<ExchangeRate>,
  rateMovePct: number,
): FxRateScenario | null {
  if (
    !Number.isFinite(currentReportedReturnLkr) ||
    !Number.isFinite(rateMovePct)
  ) {
    return null
  }
  const holdingsById = new Map(
    holdings.map((holding) => [String(holding.id ?? ''), holding]),
  )
  let exposedMarketValueLkr = 0
  let includedForeignHoldings = 0

  for (const entry of entries) {
    if (entry.insufficientHistory) continue
    const holding = holdingsById.get(entry.id)
    if (!holding) continue
    const currency = String(holding.currency ?? '')
    if (!currency || currency === 'LKR') continue
    const quantity = finite(holding.quantity)
    const buyPrice = finite(holding.buyPrice)
    const currentPrice = finite(holding.lastKnownPrice) ?? buyPrice
    if (quantity === null || currentPrice === null) continue

    const direct = latestRate(rates, currency, 'LKR')
    const inverse = direct === null ? latestRate(rates, 'LKR', currency) : null
    const rate = direct ?? (inverse === null ? null : 1 / inverse)
    if (rate === null) continue

    exposedMarketValueLkr += currentPrice * quantity * rate
    includedForeignHoldings += 1
  }

  if (includedForeignHoldings === 0) return null
  const currencyMoveLkr = exposedMarketValueLkr * (rateMovePct / 100)
  return {
    exposedMarketValueLkr,
    currencyMoveLkr,
    projectedReturnLkr: currentReportedReturnLkr + currencyMoveLkr,
  }
}
