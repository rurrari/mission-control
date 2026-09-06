#!/usr/bin/env python3
"""Reports newly-added Anki cards to the 'anki-sync' Mission Control agent's
working memory, so they show up in that agent's Activity tab on the dashboard.

Run after anki-snapshot.sh refreshes the snapshot copy. Tracks the last
reported note id in a state file so re-runs (every 5 min via
mc-anki-snapshot.timer) only report genuinely new cards, not the same
"latest word" over and over.
"""

import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

SNAPSHOT_PATH = Path(os.environ.get(
    "ANKI_SNAPSHOT_FILE",
    os.path.expanduser("~/.local/state/mc-anki-snapshot/collection.anki2"),
))
STATE_FILE = Path(os.environ.get(
    "ANKI_REPORT_STATE_FILE",
    os.path.expanduser("~/.local/state/mc-anki-snapshot/last-reported-id"),
))
MC_URL = os.environ.get("MC_URL", "http://localhost:3002")
MC_API_KEY_PATH = os.environ.get("MC_API_KEY_PATH", os.path.expanduser("~/.claude/orchestrator/mc-api-key"))
AGENT_NAME = "anki-sync"


def strip_html(value: str) -> str:
    import re
    return re.sub(r"\s+", " ", re.sub(r"<[^>]*>", " ", value)).strip()


def read_new_cards(since_id: int, limit: int = 20) -> list[tuple[int, str, str]]:
    con = sqlite3.connect(f"file:{SNAPSHOT_PATH}?mode=ro", uri=True)
    cur = con.cursor()
    cur.execute("SELECT id, flds FROM notes WHERE id > ? ORDER BY id ASC LIMIT ?", (since_id, limit))
    rows = cur.fetchall()
    con.close()

    cards = []
    for nid, flds in rows:
        parts = flds.split("\x1f")
        front = strip_html(parts[0] if parts else "")
        back = strip_html((parts[1] if len(parts) > 1 else "").split("<br>")[0])
        cards.append((nid, front, back))
    return cards


def report_to_mission_control(cards: list[tuple[int, str, str]]) -> None:
    lines = []
    for nid, front, back in cards:
        added = datetime.fromtimestamp(nid / 1000).strftime("%Y-%m-%d %H:%M")
        lines.append(f"{added} — {front} → {back}")
    body = json.dumps({"working_memory": "\n".join(lines), "append": True}).encode()

    api_key = MC_API_KEY_PATH and Path(MC_API_KEY_PATH).read_text().strip()
    req = urllib.request.Request(
        f"{MC_URL}/api/agents/{AGENT_NAME}/memory",
        data=body,
        method="PUT",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        resp.read()


def main() -> int:
    if not SNAPSHOT_PATH.exists():
        print(f"anki-report-latest: snapshot not found at {SNAPSHOT_PATH}", file=sys.stderr)
        return 1

    since_id = 0
    if STATE_FILE.exists():
        since_id = int(STATE_FILE.read_text().strip() or 0)

    cards = read_new_cards(since_id)
    if not cards:
        print("anki-report-latest: no new cards since last check")
        return 0

    try:
        report_to_mission_control(cards)
    except (urllib.error.URLError, urllib.error.HTTPError) as exc:
        print(f"anki-report-latest: failed to report to Mission Control: {exc}", file=sys.stderr)
        return 1

    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(str(cards[-1][0]))
    print(f"anki-report-latest: reported {len(cards)} new card(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
