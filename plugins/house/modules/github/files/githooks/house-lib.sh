#!/usr/bin/env bash
# Shared functions for the house git-hook floor (.githooks/*.d/10-house-branch).
#
# Managed by house: `house render` writes this file and .house/lock.json
# records it, so a local edit is reported as tamper. Put your own logic in a
# hook of your own under .githooks/<hook>.d/ instead.
#
# This file is SOURCED, never executed: every function returns, none exits, so
# a guard keeps control of its own exit code. Bash 3.2 compatible (macOS
# /bin/bash): no associative arrays, no mapfile, no `${x,,}`.
#
# Why a git hook at all: git is where a ref is actually resolved, so the
# branch a command lands on is a fact here, not a guess from command text.
# See ADR 0013 and issue #58.

# Globals the readers below set, pre-declared so `set -u` is safe for a caller
# that probes them before reading a manifest.
HOUSE_POLICY="${HOUSE_POLICY-}"
HOUSE_PROTECTED="${HOUSE_PROTECTED-}"
HOUSE_CARVEOUTS="${HOUSE_CARVEOUTS-}"
HOUSE_TOPLEVEL="${HOUSE_TOPLEVEL-}"
HOUSE_MANIFEST_SOURCE="${HOUSE_MANIFEST_SOURCE-}"

# The node fallback for reading house.json, used only when jq is absent. Kept
# as a single-quoted string, so it must not contain a single quote. It reads
# the manifest on stdin, prints the same P/B/C line protocol the jq filter
# below prints, and exits non-zero on anything it cannot read as the expected
# shape.
HOUSE_NODE_READER='
try {
  var fs = require("fs");
  var m = JSON.parse(fs.readFileSync(0, "utf8"));
  if (m === null || typeof m !== "object" || Array.isArray(m)) process.exit(1);
  var out = ["P" + (m.branchPolicy == null ? "pr" : String(m.branchPolicy))];
  var pb = m.protectedBranches == null ? ["master", "main"] : m.protectedBranches;
  var co = m.carveOuts == null ? [] : m.carveOuts;
  if (!Array.isArray(pb) || !Array.isArray(co)) process.exit(1);
  for (var i = 0; i < pb.length; i++) out.push("B" + String(pb[i]));
  for (var j = 0; j < co.length; j++) out.push("C" + String(co[j]));
  process.stdout.write(out.join("\n") + "\n");
} catch (e) {
  process.exit(1);
}
'

# house_toplevel: prints the worktree root and sets HOUSE_TOPLEVEL.
# Returns 1 when there is none (a bare repo), which every guard treats as
# "not our business" rather than an error.
house_toplevel() {
  HOUSE_TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null) || return 1
  [ -n "$HOUSE_TOPLEVEL" ] || return 1
  printf '%s\n' "$HOUSE_TOPLEVEL"
  return 0
}

