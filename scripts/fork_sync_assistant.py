#!/usr/bin/env python3
"""Inspect fork updates in a disposable Git worktree; never merge or push."""

from __future__ import annotations

import argparse
import json
import os
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

MAX_UNTRACKED_FILE_BYTES = 64 * 1024 * 1024
MAX_HISTORY_DEEPEN = 2000


def run_git(repo: Path, *args: str, check: bool = True, input_text: str | None = None,
            timeout: int = 30) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        ["git", *args], cwd=repo, input=input_text, capture_output=True,
        text=True, timeout=timeout, check=False,
    )
    if check and result.returncode:
        message = result.stderr.strip() or result.stdout.strip() or "git command failed"
        raise RuntimeError(message[:1000])
    return result


def is_git_repo(path: Path) -> bool:
    return run_git(path, "rev-parse", "--show-toplevel", check=False).returncode == 0


def remote_urls(repo: Path) -> dict[str, str]:
    names = run_git(repo, "remote").stdout.splitlines()
    return {
        name: run_git(repo, "remote", "get-url", name).stdout.strip()
        for name in names
    }


def github_repo_slug(value: str) -> str | None:
    """Return owner/repo for a github.com HTTPS or SCP-style remote URL."""
    if value.startswith("git@github.com:"):
        path = value.split(":", 1)[1]
    else:
        parsed = urlsplit(value)
        if parsed.hostname != "github.com":
            return None
        path = parsed.path.lstrip("/")
    path = path.removesuffix(".git").strip("/")
    parts = path.split("/")
    if len(parts) != 2 or not all(parts):
        return None
    return f"{parts[0]}/{parts[1]}"


def safe_remote_url(value: str) -> str:
    """Remove URL credentials and query strings before displaying a remote."""
    if value.startswith("git@"):
        return value
    parsed = urlsplit(value)
    if not parsed.scheme:
        return value
    host = parsed.hostname or ""
    if parsed.port:
        host = f"{host}:{parsed.port}"
    return urlunsplit((parsed.scheme, host, parsed.path, "", ""))


def github_fork_metadata(
    repo: Path, remotes: dict[str, str] | None = None
) -> tuple[bool | None, str | None]:
    gh = shutil.which("gh")
    if not gh:
        return None, None
    candidates = [
        (name, slug)
        for name, url in (remotes or {}).items()
        if (slug := github_repo_slug(url)) is not None
    ]
    # Ask GitHub about each configured repository explicitly. `gh repo view`
    # without a slug follows its preferred remote (usually origin), which may
    # be the parent while the actual fork is named `fork` or `upstream`.
    candidates.sort(key=lambda item: (item[0] not in {"fork", "upstream", "origin"}, item[0]))
    if not candidates:
        candidates = [("", "")]
    first_known: tuple[bool, str | None] | None = None
    for _name, slug in candidates:
        command = [gh, "repo", "view"]
        if slug:
            command.append(slug)
        command.extend(["--json", "isFork,parent"])
        result = subprocess.run(
            command, cwd=repo, capture_output=True, text=True, timeout=12,
            env={**os.environ, "GH_PAGER": "cat"}, check=False,
        )
        if result.returncode:
            continue
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError:
            continue
        parent = payload.get("parent")
        parent_name = parent.get("nameWithOwner") if isinstance(parent, dict) else None
        if not isinstance(parent_name, str) and isinstance(parent, dict):
            owner = parent.get("owner")
            owner_login = owner.get("login") if isinstance(owner, dict) else None
            repo_name = parent.get("name")
            if isinstance(owner_login, str) and isinstance(repo_name, str):
                parent_name = f"{owner_login}/{repo_name}"
        is_fork = payload.get("isFork") is True
        if is_fork:
            return True, parent_name if isinstance(parent_name, str) else None
        if first_known is None:
            first_known = (False, parent_name if isinstance(parent_name, str) else None)
    return first_known if first_known is not None else (None, None)


