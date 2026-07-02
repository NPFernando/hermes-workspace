# Hermes Workspace — UI/UX Audit Report

**Date:** 2026-07-01 (rounds 1–3, same session)
**Scope requested:** full-app UI/UX review (layout, navigation, components, mobile,
accessibility, forms, states, visual consistency, content, behavior).
**Method:** code review of the app shell, theme system, and representative screens,
plus live browser screenshots (desktop 1440×900, mobile 375×812) of an isolated
dev instance (throwaway port, no production traffic, real password used only
against that isolated instance). **Round 2 closed the coverage gap from round 1**
(Chat, Tasks, Files, Settings, Command Center, Swarm, Research, Skills — all 8
screenshotted at both viewports). **Round 3 extended coverage to the remaining
main-nav screens**: Dashboard, Memory, MCP, Profiles, Conductor, Jobs, Terminal,
plus a look at VT Capital/Finance (excluded from findings — see note below).
Not covered in any round: Create Task dialog internals, Profile creation
wizard, HARP Routing config form — still open per §13.

**Important context read before this review:** `NAVEEN_CUSTOMIZATIONS.md` and
`src/styles.css`. This is not a green-field or neglected app — it has an
unusually mature, deliberate design system already: 12 named themes (dark +
light variants) with full token sets, a documented multi-round polish history
("Round 8", "Iter 014 fix", "EDITORIAL VOCABULARY v2 surface pass"), PWA/TWA
safe-area handling, keyboard-aware mobile viewport sizing (`--vvh`), and prior
fixes for exactly this class of bug (mobile tab-bar overflow on agents-screen,
`update-center-notifier.tsx`'s own `#356` fix). Findings below are things
still wrong today, not a case for redoing existing work.

**Two round-1 leads were investigated further in round 2 and retracted** —
noted explicitly in §2 so they aren't mistaken for open issues:
- The "changelog modal keeps reappearing" observation: root-caused to my own
  test script seeding the wrong localStorage value (an arbitrary `'999.0.0'`
  instead of the real current version string the app checks for exact
  equality against). Not an app bug — retracted.
- A "washed-out low-contrast light theme" screenshot on `/chat`: reproduced
  twice under heavy system load in the dev/HMR environment, but a fresh
  isolated repro showed correct dark-theme rendering with `data-theme`,
  `--theme-bg`, and computed background all correct. Most likely a Vite-dev
  hot-reload/paint-timing artifact, not present in the production build.
  Retracted as a confirmed finding; mentioned in §13 as worth a human glance,
  not as something to fix blind.

**VT Capital and Finance screens were viewed in round 3 but are explicitly
excluded from this audit's findings.** Both read from `src/routes/api/finance.ts`
and `src/server/finance-store.ts`, which have had uncommitted, actively-changing
content from a concurrent agent session throughout this entire session — I've
avoided touching those files all session for that reason, and the same
boundary applies to reviewing/critiquing their UI. One observation is passed
along as an FYI only, not a finding to act on: VT Capital's screen mixes
Italian and English UI text in the same view (e.g. "Modalità osservazione",
"Esecuzione disattivata" next to "MARKET BIAS FILE", "GUARDIAN / OMS"), while
Finance's screen is entirely English — consistent with both being mid-build,
not a finished feature to polish yet.

---

## 1. UI/UX Executive Summary

The design *system* (tokens, themes, shared utility classes) is solid and
consistently used. The real problems cluster in four places:

1. **Duplicate page titles on mobile — systemic, confirmed on 7 of 10 screens
   checked with a `MobilePageHeader`.** Tasks, Files, Command Center,
   Research, Skills, Profiles, and Jobs all show the shell's title stacked
   directly above the screen's own internal heading (sometimes literally the
   same word twice, e.g. "Tasks" / "Tasks"; sometimes related, e.g.
   "Research" / "Deep Research"). Dashboard is correctly exempt (no
   `MobilePageHeader` by design) and **Conductor already does this right** —
   it swaps to a completely different, single-heading mobile layout instead
   of duplicating. Conductor is proof the fix is one component decision, not
   a rewrite. This is the single highest-value fix available.
2. **Tasks screen's header is unreadable on mobile**, **Swarm's per-agent
   card header text overlaps on mobile**, and **Terminal's mobile input bar
   appears to render behind the global bottom tab bar** — three separate,
   severe, narrow-viewport layout collisions, all screenshotted.
