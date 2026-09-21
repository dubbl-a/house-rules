#!/usr/bin/env bash
# house: arm the vendored git-hook floor (issue #58, ADR 0013).
#
# The floor is `.githooks/` in an adopting repo: dispatchers plus the
# `10-house-branch` guards the github module vendors. git only runs them when
# `core.hooksPath` points at that directory, and `core.hooksPath` is MACHINE
# state -- it lives in .git/config, which no clone, no render and no PR can
# carry. So every fresh clone starts unarmed, and this one script is what arms
# it, read three ways so the arming logic and the report can never disagree:
#
#   1. `house render --apply` runs it with --repo <root> after writing files.
#   2. The plugin's SessionStart hook runs it with no --repo, taking the repo
#      from the payload's `cwd` on stdin.
#   3. `house doctor` runs it with --probe --json and prints what it reports.
#
# Contract: never exits non-zero, never blocks, never overwrites somebody
# else's hooksPath, and never arms a repo whose own .git/hooks already holds a
# foreign hook (setting core.hooksPath would silently disable it). SessionStart
# stdout is injected into the session context, so this prints at most one short
# line, and only when it changed something or something is wrong.
#
# bash 3.2 compatible (macOS /bin/bash): no associative arrays, no mapfile.

set -u

SELF_DIR=$(cd "$(dirname "$0")" 2>/dev/null && pwd -P)
PLUGIN_ROOT=$(cd "$SELF_DIR/.." 2>/dev/null && pwd -P)

REPO_ARG=""
PROBE=0
JSON=0

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO_ARG="${2:-}"; shift 2 ;;
    --repo=*) REPO_ARG="${1#--repo=}"; shift ;;
    --probe) PROBE=1; shift ;;
    --json) JSON=1; shift ;;
    *) shift ;;
  esac
done

# Every hook name git 2.23 through 2.54 knows, minus the .sample suffix. A file
# in .git/hooks with one of these names and the execute bit is a hook git would
# run today, which is exactly what core.hooksPath would silence.
HOOK_NAMES="applypatch-msg pre-applypatch post-applypatch pre-commit pre-merge-commit \
prepare-commit-msg commit-msg post-commit pre-rebase post-checkout post-merge \
pre-push pre-receive update proc-receive post-receive post-update \
reference-transaction push-to-checkout pre-auto-gc post-rewrite sendemail-validate \
fsmonitor-watchman p4-changelist p4-prepare-changelist p4-post-changelist \
p4-pre-submit post-index-change"

# The seven paths the github module vendors under .githooks/. git silently
# ignores a hook without the execute bit (githooks(5)), so a lost mode bit is a
# fail-open, not a cosmetic problem.
#
# THE FLOOR IS THESE SEVEN FILES, and three places have to say so: this list,
# `GUARD_FLOOR_FILES` in plugins/house/payload/check.mjs, and the `.githooks/`
# dests in plugins/house/modules/github/module.json. A list that drifted would
# let a checker call a floor complete that this script calls unrendered, so
# `tests/check/guard.test.mjs` reads all three and asserts they are the same
# set. Add a file to the floor in all three, or in none.
FLOOR_FILES="pre-commit pre-push reference-transaction house-lib.sh \
pre-commit.d/10-house-branch pre-push.d/10-house-branch \
reference-transaction.d/10-house-branch"

# JSON forbids a raw control character inside a string, and this output is
# parsed by `house doctor` with JSON.parse: a path holding a newline or a tab
# (git config values and branch names can) used to produce a document doctor
# silently reported as "unknown" instead of a floor state. Backslash and quote
# first, then the five short escapes, then anything left in 0x00 to 0x1f as
# \u00XX. The loop only runs when a control byte survived the substitutions.
json_escape() {
  local s="$1" out rest ch
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/\\r}
  s=${s//$'\t'/\\t}
  s=${s//$'\b'/\\b}
  s=${s//$'\f'/\\f}
  case "$s" in
    *[[:cntrl:]]*)
      out=""
      rest="$s"
      while [ -n "$rest" ]; do
        ch="${rest%"${rest#?}"}"
        rest="${rest#?}"
        case "$ch" in
          [[:cntrl:]]) out="$out$(printf '\\u%04x' "'$ch")" ;;
          *) out="$out$ch" ;;
        esac
      done
      s="$out"
      ;;
  esac
  printf '%s' "$s"
}

