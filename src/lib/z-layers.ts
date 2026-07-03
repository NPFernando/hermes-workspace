/**
 * Named overlay layers, lowest to highest. Use these instead of ad-hoc
 * z-[…] literals so overlays stack predictably:
 *
 *   banner   — docked, non-blocking strips (connection, credits)
 *   bell     — floating notification bell + inbox panel
 *   modal    — blocking dialogs with a backdrop
 *   toast    — transient toasts (above modals so feedback is never hidden)
 *   critical — action-required overlays that must beat everything
 */
export const Z_LAYER = {
  banner: 'z-[9600]',
  bell: 'z-[9700]',
  modal: 'z-[9998]',
  toast: 'z-[9999]',
  critical: 'z-[10000]',
} as const
