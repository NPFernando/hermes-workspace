import fs from 'node:fs'

const css =
  fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8') +
  fs.readFileSync(new URL('../src/scifi-theme.css', import.meta.url), 'utf8')
const failures = []

function parseColor(value) {
  if (!value) return null
  const hex = value.match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    return [0, 2, 4].map((offset) =>
      Number.parseInt(hex[1].slice(offset, offset + 2), 16),
    )
  }
  const rgba = value.match(
    /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/,
  )
  if (rgba)
    return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])]
  return null
}

function blend(foreground, background) {
  const alpha = foreground[3] ?? 1
  return foreground
    .slice(0, 3)
    .map((channel, index) => channel * alpha + background[index] * (1 - alpha))
}

function luminance(rgb) {
  const channels = rgb.map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function contrast(first, second) {
  const high = Math.max(luminance(first), luminance(second))
  const low = Math.min(luminance(first), luminance(second))
  return (high + 0.05) / (low + 0.05)
}

const themeBlocks = new Map()
for (const [, theme, block] of css.matchAll(
  /^\[data-theme='([^']+)'\]\s*\{([\s\S]*?)^\}/gm,
)) {
  // Later grouped token-remap selectors can also end in `[data-theme=...] {`;
  // only the theme-definition block has its own background token.
  if (!block.match(/^\s*--theme-bg:/m) || themeBlocks.has(theme)) continue
  themeBlocks.set(theme, block)
}
for (const [theme, block] of themeBlocks) {
  const values = Object.fromEntries(
    [
      ...block.matchAll(
        /^\s*--theme-(bg|text|muted|accent|link|focus):\s*([^;]+);/gm,
      ),
    ].map((match) => [match[1], match[2].trim()]),
  )
  const background = parseColor(values.bg)
  if (!background) {
    failures.push(
      `${theme}: unsupported background color ${values.bg ?? '<missing>'}`,
    )
    continue
  }
  for (const [name, minimum] of [
    ['text', 4.5],
    ['muted', 4.5],
    ['accent', 3],
    ['link', 4.5],
  ]) {
    const parsed = parseColor(values[name])
    if (!parsed) {
      failures.push(
        `${theme}: unsupported ${name} color ${values[name] ?? '<missing>'}`,
      )
      continue
    }
    const ratio = contrast(blend(parsed, background), background)
    if (ratio < minimum)
      failures.push(
        `${theme}: ${name} contrast ${ratio.toFixed(2)}:1 < ${minimum}:1`,
      )
  }
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log(`theme contrast check passed (${themeBlocks.size} themes)`)
