import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import fork_sync_scheduled_preview


class ScheduledPreviewTests(unittest.TestCase):
    def test_writes_private_timestamped_report_without_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'reports'
            with patch.object(
                fork_sync_scheduled_preview,
                'preview',
                return_value={
                    'status': 'needs-review',
                    'recommendation': 'manual-review',
                    'overlappingFiles': ['src/app.ts'],
                },
            ):
                first = fork_sync_scheduled_preview.write_preview_report(
                    Path(directory) / 'fork', 'upstream', output
                )
            self.assertEqual(first.stat().st_mode & 0o777, 0o600)
            payload = json.loads(first.read_text())
            self.assertTrue(payload['scheduled'])
            self.assertEqual(payload['overlappingFiles'], ['src/app.ts'])
            self.assertEqual(len(list(output.glob('*.json'))), 1)

    def test_passes_check_commands_as_a_list_to_the_assistant(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'reports'
            with patch.object(
                fork_sync_scheduled_preview,
                'preview',
                return_value={'status': 'ready'},
            ) as preview:
                fork_sync_scheduled_preview.write_preview_report(
                    Path(directory) / 'fork',
                    'origin',
                    output,
                    check_commands=['pnpm run typecheck', 'pnpm test'],
                )
            preview.assert_called_once_with(
                (Path(directory) / 'fork').resolve(),
                'origin',
                None,
                ['pnpm run typecheck', 'pnpm test'],
                False,
            )


if __name__ == '__main__':
    unittest.main()
