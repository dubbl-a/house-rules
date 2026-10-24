#!/usr/bin/env bash
# Wall-clock check for plugins/house/hooks/no-direct-master.sh: on its slowest
# realistic inputs the guard must DECIDE inside the timeout hooks.json registers
# for it. When the timeout fires the harness ends the hook with no decision, and
# everything the guard denies is then only as good as `onFailure`.
#
# tests/hooks/run.sh bounds CPU time, not wall time (cpu_mark there), so that
# it passes when `npm run verify` runs it beside two other suites. The price is
# that a regression which costs wall time and no CPU (a sleep, a lock wait, a
# read that blocks) passes every case in it. This script is the other half: it
# measures wall time, so it must run ALONE, after the parallel suites have
# finished (the `verify` script in package.json, and its own step in ci.yml).
# Run in parallel with anything it would fail on load alone.
#
# The inputs are the worst cases run.sh's timing cases already use: the
# 200-line heredoc and the 72 KB one-line clause (many clauses, one long one),
# 201 MCP strings, 8000 weak-marker strings that outrun the default scan
# budget, 4000 strings past it, and a path of 5000 bytes. Each is built here,
# against its own fixtures, and piped into the real hook as run.sh does.
#
# The bound is the registered timeout less MARGIN_MS. The guard's own scan
# budget (SCAN_BUDGET_MS, 2000, also wall clock) is what the longest inputs run
# up to, so they finish near 2 s on a quiet machine; the bound sits at 4 s so a
# slow runner has the whole budget plus a second of ordinary work before this
# fails. A stall of the sort it exists for (a sleep, a lock) can hide only
# while the case it lands in still decides inside the bound, so whatever this
# passes still decides inside the hook timeout. A hook that never returns is
# killed a little past the timeout and fails on time, rather than hanging.
#
# Run:  bash tests/hooks/wall-clock.sh   (also `npm run test:hooks:wall`)
# Exits non-zero if any case fails.

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
HOOK="$REPO_ROOT/plugins/house/hooks/no-direct-master.sh"
HOOKS_JSON="$REPO_ROOT/plugins/house/hooks/hooks.json"
FLOOR_SRC="$REPO_ROOT/plugins/house/modules/github/files/githooks"
FLOOR_PATHS="pre-commit pre-push reference-transaction house-lib.sh pre-commit.d/10-house-branch pre-push.d/10-house-branch reference-transaction.d/10-house-branch"
MARGIN_MS=1000

if [[ ! -f "$HOOK" || ! -f "$HOOKS_JSON" || ! -d "$FLOOR_SRC" ]]; then
  echo "FATAL: hook, hooks.json or floor sources not found under $REPO_ROOT" >&2
  exit 1
fi
for _tool in jq perl git; do
  command -v "$_tool" >/dev/null 2>&1 || { echo "FATAL: $_tool is needed to time the hook" >&2; exit 1; }
done

# The registered timeout is the smallest across the guard's entries.
_timeout_s=$(jq -r '[.hooks.PreToolUse[].hooks[] | select((.command // "") | contains("no-direct-master.sh")) | .timeout // 600] | min // empty' "$HOOKS_JSON")
if ! [[ "$_timeout_s" =~ ^[1-9][0-9]*$ ]]; then
  echo "FATAL: no guard timeout found in $HOOKS_JSON (got [$_timeout_s])" >&2
  exit 1
fi
LIMIT_MS=$((_timeout_s * 1000 - MARGIN_MS))

# The hook reads these from the environment; a session's own must not leak in.
unset CLAUDE_PROJECT_DIR HOUSE_SCAN_BUDGET_MS

TMP_ROOT=$(mktemp -d)
trap 'rm -rf "$TMP_ROOT"' EXIT
FAILED=0
TOTAL=0

now_ms() { perl -MTime::HiRes=time -e 'printf "%d", time()*1000'; }

new_repo() {
  mkdir -p "$1"
  git -C "$1" init -q
  git -C "$1" config user.email test@example.com
  git -C "$1" config user.name "House Test"
  git -C "$1" config commit.gpgsign false
  git -C "$1" checkout -q -b master
  echo seed >"$1/.seed"
  git -C "$1" add .seed
  git -C "$1" commit -q -m seed
}