json_array() {
  # Each argument becomes one string element.
  local out="" item
  for item in "$@"; do
    if [ -n "$out" ]; then out="$out, "; fi
    out="$out\"$(json_escape "$item")\""
  done
  printf '[%s]' "$out"
}

json_string_or_null() {
  if [ -z "$1" ]; then printf 'null'; else printf '"%s"' "$(json_escape "$1")"; fi
}

json_bool() { if [ "$1" = "1" ]; then printf 'true'; else printf 'false'; fi; }

# An absolute, symlink-resolved path for a directory that exists; otherwise the
# input made absolute against $2 and left unresolved, so two spellings of the
# same existing directory compare equal and a nonexistent one still compares.
normalize_dir() {
  local p="$1" base="$2"
  case "$p" in
    /*) ;;
    *) p="$base/$p" ;;
  esac
  if [ -d "$p" ]; then
    (cd "$p" 2>/dev/null && pwd -P) || printf '%s\n' "$p"
  else
    printf '%s\n' "$p"
  fi
}

git_version_number() {
  git --version 2>/dev/null | sed -n 's/^git version \([0-9][0-9.]*\).*/\1/p' | head -1
}

# reference-transaction landed in git 2.28; older git never calls it, which is
# documented rather than worked around (the pre-commit and pre-push guards
# still cover the ordinary paths there).
version_ge_2_28() {
  local v="$1" major minor rest
  [ -n "$v" ] || return 1
  major="${v%%.*}"
  rest="${v#*.}"
  minor="${rest%%.*}"
  case "$major" in ''|*[!0-9]*) return 1 ;; esac
  case "$minor" in ''|*[!0-9]*) return 1 ;; esac
  [ "$major" -gt 2 ] && return 0
  [ "$major" -eq 2 ] && [ "$minor" -ge 28 ] && return 0
  return 1
}

# branchPolicy out of house.json: jq, else node, else a line scan. Unlike the
# hooks themselves this script is a diagnostic that must never block, so the
# last resort is a best-effort read rather than a refusal.
read_branch_policy() {
  local f="$1" v=""
  if command -v jq >/dev/null 2>&1; then
    v=$(jq -r 'if type == "object" and (.branchPolicy | type) == "string" then .branchPolicy else empty end' "$f" 2>/dev/null)
    printf '%s' "$v"
    return 0
  fi
  if command -v node >/dev/null 2>&1; then
    v=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(j&&typeof j.branchPolicy==="string")process.stdout.write(j.branchPolicy);}catch(e){}' "$f" 2>/dev/null)
    printf '%s' "$v"
    return 0
  fi
  sed -n 's/.*"branchPolicy"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$f" 2>/dev/null | head -1 | tr -d '\n'
}

# ── resolve the target repo ──────────────────────────────────────────────
#
# With --repo, the caller named it. Without, this is the SessionStart hook and
# the repo is the payload's `cwd`, read from stdin as JSON. jq missing there is
# a silent exit 0: a session must never be slowed or noised by a hook that
# cannot parse its own payload, and render and doctor still arm and report.

TARGET="$REPO_ARG"
if [ -z "$TARGET" ]; then
  command -v jq >/dev/null 2>&1 || exit 0
  PAYLOAD=$(cat 2>/dev/null || true)
  TARGET=$(printf '%s' "$PAYLOAD" | jq -r 'if type == "object" and (.cwd | type) == "string" then .cwd else empty end' 2>/dev/null)
  [ -n "$TARGET" ] || exit 0
fi
[ -d "$TARGET" ] || exit 0

GIT_VERSION=$(git_version_number)
REF_TXN_SUPPORTED=0
version_ge_2_28 "$GIT_VERSION" && REF_TXN_SUPPORTED=1

TOPLEVEL=$(git -C "$TARGET" rev-parse --show-toplevel 2>/dev/null)
if [ -z "$TOPLEVEL" ]; then
  # Not a git repository (or a bare one): nothing to arm, nothing to report.
  if [ "$PROBE" = "1" ] && [ "$JSON" = "1" ]; then
    printf '{"applicable": false, "rendered": false, "missing": [], "linkedWorktree": false, "hooksPath": null, "hooksPathScope": null, "armed": false, "foreignHooks": [], "nonExecutable": [], "gitVersion": %s, "referenceTransactionSupported": %s}\n' \
      "$(json_string_or_null "$GIT_VERSION")" "$(json_bool "$REF_TXN_SUPPORTED")"
  fi
  exit 0
