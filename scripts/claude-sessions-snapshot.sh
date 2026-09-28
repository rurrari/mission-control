#!/usr/bin/env bash
# Mirrors ~/.claude/projects (session transcripts) into a world-readable
# snapshot the mission-control Docker container (running as uid 1001) can
# read via a read-only bind mount.
#
# Same reason as anki-snapshot.sh: the source tree is 0700/0600 (Claude Code
# writes it that way), so the container's uid can never read it directly no
# matter what's mounted. rsync --chmod normalizes permissions on the copy
# without touching the real session files.

set -euo pipefail

SOURCE="${CLAUDE_PROJECTS_SOURCE:-$HOME/.claude/projects}/"
SNAPSHOT_DIR="${CLAUDE_SESSIONS_SNAPSHOT_DIR:-$HOME/.local/state/mc-claude-sessions-snapshot}/projects/"

mkdir -p "$SNAPSHOT_DIR"

rsync -a --delete \
  --chmod=D755,F644 \
  --exclude='*.lock' \
  "$SOURCE" "$SNAPSHOT_DIR"

chmod 755 "$(dirname "$SNAPSHOT_DIR")"

echo "claude-sessions-snapshot: synced $SOURCE -> $SNAPSHOT_DIR"