def inspect_repo(repo: Path) -> dict[str, object]:
    root_result = run_git(repo, "rev-parse", "--show-toplevel", check=False)
    if root_result.returncode:
        return {"path": str(repo), "isGitRepository": False, "fork": "unknown"}
    root = Path(root_result.stdout.strip()).resolve()
    remotes = remote_urls(root)
    origin = remotes.get("origin")
    upstream = remotes.get("upstream")
    is_fork, parent = github_fork_metadata(root, remotes)
    parent_slug = parent.casefold() if parent else None
    parent_remote = next(
        (
            name for name, url in remotes.items()
            if parent_slug and (slug := github_repo_slug(url)) is not None
            and slug.casefold() == parent_slug
        ),
        None,
    )
    distinct_upstream_pair = bool(
        origin and upstream and safe_remote_url(origin) != safe_remote_url(upstream)
    )
    if is_fork is True:
        fork_state = "confirmed"
    elif distinct_upstream_pair:
        # Keep GitHub's isFork signal separate: a repository can be maintained
        # as a downstream fork without being marked as a GitHub fork.
        fork_state = "configured-upstream-pair"
    elif is_fork is False:
        fork_state = "configured-upstream-pair" if distinct_upstream_pair else "not-a-fork"
    else:
        fork_state = "unknown"
    fork_remote = next(
        (name for name in ("fork", "origin", "upstream") if name in remotes and name != parent_remote),
        next((name for name in remotes if name != parent_remote), None),
    ) if is_fork is True else None
    selected_upstream = parent_remote or ("upstream" if "upstream" in remotes else None)
    branch = run_git(root, "branch", "--show-current", check=False).stdout.strip() or None
    status = run_git(root, "status", "--porcelain=v1", "--untracked-files=all").stdout
    result: dict[str, object] = {
        "path": str(root),
        "isGitRepository": True,
        "fork": fork_state,
        "githubIsFork": is_fork,
        "parent": parent,
        "branch": branch,
        "dirty": bool(status),
        "remotes": {name: safe_remote_url(url) for name, url in remotes.items()},
        "upstreamRemoteConfigured": selected_upstream is not None or distinct_upstream_pair,
        "upstreamRemote": selected_upstream,
        "forkRemote": fork_remote,
    }
    if selected_upstream:
        result["previewCommand"] = f"{Path(__file__).name} preview --repo {root} --remote {selected_upstream}"
    elif fork_state == "confirmed":
        result["nextStep"] = "Configure an upstream remote for the reported parent, then run preview; no remote was changed."
    return result


def scan_root(root: Path, max_depth: int = 2) -> list[dict[str, object]]:
    root = root.resolve()
    candidates = [root]
    if root.is_dir():
        for current, dirs, _files in os.walk(root):
            current_path = Path(current)
            depth = len(current_path.relative_to(root).parts)
            dirs[:] = [d for d in dirs if d not in {".git", "node_modules", ".venv", ".next", "dist"}]
            if depth >= max_depth:
                dirs[:] = []
                continue
            if (current_path / ".git").exists():
                candidates.append(current_path)
                dirs[:] = []
    unique = sorted({candidate.resolve() for candidate in candidates if candidate.exists()})
    results = [inspect_repo(path) for path in unique]
    return [item for item in results if item.get("isGitRepository")]


