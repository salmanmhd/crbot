#!/usr/bin/env bash
# Restore the experiment state from the `paper-state` branch into ./out (empty dir if the branch doesn't exist yet).
set -euo pipefail
OUT="${1:-out}"
rm -rf "$OUT"
URL="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
if git ls-remote --exit-code --heads "$URL" paper-state >/dev/null 2>&1; then
  git clone -q --depth 1 --branch paper-state "$URL" "$OUT"
  echo "restored paper-state ($(du -sh "$OUT/state" 2>/dev/null | cut -f1) of state)"
else
  mkdir -p "$OUT"
  echo "no paper-state branch yet (fresh start)"
fi
