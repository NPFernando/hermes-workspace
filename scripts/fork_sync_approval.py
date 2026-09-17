#!/usr/bin/env python3
"""Record explicit approval of one eligible fork-sync preview report.

This command records review evidence only. It never merges, rebases, pushes, or
changes the repository that was inspected.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from getpass import getuser
from pathlib import Path


def approve_report(report_path: Path, operator: str, note: str | None = None) -> Path:
    report_path = report_path.expanduser()
    if report_path.is_symlink() or not report_path.is_file():
        raise ValueError("report must be an existing regular file")
    report_path = report_path.resolve()
    try:
        payload = json.loads(report_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"cannot read valid JSON report: {error}") from error
    if not isinstance(payload, dict):
        raise ValueError("report must contain a JSON object")
    if payload.get("scheduled") is not True:
        raise ValueError("only scheduled preview reports can be approved")
    if payload.get("recommendation") != "manual-merge-candidate":
        raise ValueError("report is not an eligible manual-merge candidate")
    if payload.get("status") != "mergeable-tests-passed":
        raise ValueError("report does not show passing merge checks")
    operator = operator.strip()
    if not operator or len(operator) > 160:
        raise ValueError("operator is required and must be at most 160 characters")
    digest = hashlib.sha256(report_path.read_bytes()).hexdigest()
    approval_path = report_path.with_suffix(".approval.json")
    approval = {
        "schemaVersion": 1,
        "status": "approved-for-manual-integration",
        "approvedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "operator": operator,
        "reportPath": str(report_path),
        "reportSha256": digest,
        "reportStatus": payload["status"],
        "reportRecommendation": payload["recommendation"],
        "repository": payload.get("repo"),
        "branch": payload.get("branch"),
        "head": payload.get("head"),
        "upstreamHead": payload.get("upstreamHead"),
        "note": note.strip() if note else None,
        "scope": "review evidence only; no merge or push performed",
    }
    with approval_path.open("x", encoding="utf-8") as approval_file:
        approval_file.write(json.dumps(approval, indent=2, sort_keys=True))
        approval_file.write("\n")
    approval_path.chmod(0o600)
    return approval_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument(
        "--operator",
        default=os.environ.get("HERMES_FORK_SYNC_OPERATOR") or getuser(),
    )
    parser.add_argument("--note")
    args = parser.parse_args()
    try:
        approval_path = approve_report(args.report, args.operator, args.note)
    except (OSError, ValueError) as error:
        print(json.dumps({"status": "error", "error": str(error)[:1000]}, indent=2))
        return 1
    print(json.dumps({"status": "approved", "approvalPath": str(approval_path)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
