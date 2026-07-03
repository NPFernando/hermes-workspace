/**
 * Shared OS detection for keyboard-shortcut labels.
 *
 * SSR-safe: `navigator` does not exist on the server, so the module-level
 * constants fall back to non-Mac there. Only use them for cosmetic hints
 * (shortcut strings) — they are evaluated once at module load.
 */
export function detectIsMac(nav?: Pick<Navigator, 'userAgent'>): boolean {
  if (!nav) return false
  return /Mac|iPod|iPhone|iPad/.test(nav.userAgent)
}

export const isMac = detectIsMac(
  typeof navigator !== 'undefined' ? navigator : undefined,
)

/** Modifier-key label: `⌘` on Apple platforms, `Ctrl` elsewhere. */
export const MOD = isMac ? '⌘' : 'Ctrl'
