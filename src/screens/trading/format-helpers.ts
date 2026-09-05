/**
 * Shared formatters for the Trading module. formatUsdt was previously
 * redefined independently in trading-screen.tsx (using an ASCII hyphen for
 * negative values) and trading-summary-strip.tsx plus two locally-scoped
 * copies inside trading-screen.tsx (using the Unicode minus sign U+2212) --
 * the same number rendered with a different minus-sign glyph depending on
 * which panel it flowed through. This is the single canonical version,
 * standardized on the Unicode minus sign.
 */
export function formatUsdt(value: number): string {
  return `${value < 0 ? '−' : ''}${Math.abs(value).toFixed(2)} USDT`
}

/** Signed, unlabeled two-decimal number (e.g. "+12.34" or "-3.50"). */
export function formatSignedAmount(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`
}

/** Formats a fraction (e.g. 0.452) as a one-decimal percentage string ("45.2%"). */
export function formatFractionPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}