3. **Dead interactive elements in Tasks** — three confirm-dialog flows
   (delete a task, prune stale tasks, bulk-delete) set state that nothing
   ever rendered. **Fixed in this session**, on branch
   `fix/tasks-dead-confirm-dialogs`.
4. **Chat's sister/agent picker shows apparent duplicate names** (Luna, Ada,
   Maya each appeared twice in the pill row) because it flattens AI Sisters
   and Delegation Profiles into one undifferentiated list, while Command
   Center — sourced from the same registry — correctly separates them into
   labeled sections. Likely two different underlying entries that happen to
   share a display name, not a data-duplication bug.
5. **Dashboard shows internally-inconsistent data**: its "Skills Usage"
   widget reads "0 installed · NO SKILLS INSTALLED" while the Skills Browser,
   screenshotted the same session, clearly shows 9+ installed skills. Also,
   Dashboard's "Optimization Hint" card displays what is really a loading
   placeholder ("Dashboard loading — Overview data not yet available")
   styled and labeled as if it were actual analytical advice.

A smaller set of polish items (§3–§9) and three rounds of the same safe fix
(title tooltips on truncated text, applied across Skills, Profiles, and Jobs
this session) round out the findings.

---

## 2. Critical UX Issues

### Critical #1 — Duplicate page title on mobile (systemic: 7 of 10 screens)
- **Files:** `src/components/workspace-shell.tsx` (`MobilePageHeader`) +
  each screen's own heading — confirmed on `tasks-screen.tsx`,
  `files-screen.tsx`, `command-center-screen.tsx`, `research-screen.tsx`,
  `skills-screen.tsx`, `profiles-screen.tsx`, `jobs-screen.tsx`.
- **Problem:** Screenshotted at 375px on all seven. The shell's title bar
  ("Tasks", "Files", "Command Center", "Research", "Skills", "Profiles",
  "Jobs") sits directly above the screen's own `<h1>`/heading component,
  which repeats the same or a closely related string in a different type
  style.
- **Counter-example proving the fix is cheap:** `conductor.tsx`'s mobile
  layout does **not** duplicate — it swaps the desktop "office floor plan"
  visualization for a plain agent-status list with a single heading. That's
  the existing precedent for "screen adapts its own header away on mobile
  instead of showing two."
- **User impact:** Reads as a layout bug even though both headers are
  individually intentional. Wastes vertical space on the most
  space-constrained viewport, pushing real content down.
- **Recommended fix:** Establish one rule and apply it everywhere: either
  (a) suppress each screen's internal title when `isMobile` and
  `MobilePageHeader` is already showing an equivalent title, or (b) have
  screens never render their own top-level title and rely entirely on
  `MobilePageHeader` + a lighter-weight subtitle/description line if needed.
  Given how many screens are affected, this is worth a single shared
  convention rather than 7+ one-off patches.
