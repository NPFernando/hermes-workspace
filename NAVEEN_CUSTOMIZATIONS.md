# Naveen's Workspace Customizations

This file is the source of truth for every change made on top of upstream
`outsourc-e/hermes-workspace`. It is read by `scripts/upstream-sync.py` to
decide what needs review when upstream changes those files.

---

## How to use this file during an upstream update

When `upstream-sync.py` reports that upstream touched one of our files:

1. **Read the table below** — understand what our change does and which upstream PR it maps to.
2. **Check whether upstream merged our PR** — if yes, their version is at least as good; drop our local commit and use theirs.
3. **If upstream has a different/better solution** — adopt theirs, update this file, remove the local commit.
4. **If ours is still needed and doesn't conflict** — resolve the merge conflict keeping our additions.

---

## Custom files

| File | What we changed | Upstream PR | Decision rule |
|------|----------------|-------------|---------------|
| `server-entry.js` | Added `Cache-Control: no-store` on HTML responses so stale chunk errors never recur after a rebuild | Not yet submitted | Adopt upstream if they add similar cache headers; otherwise keep ours |
| `src/components/settings/settings-sidebar.tsx` | Added `'harp'` nav id and "HARP Routing" sidebar item | Part of PR #626 | If upstream merges PR #626 with the same sidebar entry, drop our commit |
| `src/components/update-center-notifier.tsx` | Added Naveen smart-update card + conflict resolution modal with AI analysis | Personal customization | Keep always; upstream won't have this |
| `src/routes/api/harp-config.ts` | New API route: GET/PATCH for HARP config | Part of PR #626 | Adopt upstream's version if merged; compare feature parity first |
| `src/routes/api/personality-swarm.ts` | New API route: GET presets + POST apply personality to swarm | Not yet submitted upstream | Keep unless upstream ships a similar endpoint |
| `src/routes/settings/index.tsx` | Render `<HarpConfigScreen>` when `activeSection === 'harp'` | Part of PR #626 | Drop if upstream merges PR #626 |
| `src/screens/profiles/profiles-screen.tsx` | Extended wizard from 3 → 4 steps: added Personality + Swarm distribution step | Not yet submitted upstream | Keep; upstream doesn't have this feature yet |
| `src/screens/settings/harp-config-screen.tsx` | Full HARP tiered routing config screen + `CapWidget` for day/week/month cap selector | Part of PR #626 | Compare with upstream's version if merged — adopt theirs if feature-complete |
| `src/server/harp-config-store.ts` | New server module: HARP config read/write/patch with multi-path auto-discovery | Part of PR #626 | Adopt upstream's version if merged |
| `src/server/personality-swarm-store.ts` | New server module: personality presets + swarm distribution logic | Not yet submitted upstream | Keep; upstream doesn't have this feature yet |
| `src/server/tasks-store.ts` | Added `agent_state`, `agent_name`, `agent_action_at`, `source` fields to `TaskRecord` | Not yet submitted upstream | If upstream adds agent task fields, merge carefully — check field naming |
| `src/lib/tasks-api.ts` | Added same 4 agent fields to the client-facing `ClaudeTask` interface | Not yet submitted upstream | Keep in sync with `tasks-store.ts` changes |
| `src/screens/tasks/task-card.tsx` | Added `AgentStateBadge`, `SourceBadge`, purple shimmer bar when agent is active | Not yet submitted upstream | Keep; upstream doesn't have agent-animated task cards yet |
| `src/screens/tasks/tasks-screen.tsx` | Added "Ask Astra" + "Add Ideas" buttons, adaptive polling (4s/30s), agent-active stats | Not yet submitted upstream | Keep; upstream doesn't have Astra review trigger in UI |
| `src/server/sisters-registry.ts` | NEW — unified sister registry: reads sisters.yaml + sister_profiles.yaml, bootstraps profiles on first API call | Personal customization | Keep always |
| `src/routes/api/sisters.ts` | NEW — GET /api/sisters: returns full sister list; triggers lazy bootstrap | Personal customization | Keep always |
| `src/routes/api/sisters-bootstrap.ts` | NEW — POST /api/sisters/bootstrap: force-bootstrap one or all sisters | Personal customization | Keep always |
| `src/routes/api/profiles/list.ts` | Added bootstrapOnceLazy() call so sisters auto-appear on first Operations load | Personal customization | Keep; drop if upstream adds sister auto-bootstrap |
| `src/screens/agents/hooks/use-operations.ts` | Added SisterInfo type, fetchSisters(), sistersQuery, sisterMap — exposes sister personality data to Operations UI | Personal customization | Keep; upstream doesn't have sisters concept |
| `src/screens/agents/operations-screen.tsx` | Split agents grid into AI Sisters + Agents sections; added Invite Sister button; passes sisterInfo to cards | Personal customization | Keep; merge carefully if upstream changes Operations layout |
| `src/screens/agents/components/operations-agent-card.tsx` | Added PersonalityBadge component + sisterInfo prop — shows role/tier pill on sister agent cards | Personal customization | Keep; upstream doesn't have personality badges |
| `src/screens/swarm2/operational-worker-card.tsx` | Added ROLE_TO_SISTER map + PersonalityBadge component — shows sister name/emoji badge per worker role | Personal customization | Keep; upstream doesn't have personality badges |
| `src/screens/agents/components/agent-bus-panel.tsx` | De-hardcoded action buttons — thumbnail + handoff targets now driven by /api/sisters data | Personal customization | Keep; upstream doesn't have sisters-driven agent bus |
| `src/server/sisters-growth.ts` | NEW — growth log engine: appendGrowthEntry, getGrowthLog, getGrowthLevel, updateSisterDescription, registerSisterCron (writes to ~/.hermes/cron/jobs.json) | Personal customization | Keep always |
| `src/routes/api/sisters-improve.ts` | NEW — POST /api/sisters/improve: sisters update own personality note + description + create cron jobs | Personal customization | Keep always |
| `src/routes/api/sisters-growth.ts` | NEW — GET /api/sisters/growth?id=: returns growth log and level for a sister | Personal customization | Keep always |
| `src/server/sisters-registry.ts` | EXTEND — Sister type now includes growthLevel/growthLabel/growthEmoji/growthEntryCount/lastNote from growth log | Personal customization | Keep; merge carefully if upstream changes Sister type |
| `src/screens/agents/components/operations-agent-card.tsx` | EXTEND PersonalityBadge — second mini pill shows growth level emoji+label (🌱 Seed → 💫 Transcendent) | Personal customization | Keep; upstream doesn't have growth tracking |
| `services/odysseus/` | NEW — Odysseus companion service (cloned from NPFernando/odysseus); provides Deep Research, Model Compare, Cookbook, Email, Calendar, Gallery, TTS/STT, Documents, Notes APIs on :7100 | Personal customization | Keep always; not upstream |
| `services/odysseus/.env` | NEW — Odysseus runtime config: AUTH_ENABLED=false, LLM_HOST→:8642, port 7100 | Personal customization | Keep always |
| `scripts/start-odysseus.sh` | NEW — production launcher for Odysseus (activates venv, starts uvicorn on :7100) | Personal customization | Keep always |
| `src/routes/api/odysseus.$.ts` | NEW — catch-all proxy /api/odysseus/** → http://127.0.0.1:7100/api/**; Hermes auth enforced at perimeter | Personal customization | Keep always |
| `src/routes/research.tsx` | NEW — /research route (Deep Research UI) | Personal customization | Keep always |
| `src/screens/research/research-screen.tsx` | NEW — Deep Research screen: query form, SSE progress stream, result renderer, past research library | Personal customization | Keep always |
| `src/screens/chat/components/chat-sidebar.tsx` | Added Telescope02Icon import + Research nav item in mainItems | Personal customization | Keep; merge if upstream changes sidebar structure |
| `src/components/mobile-tab-bar.tsx` | Added Research tab (Telescope02Icon, /research) to MOBILE_NAV_TABS | Personal customization | Keep; merge if upstream changes tab bar |
| `vite.config.ts` | Added startOdysseus() auto-start: spawns services/odysseus venv uvicorn, health check, SIGTERM on dev stop | Personal customization | Keep; merge carefully if upstream changes vite plugin structure |
| `package.json` | start:all now includes `bash scripts/start-odysseus.sh` via concurrently | Personal customization | Keep; merge if upstream changes start:all |

---

## HARP Routing (PR #626)

**Our commit:** `fccb0ada feat(settings): HARP tiered model routing config UI`

**Upstream PR:** https://github.com/outsourc-e/hermes-workspace/pull/626

**What it does:** Settings page to manage HARP VM's tiered model routing config
(`harp-config.yaml`). Reads/writes the config live, shows all 5 tiers, blocklist,
global toggles, and auto-improve settings.

**Key design decision — multi-path auto-discovery:**
The store probes 6 paths in priority order so the feature works for any user
without hardcoding. The `HARP_CONFIG_PATH` env var overrides all.

**If upstream merges PR #626:**
- Their version may be identical (we submitted it) or improved.
- If identical: our local commit becomes redundant. Run:
  ```bash
  git rebase origin/main   # should apply cleanly, drop the commit
  ```
- If upstream improved it: adopt their version and drop ours.

---

## Personality + Swarm Wizard

**Our commit:** `f962f4bc feat(profiles): personality wizard with swarm distribution`

**Upstream PR:** Not yet submitted.

**What it does:** Extends the Create Profile wizard with a step 3 (Personality &
Swarm) where you pick a personality preset, customize the prompt, toggle swarm
distribution, and set per-worker personalities with role-based recommendations.
Astra is treated as the main agent.

**If upstream ships something similar:**
Compare their implementation. Key things to check:
- Do they support role-based preset recommendations per worker?
- Do they support the Astra-as-main pattern?
- Do they write `display.personality` to the correct profile paths?

---

## Upgrade decision cheatsheet

```
Upstream touched our file?
  ├─ Yes, and it's a PR we submitted → Test if upstream version replaces ours fully.
  │     If yes: git checkout origin/main -- <file> during rebase conflict
  │     If no:  manually merge, keeping our additions
  └─ Yes, but it's our local-only feature → Resolve conflict keeping our code,
        then re-run: python3 scripts/upstream-sync.py --apply
```

---

## Adding a new customization

When you add a new file or modify an existing one for a personal/instance-specific
reason, add a row to the table above and commit this file together with the change.
