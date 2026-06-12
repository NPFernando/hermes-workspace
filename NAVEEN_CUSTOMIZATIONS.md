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
| `server-entry.js` | Added `Cache-Control: no-store` on HTML responses so stale chunk errors never recur after a rebuild | Submitted as part of good practices — not yet a PR | Adopt upstream if they add similar cache headers; otherwise keep ours |
| `src/components/settings/settings-sidebar.tsx` | Added `'harp'` nav id and "HARP Routing" sidebar item | Part of PR #626 | If upstream merges PR #626 with the same sidebar entry, drop our commit |
| `src/routes/api/harp-config.ts` | New API route: GET/PATCH for HARP config | Part of PR #626 | Adopt upstream's version if merged; compare feature parity first |
| `src/routes/api/personality-swarm.ts` | New API route: GET presets + POST apply personality to swarm | Not yet submitted upstream | Keep unless upstream ships a similar endpoint |
| `src/routes/settings/index.tsx` | Render `<HarpConfigScreen>` when `activeSection === 'harp'` | Part of PR #626 | Drop if upstream merges PR #626 |
| `src/screens/profiles/profiles-screen.tsx` | Extended wizard from 3 → 4 steps: added Personality + Swarm distribution step | Not yet submitted upstream | Keep; upstream doesn't have this feature yet |
| `src/screens/settings/harp-config-screen.tsx` | New settings screen: full HARP tiered routing config UI | Part of PR #626 | Compare with upstream's version if merged — adopt theirs if feature-complete |
| `src/server/harp-config-store.ts` | New server module: HARP config read/write/patch with multi-path auto-discovery | Part of PR #626 | Adopt upstream's version if merged |
| `src/server/personality-swarm-store.ts` | New server module: personality presets + swarm distribution logic | Not yet submitted upstream | Keep; upstream doesn't have this feature yet |

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