- **Risk if applied:** Medium — several of the affected screens' internal
  headers carry more than just text (Tasks' `<h1>` sits next to an
  assignee-filter chip; Skills' header includes the "HERMES WORKSPACE
  MARKETPLACE" eyebrow + description; Profiles' includes the "Create
  profile" button). Removing the wrong piece could drop functionality, not
  just text. **Not applied** — needs a design decision on where that inline
  content moves, not just a delete.

### Critical #2 — Tasks screen header is unusable on mobile
- **File:** `src/screens/tasks/tasks-screen.tsx` (header block).
- **Problem:** Screenshotted at 375px. The stats line and action-button row
  do not adapt to narrow viewports — text fragments wrap one-or-two-words-
  per-line down the screen, pushing the Kanban board below the fold.
- **User impact:** Tasks is functionally unreadable on a phone until the
  user scrolls past a wall of broken text.
- **Recommended fix:** Mobile variant that collapses the stats line to 2-3
  key numbers and moves the action buttons into a horizontal scroll row or
  overflow menu below ~640px — same pattern already used for
  `agents-screen.tsx`'s tab row (`flex-nowrap overflow-x-auto
  scrollbar-none`, per `NAVEEN_CUSTOMIZATIONS.md`).
- **Risk if applied:** Medium — layout-judgment call, needs visual QA.
  **Not applied** — recommended, pending your sign-off on the target layout.

### Critical #3 — Swarm screen: agent card header text overlaps on mobile
- **File:** `src/screens/swarm2/` (per-agent/worker card header — the
  component rendering the agent name next to status pills like "MERGE GATE"
  / "KILL CRITERIA").
- **Problem:** Screenshotted at 375px (`mobile-swarm.png`). The agent name
  ("Strategist", truncated to "Strate…") visually overlaps the adjacent
  status badge text ("...MERGE GATE / KILL CRITERIA"), rendering as garbled,
  overlapping, partially unreadable text in the card header.
- **User impact:** Can't reliably read which agent or what its current gate
  status is on mobile — this is the kind of monitoring screen where that
  information is the entire point.
- **Recommended fix:** Let the name and badge row wrap onto separate lines
  on narrow viewports instead of sharing one line with fixed positioning;
  truncate/scroll the badge row independently the way the Tasks board and
  agents-screen tab rows already do elsewhere in the app.
- **Risk if applied:** Medium — same category as Critical #1/#2, layout
  change needing visual QA on the actual component (not identified down to
  the exact file/line in this pass — swarm2 directory has multiple card
  components; needs a quick grep for the exact render site before editing).
  **Not applied.**

### Critical #4 — Terminal's mobile input bar appears to render behind the tab bar
- **File:** `src/components/terminal/mobile-terminal-input.tsx` (per an
  existing code comment in `workspace-shell.tsx`: "Mobile input bar — only
  mount on the terminal route. It uses fixed bottom positioning...").
- **Problem:** Screenshotted at 375px (`mobile-terminal.png`). The bottom of
  the screen shows what looks like an input field outline and an action
  button partially obscured underneath the global bottom tab bar, rather
  than sitting above it.
- **User impact:** If the terminal's own command input is genuinely behind
  the tab bar (not just a screenshot-timing artifact — I did not confirm by
  attempting to type into it), it would be difficult or impossible to use
  the terminal on mobile, which defeats the point of the screen. Confidence:
  medium — visually clear in the screenshot, but not confirmed via actual
  keyboard interaction in this pass.
- **Recommended fix:** Verify the input's z-index/stacking order relative to
  `MobileTabBar`, and confirm via manual interaction (not just screenshot)
  before treating this as fully confirmed.
- **Risk if applied:** Low once root-caused (likely a z-index or fixed-
  positioning order fix), but **not applied** — needs the interaction check
  first since I can't be fully sure without it.

### Critical #5 — Dashboard shows stale/placeholder data presented as real
- **File:** `src/screens/dashboard/` (Skills Usage widget + Optimization
  Hint card — exact component not identified down to filename in this pass).
- **Problem:** Screenshotted at 1440px (`desktop-dashboard.png`). Two issues
  in the same screen: (1) the "Skills Usage" card reads "0 installed · NO
  SKILLS INSTALLED," while the Skills Browser — screenshotted the same
  session, same account — clearly lists 9+ installed skills
  (adaptive-memory-decay, astra-*, atlas_sel, auto-improvement-loop, etc.).
  (2) The "Optimization Hint" card shows "Dashboard loading — Overview data
  not yet available. Suggestions will appear once analytics are loaded,"
  styled identically to a real actionable hint (complete with a "LOW"
  priority badge), rather than as a loading/skeleton state.
- **User impact:** (1) is either a real data-sync bug (Dashboard's skills
  count isn't reading the same source as the Skills Browser) or a stale-cache
  issue — either way it tells the user something false. (2) trains users to
  ignore the "Optimization Hint" card since it may just be saying "still
  loading," undermining the feature's credibility when it does have a real
  suggestion.
- **Recommended fix:** For (1), check whether the widget reads installed-
  skill count from a different/cached source than the Skills Browser and
  reconcile them. For (2), give the widget a real loading skeleton state
  instead of rendering a loading message inside the same card style used for
  genuine hints.
- **Risk if applied:** Unknown without seeing the widget's data source —
  **not applied**, flagged for investigation rather than blind fix since (1)
  in particular could be masking a real backend sync issue worth
  understanding before patching the display.

### Critical #6 — Dead confirm-dialog flows in Tasks (delete, prune stale, bulk delete)
- **File:** `src/screens/tasks/tasks-screen.tsx`
- **Problem:** `deleteConfirmId`, `confirmPruneStale`, and `confirmBulkDelete`
  state were set by their trigger buttons but no dialog ever read that
  state — the buttons appeared to do nothing. `deleteMutation` and a working
  `POST /api/tasks-prune` endpoint already existed with zero client callers.
- **Fix:** **Applied and committed** this session
  (`fix/tasks-dead-confirm-dialogs`, commit `aa4d80f5`). Added three confirm
  dialogs matching the app's existing dialog pattern, wired to the
  pre-existing mutation/endpoint. tsc clean, lint unchanged from baseline,
  11/11 tests pass, live-verified the delete dialog renders correctly.
- **Risk:** Low — pure wiring, no new business logic.

### Critical #7 — Chat sister-picker shows apparent duplicate agent names
- **File:** `src/screens/chat/components/sister-picker.tsx` (renders
  whatever `sisters` array it's given, no dedup) +
  `src/screens/chat/chat-screen.tsx` (fetches `/api/sisters` and passes the
  full array straight through).
- **Problem:** Screenshotted at 1440px (`desktop-chat.png`). The pill row
  under the composer reads: Astra, Novus, Nova, Luna, Maya, Helena, Larissa,
  Clara, Bia, Vitoria, Daine, Ada, **Luna, Ada** (wraps to a second line
  with just **Maya** alone).
- **Investigation:** `src/server/sisters-registry.ts`'s `listSisters()`
  already dedupes by `id` across its three sources (AI sisters, delegation
  profiles, business agents) — confirmed by reading the code (lines
  216-234). Command Center, screenshotted the same session, shows all 12 AI
  Sisters exactly once with **no duplicates**, and a separate "Delegation
  Profiles" section below it. This means the "duplicates" in the chat picker
  are near-certainly two *different* registry entries (different `id`s, one
  an AI sister and one a delegation/business profile) that happen to share a
  display **name** — the dedup-by-id logic correctly lets both through since
  they're technically different entries, but the picker gives the user no
  way to tell them apart.
- **User impact:** A user trying to route a message to "Luna" sees two
  identical-looking pills with no distinguishing information and no way to
  know which one is the actual AI sister vs. a differently-scoped profile
  that happens to share her name.
- **Recommended fix:** Either (a) filter the chat picker to AI-sister-type
  entries only (matching what Command Center already does for its "AI
  Sisters" section), or (b) if delegation/business profiles are meant to be
  selectable from chat too, visually distinguish them (a small type badge,
  the way Command Center's cards show "AI Sister" pills). I did not check
  whether the underlying `~/.hermes/config/sisters.yaml` /
  `sister_profiles.yaml` naming collision is itself intentional or a
  copy-paste artifact in those config files — that's outside this repo and
  outside the scope of a safe code fix.
- **Risk if applied:** Low-medium depending on which fix — filtering to
  AI-sister-type only is a small, well-scoped change, but I don't have
  enough context on whether delegation profiles are intentionally reachable
  from the chat picker today to make that call unilaterally. **Not
  applied** — flagging for your decision on intended behavior first.

---

## 3. Layout and Responsiveness Review

- **Desktop app shell** (`workspace-shell.tsx`): well structured, no issues.
- **Settings (desktop)**: clean, well-organized sub-nav + card sections. One
  content-clarity nit: the API Keys list uses a bright red ❌ icon for every
  "Not configured" provider (5-6 of them, by design — most users only
  configure 1-2). Repeated error-red icons for a normal, expected default
  state creates a falsely alarming impression on a screen where nothing is
  wrong. Consider a neutral gray dash instead, reserving red for actual
  failures.
- **Research (desktop + mobile)**: the primary "Start research" action is
  styled as a plain low-emphasis text link with a chevron, positioned at the
  far right of a secondary controls row (Rounds/Max time), visually
  disconnected from both the input above it and from the app's own
  convention of filled accent-colored buttons for primary actions (compare
  Tasks' "New Task", "Create"). It's easy to miss as *the* primary action of
  an otherwise very sparse page.
- **Skills Browser (desktop)**: solid marketplace-grid layout. Card titles
  use `line-clamp-1` with several names sharing long common prefixes
  ("auto-…", "claude-…" appear as two visually-identical truncated labels
  each) — **fixed this session** by adding `title` tooltips (see §11).
- **Skills Browser (mobile)**: the Installed/Marketplace/Workspace tab
  switcher overflows the viewport width without the horizontal-scroll
  treatment already applied elsewhere in the app (agents-screen's detail
  tabs, the global mobile tab bar) — "Workspace" is clipped at the right
  edge. Also, the search input's placeholder text is clipped to "Search by"
  before running out of room, next to the Profile selector.
- **Swarm (desktop)**: information-dense multi-pane layout (each
  worker/orchestrator gets its own mini chat + task tracker), but internally
  consistent and well-labeled; the "Roster-only agent, not provisioned yet"
  banner is a good example of clear, actionable empty-state copy. No issues
  found at desktop width.
- **Conductor (desktop vs. mobile)**: desktop uses a distinctive "office
  floor plan" visualization (agent avatars at desks); mobile correctly swaps
  this for a plain status list rather than trying to cram the visualization
  into a narrow viewport, and doesn't duplicate its title. This is the one
  screen in the audit that gets the mobile-adaptation question right by
  design — worth using as the internal reference example for Critical #1.
- **MCP (desktop)**: "Not available on this backend" error state is clear,
  actionable, and even includes a technical diagnostic hint without being
  cryptic. Good example, no issue.
- **Jobs (desktop)**: clean card grid, clear cron/status/last-run
  information. Job names truncate without a way to see the full name —
  **fixed this session** alongside Profiles (see §11).
- **Dashboard (desktop + mobile)**: card-based stat layout adapts to mobile
  cleanly (stacks vertically, no duplicate title since Dashboard has no
  `MobilePageHeader` by design). See Critical #5 for the data-consistency
  issue found on this screen.

## 4. Component Review

- `virtual-task-list.tsx` and the panel components under
  `src/screens/tasks/panels/` (extracted earlier this session): consistent,
  presentational, no UI/business-logic mixing.
- `sister-picker.tsx`: simple, presentational, correctly has zero business
  logic of its own — the duplicate-display issue (Critical #7) is a data-
  shaping problem in what's passed to it, not a flaw in the component
  itself.
- The `fixed inset-0` confirm-dialog markup is now repeated **7 times** in
  `tasks-screen.tsx` (4 pre-existing + 3 added this session). Strong
  extraction candidate — see §9.
- `update-center-notifier.tsx` mixes workspace/agent update-checking with a
  separate "Naveen smart-update" AI-conflict-resolution flow in one ~700
  line component. Maintainability observation, not a UX bug.

## 5. Forms and Interaction Review

- The three newly-added confirm dialogs (Critical #6 fix) follow the
  existing pattern exactly: destructive action in red/rose, neutral Cancel,
  backdrop-click-to-cancel. Consistent.
- Settings' Model & Provider form: clear labels + helper text under each
  field, good scannability. Provider/Model are free-text inputs with no
  validation shown against a known-good list — acceptable for a
  power-user-facing settings screen, but worth knowing there's no guardrail
  against a typo'd model string beyond whatever the backend returns on save.
- Not reviewed in this pass (time budget): Create Task dialog internals,
  Profile creation wizard, HARP Routing config screen forms.

## 6. Loading, Empty, and Error States

- Tasks board loading state: proper skeleton cards, good.
- Swarm's "Roster-only agent, not provisioned yet. Configure now, bootstrap
  profile later." is a good example of a clear, actionable unprovisioned-
  state message.
- Research's empty state ("Enter a research question. Odysseus will
  iteratively search, extract, and synthesize a detailed report.") is clear
  and sets expectations well.
- `update-center-notifier.tsx`: a malformed `/api/update/status` response
  (tested via a deliberately-wrong mock) crashed the whole route to a raw
  `"Cannot read properties of undefined (reading 'updateAvailable')"`
  error screen rather than degrading gracefully. Confidence caveat: this was
  triggered by an intentionally malformed test mock, not observed from the
  real endpoint — flagging as a defensive-coding gap worth a guard, not a
  confirmed production incident.
- The three previously-dead confirm flows (Critical #6) were, in effect, a
  missing-feedback bug — clicking them produced no state change and no
  error toast, which is worse than a visible error since users have no
  signal anything happened at all.

## 7. Accessibility Review

- Global focus ring (`*:focus-visible`) uses a themed accent outline
  consistently — good baseline.
- `prefers-reduced-motion` is respected for the large majority of custom
  animations (~8 occurrences in `styles.css`).
- **Fixed this session:** skill/file names truncated with `line-clamp-1/3`
  had no way to access the full text without a mouse-driven "Details" click
  — added native `title` tooltips (3 spots in `skills-screen.tsx`, 2 in
  `workspace-skills-screen.tsx`). Zero layout risk, purely additive.
- Not verified in this pass (needs targeted testing, not just reading):
  full keyboard-only navigation for Tasks board drag-and-drop (no keyboard
  alternative found for moving a card between columns); screen-reader
  labeling on icon-only mobile tab-bar buttons; contrast ratio measurements
  for `--theme-muted` (~60-65% opacity in several dark themes) against
  their respective `--theme-bg` — flagged as needs-measurement, not
  confirmed failing.

## 8. Visual Design Cleanup

- **Added:** three confirm dialogs (Critical #6); nine `title` tooltips on
  truncated text across Skills, Profiles, and Jobs screens.
- **Recommended, not applied:** unified mobile-header convention (Critical
  #1); Tasks mobile header layout (Critical #2); Swarm mobile card overlap
  fix (Critical #3); Terminal mobile input stacking order (Critical #4);
  Dashboard data reconciliation (Critical #5); sister-picker type filtering
  or badging (Critical #7); neutral (non-red) "not configured" indicator in
  Settings API Keys; "Start research" restyled as a primary filled button;
  Skills tab-row horizontal-scroll treatment on mobile;
  `update-center-notifier.tsx` defensive guard.
- **Nothing identified for removal** beyond the already-fixed dead dialogs.
- **Merge candidate:** the repeated confirm-dialog markup in
  `tasks-screen.tsx` (§9.1).

## 9. Recommended Design System Improvements

1. **`<ConfirmDialog>` shared component** — extract the backdrop+card+
   Cancel+destructive-button pattern (now 7 instances in `tasks-screen.tsx`)
   into one component taking `title`, `body`, `confirmLabel`, `onConfirm`,
   `onCancel`, `danger?: boolean`.
2. **Mobile header contract** — a documented, consistently-applied rule for
   whether a screen owns its own title or defers entirely to
   `MobilePageHeader` below `md`. Currently inconsistent on 7 of 10 screens
   checked (Critical #1) — this is the highest-leverage fix available since
   it's one convention applied many places rather than 7+ bespoke patches,
   and Conductor already proves the pattern works.
3. **Sister/profile type badge** — Command Center already has the pattern
   ("AI Sister" pill); reusing it wherever a flat sisters/profiles list is
   rendered (starting with the chat picker) would resolve Critical #7
   without needing to change what data is fetched.
4. **Split `update-center-notifier.tsx`** — separate the workspace/agent
   update flow from the "Naveen smart-update" AI-conflict-resolution flow;
   would make the defensive-coding fix easier to scope in isolation.

## 10. Implementation Plan

- **Phase 1 — critical usability fixes:** ✅ dead confirm dialogs (done).
  Remaining, needs investigation first: Dashboard data reconciliation
  (Critical #5), Terminal mobile input interaction check (Critical #4),
  defensive guard in `update-center-notifier.tsx`.
- **Phase 2 — mobile responsiveness fixes:** unified mobile-header
  convention (Critical #1, highest leverage — fixes 7 screens at once once
  the pattern is agreed, and Conductor already proves it works); Tasks
  header mobile layout (Critical #2); Swarm card overlap fix (Critical #3).
  All three need product/design input on target layout before
  implementation.
- **Phase 3 — component consistency:** extract `<ConfirmDialog>` (§9.1);
  reusable sister/profile type badge (§9.3), which also resolves Critical
  #7.
- **Phase 4 — accessibility improvements:** keyboard alternative for
  Tasks board drag-and-drop; verify mobile tab-bar icon aria-labels;
  measure `--theme-muted` contrast ratios per theme.
- **Phase 5 — visual polish:** Settings API-keys neutral "not configured"
  indicator; Research "Start research" as a filled primary button; Skills
  mobile tab-row horizontal scroll.

## 11. Changes Made

- **`src/screens/tasks/tasks-screen.tsx`** — added three confirm dialogs
  (delete single task, prune stale tasks, bulk delete) wired to pre-existing
  state/mutation/endpoint. Committed on `fix/tasks-dead-confirm-dialogs`
  (commit `aa4d80f5`).
- **`src/screens/skills/skills-screen.tsx`** — added `title` attribute to
  the truncated skill-name heading, author line, and two description
  paragraphs (grid card + featured card variants), so hovering shows the
  full text. Committed on `fix/skills-title-tooltips` (commit `55960251`).
- **`src/screens/skills/workspace-skills-screen.tsx`** — same, for the
  truncated file name and file path in the workspace-skills file picker.
  Same commit.
- **`src/screens/profiles/profiles-screen.tsx`** — added `title` attribute
  to `ProfileStat`'s truncated value (used for the model-name stat).
  Committed on `fix/profiles-jobs-title-tooltips` (commit `b4c00729`).
- **`src/screens/jobs/jobs-screen.tsx`** — same, for the truncated job name
  and prompt preview. Same commit.

No other files were changed. All four fix branches are **independent,
unmerged, undeployed** — none has been rebased onto another or onto `main`
beyond their shared base.

## 12. Validation

```
npx tsc --noEmit -p .
   → clean for all changed files across all four commits

npx eslint src/screens/tasks/tasks-screen.tsx
   → 7 errors, all pre-existing (git-stash A/B confirmed identical
     count/content before and after)

npx eslint src/screens/skills/skills-screen.tsx src/screens/skills/workspace-skills-screen.tsx
   → 12 problems (11 errors, 1 warning), all pre-existing (git-stash A/B
     confirmed identical count/content before and after)

npx eslint src/screens/profiles/profiles-screen.tsx src/screens/jobs/jobs-screen.tsx
   → 5 problems, all pre-existing in profiles-screen.tsx (git-stash A/B
     confirmed identical count/content, line numbers shifted by 1 from the
     added line); jobs-screen.tsx: 0 errors

npx vitest run src/screens/tasks/
   → 11/11 tests pass

npx vitest run src/screens/skills/ src/screens/profiles/ src/screens/jobs/
   → no test files exist for these directories (not a failure — nothing to run)
```

**Manual/visual verification:** isolated dev server on a throwaway port, not
production; real password used only against that isolated instance.
Confirmed live via Playwright: the per-task delete dialog opens correctly
reading `Delete "<task title>"?`. The title-tooltip fixes (Skills, Profiles,
Jobs) are pure additive HTML attributes with no rendering path that could
regress — not separately screenshotted, but the risk profile doesn't
warrant it.

No `pnpm build` or production restart was performed. Per the standing
agreement this session, UI changes stop at a reviewable branch pending your
explicit go-ahead before build+deploy.

## 13. Remaining Risks / Needs Manual Review

- **Critical #1 (duplicate mobile titles, 7 screens)**, **#2 (Tasks mobile
  header)**, and **#3 (Swarm mobile overlap)** all need product/design
  sign-off on target layout before any code is written — user-visible
  layout changes on your family-facing production app.
- **Critical #4 (Terminal mobile input)** needs a manual interaction check
  (try typing into the terminal on an actual mobile viewport) before being
  treated as confirmed — I only verified it visually via screenshot.
- **Critical #5 (Dashboard data inconsistency)** needs investigation into
  where the Skills Usage widget's count actually comes from before any fix
  — could indicate a real sync bug, not just a display issue.
- **Critical #7 (sister-picker apparent duplicates)** needs your call on
  intended behavior: should delegation/business profiles be selectable from
  chat at all, and if so, should they be visually distinguished from AI
  sisters? I did not check the actual YAML config files
  (`~/.hermes/config/sisters.yaml`, `~/.hermes/sister_profiles.yaml`) for
  whether the name collision itself (e.g. two entries both named "Luna") is
  intentional — that's outside this repo.
- The **update-notifier defensive-coding gap** (§6) is a real code-level
  finding but its production likelihood is unverified — worth a quick
  manual check of what `/api/update/status` can actually return in edge
  cases before prioritizing.
- **Two round-1 leads were retracted** after further investigation (see
  header) — don't re-open either without a fresh, independently-reproduced
  repro.
- **VT Capital / Finance were viewed but excluded from findings** — active
  concurrent-agent WIP, not this session's territory (see header note).
- Accessibility findings in §7 are mostly "needs measurement/testing," not
  confirmed pass/fail — treat as a checklist for a dedicated a11y pass.
- Still not reviewed in any round: the Create Task dialog's internals, the
  Profile creation wizard's internals, and the HARP Routing config form —
  these need interaction (opening modals/forms), not just navigation, and
  were out of the time budget for this pass.