fi
TOPLEVEL=$(normalize_dir "$TOPLEVEL" "$TARGET")
FLOOR_DIR="$TOPLEVEL/.githooks"

# ── applicability ────────────────────────────────────────────────────────

APPLICABLE=0
if [ -f "$TOPLEVEL/house.json" ]; then
  POLICY=$(read_branch_policy "$TOPLEVEL/house.json")
  [ "$POLICY" = "pr" ] && APPLICABLE=1
fi

# Rendered means ALL SEVEN are on disk, not just the dispatcher. house-lib.sh
# is the one that matters most to get right here: every guard sources it and
# exits non-zero when the source fails, so a floor missing only the library
# fails every commit closed rather than failing open, and "rendered" has to be
# false so the report says which file to bring back.
MISSING=""
for rel in $FLOOR_FILES; do
  [ -f "$FLOOR_DIR/$rel" ] || MISSING="$MISSING $rel"
done
MISSING="${MISSING# }"
RENDERED=0
[ -z "$MISSING" ] && RENDERED=1

# ── current hooksPath and its scope ──────────────────────────────────────
#
# Plain --get, not --local: a hooksPath set globally governs this repo too, and
# reporting only the local scope would claim "unset" for a repo git is already
# routing elsewhere. --show-origin names which file decided it.

HOOKS_PATH=$(git -C "$TOPLEVEL" config --get core.hooksPath 2>/dev/null)
HOOKS_PATH_SCOPE=""
if [ -n "$HOOKS_PATH" ]; then
  ORIGIN_LINE=$(git -C "$TOPLEVEL" config --show-origin --get core.hooksPath 2>/dev/null | head -1)
  HOOKS_PATH_SCOPE="${ORIGIN_LINE%%	*}"
  [ "$HOOKS_PATH_SCOPE" = "$ORIGIN_LINE" ] && HOOKS_PATH_SCOPE=""
fi

# ── the main checkout, and whether this one is a linked worktree ─────────
#
# --git-common-dir, not --git-dir: a linked worktree has its own .git dir but
# SHARES config and hooks with the main checkout. That sharing is what makes
# the floor work across worktrees (arm once, every worktree inherits it), and
# it is also the trap: a core.hooksPath naming a worktree's own .githooks would
# follow the main checkout around and dangle the moment that worktree is
# removed, after which git runs no hooks at all and says nothing. So a linked
# worktree never writes the setting; it reports where to set it instead.

GIT_COMMON_DIR=$(git -C "$TOPLEVEL" rev-parse --git-common-dir 2>/dev/null)
[ -n "$GIT_COMMON_DIR" ] || GIT_COMMON_DIR="$TOPLEVEL/.git"
GIT_COMMON_DIR=$(normalize_dir "$GIT_COMMON_DIR" "$TOPLEVEL")

GIT_DIR_HERE=$(git -C "$TOPLEVEL" rev-parse --absolute-git-dir 2>/dev/null)
[ -n "$GIT_DIR_HERE" ] || GIT_DIR_HERE="$TOPLEVEL/.git"
GIT_DIR_HERE=$(normalize_dir "$GIT_DIR_HERE" "$TOPLEVEL")

LINKED=0
[ "$GIT_DIR_HERE" = "$GIT_COMMON_DIR" ] || LINKED=1

MAIN_TOPLEVEL=""
case "$GIT_COMMON_DIR" in
  */.git)
    cand="${GIT_COMMON_DIR%/.git}"
    [ -d "$cand" ] && MAIN_TOPLEVEL="$cand"
    ;;
esac
MAIN_FLOOR_DIR=""
[ -n "$MAIN_TOPLEVEL" ] && MAIN_FLOOR_DIR="$MAIN_TOPLEVEL/.githooks"