# adopt <dir> -> house.json and the vendored floor, committed, as run.sh does.
adopt() {
  local dir="$1" rel
  printf '%s' '{"branchPolicy":"pr"}' >"$dir/house.json"
  mkdir -p "$dir/.githooks/pre-commit.d" "$dir/.githooks/pre-push.d" "$dir/.githooks/reference-transaction.d"
  for rel in $FLOOR_PATHS; do
    cp "$FLOOR_SRC/$rel" "$dir/.githooks/$rel"
    chmod +x "$dir/.githooks/$rel"
  done
  git -C "$dir" add house.json .githooks
  git -C "$dir" commit -q -m house
}

mk_payload() {
  jq -n --arg cmd "$1" --arg cwd "$2" \
    '{tool_name: "Bash", tool_input: {command: $cmd}, cwd: $cwd, hook_event_name: "PreToolUse"}'
}
mk_file_payload() {
  jq -n --arg fp "$1" --arg cwd "$2" \
    '{tool_name: "Edit", tool_input: {file_path: $fp}, cwd: $cwd, hook_event_name: "PreToolUse"}'
}
# tool_input goes in on stdin: the large inputs outrun one argv string on Linux.
mk_mcp_payload() {
  printf '%s' "$1" | jq -c --arg cwd "$2" \
    '{tool_name: "mcp__fs__write_file", tool_input: ., cwd: $cwd, hook_event_name: "PreToolUse"}'
}

