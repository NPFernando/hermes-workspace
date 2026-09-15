#!/usr/bin/env python3
"""
upstream-sync.py — Pull upstream hermes-workspace changes into Naveen's fork.

Usage:
  python3 scripts/upstream-sync.py            # check only; never apply
  python3 scripts/upstream-sync.py --check    # only check, report, never apply
  python3 scripts/upstream-sync.py --status   # report local cached refs only

The historical in-place rebase/build/restart/push path is retired. Use
fork_sync_assistant.py preview for an isolated assessment; integrate updates
manually only after reviewing its report.

Telegram notifications are sent to the Monitoring topic (14) on success, the
Approvals topic (23) when conflicts require review.
"""

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────

REPO_DIR = Path("/home/ubuntu/hermes-workspace")
UPSTREAM_REMOTE = "upstream"
UPSTREAM_BRANCH = "main"
UPSTREAM_REF = f"{UPSTREAM_REMOTE}/{UPSTREAM_BRANCH}"
LOG_DIR = Path("/home/ubuntu/.hermes/logs")
LOG_FILE = LOG_DIR / "workspace-sync.log"

# Telegram targets (from harp-config.yaml / watchdog.py convention)
TG_MONITORING = "telegram:-1003820054153:14"   # Monitoring topic
TG_APPROVALS = "telegram:-1003820054153:23"    # Approvals topic

# Files that carry Naveen-specific customisations. Upstream touching any of
# these is a signal to review before auto-applying. See NAVEEN_CUSTOMIZATIONS.md
# for the full story behind each file.
CUSTOM_FILES = [
    "server-entry.js",
    "src/components/settings/settings-sidebar.tsx",
    "src/routes/api/harp-config.ts",
    "src/routes/api/personality-swarm.ts",
    "src/routes/settings/index.tsx",
    "src/screens/profiles/profiles-screen.tsx",
    "src/screens/settings/harp-config-screen.tsx",
    "src/server/harp-config-store.ts",
    "src/server/personality-swarm-store.ts",
]

# Known upstream PRs that correspond to our local commits. When upstream merges
# one of these we should DROP our local commit and use upstream's version.
UPSTREAM_PR_SIGNALS = {
    "harp": ["harp", "tiered routing", "routing config", "harp-routing", "harp_vm"],
    "personality-swarm": ["personality", "swarm wizard", "personality preset"],
}

# ── Utilities ─────────────────────────────────────────────────────────────────

def run(cmd, *, cwd=REPO_DIR, capture=True, check=True):
    r = subprocess.run(cmd, cwd=cwd, capture_output=capture, text=True)
    if check and r.returncode != 0:
        raise RuntimeError(f"Command failed: {' '.join(cmd)}\n{r.stderr}")
    return r

def git(*args, **kwargs):
    return run(["git"] + list(args), **kwargs)

def log(msg):
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    line = f"[{ts}] {msg}"
    print(line)
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")

def notify(target, message):
    """Send a Telegram message via hermes_tools if available, else curl fallback."""
    try:
        # Try hermes_tools first (cleanest)
        import importlib.util
        if importlib.util.find_spec("hermes_tools") is not None:
            from hermes_tools import send_message  # type: ignore
            send_message(target=target, message=message)
            return
    except Exception:
        pass

    # Fallback: direct Telegram Bot API call
    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    if not bot_token:
        # Try loading from hermes .env
        env_file = Path("/home/ubuntu/.hermes/.env")
        if env_file.exists():
            for line in env_file.read_text().splitlines():
                if line.startswith("TELEGRAM_BOT_TOKEN="):
                    bot_token = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break

    if not bot_token:
        log("WARNING: cannot send Telegram notification (no TELEGRAM_BOT_TOKEN)")
        return

    # Parse "telegram:-1003820054153:14" -> chat_id=-1003820054153, thread_id=14
    parts = target.split(":")
    chat_id = parts[1] if len(parts) >= 2 else parts[0].replace("telegram", "")
    thread_id = parts[2] if len(parts) >= 3 else None

    import urllib.request, urllib.parse
    payload: dict = {
        "chat_id": chat_id,
        "text": message,
        "parse_mode": "HTML",
    }
    if thread_id:
        payload["message_thread_id"] = int(thread_id)

    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{bot_token}/sendMessage",
        data=data,
        headers={"Content-Type": "application/json"},
    )
    try:
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        log(f"WARNING: Telegram notification failed: {e}")

# ── Git helpers ───────────────────────────────────────────────────────────────

def current_branch():
    return git("rev-parse", "--abbrev-ref", "HEAD").stdout.strip()

def merge_base(a, b):
    return git("merge-base", a, b).stdout.strip()

def new_upstream_commits():
    """Return list of (hash, subject) for commits in upstream not yet in HEAD."""
    raw = git("log", f"HEAD..{UPSTREAM_REF}", "--oneline", "--no-merges").stdout.strip()
    if not raw:
        return []
    return [line.split(" ", 1) for line in raw.splitlines()]