# Armed means "git will run house's hooks here", which the main checkout's
# .githooks satisfies just as well as this worktree's: the hooks ask git for
# the toplevel themselves, so a worktree running the main checkout's copy still
# reads the worktree's own house.json and branch.
#
# One predicate, because the arming write below has to ask the same question a
# second time: when two SessionStart hooks race, one of them loses .git/config
# to the other's lock, and a loser that reported "NOT armed" would be lying
# about a repo the winner had just armed.
path_is_floor() {
  local value="$1" resolved cand
  [ -n "$value" ] || return 1
  resolved=$(normalize_dir "$value" "$TOPLEVEL")
  for cand in "$FLOOR_DIR" "$MAIN_FLOOR_DIR"; do
    [ -n "$cand" ] || continue
    [ "$resolved" = "$(normalize_dir "$cand" "$TOPLEVEL")" ] && return 0
  done
  return 1
}

ARMED=0
path_is_floor "$HOOKS_PATH" && ARMED=1

# ── foreign hooks in the repo's own hooks directory ──────────────────────

FOREIGN=""
for name in $HOOK_NAMES; do
  f="$GIT_COMMON_DIR/hooks/$name"
  if [ -f "$f" ] && [ -x "$f" ]; then
    FOREIGN="$FOREIGN $name"
  fi
done
FOREIGN="${FOREIGN# }"

# ── floor files that exist but lost the execute bit ──────────────────────

NON_EXEC=""
for rel in $FLOOR_FILES; do
  f="$FLOOR_DIR/$rel"
  if [ -f "$f" ] && [ ! -x "$f" ]; then
    NON_EXEC="$NON_EXEC $rel"
  fi
done
NON_EXEC="${NON_EXEC# }"

# ── probe mode: report, change nothing ───────────────────────────────────

if [ "$PROBE" = "1" ]; then
  if [ "$JSON" = "1" ]; then
    # MISSING, FOREIGN and NON_EXEC are space-separated lists; the splitting is
    # the point.
    # shellcheck disable=SC2086
    printf '{"applicable": %s, "rendered": %s, "missing": %s, "linkedWorktree": %s, "hooksPath": %s, "hooksPathScope": %s, "armed": %s, "foreignHooks": %s, "nonExecutable": %s, "gitVersion": %s, "referenceTransactionSupported": %s}\n' \
      "$(json_bool "$APPLICABLE")" \
      "$(json_bool "$RENDERED")" \
      "$(json_array $MISSING)" \
      "$(json_bool "$LINKED")" \
      "$(json_string_or_null "$HOOKS_PATH")" \
      "$(json_string_or_null "$HOOKS_PATH_SCOPE")" \
      "$(json_bool "$ARMED")" \
      "$(json_array $FOREIGN)" \
      "$(json_array $NON_EXEC)" \
      "$(json_string_or_null "$GIT_VERSION")" \
      "$(json_bool "$REF_TXN_SUPPORTED")"
  else
    printf 'applicable=%s rendered=%s armed=%s hooksPath=%s missing=%s\n' \
      "$APPLICABLE" "$RENDERED" "$ARMED" "${HOOKS_PATH:-<unset>}" "${MISSING:-none}"
  fi
  exit 0
fi

# ── arm ──────────────────────────────────────────────────────────────────

[ "$APPLICABLE" = "1" ] || exit 0

if [ "$RENDERED" != "1" ]; then
  # MISSING is a space-separated list; the splitting is the point.
  # shellcheck disable=SC2086
  printf 'house: git-hook floor not rendered here (missing:%s; run: node %s/scripts/house render --apply)\n' \
    "$(printf ' %s' $MISSING)" "$PLUGIN_ROOT"
  exit 0
fi

FIXED=""
for rel in $NON_EXEC; do
  if chmod +x "$FLOOR_DIR/$rel" 2>/dev/null; then
    FIXED="$FIXED $rel"
  fi
done
FIXED="${FIXED# }"
FIXED_SUFFIX=""
# FIXED is a space-separated list; the splitting is the point.
# shellcheck disable=SC2086
[ -n "$FIXED" ] && FIXED_SUFFIX="; restored the execute bit on:$(printf ' %s' $FIXED)"

if [ "$ARMED" = "1" ]; then
  # Already pointing at the floor: silent unless a mode bit had to come back.
  [ -n "$FIXED" ] && printf 'house: restored the execute bit on the git-hook floor:%s\n' "${FIXED_SUFFIX#; restored the execute bit on:}"
  exit 0
fi