def render_summary(payload: object) -> str:
    """Render a concise operator report while keeping JSON as the full record."""
    if isinstance(payload, list):
        rows = [
            f'{item.get("path", "unknown")}: fork={item.get("fork", "unknown")}, '
            f'branch={item.get("branch") or "detached"}, '
            f'dirty={item.get("dirty", False)}, '
            f'upstream-configured={item.get("upstreamRemoteConfigured", False)}'
            for item in payload
            if isinstance(item, dict)
        ]
        return "\n".join(rows) or "No Git repositories found."
    if not isinstance(payload, dict):
        return json.dumps(payload, indent=2)

    status = str(payload.get("status", "unknown"))
    lines = [
        f'Decision: {payload.get("recommendation", "manual-review")} (status: {status})'
    ]
    freshness = payload.get("upstreamRefFreshness")
    if freshness == "cached-potentially-stale":
        lines.append(
            "Upstream freshness: cached remote-tracking ref; it may be stale. "
            "Treat this as a preliminary review, not merge approval."
        )
    elif freshness == "fetched":
        lines.append("Upstream freshness: fetched for this preview")
    for key, label in (
        ("repo", "Repository"),
        ("branch", "Branch"),
        ("upstreamBranch", "Upstream branch"),
    ):
        if payload.get(key):
            lines.append(f"{label}: {payload[key]}")
    for key, label in (("head", "Local commit"), ("upstreamHead", "Upstream commit")):
        value = payload.get(key)
        if isinstance(value, str) and value:
            lines.append(f"{label}: {value[:12]}")
    if "localCommitsAhead" in payload or "upstreamCommitsAhead" in payload:
        lines.append(
            "Commit delta: "
            f'{payload.get("localCommitsAhead", "?")} local ahead, '
            f'{payload.get("upstreamCommitsAhead", "?")} upstream ahead'
        )

    for key, label in (
        ("dirtyTrackedFiles", "Dirty tracked files"),
        ("untrackedFiles", "Untracked files"),
        ("untrackedFilesIncluded", "Untracked files included in scratch"),
        ("untrackedFilesExcluded", "Untracked files excluded"),
        ("localCommittedFilesChanged", "Local committed paths changed"),
        ("upstreamFilesChanged", "Upstream paths changed"),
        ("overlappingFiles", "Overlapping paths"),
    ):
        values = payload.get(key)
        if isinstance(values, list):
            lines.append(f"{label}: {len(values)}")
            if key in {"overlappingFiles", "untrackedFiles", "untrackedFilesExcluded"} and values:
                shown = ", ".join(str(value) for value in values[:5])
                remainder = len(values) - min(5, len(values))
                lines.append(f"  {shown}" + (f", +{remainder} more" if remainder else ""))

    conflicts = payload.get("conflictFiles")
    if isinstance(conflicts, list) and conflicts:
        lines.append("Conflicts: " + ", ".join(str(value) for value in conflicts))
    rebase_simulation = payload.get("rebaseSimulation")
    if rebase_simulation == "no-conflicts":
        lines.append("Rebase simulation: no conflicts in the disposable worktree")
    elif rebase_simulation == "conflicts":
        lines.append("Rebase simulation: conflicts detected in the disposable worktree")
    preservation = payload.get("customChangePreservation")
    if isinstance(preservation, dict):
        lines.append(
            "Custom-change preservation: "
            f'{preservation.get("status", "unknown")} '
            f'(committed {len(preservation.get("committedPaths", [])) if isinstance(preservation.get("committedPaths"), list) else "?"}, '
            f'untracked included {len(preservation.get("untrackedPathsIncluded", [])) if isinstance(preservation.get("untrackedPathsIncluded"), list) else "?"}, '
            f'excluded {len(preservation.get("untrackedPathsExcluded", [])) if isinstance(preservation.get("untrackedPathsExcluded"), list) else "?"})'
        )
    risk_flags = payload.get("riskFlags")
    if isinstance(risk_flags, list) and risk_flags:
        lines.append("Risk flags: " + ", ".join(str(value) for value in risk_flags))
    exclusion_reasons = payload.get("untrackedExclusionReasons")
    if isinstance(exclusion_reasons, list) and exclusion_reasons:
        lines.append("Excluded paths need separate review:")
        for item in exclusion_reasons[:5]:
            if isinstance(item, dict):
                lines.append(f'  {item.get("path", "unknown")}: {item.get("reason", "not snapshotted")}')
        if len(exclusion_reasons) > 5:
            lines.append(f"  +{len(exclusion_reasons) - 5} more excluded paths")
    if status == "partial-preview-manual-review":
        lines.append("Preview scope is partial; checks cannot justify merging excluded local paths.")
    if status == "shallow-history-incomplete":
        lines.append(
            "History is shallow; no merge base was found, so Git cannot distinguish "
            "unrelated histories from an omitted common ancestor. Deepen history and preview again."
        )

    tests = payload.get("tests")
    if isinstance(tests, list) and tests:
        passed = sum(
            1 for item in tests
            if isinstance(item, dict) and item.get("exitCode") == 0
        )
        lines.append(f"Checks: {passed}/{len(tests)} passed")
        for item in tests:
            if not isinstance(item, dict) or item.get("exitCode") == 0:
                continue
            command = item.get("command")
            rendered = shlex.join(command) if isinstance(command, list) else "unknown command"
            lines.append(f"  Failed check: {rendered[:180]} (exit {item.get('exitCode', '?')})")
    elif status == "conflicts":
        lines.append("Checks: not run because replay stopped at a conflict")
    else:
        lines.append("Checks: not run; supply --check-command for isolated checks")

    lines.extend((
        f'Scratch worktree used: {bool(payload.get("scratchWorktreeUsed", False))}',
        f'Merge applied: {bool(payload.get("mergeApplied", False))}',
        f'Pushed: {bool(payload.get("pushed", False))}',
    ))
    details = payload.get("details")
    if isinstance(details, str) and details:
        first_line = details.splitlines()[0].strip()
        if first_line:
            lines.append(f"Detail: {first_line[:240]}")
    return "\n".join(lines)


def porcelain_paths(repo: Path) -> tuple[list[str], list[str]]:
    raw = run_git(repo, "status", "--porcelain=v1", "--untracked-files=all").stdout
    tracked: list[str] = []
    for line in raw.splitlines():
        if len(line) < 4:
            continue
        filename = line[3:]
        if not line.startswith("??"):
            tracked.append(filename.split(" -> ")[-1])
    untracked_raw = subprocess.run(
        ["git", "ls-files", "--others", "--exclude-standard", "-z"],
        cwd=repo,
        capture_output=True,
        check=True,
    ).stdout
    untracked = [os.fsdecode(path) for path in untracked_raw.split(b"\0") if path]
    return sorted(set(tracked)), sorted(set(untracked))


