import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from scripts.fork_sync_approval import approve_report


class ForkSyncApprovalTests(unittest.TestCase):
    def test_records_digest_and_scope_for_eligible_report(self):
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / "fork-20260916T041500Z.json"
            report.write_text(json.dumps({
                "scheduled": True,
                "status": "mergeable-tests-passed",
                "recommendation": "manual-merge-candidate",
                "repo": "/tmp/fork",
                "branch": "main",
                "head": "local",
                "upstreamHead": "upstream",
            }), encoding="utf-8")
            approval = approve_report(report, "operator@example.test", "reviewed diff")
            payload = json.loads(approval.read_text(encoding="utf-8"))
            self.assertEqual(approval.stat().st_mode & 0o777, 0o600)
            self.assertEqual(payload["status"], "approved-for-manual-integration")
            self.assertEqual(payload["operator"], "operator@example.test")
            self.assertEqual(payload["reportSha256"], hashlib.sha256(report.read_bytes()).hexdigest())
            self.assertIn("no merge or push", payload["scope"])

    def test_rejects_non_candidate_and_does_not_create_approval(self):
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / "report.json"
            report.write_text(json.dumps({
                "scheduled": True,
                "status": "conflicts",
                "recommendation": "manual-review",
            }), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "eligible"):
                approve_report(report, "operator")
            self.assertFalse(report.with_suffix(".approval.json").exists())


if __name__ == "__main__":
    unittest.main()
