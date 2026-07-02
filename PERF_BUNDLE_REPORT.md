# Bundle Performance Analysis — Client Entry Chunk

**Date:** 2026-07-02 · **Method:** `vite build --sourcemap` on `main` (7e9888e8) in an
isolated worktree, analyzed with `source-map-explorer` (98.4% of bytes mapped).

## Headline

The eager client entry (`main-*.js`) is **2,152 KB minified** — downloaded and parsed
before anything renders, on every route. Route-level code splitting *works*
(dashboard/tasks/swarm/conductor etc. have their own chunks; mermaid/cytoscape/xterm
lazy-load correctly). The weight is structural: app code and libraries that should be
on-demand are statically reachable from the shell.

## Composition (top contributors)

| KB | % | What | Why it's eager |
|---|---|---|---|
| 388 | 18.0 | `src/components/**` | Shell statically imports heavy components (below) |
| 306 | 14.2 | `src/screens/**` | **chat 259 KB + settings 46 KB** leak past route splitting |
| 187 | 8.7 | `@base-ui/react` | UI primitives — legitimately eager |
| 178 | 8.3 | `react-dom` | Framework — legitimate |
| 124 | 5.8 | `parse5` | HTML parser, dragged in by the markdown pipeline (chat) |
| 123 | 5.7 | `motion-dom` **+** `framer-motion` | **Two animation libraries** shipped together |
| 62 | 2.9 | `@tanstack/router-core` | Framework — legitimate |
| 65 | 3.0 | `react-floater` + `popper.js` | Tour/onboarding library, needed only on first-run |
| 67 | 3.1 | `marked` **+** micromark stack | **Two markdown parsers** shipped together |
| 78 | 3.6 | `@shikijs/*` core | Syntax highlighting core (languages split correctly) |
| 53 | 2.4 | `zod` | Validation — used at boot, legitimate |

Eager app components worth naming: `agent-view` 45 KB, `settings-dialog` 40 KB,
`usage-meter` 29 KB, `onboarding` 25 KB, `orchestrator-avatar` 20 KB,
`update-center-notifier` 18 KB.

## Ranked proposals (not implemented — pick and I'll build them)

1. **Lazy-mount `ChatPanel` on non-chat routes** (`workspace-shell.tsx` imports it
   statically). Chat-on-`/chat` staying eager is a fair product call — but every
   *other* route currently pays 259 KB of chat screen plus the markdown pipeline
   (parse5, micromark, shiki core ≈ 230 KB more) at first paint.
   *Estimated: −300–450 KB from main. Risk: low-medium (Suspense fallback for the
   side panel; chat route itself unaffected).*

2. **Dedup animation libraries.** `motion` (v12, `motion-dom`) and `framer-motion`
   are both bundled — almost certainly one legacy import path left behind.
   *Estimated: −30–90 KB. Risk: low (grep + swap imports, visual QA on animations).*

3. **Dedup markdown parsers.** `marked` and the micromark/react-markdown stack both
   ship. One consumer of `marked` can likely move to the existing pipeline.
   *Estimated: −40 KB. Risk: low.*

4. **Lazy the deferred-need components:** `settings-dialog` (open-on-click),
   `onboarding` + `react-floater` tour (first-run only), `agent-view`,
   `usage-meter`, `update-center-notifier` (idle-mount).
   *Estimated: −150–200 KB combined. Risk: low (each is an isolated `lazy()` +
   `Suspense` at an interaction boundary).*

Realistic combined outcome: **main ≈ 1.2–1.4 MB** (−35–45%) without touching the
chat-route experience.

## Non-issues (checked, fine as-is)

- Route chunks exist and load on navigation; server bundle size (2.9 MB) is a
  server-side concern only, no user download.
- `cpp/wasm/wardley/mermaid/cytoscape/AreaChart/xterm` chunks are correctly lazy.
- gzip serving is enabled (`.gz` assets present); 2,152 KB ships as ~600 KB wire,
  but parse cost on mobile is the real tax.
