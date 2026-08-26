export function formatLkr(value: number): string {
  return `LKR ${Math.round(value).toLocaleString('en-LK')}`
}

export function formatPct(value: number): string {
  return `${value.toFixed(1)}%`
}