if [ -n "$HOOKS_PATH" ]; then
  # Somebody else (husky, lefthook, a monorepo convention) owns the one
  # hooksPath this repo has. Never overwrite it; say how to chain instead.
  printf "house: core.hooksPath is %s (%s), git-hook floor NOT armed; chain it: add 'bash %s/pre-commit \"\$@\"' (and pre-push, reference-transaction) to the hooks there, or unset it and re-run%s\n" \
    "$HOOKS_PATH" "${HOOKS_PATH_SCOPE:-unknown scope}" "$FLOOR_DIR" "$FIXED_SUFFIX"
  exit 0
fi

if [ "$LINKED" = "1" ]; then
  # Unset, and this checkout must not be the one to set it: core.hooksPath
  # lives in the config this worktree SHARES with the main checkout, so writing
  # this worktree's own absolute path would leave the main clone pointing at a
  # directory that disappears with the worktree, after which git runs no hooks
  # and says nothing. Arm the main checkout once; every worktree inherits it,
  # and the hooks ask git for the toplevel themselves, so they still read this
  # worktree's house.json and branch.
  printf 'house: git-hook floor NOT armed, and core.hooksPath is shared with the main checkout, so set it there: git config core.hooksPath "%s" (from %s)%s\n' \
    "${MAIN_FLOOR_DIR:-<main-checkout>/.githooks}" "${MAIN_TOPLEVEL:-the main checkout}" "$FIXED_SUFFIX"
  exit 0
fi

if [ -n "$FOREIGN" ]; then
  # core.hooksPath replaces .git/hooks wholesale rather than adding to it, so
  # arming here would silently disable hooks the repo is relying on today.
  printf 'house: git-hook floor NOT armed: %s/hooks already has its own executable hook(s) (%s) and core.hooksPath would silently disable them; chain them (call %s/<hook> "$@" from each) or move them into %s/<hook>.d/, then re-run%s\n' \
    "$GIT_COMMON_DIR" "$(printf '%s' "$FOREIGN" | tr ' ' ',' | sed 's/,/, /g')" "$FLOOR_DIR" "$FLOOR_DIR" "$FIXED_SUFFIX"
  exit 0
fi

# A losing write is the ordinary case, not the exceptional one. SessionStart
# fires this script for every window, and `house render --apply` runs it too,
# so several copies reach for .git/config.lock at the same instant; git does not
# queue, it just fails the ones that did not get the lock. Ten concurrent runs
# produced thirty-nine "NOT armed" lines about a repo that was being armed.
#
# So a failed write asks two more questions before it says anything. Is the
# floor armed NOW (the winner finished, and whoever armed it, this run has
# nothing to report)? And if not, is it worth waiting a moment and trying again
# (the winner is mid-write, holding the lock it has not renamed yet)? Only a
# run that still cannot see an armed floor after that reports a failure.
ARM_RESULT=""
ARM_TRY=1
while :; do
  if git -C "$TOPLEVEL" config core.hooksPath "$FLOOR_DIR" 2>/dev/null; then
    ARM_RESULT="self"
    break
  fi
  HOOKS_PATH=$(git -C "$TOPLEVEL" config --get core.hooksPath 2>/dev/null)
  if path_is_floor "$HOOKS_PATH"; then
    ARM_RESULT="other"
    break
  fi
  [ "$ARM_TRY" -ge 8 ] && break
  ARM_TRY=$((ARM_TRY + 1))
  # Fractional sleep is a BSD/GNU extension both platforms have; a shell whose
  # sleep rejects it simply retries immediately, which is still better than
  # reporting a floor unarmed because another process was writing it.
  sleep 0.05 2>/dev/null || true
done

if [ "$ARM_RESULT" = "self" ]; then
  printf 'house: armed git hooks (core.hooksPath=%s)%s\n' "$FLOOR_DIR" "$FIXED_SUFFIX"
elif [ "$ARM_RESULT" = "other" ]; then
  # Armed by a concurrent run: silent, except for a mode bit this one restored.
  [ -n "$FIXED" ] && printf 'house: restored the execute bit on the git-hook floor:%s\n' "${FIXED_SUFFIX#; restored the execute bit on:}"
else
  printf 'house: could not set core.hooksPath to %s (git config refused); the git-hook floor is NOT armed%s\n' "$FLOOR_DIR" "$FIXED_SUFFIX"
fi
exit 0
