#!/usr/bin/env python3
"""Write a timestamped, read-only fork synchronization preview report.

This wrapper intentionally delegates conflict and patch analysis to
fork_sync_assistant.preview(). It never merges, pushes, or overwrites a prior
report. Configure HERMES_FORK_SYNC_REPO and HERMES_FORK_SYNC_REMOTE for the
systemd timer, or pass --repo/--remote directly.
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

try:
    from fork_sync_assistant import preview
except ModuleNotFoundError:  # Support imports from the repository root in tests.
    from scripts.fork_sync_assistant import preview


def write_preview_report(
    repo: Path,
    remote: str,
    output_dir: Path,
    branch: str | None = None,
    check_command: str | None = None,
    cached: bool = False,
) -> Path:
    repo = repo.expanduser().resolve()
    output_dir = output_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    generated_at = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    report_path = output_dir / f'{repo.name}-{generated_at}.json'
    payload = preview(repo, remote, branch, check_command, cached)
    if not isinstance(payload, dict):
        raise RuntimeError('fork preview returned a non-object report')
    payload = {
        'scheduled': True,
        'generatedAt': generated_at,
        'reportPath': str(report_path),
        **payload,
    }
    # Exclusive creation protects historical evidence if two timer invocations
    # happen to share a timestamp or an operator runs one manually.
    with report_path.open('x', encoding='utf-8') as report_file:
        report_file.write(json.dumps(payload, indent=2, sort_keys=True))
        report_file.write('\n')
    report_path.chmod(0o600)
    return report_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=None)
    parser.add_argument('--remote', default=None)
    parser.add_argument('--branch')
    parser.add_argument('--check-command')
    parser.add_argument('--cached', action='store_true')
    parser.add_argument(
        '--output-dir',
        type=Path,
        default=Path(os.environ.get('HERMES_FORK_SYNC_REPORT_DIR', '~/.hermes/fork-sync-previews')),
    )
    args = parser.parse_args()
    repo = args.repo or (Path(os.environ['HERMES_FORK_SYNC_REPO']) if os.environ.get('HERMES_FORK_SYNC_REPO') else None)
    remote = args.remote or os.environ.get('HERMES_FORK_SYNC_REMOTE', 'upstream')
    if repo is None:
        parser.error('--repo or HERMES_FORK_SYNC_REPO is required')
    try:
        report_path = write_preview_report(
            repo,
            remote,
            args.output_dir,
            args.branch,
            args.check_command,
            args.cached,
        )
    except Exception as error:  # noqa: BLE001 - CLI must return a concise failure
        print(json.dumps({'status': 'error', 'error': str(error)[:1000]}, indent=2))
        return 1
    print(json.dumps({'status': 'written', 'reportPath': str(report_path)}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