# house_manifest_read <toplevel> [rev ...]: reads house.json into HOUSE_POLICY,
# HOUSE_PROTECTED (newline list) and HOUSE_CARVEOUTS (newline list), and names
# what it read in HOUSE_MANIFEST_SOURCE.
#
# The manifest is read from a COMMIT, not from the working tree: `HEAD` by
# default, or the revs given, in order. One Write to the working-tree
# house.json would otherwise turn every layer of the policy off, and a policy a
# session can rewrite in place is not a policy. The working-tree copy is the
# last resort, used only when no given rev has a house.json at all, which is
# the repo that adopted house before its first commit.
#
#   0  read it
#   1  no house.json anywhere: the repo has not adopted house, fail open
#   2  refuse: the manifest exists but cannot be read (bad JSON, unexpected
#      shape, or no JSON reader on PATH). Existence signals adoption, so
#      unreadable policy denies rather than guesses, the same posture the
#      PreToolUse hook takes when jq is missing. The message is already on
#      stderr when this returns.
house_manifest_read() {
  local top="$1" rev json raw rc line nl found
  shift
  nl='
'
  HOUSE_POLICY=""
  HOUSE_PROTECTED=""
  HOUSE_CARVEOUTS=""
  HOUSE_MANIFEST_SOURCE=""
  [ "$#" -gt 0 ] || set -- HEAD

  json=""
  found=1
  for rev in "$@"; do
    [ -n "$rev" ] || continue
    # cat-file, not show: plumbing, one process, no pager, and it fails
    # quietly on an unborn HEAD or a rev this clone does not have.
    json=$(git -C "$top" cat-file blob "$rev:house.json" 2>/dev/null </dev/null) && {
      HOUSE_MANIFEST_SOURCE="$rev:house.json"
      found=0
      break
    }
    json=""
  done
  if [ "$found" -ne 0 ]; then
    [ -f "$top/house.json" ] || return 1
    json=$(cat "$top/house.json" 2>/dev/null) || json=""
    HOUSE_MANIFEST_SOURCE="$top/house.json"
  fi

  rc=0
  if command -v jq >/dev/null 2>&1; then
    raw=$(printf '%s\n' "$json" | jq -r '
      "P" + ((.branchPolicy // "pr") | tostring),
      ((.protectedBranches // ["master","main"])[] | "B" + tostring),
      ((.carveOuts // [])[] | "C" + tostring)
    ' 2>/dev/null) || rc=$?
  elif command -v node >/dev/null 2>&1; then
    raw=$(printf '%s\n' "$json" | node -e "$HOUSE_NODE_READER" 2>/dev/null) || rc=$?
  else
    printf 'house: neither jq nor node is on PATH, so %s cannot be read.\n' "$HOUSE_MANIFEST_SOURCE" >&2
    printf 'house: refusing rather than guessing the branch policy; install jq (brew install jq) or node.\n' >&2
    return 2
  fi

  if [ "$rc" -ne 0 ]; then
    printf 'house: %s is not valid JSON, or its branch policy fields are not the expected shape.\n' "$HOUSE_MANIFEST_SOURCE" >&2
    printf 'house: refusing rather than guessing; fix it (node .house/check.mjs names the error).\n' >&2
    return 2
  fi

  while IFS= read -r line; do
    case "$line" in
      P*) HOUSE_POLICY="${line#P}" ;;
      B*) HOUSE_PROTECTED="$HOUSE_PROTECTED${line#B}$nl" ;;
      C*) HOUSE_CARVEOUTS="$HOUSE_CARVEOUTS${line#C}$nl" ;;
    esac
  done <<EOF
$raw
EOF

  [ -n "$HOUSE_POLICY" ] || HOUSE_POLICY="pr"
  # An empty protectedBranches list falls back to the same pair the PreToolUse
  # hook falls back to, so the two enforcement points cannot disagree about
  # what is protected.
  [ -n "$HOUSE_PROTECTED" ] || HOUSE_PROTECTED="master${nl}main${nl}"
  return 0
}

# house_branch: prints the current branch name. A detached HEAD prints nothing
# and returns 1 (there is no branch to protect, so guards exit 0 on it).
house_branch() {
  local b
  b=$(git symbolic-ref --quiet --short HEAD 2>/dev/null) || return 1
  [ -n "$b" ] || return 1
  printf '%s\n' "$b"
  return 0
}

# house_is_protected <name>: exact match against HOUSE_PROTECTED.
house_is_protected() {
  local want="$1" p
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    if [ "$want" = "$p" ]; then
      return 0
    fi
  done <<EOF
$HOUSE_PROTECTED
EOF
  return 1
}

# house_carve_out_satisfied <newline-separated paths>: true (0) only when
# HOUSE_CARVEOUTS is non-empty AND every path matches at least one carve-out
# glob under shell `case` semantics (`*` crosses `/`). An empty path list is
# NOT satisfied, so "nothing changed" cannot be mistaken for "carve-out only".
# Same predicate as carve_out_satisfied in the PreToolUse hook.
house_carve_out_satisfied() {
  local paths="$1" path glob ok
  [ -z "$HOUSE_CARVEOUTS" ] && return 1
  [ -z "$paths" ] && return 1
  while IFS= read -r path; do
    [ -z "$path" ] && continue
    ok=1
    while IFS= read -r glob; do
      [ -z "$glob" ] && continue
      # Intentional unquoted glob expansion: $glob is a house.json pattern,
      # matched as a shell glob (so `*` crosses `/`), not a literal string.
      # shellcheck disable=SC2254
      case "$path" in
        $glob) ok=0; break ;;
      esac
    done <<EOF
$HOUSE_CARVEOUTS
EOF
    [ "$ok" -ne 0 ] && return 1
  done <<EOF
$paths
EOF
  return 0
}

# house_refuse <hook> <first line> [more lines...]: the one refusal block every
# guard prints, so the wording cannot drift between them. Always returns 1, so
# a guard can `house_refuse ... ; exit $?`.
house_refuse() {
  local hook="$1" first repo top
  shift
  first="this operation"
  if [ "$#" -gt 0 ]; then
    first="$1"
    shift
  fi
  top="${HOUSE_TOPLEVEL:-}"
  if [ -z "$top" ]; then
    top=$(git rev-parse --show-toplevel 2>/dev/null) || top=""
  fi
  repo="${top##*/}"
  [ -n "$repo" ] || repo="repo"

  printf 'house %s: refusing %s\n' "$hook" "$first" >&2
  while [ "$#" -gt 0 ]; do
    printf '  %s\n' "$1" >&2
    shift
  done
  printf '\n' >&2
  printf 'This branch needs a PR. Work in a worktree:\n' >&2
  printf '  git worktree add -b kind/short-name ../%s-kind-short-name\n' "$repo"  >&2
  printf 'then commit there and open a PR.\n' >&2
  return 1
}
