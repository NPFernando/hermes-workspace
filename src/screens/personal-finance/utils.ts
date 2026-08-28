export function formatMoney(amount: number, currency: string): string {
  return `${currency} ${Math.round(amount).toLocaleString('en-LK')}`
}

export function formatLkr(value: number): string {
  return formatMoney(value, 'LKR')
}

export function formatPct(value: number): string {
  return `${value.toFixed(1)}%`
}
