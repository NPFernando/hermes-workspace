#!/usr/bin/env python3
"""
upstream-sync.py — Pull upstream hermes-workspace changes into Naveen's fork.

Usage:
  python3 scripts/upstream-sync.py            # auto mode: check + apply if safe
  python3 scripts/upstream-sync.py --check    # only check, report, never apply
  python3 scripts/upstream-sync.py --apply    # apply even if our files are touched
  python3 scripts/upstream-sync.py --status   # print current sync status and exit

Telegram notifications are sent to the Monitoring topic (14) on success, the
Approvals topic (23) when conflicts require review.
"""

import argparse
import json
import os
import subprocess
import sys
import textwrap
from datetime import datetime, timezone
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────

REPO_DIR = Path("/home/ubuntu/hermes-workspace")
BRANCH = "feat/harp-routing-config-ui"
UPSTREAM_REMOTE = "origin"
UPSTREAM_BRANCH = "main"
UPSTREAM_REF = f"{UPSTREAM_REMOTE}/{UPSTREAM_BRANCH}"
NAVEEN_REMOTE = "naveen"
SERVICE = "hermes-workspace.service"
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

def stash_working_tree():
    """Stash if there are uncommitted changes. Returns True if stashed."""
    status = git("status", "--porcelain").stdout.strip()
    if status:
        git("stash", "push", "-m", "upstream-sync auto-stash")
        return True
    return False

def pop_stash():
    try:
        git("stash", "pop", check=False)
    except Exception:
        pass

# ── Core operations ───────────────────────────────────────────────────────────

def do_rebase():
    """
    Rebase current branch onto upstream/main.
    Returns (success: bool, conflict_files: list[str])
    """
    r = subprocess.run(
        ["git", "rebase", UPSTREAM_REF],
        cwd=REPO_DIR, capture_output=True, text=True
    )
    if r.returncode == 0:
        return True, []

    # Collect conflicted files
    conflict_files = []
    status = subprocess.run(
        ["git", "diff", "--name-only", "--diff-filter=U"],
        cwd=REPO_DIR, capture_output=True, text=True
    ).stdout.strip().splitlines()
    conflict_files = status

    subprocess.run(["git", "rebase", "--abort"], cwd=REPO_DIR, capture_output=True)
    return False, conflict_files

def do_build():
    """Run vite build. Returns (success: bool, output: str)"""
    log("Building...")
    pnpm = Path("/home/ubuntu/.hermes/node/bin/pnpm")
    build_cmd = [str(pnpm), "run", "build"] if pnpm.exists() else ["npm", "run", "build"]
    r = subprocess.run(build_cmd, cwd=REPO_DIR, capture_output=True, text=True, timeout=300)
    output = r.stdout[-3000:] + r.stderr[-1000:]
    return r.returncode == 0, output

def do_restart():
    """Restart the workspace systemd service."""
    r = subprocess.run(
        ["sudo", "systemctl", "restart", SERVICE],
        capture_output=True, text=True
    )
    return r.returncode == 0

def push_to_naveen_fork():
    """Push updated branch to Naveen's personal fork."""
    try:
        git("push", NAVEEN_REMOTE, f"{BRANCH}:{BRANCH}", "--force-with-lease", check=False)
    except Exception as e:
        log(f"WARNING: push to naveen fork failed: {e}")

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
    lines.append(f"\nRun <code>python3 scripts/upstream-sync.py --apply</code> to merge.")
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
    lines.append("  5. python3 scripts/upstream-sync.py --apply")
    lines.append(f"\nSee NAVEEN_CUSTOMIZATIONS.md for the guide.")
    return "\n".join(lines)

def msg_build_failed(commits, build_output):
    return "\n".join([
        "❌ <b>hermes-workspace: build failed after rebase</b>",
        f"Upstream rebase applied ({len(commits)} commits) but <code>vite build</code> failed.",
        "Reverted to previous state. Manual fix needed.",
        f"\n<b>Build error (last 800 chars):</b>",
        f"<pre>{build_output[-800:]}</pre>",
    ])

