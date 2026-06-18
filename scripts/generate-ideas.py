#!/usr/bin/env python3
"""
generate-ideas.py — Generate workspace improvement ideas and add them to the task board.

Usage:
  python3 scripts/generate-ideas.py           # generate + inject into board
  python3 scripts/generate-ideas.py --dry-run  # print ideas without saving
  python3 scripts/generate-ideas.py --count 5  # generate N ideas (default 5)

The script:
  1. Reads existing IDEAS.json and tasks.json to avoid duplicates
  2. Calls hermes to generate new workspace improvement ideas
  3. Appends new ideas to IDEAS.json
  4. Calls POST /api/tasks-inject-ideas to push them to the task board
  5. Calls POST /api/tasks-astra-review to trigger Astra prioritisation

Designed to run weekly via systemd timer or hermes cron.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

WORKSPACE_DIR = Path(__file__).parent.parent
IDEAS_FILE = WORKSPACE_DIR / 'IDEAS.json'
HERMES_HOME = Path(os.environ.get('HERMES_HOME') or os.environ.get('CLAUDE_HOME') or Path.home() / '.hermes')
TASKS_FILE = HERMES_HOME / 'tasks.json'
WORKSPACE_API = 'http://127.0.0.1:3000'

CATEGORIES = ['ui', 'agent', 'automation', 'memory', 'performance', 'integration', 'devx', 'monitoring']


def load_ideas() -> list[dict]:
    try:
        return json.loads(IDEAS_FILE.read_text()) if IDEAS_FILE.exists() else []
    except Exception:
        return []


def load_tasks() -> list[dict]:
    try:
        data = json.loads(TASKS_FILE.read_text()) if TASKS_FILE.exists() else {}
        return data.get('tasks', [])
    except Exception:
        return []


def existing_titles(ideas: list[dict], tasks: list[dict]) -> set[str]:
    titles: set[str] = set()
    for item in ideas:
        if item.get('title'):
            titles.add(item['title'].lower())
    for task in tasks:
        if task.get('title'):
            titles.add(task['title'].lower())
    return titles


def generate_ideas_via_hermes(count: int, existing: set[str]) -> list[dict]:
    existing_sample = json.dumps(list(existing)[:20])
    prompt = f"""You are Astra, the orchestrator for the Hermes workspace — an AI agent platform running on an OCI ARM64 VM.

Generate {count} concrete, actionable improvement ideas for the workspace UI or agent system.

Rules:
- Each idea must be implementable as a single focused task
- Focus on: UI improvements, agent capabilities, automation, integrations, monitoring, developer experience
- DO NOT suggest anything already in this list: {existing_sample}
- Be specific — "Add keyboard shortcut to task board" not "improve UX"

Return a JSON array only — no prose, no markdown fences:
[
  {{
    "title": "...",
    "description": "...",
    "category": "{CATEGORIES[0]}",
    "estimated_effort": "low|medium|high"
  }}
]
"""
    result = subprocess.run(
        ['hermes', '-z', prompt],
        capture_output=True, text=True, timeout=60,
    )
    if result.returncode != 0 or not result.stdout.strip():
        print(f'[ideas] hermes failed: {result.stderr[:300]}', file=sys.stderr)
        return []

    raw = result.stdout.strip()
    # Extract JSON array from response
    try:
        ideas = json.loads(raw)
        if isinstance(ideas, list):
            return ideas
    except json.JSONDecodeError:
        pass
    # Try to find a JSON array in the response
    import re
    match = re.search(r'\[\s*\{[\s\S]*?\}\s*\]', raw)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass
    print('[ideas] could not parse hermes response as JSON', file=sys.stderr)
    return []


def save_ideas(ideas: list[dict]) -> None:
    IDEAS_FILE.write_text(json.dumps(ideas, indent=2) + '\n')


def api_post(path: str) -> dict:
    url = f'{WORKSPACE_API}{path}'
    req = urllib.request.Request(url, data=b'{}', method='POST',
                                  headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except Exception as e:
        return {'ok': False, 'error': str(e)}


def notify_telegram(message: str) -> None:
    try:
        from hermes_tools import send_message  # type: ignore
        send_message(target='telegram:-1003820054153:14', message=message)
    except Exception:
        pass


def main() -> None:
    parser = argparse.ArgumentParser(description='Generate workspace ideas and add to task board')
    parser.add_argument('--dry-run', action='store_true', help='Print ideas without saving')
    parser.add_argument('--count', type=int, default=5, help='Number of new ideas to generate')
    args = parser.parse_args()

    existing_ideas = load_ideas()
    existing_tasks = load_tasks()
    known = existing_titles(existing_ideas, existing_tasks)

    print(f'[ideas] Generating {args.count} ideas ({len(known)} titles already known)…')
    new_ideas = generate_ideas_via_hermes(args.count, known)

    # Filter strict duplicates
    new_ideas = [
        idea for idea in new_ideas
        if isinstance(idea, dict) and idea.get('title')
        and idea['title'].lower() not in known
    ]

    if not new_ideas:
        print('[ideas] No new ideas generated.')
        return

    print(f'[ideas] Got {len(new_ideas)} new ideas:')
    for idea in new_ideas:
        print(f'  • [{idea.get("estimated_effort","?")}] {idea["title"]}')

    if args.dry_run:
        print('[ideas] --dry-run: not saving.')
        return

    # Append to IDEAS.json
    all_ideas = existing_ideas + new_ideas
    save_ideas(all_ideas)
    print(f'[ideas] Saved {len(all_ideas)} total ideas to {IDEAS_FILE}')

    # Inject into task board
    inject_result = api_post('/api/tasks-inject-ideas')
    injected = inject_result.get('injected', 0)
    print(f'[ideas] Injected {injected} tasks into backlog.')

    # Trigger Astra review if tasks were added
    if injected > 0:
        review_result = api_post('/api/tasks-astra-review')
        task_count = review_result.get('taskCount', 0)
        print(f'[ideas] Triggered Astra review for {task_count} tasks.')

        ts = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
        titles = ', '.join(i['title'] for i in new_ideas[:3])
        suffix = f' +{len(new_ideas)-3} more' if len(new_ideas) > 3 else ''
        notify_telegram(
            f'💡 <b>Idea job ran</b> [{ts}]\n'
            f'Added {injected} new tasks to backlog.\n'
            f'Ideas: {titles}{suffix}\n'
            f'Astra is reviewing {task_count} tasks.'
        )


if __name__ == '__main__':
    main()