def copy_untracked_files(
    source_repo: Path, worktree: Path, paths: list[str]
) -> tuple[list[str], list[dict[str, str]]]:
    """Copy safe untracked leaves and report unsafe paths individually."""
    source_root = source_repo.resolve()
    worktree_root = worktree.resolve()
    included: list[str] = []
    excluded: list[dict[str, str]] = []
    for raw_path in paths:
        destination: Path | None = None
        destination_created = False
        try:
            relative = Path(raw_path)
            if relative.is_absolute() or ".." in relative.parts or not relative.parts:
                raise RuntimeError("Unsafe untracked path refused during scratch copy.")
            source = source_root / relative
            source_parent = source.parent.resolve(strict=True)
            if not source_parent.is_relative_to(source_root):
                raise RuntimeError("Untracked path resolves outside the source repository.")
            source_info = source.lstat()
            source_mode = source_info.st_mode
            if stat.S_ISDIR(source_mode):
                raise RuntimeError("Directories and nested repositories are not copied.")
            if stat.S_ISREG(source_mode) and source_info.st_size > MAX_UNTRACKED_FILE_BYTES:
                raise RuntimeError(
                    f"File exceeds the {MAX_UNTRACKED_FILE_BYTES // (1024 * 1024)} MiB preview limit."
                )

            destination_parent = worktree_root
            for component in relative.parts[:-1]:
                destination_parent = destination_parent / component
                if os.path.lexists(destination_parent):
                    if destination_parent.is_symlink() or not destination_parent.is_dir():
                        raise RuntimeError("Untracked path crosses a non-directory in scratch.")
                else:
                    destination_parent.mkdir()
                if not destination_parent.resolve(strict=True).is_relative_to(worktree_root):
                    raise RuntimeError("Untracked path resolves outside the scratch worktree.")

            destination = worktree_root / relative
            if os.path.lexists(destination):
                raise RuntimeError("An untracked path already exists in the scratch worktree.")
            if stat.S_ISLNK(source_mode):
                os.symlink(os.readlink(source), destination)
            elif stat.S_ISREG(source_mode):
                descriptor = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
                with os.fdopen(descriptor, "rb") as source_stream:
                    actual_info = os.fstat(source_stream.fileno())
                    actual_mode = actual_info.st_mode
                    if not stat.S_ISREG(actual_mode):
                        raise RuntimeError("An untracked file changed type during preview.")
                    if actual_info.st_size > MAX_UNTRACKED_FILE_BYTES:
                        raise RuntimeError(
                            f"File exceeds the {MAX_UNTRACKED_FILE_BYTES // (1024 * 1024)} MiB preview limit."
                        )
                    with destination.open("xb") as destination_stream:
                        destination_created = True
                        copied = 0
                        while chunk := source_stream.read(
                            min(1024 * 1024, MAX_UNTRACKED_FILE_BYTES + 1 - copied)
                        ):
                            copied += len(chunk)
                            if copied > MAX_UNTRACKED_FILE_BYTES:
                                raise RuntimeError(
                                    f"File exceeds the {MAX_UNTRACKED_FILE_BYTES // (1024 * 1024)} MiB preview limit."
                                )
                            destination_stream.write(chunk)
                        os.fchmod(destination_stream.fileno(), stat.S_IMODE(actual_mode))
            else:
                raise RuntimeError("Only regular files and symlinks can be snapshotted safely.")
            included.append(raw_path)
        except OSError as error:
            if destination_created and destination is not None:
                destination.unlink(missing_ok=True)
            excluded.append({"path": raw_path, "reason": f"Snapshot failed: {error}"})
        except RuntimeError as error:
            if destination_created and destination is not None:
                destination.unlink(missing_ok=True)
            excluded.append({"path": raw_path, "reason": str(error)})
    return included, excluded


def resolve_branch(
    repo: Path, remote: str, branch: str | None, *, use_cached: bool = False
) -> tuple[str, bool]:
    resolved_from_cache = use_cached
    if branch:
        candidate = branch
    elif use_cached:
        symbolic = run_git(
            repo, "symbolic-ref", "--quiet", "--short", f"refs/remotes/{remote}/HEAD",
            check=False,
        )
        candidate = symbolic.stdout.strip().removeprefix(f"{remote}/")
        cached = run_git(
            repo, "show-ref", "--verify", "--quiet", f"refs/remotes/{remote}/{candidate}",
            check=False,
        ) if candidate else None
        if not candidate or cached is None or cached.returncode:
            current = run_git(repo, "branch", "--show-current", check=False).stdout.strip()
            current_ref = run_git(
                repo, "show-ref", "--verify", "--quiet", f"refs/remotes/{remote}/{current}",
                check=False,
            ) if current else None
            candidate = current if current_ref and current_ref.returncode == 0 else ""
    else:
        try:
            remote_head = run_git(
                repo, "-c", "http.version=HTTP/1.1", "ls-remote", "--symref",
                remote, "HEAD", check=False, timeout=25,
            )
        except subprocess.TimeoutExpired:
            remote_head = subprocess.CompletedProcess([], 124, "", "timed out")
        candidate = ""
        if remote_head.returncode == 0:
            for line in remote_head.stdout.splitlines():
                if line.startswith("ref: refs/heads/") and line.endswith("\tHEAD"):
                    candidate = line.removeprefix("ref: refs/heads/").removesuffix("\tHEAD")
                    break
        else:
            # Still allow a useful offline comparison when remote HEAD cannot
            # be queried. The report will identify the cached ref as stale.
            symbolic = run_git(
                repo, "symbolic-ref", "--quiet", "--short", f"refs/remotes/{remote}/HEAD",
                check=False,
            )
            candidate = symbolic.stdout.strip().removeprefix(f"{remote}/")
            if not candidate:
                current = run_git(repo, "branch", "--show-current", check=False).stdout.strip()
                current_ref = run_git(
                    repo, "show-ref", "--verify", "--quiet", f"refs/remotes/{remote}/{current}",
                    check=False,
                ) if current else None
                candidate = current if current_ref and current_ref.returncode == 0 else ""
            resolved_from_cache = bool(candidate)
    if not candidate or run_git(repo, "check-ref-format", "--branch", candidate, check=False).returncode:
        raise RuntimeError(
            "Could not determine a valid upstream branch from its HEAD or cached matching branch; "
            "specify --branch."
        )
    return candidate, resolved_from_cache


