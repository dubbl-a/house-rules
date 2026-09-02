#!/usr/bin/env bash
# Exercises plugins/house/templates/pre-commit against real git staging, in a
# throwaway repo (mktemp -d) per case, so the hook's own behavior is proven
# before anything downstream trusts it. Positive control: a file the hook
# must block. Negative controls: an ordinary file, and an allowlisted file
# that matches a PIIPATTERNS entry on purpose, must both pass.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOK_SRC="$REPO_ROOT/plugins/house/templates/pre-commit"
fail=0

new_repo() {
  local dir
  dir=$(mktemp -d)
  git -C "$dir" init -q
  git -C "$dir" config user.email "test@example.com"
  git -C "$dir" config user.name "pre-commit test"
  git -C "$dir" config commit.gpgsign false
  install -m 0755 "$HOOK_SRC" "$dir/.git/hooks/pre-commit"
  echo "$dir"
}

assert_blocked() {
  local repo="$1" msg="$2" out rc=0
  out=$(git -C "$repo" commit -q -m "$msg" 2>&1) || rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "FAIL: $msg — pre-commit let a blocked file through"
    fail=1
  else
    echo "ok: $msg — refused"
  fi
}

assert_passed() {
  local repo="$1" msg="$2" out rc=0
  out=$(git -C "$repo" commit -q -m "$msg" 2>&1) || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "FAIL: $msg — pre-commit blocked a file it should have let through"
    echo "$out"
    fail=1
  else
    echo "ok: $msg — passed"
  fi
}

# --- positive control: staging a fake .env must be refused ---
repo=$(new_repo)
echo "SECRET=1" > "$repo/.env"
git -C "$repo" add .env
assert_blocked "$repo" "stage a fake .env"
rm -rf "$repo"

# --- negative control: an ordinary file must pass ---
repo=$(new_repo)
echo "hello" > "$repo/README.md"
git -C "$repo" add README.md
assert_passed "$repo" "stage an ordinary file"
rm -rf "$repo"

# --- allowlisted file must pass despite matching a PIIPATTERNS entry ---
repo=$(new_repo)
mkdir -p "$repo/migrations"
echo "-- schema" > "$repo/migrations/001_init.sql"
git -C "$repo" add migrations/001_init.sql
assert_passed "$repo" "stage an allowlisted migrations/*.sql file"
rm -rf "$repo"

exit $fail
