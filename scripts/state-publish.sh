#!/usr/bin/env bash
# Commit ./out to the `paper-state` branch.
# Default: a single orphan commit force-pushed every time, so the repo does NOT grow by ~5MB per tick
# (576 ticks x 5MB would be ~3GB of history). Set KEEP_HISTORY=1 for ordinary incremental commits instead.
set -euo pipefail
push_retry() { for i in 1 2 3 4; do "$@" && return 0; echo "push failed (attempt $i), retrying"; sleep $((i*3)); done; return 1; }
OUT="${1:-out}"
cd "$OUT"
URL="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
if [ "${KEEP_HISTORY:-0}" = "1" ] && [ -d .git ]; then
  git config user.name "paper-lab[bot]"; git config user.email "paper-lab@users.noreply.github.com"
  git add -A
  git diff --cached --quiet && { echo "nothing to commit"; exit 0; }
  git commit -q -m "state $(date -u +%FT%TZ)"
  push_retry git push -q origin HEAD:paper-state
else
  rm -rf .git
  git init -q -b paper-state
  git config user.name "paper-lab[bot]"; git config user.email "paper-lab@users.noreply.github.com"
  git add -A
  git commit -q -m "state $(date -u +%FT%TZ)"
  git remote add origin "$URL"
  push_retry git push -q --force origin paper-state
fi
echo "published state at $(date -u +%FT%TZ)"