def checked_branch(
    repo: Path, remote: str, branch: str | None, *, use_cached: bool = False
) -> str:
    """Compatibility wrapper returning only the selected branch name."""
    return resolve_branch(repo, remote, branch, use_cached=use_cached)[0]


def tracking_remote_branch(repo: Path) -> tuple[str, str] | None:
    """Return the current branch's configured remote and branch, if any."""
    current = run_git(repo, "branch", "--show-current", check=False).stdout.strip()
    if not current:
        return None
    remote = run_git(repo, "config", f"branch.{current}.remote", check=False).stdout.strip()
    merge_ref = run_git(repo, "config", f"branch.{current}.merge", check=False).stdout.strip()
    if not remote or remote == "." or not merge_ref.startswith("refs/heads/"):
        return None
    return remote, merge_ref.removeprefix("refs/heads/")


def preview(repo: Path, remote: str, branch: str | None,
            check_commands: list[str], use_cached: bool = False) -> dict[str, object]:
    root_result = run_git(repo, "rev-parse", "--show-toplevel", check=False)
    if root_result.returncode:
        raise RuntimeError("--repo is not inside a Git repository.")
    root = Path(root_result.stdout.strip()).resolve()
    remotes = remote_urls(root)
    if remote not in remotes:
        raise RuntimeError(f"Remote {remote!r} is not configured; preview skipped.")
    selected_branch, branch_from_cache = resolve_branch(root, remote, branch, use_cached=use_cached)
    upstream_ref = f"refs/remotes/{remote}/{selected_branch}"
    fetch_fallback_reason: str | None = None
    if use_cached:
        cached = run_git(root, "show-ref", "--verify", "--quiet", upstream_ref, check=False)
        if cached.returncode:
            raise RuntimeError(
                f"No cached upstream ref exists for {remote}/{selected_branch}; "
                "run an online preview when the upstream is reachable."
            )
    else:
        fetch_ref = f"+refs/heads/{selected_branch}:{upstream_ref}"
        try:
            fetch = run_git(root, "fetch", "--no-tags", remote, fetch_ref, check=False, timeout=90)
        except subprocess.TimeoutExpired:
            fetch = subprocess.CompletedProcess([], 124, "", "timed out")
        if fetch.returncode:
            cached = run_git(root, "show-ref", "--verify", "--quiet", upstream_ref, check=False)
            if cached.returncode:
                raise RuntimeError(
                    "Upstream fetch failed and no cached ref exists for a stale preview; "
                    "retry when the upstream is reachable."
                )
            use_cached = True
            fetch_fallback_reason = "Upstream fetch failed; showing the last cached ref, which may be stale."

    head = run_git(root, "rev-parse", "HEAD").stdout.strip()
    upstream_head = run_git(root, "rev-parse", upstream_ref).stdout.strip()
    base_result = run_git(root, "merge-base", head, upstream_head, check=False)
    deepened = False
    deepening_attempted = False
    if base_result.returncode and not use_cached:
        shallow = run_git(root, "rev-parse", "--is-shallow-repository", check=False).stdout.strip() == "true"
        if shallow:
            remotes_to_deepen = [(remote, selected_branch)]
            local_tracking = tracking_remote_branch(root)
            if local_tracking and local_tracking not in remotes_to_deepen:
                remotes_to_deepen.append(local_tracking)
            for deepen_remote, deepen_branch in remotes_to_deepen:
                deepening_attempted = True
                deepen_ref = f"+refs/heads/{deepen_branch}:refs/remotes/{deepen_remote}/{deepen_branch}"
                try:
                    deepen = run_git(
                        root, "fetch", f"--deepen={MAX_HISTORY_DEEPEN}", "--no-tags",
                        deepen_remote, deepen_ref, check=False, timeout=90,
                    )
                except subprocess.TimeoutExpired:
                    break
                if deepen.returncode == 0:
                    deepened = True
                    upstream_head = run_git(root, "rev-parse", upstream_ref).stdout.strip()
                    base_result = run_git(root, "merge-base", head, upstream_head, check=False)
                    if base_result.returncode == 0:
                        break
    tracked, untracked = porcelain_paths(root)
    report: dict[str, object] = {
        "repo": str(root),
        "branch": run_git(root, "branch", "--show-current").stdout.strip(),
        "upstream": safe_remote_url(remotes[remote]),
        "upstreamBranch": selected_branch,
        "upstreamRefFreshness": "cached-potentially-stale" if use_cached else "fetched",
        "upstreamMayBeStale": use_cached,
        "branchResolvedFromCache": branch_from_cache,
        "fetchFallbackReason": fetch_fallback_reason,
        "historyDeepeningAttempted": deepening_attempted,
        "historyDeepeningLimit": MAX_HISTORY_DEEPEN if deepening_attempted else 0,
        "head": head,
        "upstreamHead": upstream_head,
        "dirtyTrackedFiles": tracked,
        "untrackedFiles": untracked,
        "untrackedFilesIncluded": [],
        "untrackedFilesExcluded": untracked,
        "scratchWorktreeUsed": False,
        "tests": [],
        "mergeApplied": False,
        "pushed": False,
        "customChangePreservation": {
            "status": "pending",
            "committedPaths": [],
            "trackedWorkingCopyPaths": tracked,
            "untrackedPaths": untracked,
            "untrackedPathsIncluded": [],
            "untrackedPathsExcluded": untracked,
            "conflictPaths": [],
        },
    }
    if base_result.returncode:
        shallow = run_git(
            root, "rev-parse", "--is-shallow-repository", check=False
        ).stdout.strip() == "true"
        if shallow:
            if use_cached:
                history_detail = (
                    "No merge base was found in shallow history. This cached preview did not "
                    "deepen history; retry an online preview to attempt bounded deepening, or "
                    "deepen both histories manually."
                )
            elif deepening_attempted:
                history_detail = (
                    "No merge base was found in shallow history after a bounded online "
                    "deepening attempt; deepen both histories manually before comparing or "
                    "running checks."
                )
            else:
                history_detail = (
                    "No merge base was found in shallow history; bounded deepening could not "
                    "be attempted. Deepen both histories manually before comparing or running checks."
                )
            report.update({
                "status": "shallow-history-incomplete",
                "historyIncomplete": True,
                "recommendation": "manual-review",
                "details": history_detail,
            })
        else:
            report.update({"status": "unrelated-histories", "recommendation": "manual-review"})
        return report
    base = base_result.stdout.strip()
    local_commits = run_git(root, "rev-list", "--count", f"{base}..{head}").stdout.strip()
    upstream_commits = run_git(root, "rev-list", "--count", f"{base}..{upstream_head}").stdout.strip()
    local_files = run_git(root, "diff", "--name-only", f"{base}..{head}").stdout.splitlines()
    upstream_files = run_git(root, "diff", "--name-only", f"{base}..{upstream_head}").stdout.splitlines()
    upstream_file_set = set(upstream_files)
    untracked_overlap = sorted(
        path for path in untracked
        if any(
            candidate == path.rstrip("/")
            or candidate.startswith(path.rstrip("/") + "/")
            or path.rstrip("/").startswith(candidate.rstrip("/") + "/")
            for candidate in upstream_file_set
        )
    )
    overlap = sorted(set(local_files).intersection(upstream_files) | set(untracked_overlap))
    risk_flags: list[str] = []
    if overlap:
        risk_flags.append("upstream-and-local-commits-touch-same-files")
    if tracked:
        risk_flags.append("tracked-working-copy-edits-included-in-preview")
    if untracked_overlap:
        risk_flags.append("untracked-working-copy-paths-overlap-upstream")
    if not check_commands:
        risk_flags.append("no-check-commands-requested")
    if use_cached:
        risk_flags.append("cached-upstream-ref-may-be-stale")
    if fetch_fallback_reason:
        risk_flags.append("upstream-fetch-failed-cached-fallback")
    report.update({
        "mergeBase": base,
        "localCommitsAhead": int(local_commits),
        "upstreamCommitsAhead": int(upstream_commits),
        "localCommittedFilesChanged": local_files,
        "upstreamFilesChanged": upstream_files,
        "overlappingFiles": overlap,
        "riskFlags": risk_flags,
        "upstreamCommits": run_git(
            root, "log", "--pretty=format:%h %s", f"{head}..{upstream_head}", "-n", "30"
        ).stdout.splitlines(),
    })
    report["customChangePreservation"] = {
        "status": "pending",
        "committedPaths": local_files,
        "trackedWorkingCopyPaths": tracked,
        "untrackedPaths": untracked,
        "untrackedPathsIncluded": [],
        "untrackedPathsExcluded": untracked,
        "conflictPaths": [],
    }
    if fetch_fallback_reason:
        report["details"] = fetch_fallback_reason
    if upstream_head == head and not tracked and not untracked:
        if use_cached:
            report.update({
                "status": "cached-preview-manual-review",
                "recommendation": "manual-review",
                "details": "The cached ref matches HEAD, but unseen upstream commits may exist.",
            })
            return report
        report.update({"status": "up-to-date", "recommendation": "no-action"})
        return report

    with tempfile.TemporaryDirectory(prefix="fork-sync-preview-") as temporary:
        worktree = Path(temporary) / "repo"
        added = False
        try:
            run_git(root, "worktree", "add", "--detach", str(worktree), head, timeout=60)
            added = True
            report["scratchWorktreeUsed"] = True
            # Snapshot tracked and untracked local edits into scratch without
            # touching the source index or worktree.
            patch = run_git(root, "diff", "--binary", "--full-index", "HEAD").stdout
            if patch:
                applied = run_git(worktree, "apply", "--binary", "-", check=False, input_text=patch)
                if applied.returncode:
                    report.update({
                        "status": "local-edits-not-applicable",
                        "recommendation": "manual-review",
                        "details": (applied.stderr.strip() or "Tracked local edits could not be applied to scratch worktree.")[:1000],
                    })
                    return report
                run_git(worktree, "add", "-u")
            if untracked:
                included, excluded = copy_untracked_files(root, worktree, untracked)
                report["untrackedFilesIncluded"] = included
                report["untrackedFilesExcluded"] = [item["path"] for item in excluded]
                report["untrackedExclusionReasons"] = excluded
                if included:
                    run_git(worktree, "add", "--", *included)
                    risk_flags.append("untracked-working-copy-edits-included-in-preview")
                if excluded:
                    risk_flags.append("untracked-working-copy-paths-excluded-from-preview")
            report["customChangePreservation"] = {
                "status": "pending",
                "committedPaths": local_files,
                "trackedWorkingCopyPaths": tracked,
                "untrackedPaths": untracked,
                "untrackedPathsIncluded": report["untrackedFilesIncluded"],
                "untrackedPathsExcluded": report["untrackedFilesExcluded"],
                "conflictPaths": [],
            }
            if patch or report["untrackedFilesIncluded"]:
                temporary_commit = run_git(
                    worktree, "-c", "user.name=Fork Sync Preview",
                    "-c", "user.email=fork-sync-preview@localhost",
                    "commit", "-m", "Temporary preview of uncommitted working-copy edits",
                    check=False,
                )
                if temporary_commit.returncode:
                    report.update({
                        "status": "local-edits-not-snapshotted",
                        "recommendation": "manual-review",
                        "details": (temporary_commit.stderr.strip() or "Tracked local edits could not be snapshotted in the scratch worktree.")[:1000],
                    })
                    return report
            rebase = run_git(worktree, "rebase", upstream_head, check=False, timeout=90)
            if rebase.returncode:
                conflicts = run_git(
                    worktree, "diff", "--name-only", "--diff-filter=U", check=False
                ).stdout.splitlines()
                run_git(worktree, "rebase", "--abort", check=False)
                report.update({
                    "status": "conflicts",
                    "recommendation": "manual-review",
                    "rebaseSimulation": "conflicts",
                    "conflictFiles": conflicts,
                    "details": (rebase.stderr.strip() or rebase.stdout.strip())[-1500:],
                })
                report["customChangePreservation"] = {
                    "status": "needs-review",
                    "committedPaths": local_files,
                    "trackedWorkingCopyPaths": tracked,
                    "untrackedPaths": untracked,
                    "untrackedPathsIncluded": report["untrackedFilesIncluded"],
                    "untrackedPathsExcluded": report["untrackedFilesExcluded"],
                    "conflictPaths": conflicts,
                }
                return report

            report["rebaseSimulation"] = "no-conflicts"

            diff_stat = run_git(
                worktree, "diff", "--stat", f"{upstream_head}...HEAD", check=False
            ).stdout.strip()
            test_results: list[dict[str, object]] = []
            for command_text in check_commands:
                command = shlex.split(command_text)
                if not command:
                    raise RuntimeError("An empty --check-command was supplied.")
                result = run_check_sandboxed(root, worktree, command)
                test_results.append({
                    "command": command,
                    "exitCode": result.returncode,
                    "output": (result.stdout + result.stderr)[-3000:],
                })
                if result.returncode:
                    report.update({
                        "status": "checks-failed",
                        "recommendation": "manual-review",
                        "tests": test_results,
                    })
                    return report
            safe_snapshot = len(report["untrackedFilesIncluded"]) == len(untracked)
            tests_passed = bool(check_commands) and all(
                item["exitCode"] == 0 for item in test_results
            )
            report.update({
                "status": (
                    "partial-preview-manual-review" if not safe_snapshot
                    else "cached-preview-manual-review"
                    if use_cached and tests_passed
                    else "mergeable-tests-passed" if tests_passed
                    else "mergeable-unverified"
                ),
                "recommendation": "manual-merge-candidate" if tests_passed and safe_snapshot and not use_cached else "manual-review",
                "scratchDiffStat": diff_stat,
                "tests": test_results,
                "untrackedChangesRequireReview": bool(untracked),
            })
            report["customChangePreservation"] = {
                "status": "preserved" if safe_snapshot and report["rebaseSimulation"] == "no-conflicts" else "needs-review",
                "committedPaths": local_files,
                "trackedWorkingCopyPaths": tracked,
                "untrackedPaths": untracked,
                "untrackedPathsIncluded": report["untrackedFilesIncluded"],
                "untrackedPathsExcluded": report["untrackedFilesExcluded"],
                "conflictPaths": [],
            }
            return report
        finally:
            if added:
                run_git(root, "worktree", "remove", "--force", str(worktree), check=False, timeout=60)


