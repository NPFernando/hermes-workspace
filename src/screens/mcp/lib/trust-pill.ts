export type McpTrustLevel = 'official' | 'community' | 'unverified'

/** Shared trust-level badge styling for MCP server entries. */
export const TRUST_PILL: Record<string, { label: string; className: string }> = {
  official: {
    label: 'Official',
    className:
      'border-[var(--theme-success)] bg-[color-mix(in_srgb,var(--theme-success)_10%,transparent)] text-[var(--theme-success)]',
  },
  community: {
    label: 'Community',
    className:
      'border-[var(--theme-warning)] bg-[color-mix(in_srgb,var(--theme-warning)_10%,transparent)] text-[var(--theme-warning)]',
  },
  unverified: {
    label: 'Unverified',
    className:
      'border-[var(--theme-danger)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] text-[var(--theme-danger)]',
  },
}
