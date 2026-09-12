export type HarpSelectorCell = {
  available: boolean
  provider?: string
  model?: string
  tier?: string
  decision?: string
  reason?: string
  error?: string
}

export type HarpSelectorPreview = {
  tasks: Array<string>
  risks: Array<string>
  generated_at: string
  matrix: Array<{ risk: string; cells: Array<HarpSelectorCell> }>
}

const PREVIEW_URL = 'http://127.0.0.1:5052/api/harp/selector-preview'
const PREVIEW_TIMEOUT_MS = 20_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is Array<string> {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && item.length > 0)
  )
}

function isPreviewCell(value: unknown): value is HarpSelectorCell {
  if (!isRecord(value) || typeof value.available !== 'boolean') return false
  if (!value.available)
    return value.error === undefined || typeof value.error === 'string'
  return (
    ['provider', 'model', 'tier', 'decision'].every(
      (key) => typeof value[key] === 'string' && value[key].length > 0,
    ) &&
    (value.reason === undefined || typeof value.reason === 'string')
  )
}

export function parseHarpSelectorPreview(
  value: unknown,
): HarpSelectorPreview | null {
  if (
    !isRecord(value) ||
    !isStringArray(value.tasks) ||
    !isStringArray(value.risks)
  )
    return null
  if (typeof value.generated_at !== 'string' || !Array.isArray(value.matrix))
    return null
  if (value.matrix.length !== value.risks.length) return null

  const matrix: HarpSelectorPreview['matrix'] = []
  for (let index = 0; index < value.risks.length; index += 1) {
    const row = value.matrix[index]
    if (
      !isRecord(row) ||
      row.risk !== value.risks[index] ||
      !Array.isArray(row.cells)
    )
      return null
    if (
      row.cells.length !== value.tasks.length ||
      !row.cells.every(isPreviewCell)
    )
      return null
    matrix.push({ risk: row.risk, cells: row.cells })
  }

  return {
    tasks: value.tasks,
    risks: value.risks,
    generated_at: value.generated_at,
    matrix,
  }
}

export async function loadHarpSelectorPreview(
  fetcher: typeof fetch = fetch,
): Promise<HarpSelectorPreview> {
  const response = await fetcher(PREVIEW_URL, {
    method: 'GET',
    cache: 'no-store',
    signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS),
  })
  if (!response.ok)
    throw new Error('HARP selector preview service is unavailable')
  const preview = parseHarpSelectorPreview(await response.json())
  if (!preview)
    throw new Error('HARP selector preview returned an invalid matrix')
  return preview
}
