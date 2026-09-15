import importlib.util
import io
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("upstream-sync.py")
SPEC = importlib.util.spec_from_file_location("upstream_sync", MODULE_PATH)
upstream_sync = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(upstream_sync)


class LegacyUpdaterSafetyTests(unittest.TestCase):
    def invoke(self, *arguments: str) -> int:
        with patch.object(sys, "argv", [str(MODULE_PATH), *arguments]):
            return upstream_sync.main()

    def test_apply_is_refused_before_changing_directory_or_running_git(self) -> None:
        stderr = io.StringIO()
        with patch.object(upstream_sync.os, "chdir") as chdir, patch.object(upstream_sync, "git") as git, redirect_stderr(stderr):
            result = self.invoke("--apply")

        self.assertEqual(result, 2)
        chdir.assert_not_called()
        git.assert_not_called()
        self.assertIn("retired", stderr.getvalue())

    def test_status_uses_cached_refs_without_fetching(self) -> None:
        stdout = io.StringIO()
        completed = upstream_sync.subprocess.CompletedProcess([], 0, "", "")
        with (
            patch.object(upstream_sync.os, "chdir"),
            patch.object(upstream_sync, "current_branch", return_value="main"),
            patch.object(upstream_sync, "new_upstream_commits", return_value=[]),
            patch.object(upstream_sync, "upstream_touched_our_files", return_value=[]),
            patch.object(upstream_sync, "detect_merged_prs", return_value=[]),
            patch.object(upstream_sync, "git", return_value=completed) as git,
            redirect_stdout(stdout),
        ):
            result = self.invoke("--status")

        self.assertEqual(result, 0)
        git.assert_not_called()
        self.assertIn("cached refs only", stdout.getvalue())

    def test_default_mode_only_fetches_and_reports(self) -> None:
        stdout = io.StringIO()
        completed = upstream_sync.subprocess.CompletedProcess([], 0, "", "")
        with (
            patch.object(upstream_sync.os, "chdir"),
            patch.object(upstream_sync, "current_branch", return_value="main"),
            patch.object(upstream_sync, "new_upstream_commits", return_value=[]),
            patch.object(upstream_sync, "git", return_value=completed) as git,
            patch.object(upstream_sync, "notify") as notify,
            redirect_stdout(stdout),
        ):
            result = self.invoke()

        self.assertEqual(result, 0)
        git.assert_called_once_with("fetch", "upstream", "--no-tags")
        notify.assert_not_called()
        self.assertIn("no worktree, build, service, push", stdout.getvalue())


if __name__ == "__main__":
    unittest.main()