def msg_success(commits, touched, merged_prs, build_time_s):
    lines = [f"✅ <b>hermes-workspace updated</b>"]
    lines.append(f"<b>{len(commits)} upstream commits</b> rebased + built + restarted ({build_time_s:.0f}s)")
    if touched:
        lines.append(f"\n⚡ <b>Custom files merged cleanly:</b>")
        for f in touched:
            lines.append(f"  • {f}")
    if merged_prs:
        lines.append(f"\n🎉 <b>Our PRs merged upstream:</b> {', '.join(merged_prs)}")
        lines.append("  → Local commits now redundant; clean up when convenient")
    lines.append(f"\n<b>Changes applied:</b>")
    for h, s in commits[:10]:
        lines.append(f"  <code>{h[:7]}</code> {s}")
    if len(commits) > 10:
        lines.append(f"  … and {len(commits)-10} more")
    return "\n".join(lines)

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Sync hermes-workspace with upstream")
    parser.add_argument("--check", action="store_true", help="Check only, never apply")
    parser.add_argument("--apply", action="store_true", help="Apply even if custom files touched")
    parser.add_argument("--status", action="store_true", help="Print status and exit")
    parser.add_argument("--quiet", action="store_true", help="Suppress Telegram if up-to-date")
    args = parser.parse_args()

    os.chdir(REPO_DIR)
    branch = current_branch()
    log(f"Starting upstream sync (branch={branch})")

    # 1. Fetch
    log("Fetching upstream...")
    git("fetch", UPSTREAM_REMOTE)

    # 2. Check for new commits
    commits = new_upstream_commits()

    if args.status:
        touched = upstream_touched_our_files()
        merged_prs = detect_merged_prs(commits)
        print(f"Branch:          {branch}")
        print(f"Upstream commits ahead: {len(commits)}")
        print(f"Our custom files touched by upstream: {touched or 'none'}")
        print(f"Upstream may have merged our PRs: {merged_prs or 'none'}")
        return

    if not commits:
        log("Already up to date.")
        if not args.quiet:
            notify(TG_MONITORING, msg_up_to_date())
        return

    log(f"Found {len(commits)} new upstream commits.")
    touched = upstream_touched_our_files()
    merged_prs = detect_merged_prs(commits)

    if merged_prs:
        log(f"Our PRs appear merged upstream: {merged_prs}")
    if touched:
        log(f"Upstream touches our custom files: {touched}")

    # 3. Check-only mode
    if args.check:
        log("--check mode: reporting only, not applying.")
        notify(TG_MONITORING, msg_check_only(commits, touched, merged_prs))
        return

    # 4. If upstream touched our files and we're not in --apply mode, ask for review
    if touched and not args.apply:
        log("Custom file conflict detected — sending review request, not auto-applying.")
        # Do a trial rebase to find actual conflict files
        stashed = stash_working_tree()
        ok, conflict_files = do_rebase()
        if stashed:
            pop_stash()
        if not ok:
            notify(TG_APPROVALS, msg_conflict(commits, conflict_files, touched, merged_prs))
            log("Review required. Notified Approvals topic.")
            sys.exit(2)
        # Rebase was actually clean even though files were touched (no overlap in lines)
        log("Files touched but rebase was clean — proceeding.")

    # 5. Apply
    prev_head = git("rev-parse", "HEAD").stdout.strip()
    stashed = stash_working_tree()

    ok, conflict_files = do_rebase()
    if stashed:
        pop_stash()

    if not ok:
        log(f"Rebase failed. Conflicts: {conflict_files}")
        notify(TG_APPROVALS, msg_conflict(commits, conflict_files, touched, merged_prs))
        sys.exit(2)

    log("Rebase clean. Building...")
    t0 = datetime.now(timezone.utc)
    build_ok, build_out = do_build()
    build_time = (datetime.now(timezone.utc) - t0).total_seconds()

    if not build_ok:
        log("Build failed — reverting rebase.")
        git("reset", "--hard", prev_head)
        notify(TG_MONITORING, msg_build_failed(commits, build_out))
        sys.exit(3)

    log("Build succeeded. Restarting service...")
    restart_ok = do_restart()
    if not restart_ok:
        log("WARNING: service restart failed — check systemctl status hermes-workspace.service")

    # 6. Push updated branch to Naveen's fork
    push_to_naveen_fork()

    log(f"Sync complete ({len(commits)} commits, {build_time:.0f}s build).")
    notify(TG_MONITORING, msg_success(commits, touched, merged_prs, build_time))

if __name__ == "__main__":
    main()
