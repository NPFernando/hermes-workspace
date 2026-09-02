/** Shared row-accessor and presentation helpers used across Personal Finance panels. */

export function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

export function numberField(row: Record<string, unknown>, key: string): number {
  const value = row[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function optionalNumberField(
  row: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = row[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function boolField(row: Record<string, unknown>, key: string): boolean {
  return row[key] === true
}

export function splitTags(value: string): Array<string> {
  return value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

export function toneFor(percent: number): { bar: string; text: string } {
  if (percent >= 100) return { bar: 'bg-emerald-400', text: 'text-emerald-200' }
  if (percent >= 50) return { bar: 'bg-sky-400', text: 'text-sky-200' }
  return { bar: 'bg-amber-400', text: 'text-amber-200' }
}
