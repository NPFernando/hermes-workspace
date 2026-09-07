# Plan: Add keyboard shortcut discoverability trigger in workspace header

## Summary
The KeyboardShortcutsModal component exists and opens when pressing `?`, but there is no visible UI affordance — users must already know about the shortcut. Add a small keyboard icon button (`⌨` SVG) in the Electron title bar area that triggers the modal when clicked, making keyboard shortcuts discoverable without prior knowledge.

## Files to modify

1. **`src/components/workspace-shell.tsx`** (lines ~396–400 — Electron title bar right spacer)
   - Replace the empty right spacer div (`w-[78px] shrink-0`) with a flex container that holds a keyboard icon button alongside the spacer
   - The button dispatches a `keydown` event with `key: '?'` which the existing KeyboardShortcutsModal already handles

2. **`src/components/keyboard-shortcuts-modal.tsx`** (lines ~38–67 — `useEffect` keyboard listener)
   - Add a custom event listener for `'open-keyboard-shortcuts'` alongside the existing `keydown` listener
   - The custom event sets `isOpen(true)` directly without needing a simulated keypress

## Steps

1. **Modify keyboard-shortcuts-modal.tsx**: Add a `useEffect` that listens for a `'open-keyboard-shortcuts'` CustomEvent and sets `isOpen(true)` when received. Clean up on unmount.

2. **Modify workspace-shell.tsx**: In the Electron title bar's right spacer area, add a small keyboard icon button (`<button type="button">`) that:
   - Uses `aria-label="Keyboard shortcuts"` for accessibility
   - Shows an SVG keyboard icon (16x16)
   - Has hover styling matching the existing theme
   - On click, dispatches `new CustomEvent('open-keyboard-shortcuts')`
   - Is inside a `WebkitAppRegion: 'no-drag'` span so it doesn't interfere with title bar dragging

3. **Verify**: `npx tsc --noEmit` exits 0

## How to verify
- `npx tsc --noEmit` exits 0
- `npx vitest run src/screens/tasks/tasks-ux.test.ts` passes (no regression)
- `npx eslint --no-warn-ignored -f json src/components/workspace-shell.tsx src/components/keyboard-shortcuts-modal.tsx` shows 0 new errors
- Manual: Electron title bar shows a keyboard icon; clicking it opens the shortcuts modal