def upstream_touched_our_files():
    """Return list of our custom files that upstream has changed since our base."""
    base = merge_base("HEAD", UPSTREAM_REF)
    changed = git("diff", "--name-only", f"{base}..{UPSTREAM_REF}").stdout.strip().splitlines()
    return [f for f in CUSTOM_FILES if f in changed]

def detect_merged_prs(commits):
    """Check commit subjects for signals that upstream merged our PRs."""
    merged = []
    subjects = " ".join(s.lower() for _, s in commits)
    for key, signals in UPSTREAM_PR_SIGNALS.items():
        if any(sig in subjects for sig in signals):
            merged.append(key)
    return merged

# ── Notification messages ─────────────────────────────────────────────────────

def msg_up_to_date():
    return "✅ <b>hermes-workspace</b>: already up to date with upstream. No action needed."

def msg_check_only(commits, touched, merged_prs):
    lines = [f"🔍 <b>hermes-workspace upstream check</b>"]
    lines.append(f"<b>{len(commits)} new upstream commits available</b>")
    if touched:
        lines.append(f"\n⚠️ <b>Our custom files touched by upstream:</b>")
        for f in touched:
            lines.append(f"  • {f}")
    if merged_prs:
        lines.append(f"\n🎉 <b>Our PRs likely merged upstream:</b> {', '.join(merged_prs)}")
        lines.append("  → Consider adopting upstream version and dropping local commit")
    lines.append(f"\n<b>Top commits:</b>")
    for h, s in commits[:10]:
        lines.append(f"  <code>{h[:7]}</code> {s}")
    lines.append("\nReview with the isolated fork-sync preview, then integrate manually after reviewing the report.")
    return "\n".join(lines)

def msg_conflict(commits, conflict_files, touched, merged_prs):
    lines = [f"⚠️ <b>hermes-workspace: update requires review</b>"]
    lines.append(f"<b>{len(commits)} upstream commits</b> conflict with local customisations.")
    lines.append(f"\n<b>Conflicted files:</b>")
    for f in conflict_files:
        marker = " ← our custom" if f in CUSTOM_FILES else ""
        lines.append(f"  • {f}{marker}")
    if merged_prs:
        lines.append(f"\n🎉 <b>Our PRs appear merged upstream:</b> {', '.join(merged_prs)}")
        lines.append("  → Upstream version may be better — review NAVEEN_CUSTOMIZATIONS.md")
    lines.append(f"\n<b>Upstream commits:</b>")
    for h, s in commits[:8]:
        lines.append(f"  <code>{h[:7]}</code> {s}")
    lines.append(f"\n<b>To resolve:</b>")
    lines.append("  1. SSH into the VM")
    lines.append("  2. cd /home/ubuntu/hermes-workspace")
    lines.append("  3. Review: git fetch origin && git log HEAD..origin/main --oneline")
    lines.append("  4. Decide per file: keep ours or adopt upstream")
    lines.append("  5. Run scripts/fork_sync_assistant.py preview in a disposable assessment, then resolve and merge manually.")
    lines.append(f"\nSee NAVEEN_CUSTOMIZATIONS.md for the guide.")
    return "\n".join(lines)

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Sync hermes-workspace with upstream")
    parser.add_argument("--check", action="store_true", help="Check only, never apply")
    parser.add_argument("--apply", action="store_true", help="Deprecated and disabled; use the isolated preview then merge manually")
    parser.add_argument("--status", action="store_true", help="Print status and exit")
    parser.add_argument("--notify", action="store_true", help="Explicitly send the report to Telegram")
    args = parser.parse_args()

    if args.apply:
        print("Refusing in-place update: automatic rebase/build/restart/push is retired. Run scripts/fork_sync_assistant.py preview, review the report, then merge manually.", file=sys.stderr)
        return 2

    os.chdir(REPO_DIR)
    branch = current_branch()

    if args.status:
        commits = new_upstream_commits()
        touched = upstream_touched_our_files()
        merged_prs = detect_merged_prs(commits)
        print(f"Branch:          {branch}")
        print(f"Upstream commits ahead: {len(commits)}")
        print(f"Our custom files touched by upstream: {touched or 'none'}")
        print(f"Upstream may have merged our PRs: {merged_prs or 'none'}")
        print("Status uses cached refs only; no fetch or merge was performed.")
        return 0

    # Checking may update local remote-tracking refs, but never edits the
    # working tree, starts tests, restarts services, pushes, or sends messages.
    git("fetch", UPSTREAM_REMOTE, "--no-tags")
    commits = new_upstream_commits()

    if not commits:
        print("Already up to date; no worktree, build, service, push, or notification actions taken.")
        return 0

    touched = upstream_touched_our_files()
    merged_prs = detect_merged_prs(commits)
    report = msg_check_only(commits, touched, merged_prs)
    print(report)
    if args.notify:
        notify(TG_MONITORING, report)
    return 0

if __name__ == "__main__":
    sys.exit(main())
