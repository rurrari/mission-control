#!/usr/bin/env bash
# Copies the live Anki collection to a world-readable snapshot the mission-control
# Docker container (running as uid 1001) can read via a read-only bind mount.
#
# Why a copy instead of mounting the live file directly: Anki chmods its own
# collection.anki2 back to 0600 on every save, and POSIX ACLs granting another
# uid/gid read access get wiped by that chmod too (chmod's group bits reset the
# ACL mask, which caps any named grants to zero). A periodic copy with an
# explicit 0644 sidesteps that entirely, at the cost of the widget lagging
# behind the live collection by up to one snapshot interval.

set -euo pipefail

SOURCE="${ANKI_COLLECTION_SOURCE:-$HOME/.local/share/anki/English/collection.anki2}"
SNAPSHOT_DIR="${ANKI_SNAPSHOT_DIR:-$HOME/.local/state/mc-anki-snapshot}"
SNAPSHOT_FILE="$SNAPSHOT_DIR/collection.anki2"

if [ ! -f "$SOURCE" ]; then
  echo "anki-snapshot: source collection not found at $SOURCE" >&2
  exit 1
fi

mkdir -p "$SNAPSHOT_DIR"
chmod 755 "$SNAPSHOT_DIR"

TMP_FILE="$SNAPSHOT_FILE.tmp.$$"
cp "$SOURCE" "$TMP_FILE"
chmod 644 "$TMP_FILE"
mv -f "$TMP_FILE" "$SNAPSHOT_FILE"

echo "anki-snapshot: refreshed $SNAPSHOT_FILE from $SOURCE"