def run_check_sandboxed(source_repo: Path, worktree: Path,
                        command: list[str]) -> subprocess.CompletedProcess[str]:
    bwrap = shutil.which("bwrap")
    if not bwrap:
        raise RuntimeError("bubblewrap is required to execute checks against upstream code.")
    executable = shutil.which(command[0])
    if not executable:
        raise RuntimeError(f"Check command is not installed: {command[0]}")
    executable_path = Path(executable).resolve()
    mounts: list[str] = []
    sandbox_command = list(command)
    tool_paths: list[str] = []
    if executable_path.is_relative_to(Path.home()):
        tool_root = executable_path.parent
        tool_relative_path = Path(executable_path.name)
        if tool_root.name == "dist" and (tool_root.parent / "package.json").is_file():
            tool_root = tool_root.parent
            tool_relative_path = Path("dist") / tool_relative_path
        tool_mount = "/tmp/fork-sync-tools"
        mounts.extend(["--dir", tool_mount, "--ro-bind", str(tool_root), tool_mount])
        sandbox_command[0] = f"{tool_mount}/{tool_relative_path.as_posix()}"
        tool_paths.append(tool_mount)

    # Corepack shims need both their Node runtime and local package-manager
    # cache. Mount only these toolchain directories read-only; never expose the
    # operator's normal HOME or credentials to code being checked.
    node_executable = shutil.which("node")
    if node_executable:
        node_path = Path(node_executable).resolve()
        if node_path.is_relative_to(Path.home()):
            node_mount = "/tmp/fork-sync-node"
            mounts.extend(["--dir", node_mount, "--ro-bind", str(node_path.parent), node_mount])
            tool_paths.append(node_mount)

    corepack_cache = Path.home() / ".cache/node/corepack"
    if corepack_cache.is_dir():
        corepack_mount = "/tmp/fork-sync-corepack"
        mounts.extend(["--dir", corepack_mount, "--ro-bind", str(corepack_cache), corepack_mount])
    args = [
        bwrap, "--die-with-parent", "--unshare-all", "--ro-bind", "/", "/",
        "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/home",
        "--tmpfs", "/root", "--tmpfs", "/tmp", "--tmpfs", "/run",
        "--tmpfs", "/srv", "--dir", "/tmp/fork-sync-home",
        "--dir", "/tmp/fork-sync-workspace",
        "--bind", str(worktree), "/tmp/fork-sync-workspace",
        "--chdir", "/tmp/fork-sync-workspace",
        "--dir", "/tmp/fork-sync-workspace/node_modules",
        "--setenv", "HOME", "/tmp/fork-sync-home", "--setenv", "CI", "1",
        "--setenv", "PATH", f"{':'.join(tool_paths)}:/usr/local/bin:/usr/bin:/bin",
        "--setenv", "COREPACK_HOME", "/tmp/fork-sync-corepack",
        *mounts,
    ]
    node_modules = source_repo / "node_modules"
    if node_modules.is_dir():
        args.extend(["--ro-bind", str(node_modules.resolve()), "/tmp/fork-sync-workspace/node_modules"])
    args.extend(["--", *sandbox_command])
    return subprocess.run(
        args, cwd=worktree, capture_output=True, text=True, timeout=900,
        env={
            "PATH": f"{':'.join(tool_paths)}:/usr/local/bin:/usr/bin:/bin",
            "HOME": "/tmp/fork-sync-home",
            "CI": "1",
            "COREPACK_HOME": "/tmp/fork-sync-corepack",
        },
        check=False,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    scan_parser = sub.add_parser("scan", help="Find Git repositories and report fork metadata.")
    scan_parser.add_argument("--root", required=True, type=Path)
    scan_parser.add_argument("--max-depth", type=int, default=2)
    scan_parser.add_argument("--format", choices=("json", "summary"), default="json")
    preview_parser = sub.add_parser("preview", help="Assess upstream in a disposable worktree; --cached uses a potentially stale remote-tracking ref.")
    preview_parser.add_argument("--repo", required=True, type=Path)
    preview_parser.add_argument("--remote", default="upstream")
    preview_parser.add_argument("--branch")
    preview_parser.add_argument(
        "--cached", action="store_true",
        help="Skip fetch and assess the cached remote-tracking ref; results are always manual-review only.",
    )
    preview_parser.add_argument(
        "--check-command", action="append", default=[], metavar="COMMAND",
        help="Run a test/build command inside bubblewrap; repeat for multiple checks.",
    )
    preview_parser.add_argument("--format", choices=("json", "summary"), default="json")
    preview_parser.add_argument(
        "--output", type=Path,
        help="Save this preview report to a new file (refuses to overwrite an existing file).",
    )
    args = parser.parse_args()
    try:
        if args.action == "scan":
            payload: object = scan_root(args.root, max(1, min(args.max_depth, 5)))
        else:
            payload = preview(args.repo, args.remote, args.branch, args.check_command, args.cached)
        rendered = render_summary(payload) if args.format == "summary" else json.dumps(payload, indent=2)
        if args.action == "preview" and args.output:
            with args.output.open("x", encoding="utf-8") as report_file:
                report_file.write(rendered)
                report_file.write("\n")
            print(f"Saved preview report: {args.output}")
            if args.format == "summary":
                print(rendered)
        else:
            print(rendered)
        return 0
    except (OSError, RuntimeError, subprocess.TimeoutExpired) as error:
        print(json.dumps({"status": "error", "error": str(error)[:1000]}, indent=2))
        return 2


if __name__ == "__main__":
    sys.exit(main())
