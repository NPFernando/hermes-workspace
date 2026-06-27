# Respect Reduced Motion in Mobile Tab Navigation

## Summary of the change
Improve the mobile tab bar accessibility polish by honoring the operating system `prefers-reduced-motion` setting when the active tab is scrolled into view. While touching the same UI, make the active tab's accessible label explicit so screen-reader users hear which destination is the current page.

## Files to modify
- `src/components/mobile-tab-bar.tsx`

## Steps
1. In the route-change effect that calls `scrollIntoView`, check `window.matchMedia('(prefers-reduced-motion: reduce)').matches`.
2. Use `behavior: 'auto'` when reduced motion is requested and keep `behavior: 'smooth'` otherwise.
3. Update each tab button `aria-label` so active tabs announce `"<label> (current page)"` while inactive tabs keep their existing label.
4. Do not modify unrelated service or submodule files.

## How to verify the change works
- Run `npx tsc --noEmit --pretty false` from `/home/ubuntu/hermes-workspace`.
- Run focused lint on the changed file with `npx eslint -f json src/components/mobile-tab-bar.tsx` and confirm there are no errors.
- Run `git diff --check` to catch whitespace issues.
- Optionally run `pnpm build`; this cycle should not restart services unless the source change is committed and deployment is explicitly needed.

## Rollback procedure
Revert the commit or restore `src/components/mobile-tab-bar.tsx` from the previous revision, then rerun TypeScript and focused lint.