# timed <label> <want> <payload>
#   want: "deny" (the output must be a deny) or "any" (a decision, allow or
#   deny, is enough: the case is about time, not outcome). The hook must exit 0.
timed() {
  local label="$1" want="$2" payload="$3" start end ms out code decision
  start=$(now_ms)
  # A hook that blocks forever is killed past the timeout with its whole process
  # group: killing bash alone leaves a child (a sleep) holding the pipe open.
  out=$(printf '%s' "$payload" 2>/dev/null | perl -e '
    my $t = shift; my $p = fork; die "fork: $!" unless defined $p;
    if (!$p) { setpgrp(0, 0); exec @ARGV or die "exec: $!" }
    $SIG{ALRM} = sub { kill "KILL", -$p; waitpid $p, 0; exit 142 };
    alarm $t; waitpid $p, 0; exit($? & 127 ? 128 + ($? & 127) : $? >> 8);
  ' $((_timeout_s + 2)) bash "$HOOK")
  code=$?
  end=$(now_ms)
  ms=$((end - start))
  decision=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision // ""' 2>/dev/null)
  TOTAL=$((TOTAL + 1))
  if [[ "$ms" -ge "$LIMIT_MS" ]]; then
    FAILED=$((FAILED + 1))
    printf '  FAIL  %s -- took %s ms of wall time, limit %s ms (the %s s hook timeout less %s ms)\n' \
      "$label" "$ms" "$LIMIT_MS" "$_timeout_s" "$MARGIN_MS"
  elif [[ "$code" -ne 0 || ( "$want" == deny && "$decision" != deny ) ]]; then
    FAILED=$((FAILED + 1))
    printf '  FAIL  %s -- decided in %s ms but wrongly: code=%s decision=[%s]\n' "$label" "$ms" "$code" "$decision"
  else
    printf '  ok    %s in %s ms (limit %s)\n' "$label" "$ms" "$LIMIT_MS"
  fi
}

# exec_counted <label> <max> <payload>: the guard is allowed at most <max>
# process starts (counted by PATH shims for the tools it runs) on this payload.
# Wall time cannot show the cost of a process start that only an endpoint
# security agent makes expensive: on 2026-10-22 (#460) a machine at load 140,
# with such an agent scanning every exec, spent the whole 5 s on short git
# commands. Each start there cost tens of milliseconds, so the count is the
# measurable thing. The limits sit a little above the counts after #460's cut
# (21 and 24; they were 37 and 62), so a few more processes on the common path
# fail here, not as a timeout on somebody's busy machine.
SHIM_DIR="$TMP_ROOT/shims"; mkdir -p "$SHIM_DIR"
for _tool in git jq sed tr cat cmp head readlink dirname basename grep awk find uname; do
  _real=$(command -v "$_tool") || continue
  printf '#!/bin/sh\necho %s >> "$EXEC_LOG"\nexec %s "$@"\n' "$_tool" "$_real" >"$SHIM_DIR/$_tool"
  chmod +x "$SHIM_DIR/$_tool"
done
exec_counted() {
  local label="$1" max="$2" payload="$3" n
  EXEC_LOG="$TMP_ROOT/exec.log"; : >"$EXEC_LOG"; export EXEC_LOG
  printf '%s' "$payload" | PATH="$SHIM_DIR:$PATH" bash "$HOOK" >/dev/null 2>&1
  n=$(wc -l <"$EXEC_LOG" | tr -d ' ')
  TOTAL=$((TOTAL + 1))
  if [[ "$n" -gt "$max" ]]; then
    FAILED=$((FAILED + 1))
    printf '  FAIL  %s -- started %s processes, limit %s\n' "$label" "$n" "$max"
  else
    printf '  ok    %s started %s processes (limit %s)\n' "$label" "$n" "$max"
  fi
}

echo "=== guard wall-clock: decides inside ${_timeout_s} s less ${MARGIN_MS} ms (serial, never beside another suite) ==="

ex="$TMP_ROOT/execs"; new_repo "$ex"; adopt "$ex"; git -C "$ex" checkout -q -b feat/ex
git -C "$ex" config core.hooksPath "$ex/.githooks"
exec_counted "git status on a feature branch, floor armed: process starts" 26 \
  "$(mk_payload "git status" "$ex")"
exec_counted "git -C <cwd> worktree remove, two candidates: process starts" 28 \
  "$(mk_payload "git -C $ex worktree remove $TMP_ROOT/nosuch" "$ex")"

sc="$TMP_ROOT/split"; new_repo "$sc"; adopt "$sc"; git -C "$sc" checkout -q -b feat/sc
pg="$TMP_ROOT/pathgaps"; new_repo "$pg"; adopt "$pg"
n="$TMP_ROOT/unadopted"; new_repo "$n"

_g="gi""t"; _hp="hooks""Path"
heredoc_cmd() {
  local i body=''
  for ((i = 0; i < $1; i++)); do
    body+="const r$i = files.filter((f) => f.endsWith('.md') && !seen.has(f)).map((f) => ({ f, n: $i }));"$'\n'
  done
  printf '%s' "S=/tmp/probe-x; rm -rf \$S; mkdir -p \$S/a \$S/b; cd $sc && $_g archive HEAD docs | tar -x -C \$S/a; $_g -C $sc archive HEAD docs | tar -x -C \$S/b; cat > \$S/cmp.mjs <<'EOF'"$'\n'"${body}EOF"$'\n'"node \$S/cmp.mjs \$S/a \$S/b$2"
}

timed "200-line heredoc ahead of a hooks-path write (many clauses)" deny \
  "$(mk_payload "$(heredoc_cmd 200 "; $_g config core.$_hp /dev/null")" "$sc")"
_blob=$(head -c 72000 /dev/zero | tr '\0' 'Q' | sed 's/\(.\{70\}\)/\1 /g')
timed "72 KB one-line clause ahead of a hooks-path write" deny \
  "$(mk_payload "echo $_blob > /dev/null; $_g config core.$_hp /dev/null" "$sc")"

mkdir -p "$pg/many"
for ((i = 0; i < 200; i++)); do mkdir -p "$pg/many/d$i"; done
_many=$(for ((i = 0; i < 200; i++)); do printf '%s\n' "$pg/many/d$i/.gitkeep"; done | jq -R . | jq -s --arg last "$pg/zz/../.git/config" '{paths: (. + [$last])}')
timed "201 .git-bearing MCP strings into one repo" deny "$(mk_mcp_payload "$_many" "$pg")"

_huge=$(for ((i = 0; i < 200; i++)); do for ((j = 0; j < 20; j++)); do printf '%s\n' "$pg/many/d$i/f$j.gitkeep"; done; done | jq -R . | jq -s '{paths: .}')
timed "4000 MCP strings at the default scan budget" any "$(mk_mcp_payload "$_huge" "$pg")"

_wide=$(for ((i = 0; i < 8000; i++)); do printf '%s\n' "pkg$i/x/x/x/x/hooks.ts"; done | jq -R . | jq -s '{paths: (. + ["zzz/.git/config"])}')
timed "8000 weak-marker strings, then a .git path sorting last" deny "$(mk_mcp_payload "$_wide" "$n")"

_long=$(printf '%05000d' 0 | tr 0 a)
timed "Edit path of 5000 bytes in an adopted repo" deny "$(mk_file_payload "$pg/.githooks/$_long" "$pg")"

echo
if [[ "$FAILED" -gt 0 ]]; then
  echo "wall-clock: $FAILED of $TOTAL case(s) failed."
  exit 1
fi
echo "wall-clock: $TOTAL / $TOTAL decided inside the limit."
