import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("fork_sync_assistant.py")
SPEC = importlib.util.spec_from_file_location("fork_sync_assistant", MODULE_PATH)
assistant = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(assistant)


def git(path: Path, *args: str, input_text: str | None = None) -> str:
    result = subprocess.run(
        ["git", *args], cwd=path, input=input_text, capture_output=True,
        text=True, check=True,
    )
    return result.stdout.strip()


def commit_all(path: Path, message: str) -> None:
    git(path, "add", "-A")
    git(path, "-c", "user.name=Fork Sync Test", "-c", "user.email=fork-sync@example.test", "commit", "-m", message)


class ForkSyncPreviewTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="fork-sync-assistant-test-")
        self.root = Path(self.temporary.name)
        self.upstream_bare = self.root / "upstream.git"
        self.upstream_work = self.root / "upstream-work"
        self.fork_bare = self.root / "fork.git"
        self.repo = self.root / "repo"
        git(self.root, "init", "--bare", str(self.upstream_bare))
        git(self.root, "init", "--bare", str(self.fork_bare))
        git(self.root, "init", "-b", "main", str(self.upstream_work))
        (self.upstream_work / "base.txt").write_text("base\n")
        (self.upstream_work / "shared.txt").write_text("base\n")
        commit_all(self.upstream_work, "initial")
        git(self.upstream_work, "remote", "add", "origin", str(self.upstream_bare))
        git(self.upstream_work, "push", "-u", "origin", "main")
        git(self.root, "clone", str(self.upstream_bare), str(self.repo))
        git(self.repo, "remote", "rename", "origin", "upstream")
        git(self.repo, "remote", "add", "origin", str(self.fork_bare))
        git(self.repo, "config", "user.name", "Fork Sync Test")
        git(self.repo, "config", "user.email", "fork-sync@example.test")
        git(self.repo, "push", "-u", "origin", "main")
        (self.repo / "custom.txt").write_text("local commit\n")
        commit_all(self.repo, "custom local change")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def push_upstream_file(self, filename: str, content: str) -> None:
        (self.upstream_work / filename).write_text(content)
        commit_all(self.upstream_work, f"upstream changes {filename}")
        git(self.upstream_work, "push", "origin", "main")

    def test_clean_preview_uses_scratch_and_preserves_dirty_tracked_changes(self) -> None:
        self.push_upstream_file("feature.txt", "upstream feature\n")
        (self.repo / "base.txt").write_text("local uncommitted edit\n")
        original_head = git(self.repo, "rev-parse", "HEAD")

        report = assistant.preview(self.repo, "upstream", "main", [])

        self.assertEqual(report["status"], "mergeable-unverified")
        self.assertEqual(report["recommendation"], "manual-review")
        self.assertEqual(report["rebaseSimulation"], "no-conflicts")
        self.assertEqual(report["dirtyTrackedFiles"], ["base.txt"])
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), original_head)
        self.assertEqual((self.repo / "base.txt").read_text(), "local uncommitted edit\n")
        self.assertEqual(git(self.repo, "status", "--porcelain"), "M base.txt")
        self.assertEqual(git(self.repo, "worktree", "list", "--porcelain").count("worktree "), 1)

    def test_cached_preview_skips_fetch_and_is_explicitly_stale_and_manual_review(self) -> None:
        self.push_upstream_file("not-yet-fetched.txt", "new upstream change\n")
        original_run_git = assistant.run_git
        calls: list[tuple[str, ...]] = []

        def record_git(repo: Path, *args: str, **kwargs: object) -> subprocess.CompletedProcess[str]:
            calls.append(tuple(args))
            return original_run_git(repo, *args, **kwargs)

        with patch.object(assistant, "run_git", side_effect=record_git):
            report = assistant.preview(self.repo, "upstream", "main", [], use_cached=True)

        self.assertFalse(any(args and args[0] == "fetch" for args in calls))
        self.assertEqual(report["upstreamRefFreshness"], "cached-potentially-stale")
        self.assertTrue(report["upstreamMayBeStale"])
        self.assertEqual(report["upstreamCommitsAhead"], 0)
        self.assertIn("cached-upstream-ref-may-be-stale", report["riskFlags"])
        self.assertEqual(report["recommendation"], "manual-review")
        self.assertFalse(report["mergeApplied"])
        self.assertFalse(report["pushed"])

    def test_failed_online_fetch_falls_back_to_cached_ref_with_clear_stale_warning(self) -> None:
        original_run_git = assistant.run_git
        calls: list[tuple[str, ...]] = []

        def fail_fetch(repo: Path, *args: str, **kwargs: object) -> subprocess.CompletedProcess[str]:
            calls.append(tuple(args))
            if args and args[0] == "fetch" and "--deepen=2000" not in args:
                return subprocess.CompletedProcess(args, 1, "", "network unavailable")
            return original_run_git(repo, *args, **kwargs)

        with patch.object(assistant, "run_git", side_effect=fail_fetch):
            report = assistant.preview(self.repo, "upstream", "main", [])

        self.assertEqual(report["upstreamRefFreshness"], "cached-potentially-stale")
        self.assertTrue(report["upstreamMayBeStale"])
        self.assertEqual(report["fetchFallbackReason"],
                         "Upstream fetch failed; showing the last cached ref, which may be stale.")
        self.assertIn("upstream-fetch-failed-cached-fallback", report["riskFlags"])
        self.assertEqual(report["recommendation"], "manual-review")
        self.assertFalse(report["mergeApplied"])
        self.assertFalse(report["pushed"])
        self.assertTrue(any(args and args[0] == "fetch" for args in calls))
        self.assertNotIn("network unavailable", assistant.render_summary(report))
        self.assertIn("may be stale", assistant.render_summary(report))

    def test_online_timeouts_resolve_cached_default_branch_and_return_stale_preview(self) -> None:
        original_run_git = assistant.run_git

        def timeout_online_calls(
            repo: Path, *args: str, **kwargs: object
        ) -> subprocess.CompletedProcess[str]:
            if "ls-remote" in args or (args and args[0] == "fetch"):
                raise subprocess.TimeoutExpired(["git", *args], timeout=1)
            return original_run_git(repo, *args, **kwargs)

        with patch.object(assistant, "run_git", side_effect=timeout_online_calls):
            report = assistant.preview(self.repo, "upstream", None, [])

        self.assertEqual(report["upstreamBranch"], "main")
        self.assertTrue(report["branchResolvedFromCache"])
        self.assertEqual(report["upstreamRefFreshness"], "cached-potentially-stale")
        self.assertTrue(report["upstreamMayBeStale"])
        self.assertEqual(report["recommendation"], "manual-review")
        self.assertIn("fetch failed", report["fetchFallbackReason"])

    def test_shallow_online_preview_attempts_bounded_deepening_then_compares(self) -> None:
        self.push_upstream_file("new-upstream.txt", "change\n")
        original_run_git = assistant.run_git
        merge_base_calls = 0
        deepen_calls: list[tuple[str, ...]] = []

        def shallow_then_reachable(
            repo: Path, *args: str, **kwargs: object
        ) -> subprocess.CompletedProcess[str]:
            nonlocal merge_base_calls
            if args == ("rev-parse", "--is-shallow-repository"):
                return subprocess.CompletedProcess(args, 0, "true\n", "")
            if args and args[0] == "merge-base":
                merge_base_calls += 1
                if merge_base_calls == 1:
                    return subprocess.CompletedProcess(args, 1, "", "")
            if args and args[0] == "fetch" and any(arg.startswith("--deepen=") for arg in args):
                deepen_calls.append(tuple(args))
            return original_run_git(repo, *args, **kwargs)

        with patch.object(assistant, "run_git", side_effect=shallow_then_reachable):
            report = assistant.preview(self.repo, "upstream", "main", [])

        self.assertTrue(report["historyDeepeningAttempted"])
        self.assertEqual(report["historyDeepeningLimit"], assistant.MAX_HISTORY_DEEPEN)
        self.assertTrue(deepen_calls)
        self.assertTrue(any(f"--deepen={assistant.MAX_HISTORY_DEEPEN}" in args for args in deepen_calls))
        self.assertIn("mergeBase", report)
        self.assertEqual(report["status"], "mergeable-unverified")
        self.assertTrue(report["scratchWorktreeUsed"])

    def test_deepening_timeout_reports_incomplete_shallow_history_without_scratch(self) -> None:
        original_run_git = assistant.run_git

        def timeout_deepen(repo: Path, *args: str, **kwargs: object) -> subprocess.CompletedProcess[str]:
            if args == ("rev-parse", "--is-shallow-repository"):
                return subprocess.CompletedProcess(args, 0, "true\n", "")
            if args and args[0] == "merge-base":
                return subprocess.CompletedProcess(args, 1, "", "")
            if args and args[0] == "fetch" and any(arg.startswith("--deepen=") for arg in args):
                raise subprocess.TimeoutExpired(["git", *args], timeout=1)
            return original_run_git(repo, *args, **kwargs)

        with patch.object(assistant, "run_git", side_effect=timeout_deepen):
            report = assistant.preview(self.repo, "upstream", "main", [])

        self.assertEqual(report["status"], "shallow-history-incomplete")
        self.assertTrue(report["historyDeepeningAttempted"])
        self.assertFalse(report["scratchWorktreeUsed"])
        self.assertEqual(report["tests"], [])
        self.assertIn("after a bounded online", report["details"])

    def test_missing_merge_base_in_shallow_checkout_is_not_mislabeled_unrelated(self) -> None:
        original_run_git = assistant.run_git

        def shallow_without_merge_base(
            repo: Path, *args: str, **kwargs: object
        ) -> subprocess.CompletedProcess[str]:
            if args and args[0] == "merge-base":
                return subprocess.CompletedProcess(args, 1, "", "")
            if args == ("rev-parse", "--is-shallow-repository"):
                return subprocess.CompletedProcess(args, 0, "true\n", "")
            return original_run_git(repo, *args, **kwargs)

        with patch.object(assistant, "run_git", side_effect=shallow_without_merge_base):
            report = assistant.preview(
                self.repo, "upstream", "main", [], use_cached=True
            )

        self.assertEqual(report["status"], "shallow-history-incomplete")
        self.assertTrue(report["historyIncomplete"])
        self.assertEqual(report["recommendation"], "manual-review")
        self.assertFalse(report["scratchWorktreeUsed"])
        self.assertEqual(report["tests"], [])
        summary = assistant.render_summary(report)
        self.assertIn("cannot distinguish unrelated histories", summary)
        self.assertIn("Deepen history", summary)

    def test_missing_merge_base_in_complete_checkout_is_reported_as_unrelated(self) -> None:
        original_run_git = assistant.run_git

        def complete_without_merge_base(
            repo: Path, *args: str, **kwargs: object
        ) -> subprocess.CompletedProcess[str]:
            if args and args[0] == "merge-base":
                return subprocess.CompletedProcess(args, 1, "", "")
            if args == ("rev-parse", "--is-shallow-repository"):
                return subprocess.CompletedProcess(args, 0, "false\n", "")
            return original_run_git(repo, *args, **kwargs)

        with patch.object(assistant, "run_git", side_effect=complete_without_merge_base):
            report = assistant.preview(
                self.repo, "upstream", "main", [], use_cached=True
            )

        self.assertEqual(report["status"], "unrelated-histories")
        self.assertNotIn("historyIncomplete", report)
        self.assertFalse(report["scratchWorktreeUsed"])

    def test_default_branch_resolution_uses_remote_head_and_cached_matching_branch(self) -> None:
        git(self.upstream_bare, "symbolic-ref", "HEAD", "refs/heads/main")
        self.assertEqual(assistant.checked_branch(self.repo, "upstream", None), "main")

        # A stale remote HEAD pointing to a nonexistent branch should not make
        # an offline cached preview fail when the current branch has a cache.
        git(self.repo, "symbolic-ref", "refs/remotes/upstream/HEAD", "refs/remotes/upstream/missing")
        original_run_git = assistant.run_git
        calls: list[tuple[str, ...]] = []

        def record_git(repo: Path, *args: str, **kwargs: object) -> subprocess.CompletedProcess[str]:
            calls.append(tuple(args))
            return original_run_git(repo, *args, **kwargs)

        with patch.object(assistant, "run_git", side_effect=record_git):
            report = assistant.preview(self.repo, "upstream", None, [], use_cached=True)

        self.assertEqual(report["upstreamBranch"], "main")
        self.assertFalse(any(args and args[0] in {"fetch", "ls-remote"} for args in calls))
        self.assertEqual(report["upstreamRefFreshness"], "cached-potentially-stale")

    def test_conflicting_upstream_and_custom_commits_are_reported_without_touching_repo(self) -> None:
        (self.repo / "shared.txt").write_text("local version\n")
        commit_all(self.repo, "custom conflicting change")
        self.push_upstream_file("shared.txt", "upstream version\n")
        original_head = git(self.repo, "rev-parse", "HEAD")

        report = assistant.preview(self.repo, "upstream", "main", [])

        self.assertEqual(report["status"], "conflicts")
        self.assertEqual(report["conflictFiles"], ["shared.txt"])
        self.assertEqual(report["overlappingFiles"], ["shared.txt"])
        self.assertIn("upstream-and-local-commits-touch-same-files", report["riskFlags"])
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), original_head)
        self.assertEqual((self.repo / "shared.txt").read_text(), "local version\n")

    def test_summary_report_surfaces_decision_conflicts_skipped_checks_and_safety(self) -> None:
        summary = assistant.render_summary({
            "status": "conflicts",
            "recommendation": "manual-review",
            "repo": "/workspace/custom-fork",
            "branch": "main",
            "upstreamBranch": "main",
            "upstreamRefFreshness": "cached-potentially-stale",
            "localCommitsAhead": 4,
            "upstreamCommitsAhead": 2,
            "dirtyTrackedFiles": ["local.ts"],
            "untrackedFiles": ["new-feature.ts"],
            "untrackedFilesIncluded": ["new-feature.ts"],
            "untrackedFilesExcluded": [],
            "overlappingFiles": ["server-entry.js"],
            "conflictFiles": ["server-entry.js"],
            "rebaseSimulation": "conflicts",
            "riskFlags": ["upstream-and-local-commits-touch-same-files"],
            "tests": [],
            "scratchWorktreeUsed": True,
            "mergeApplied": False,
            "pushed": False,
        })

        self.assertIn("Decision: manual-review (status: conflicts)", summary)
        self.assertIn("Commit delta: 4 local ahead, 2 upstream ahead", summary)
        self.assertIn("Conflicts: server-entry.js", summary)
        self.assertIn("Rebase simulation: conflicts detected in the disposable worktree", summary)
        self.assertIn("Checks: not run because replay stopped at a conflict", summary)
        self.assertIn("cached remote-tracking ref; it may be stale", summary)
        self.assertIn("Untracked files: 1", summary)
        self.assertIn("Untracked files included in scratch: 1", summary)
        self.assertIn("Untracked files excluded: 0", summary)
        self.assertIn("Merge applied: False", summary)
        self.assertIn("Pushed: False", summary)

    def test_summary_reports_revisions_and_failed_check_without_echoing_output(self) -> None:
        summary = assistant.render_summary({
            "status": "checks-failed",
            "recommendation": "manual-review",
            "head": "a" * 40,
            "upstreamHead": "b" * 40,
            "tests": [{
                "command": ["python3", "-m", "pytest", "-q"],
                "exitCode": 1,
                "output": "token=must-not-appear-in-summary",
            }],
            "scratchWorktreeUsed": True,
            "mergeApplied": False,
            "pushed": False,
        })

        self.assertIn("Local commit: aaaaaaaaaaaa", summary)
        self.assertIn("Upstream commit: bbbbbbbbbbbb", summary)
        self.assertIn("Failed check: python3 -m pytest -q (exit 1)", summary)
        self.assertNotIn("must-not-appear", summary)

    def test_untracked_files_are_snapshotted_into_scratch_without_touching_source(self) -> None:
        self.push_upstream_file("feature.txt", "upstream feature\n")
        (self.repo / "local-only.txt").write_text("untracked local data\n")

        report = assistant.preview(self.repo, "upstream", "main", [])

        self.assertEqual(report["untrackedFiles"], ["local-only.txt"])
        self.assertEqual(report["untrackedFilesIncluded"], ["local-only.txt"])
        self.assertEqual(report["untrackedFilesExcluded"], [])
        self.assertEqual(report["status"], "mergeable-unverified")
        self.assertEqual(report["recommendation"], "manual-review")
        self.assertIn("untracked-working-copy-edits-included-in-preview", report["riskFlags"])
        self.assertIn("local-only.txt", report["scratchDiffStat"])
        self.assertTrue((self.repo / "local-only.txt").exists())
        self.assertEqual(git(self.repo, "status", "--porcelain"), "?? local-only.txt")

    def test_untracked_path_added_upstream_is_a_replay_conflict(self) -> None:
        (self.repo / "upstream-new.txt").write_text("local untracked version\n")
        self.push_upstream_file("upstream-new.txt", "upstream version\n")

        report = assistant.preview(self.repo, "upstream", "main", [])

        self.assertEqual(report["status"], "conflicts")
        self.assertEqual(report["recommendation"], "manual-review")
        self.assertEqual(report["untrackedFilesIncluded"], ["upstream-new.txt"])
        self.assertEqual(report["conflictFiles"], ["upstream-new.txt"])
        self.assertTrue((self.repo / "upstream-new.txt").exists())
        self.assertEqual((self.repo / "upstream-new.txt").read_text(), "local untracked version\n")

    def test_nested_untracked_repo_is_excluded_but_safe_paths_still_preview(self) -> None:
        (self.upstream_work / "nested-repo").mkdir()
        self.push_upstream_file("nested-repo/upstream.txt", "upstream change\n")
        nested_repo = self.repo / "nested-repo"
        nested_repo.mkdir()
        git(nested_repo, "init", "-b", "main")
        (nested_repo / "private-local.txt").write_text("never copied out of nested repo\n")
        (self.repo / "local-only.txt").write_text("safe untracked file\n")
        original_head = git(self.repo, "rev-parse", "HEAD")

        report = assistant.preview(self.repo, "upstream", "main", [])

        self.assertEqual(report["status"], "partial-preview-manual-review")
        self.assertEqual(report["recommendation"], "manual-review")
        self.assertEqual(report["untrackedFilesIncluded"], ["local-only.txt"])
        self.assertEqual(report["untrackedFilesExcluded"], ["nested-repo/"])
        self.assertEqual(
            report["untrackedExclusionReasons"],
            [{"path": "nested-repo/", "reason": "Directories and nested repositories are not copied."}],
        )
        self.assertIn("nested-repo/", report["overlappingFiles"])
        self.assertIn("local-only.txt", report["scratchDiffStat"])
        self.assertNotIn("private-local.txt", report["scratchDiffStat"])
        summary = assistant.render_summary(report)
        self.assertIn("Preview scope is partial", summary)
        self.assertIn("nested-repo/", summary)
        self.assertIn("Directories and nested repositories are not copied.", summary)
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), original_head)
        self.assertTrue((nested_repo / "private-local.txt").exists())

    def test_oversized_untracked_file_is_skipped_without_blocking_safe_snapshot(self) -> None:
        self.push_upstream_file("feature.txt", "upstream feature\n")
        large_file = self.repo / "large-dump.bin"
        with large_file.open("wb") as stream:
            stream.truncate(assistant.MAX_UNTRACKED_FILE_BYTES + 1)
        (self.repo / "local-only.txt").write_text("safe untracked file\n")

        report = assistant.preview(self.repo, "upstream", "main", [])

        self.assertEqual(report["status"], "partial-preview-manual-review")
        self.assertEqual(report["recommendation"], "manual-review")
        self.assertEqual(report["untrackedFilesIncluded"], ["local-only.txt"])
        self.assertEqual(report["untrackedFilesExcluded"], ["large-dump.bin"])
        self.assertEqual(
            report["untrackedExclusionReasons"],
            [{
                "path": "large-dump.bin",
                "reason": "File exceeds the 64 MiB preview limit.",
            }],
        )
        self.assertIn("local-only.txt", report["scratchDiffStat"])
        self.assertNotIn("large-dump.bin", report["scratchDiffStat"])

    def test_failed_temporary_commit_fails_closed(self) -> None:
        self.push_upstream_file("feature.txt", "upstream feature\n")
        (self.repo / "base.txt").write_text("local uncommitted edit\n")
        original_head = git(self.repo, "rev-parse", "HEAD")
        original_run_git = assistant.run_git

        def fail_temporary_commit(repo: Path, *args: str, **kwargs: object) -> subprocess.CompletedProcess[str]:
            if "commit" in args:
                return subprocess.CompletedProcess(args, 1, "", "commit signing failed")
            return original_run_git(repo, *args, **kwargs)

        with patch.object(assistant, "run_git", side_effect=fail_temporary_commit):
            report = assistant.preview(self.repo, "upstream", "main", [])

        self.assertEqual(report["status"], "local-edits-not-snapshotted")
        self.assertEqual(report["recommendation"], "manual-review")
        self.assertIn("commit signing failed", report["details"])
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), original_head)
        self.assertEqual((self.repo / "base.txt").read_text(), "local uncommitted edit\n")

    def test_fork_discovery_reports_parent_but_does_not_rewrite_remotes(self) -> None:
        with patch.object(assistant, "github_fork_metadata", return_value=(False, None)):
            report = assistant.inspect_repo(self.repo)

        self.assertEqual(report["fork"], "configured-upstream-pair")
        self.assertFalse(report["githubIsFork"])
        self.assertIsNone(report["parent"])
        self.assertTrue(report["upstreamRemoteConfigured"])
        self.assertEqual(report["remotes"]["upstream"], str(self.upstream_bare))
        with patch.object(assistant, "github_fork_metadata", return_value=(True, "upstream/project")):
            confirmed = assistant.inspect_repo(self.repo)
        self.assertEqual(confirmed["fork"], "confirmed")
        self.assertTrue(confirmed["githubIsFork"])
        self.assertEqual(confirmed["parent"], "upstream/project")

    def test_fork_discovery_matches_parent_when_remote_names_are_nonstandard(self) -> None:
        git(self.repo, "remote", "rename", "origin", "fork")
        git(self.repo, "remote", "rename", "upstream", "origin")
        git(self.repo, "remote", "set-url", "fork", "git@github.com:NPFernando/hermes-agent.git")
        git(self.repo, "remote", "set-url", "origin", "https://github.com/NousResearch/hermes-agent.git")

        with patch.object(
            assistant, "github_fork_metadata",
            return_value=(True, "NousResearch/hermes-agent"),
        ):
            report = assistant.inspect_repo(self.repo)

        self.assertEqual(report["fork"], "confirmed")
        self.assertTrue(report["upstreamRemoteConfigured"])
        self.assertEqual(report["forkRemote"], "fork")
        self.assertEqual(report["upstreamRemote"], "origin")
        self.assertIn("--remote origin", report["previewCommand"])
        self.assertEqual(assistant.github_repo_slug("git@github.com:owner/project.git"), "owner/project")
        self.assertEqual(assistant.github_repo_slug("https://github.com/Owner/project.git"), "Owner/project")

    def test_github_metadata_queries_explicit_fork_remote_and_builds_parent_slug(self) -> None:
        payload = {
            "isFork": True,
            "parent": {"name": "hermes-agent", "owner": {"login": "NousResearch"}},
        }
        gh_result = subprocess.CompletedProcess(["gh"], 0, json.dumps(payload), "")
        with patch.object(assistant.shutil, "which", return_value="/usr/bin/gh"), patch.object(
            assistant.subprocess, "run", return_value=gh_result
        ) as run:
            metadata = assistant.github_fork_metadata(Path("/tmp/repo"), {
                "fork": "https://github.com/NPFernando/hermes-agent.git",
                "origin": "https://github.com/NousResearch/hermes-agent.git",
            })

        self.assertEqual(metadata, (True, "NousResearch/hermes-agent"))
        self.assertEqual(run.call_args.args[0], [
            "/usr/bin/gh", "repo", "view", "NPFernando/hermes-agent", "--json", "isFork,parent"
        ])

    def test_isolated_check_command_cannot_read_home_or_write_outside_scratch(self) -> None:
        if not shutil_which("bwrap"):
            self.skipTest("bubblewrap is unavailable")
        self.push_upstream_file("feature.txt", "upstream feature\n")
        command = (
            "/usr/bin/python3 -c \"from pathlib import Path; "
            "assert not Path('/home/ubuntu/.hermes/.env').exists(); "
            "Path('/tmp/fork-sync-workspace/check-output.txt').write_text('ok'); "
            "assert not Path('/srv/fork-sync-escape.txt').exists()\""
        )

        report = assistant.preview(self.repo, "upstream", "main", [command])

        self.assertEqual(report["status"], "mergeable-tests-passed", report)
        self.assertTrue(report["tests"][0]["exitCode"] == 0)
        self.assertFalse((self.repo / "check-output.txt").exists())

    def test_isolated_check_can_launch_the_project_package_manager(self) -> None:
        if not shutil_which("bwrap") or not shutil_which("pnpm"):
            self.skipTest("bubblewrap or pnpm is unavailable")
        self.push_upstream_file("feature.txt", "upstream feature\n")

        report = assistant.preview(self.repo, "upstream", "main", ["pnpm --version"])

        self.assertEqual(report["status"], "mergeable-tests-passed", report)
        self.assertEqual(report["tests"][0]["exitCode"], 0, report["tests"])

    def test_preview_cli_saves_a_reviewable_report_without_overwriting(self) -> None:
        report_path = self.root / "review" / "fork-preview.json"
        report_path.parent.mkdir()
        payload = {"status": "conflicts", "overlappingPaths": ["src/example.ts"]}
        output = StringIO()
        with patch.object(sys, "argv", [
            "fork_sync_assistant.py", "preview", "--repo", str(self.repo),
            "--output", str(report_path),
        ]), patch.object(assistant, "preview", return_value=payload), redirect_stdout(output):
            self.assertEqual(assistant.main(), 0)

        self.assertEqual(json.loads(report_path.read_text()), payload)
        self.assertIn(str(report_path), output.getvalue())
        with patch.object(sys, "argv", [
            "fork_sync_assistant.py", "preview", "--repo", str(self.repo),
            "--output", str(report_path),
        ]), patch.object(assistant, "preview", return_value=payload), redirect_stdout(StringIO()):
            self.assertEqual(assistant.main(), 2)
        self.assertEqual(json.loads(report_path.read_text()), payload)


def shutil_which(command: str) -> str | None:
    import shutil

    return shutil.which(command)


if __name__ == "__main__":
    unittest.main()
