#!/usr/bin/env bash
# Regression tests for plugins/house/hooks/no-direct-master.sh.
#
# For each case, builds a REAL PreToolUse JSON payload (Bash:
# {"tool_name":"Bash","tool_input":{"command":"..."},"cwd":"..."}; Edit,
# Write and MultiEdit: tool_input.file_path; NotebookEdit:
# tool_input.notebook_path; an MCP tool: any tool_input), pipes it into the REAL hook
# script, and asserts on the captured stdout JSON (via jq,
# .hookSpecificOutput.permissionDecision) and the exit code.
#
# Deliberately does NOT reimplement any of the hook's matching logic here;
# every case exercises the hook's actual stdin-to-stdout contract, using
# throwaway git repos created under mktemp.
#
# Since #58 (ADR 0013) the hook is no longer the branch guard: the git-hook
# floor is. So the suite is in six parts:
#   - the ADR 0002 adoption gates and the deference matrix
#   - the policy source: house.json as it is on HEAD, not in the working tree,
#     and not through a replace ref either
#   - the disable list: every literal that turns the floor off, each next to
#     an innocent neighbour that must still pass, and the proof that the list
#     applies in a `direct` repo and in one that defers its branch decision
#   - the branch refusals, run four ways: against a fixture where the floor is
#     ARMED (only a commit and a send-pack are refused, the rest is the
#     floor's), one where core.hooksPath is unset, one where the floor is
#     armed but not intact (an edited, missing, unexecutable, untracked,
#     ignored or symlinked file), and one where the floor is perfect but the
#     git that would run it is older than 2.28
#   - the two fail-closed paths: missing jq and the ERR trap
#   - the round-2 adversarial findings, replayed as fixtures: send-pack (N1),
#     a replace ref (N2), the disable list in front of the policy gate (N3),
#     an alias body while armed (N5), git < 2.28 (N6), a bare push from a
#     feature branch (N7), an ignored plant under .githooks (N8),
#     case-different paths (N9), and a repository named through the
#     environment (N11)
#
# The armed fixture copies the vendored floor from
# plugins/house/modules/github/files/githooks/ AND COMMITS IT, because the
# hook's `armed` test is byte-identity with the plugin's own copy, the set of
# files HEAD tracks, and a clean `git status` on the hooks directory. Copying
# at test time is deliberate: the floor's contents change in the same PR, and
# the fixture must follow.
#
# Run:  bash tests/hooks/run.sh   (also wired as `npm run test:hooks`)
#
# Exits non-zero if any case fails.

set -o pipefail

SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
HOOK="$REPO_ROOT/plugins/house/hooks/no-direct-master.sh"
FLOOR_SRC="$REPO_ROOT/plugins/house/modules/github/files/githooks"
FLOOR_PATHS="pre-commit pre-push reference-transaction house-lib.sh pre-commit.d/10-house-branch pre-push.d/10-house-branch reference-transaction.d/10-house-branch"

if [[ ! -f "$HOOK" ]]; then
  echo "FATAL: hook not found at $HOOK" >&2
  exit 1
fi
if [[ ! -d "$FLOOR_SRC" ]]; then
  echo "FATAL: vendored floor sources not found at $FLOOR_SRC;" >&2
  echo "       the armed fixtures below are byte-identity checks against them." >&2
  exit 1
fi

# Since round 3 the hook reads a repo as ARMED only when the git that will run
# the hooks is 2.28 or newer: reference-transaction, the only hook that sees a
# merge, rebase, amend, reset or update-ref, arrived there, and without it the
# floor cannot cover history. So the armed fixtures below need a >= 2.28 git
# first on PATH for the HOOK (the fixtures themselves are built with whatever
# git this suite runs under, which any version handles), and the git-version
# cases need an older one. Both are looked for; a missing one skips its cases
# loudly rather than silently passing.
# HOUSE_TEST_GIT_NEW / HOUSE_TEST_GIT_OLD pin the bin directory each half uses
# (the word `none` means "pretend this box has no such git", which is how a CI
# runner with a single git looks).
GIT_NEW_DIR="${HOUSE_TEST_GIT_NEW:-}"
GIT_OLD_DIR="${HOUSE_TEST_GIT_OLD:-}"
for _g in "$(command -v git 2>/dev/null)" /usr/bin/git /usr/local/bin/git \
          /opt/homebrew/bin/git /usr/local/opt/git/bin/git /opt/local/bin/git; do
  [[ -n "$_g" && -x "$_g" ]] || continue
  _v=$("$_g" --version 2>/dev/null | awk '{print $3}')
  _maj="${_v%%.*}"; _min="${_v#*.}"; _min="${_min%%.*}"
  case "$_maj$_min" in ''|*[!0-9]*) continue ;; esac
  if [[ "$_maj" -gt 2 ]] || { [[ "$_maj" -eq 2 ]] && [[ "$_min" -ge 28 ]]; }; then
    [[ -n "$GIT_NEW_DIR" ]] || GIT_NEW_DIR="$(dirname "$_g")"
  else
    [[ -n "$GIT_OLD_DIR" ]] || GIT_OLD_DIR="$(dirname "$_g")"
  fi
done
[[ "$GIT_NEW_DIR" == none ]] && GIT_NEW_DIR=''
[[ "$GIT_OLD_DIR" == none ]] && GIT_OLD_DIR=''

# The hook reads relative MCP paths against CLAUDE_PROJECT_DIR too, and a
# suite run from inside a session inherits the session's; cases set it.
unset CLAUDE_PROJECT_DIR
# The hook's scan budget can be lowered from the environment; the overrun
# cases set it themselves, and nothing else may inherit one.
unset HOUSE_SCAN_BUDGET_MS

# Prepended to PATH for the hook only (empty means: run it as the suite runs).
HOOK_PATH_PREFIX=''

TESTS_TOTAL=0
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0

skip() {
  TESTS_SKIPPED=$((TESTS_SKIPPED + 1))
  printf '  SKIP  %s -- %s\n' "$1" "$2"
}

pass() {
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  TESTS_PASSED=$((TESTS_PASSED + 1))
  printf '  ok    %s\n' "$1"
}

fail() {
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  TESTS_FAILED=$((TESTS_FAILED + 1))
  printf '  FAIL  %s -- %s\n' "$1" "$2"
}

TMP_ROOT=$(mktemp -d)
cleanup() { rm -rf "$TMP_ROOT"; }
trap cleanup EXIT

# mk_payload <command> <cwd> -> real PreToolUse JSON on stdout
mk_payload() {
  jq -n --arg cmd "$1" --arg cwd "$2" \
    '{tool_name: "Bash", tool_input: {command: $cmd}, cwd: $cwd}'
}

# mk_file_payload <tool> <file_path> <cwd> -> real PreToolUse JSON on stdout
mk_file_payload() {
  jq -n --arg tool "$1" --arg fp "$2" --arg cwd "$3" \
    '{tool_name: $tool, tool_input: {file_path: $fp}, cwd: $cwd}'
}

# mk_real_file_payload: mk_file_payload plus hook_event_name, which every real
# payload carries.
mk_real_file_payload() { mk_file_payload "$@" | jq -c '. + {hook_event_name: "PreToolUse"}'; }

# mk_notebook_payload <notebook_path> <cwd> -> real NotebookEdit PreToolUse JSON
mk_notebook_payload() {
  jq -n --arg np "$1" --arg cwd "$2" \
    '{tool_name: "NotebookEdit", tool_input: {notebook_path: $np, new_source: "x"}, cwd: $cwd}'
}

# run_hook <payload-json> -> sets HOOK_OUT / HOOK_CODE. HOOK_PATH_PREFIX picks
# which git the hook itself sees, which decides whether a floor counts as armed;
# HOOK_ENV is a list of VAR=value assignments for cases that must not read the
# person's own global git config (push.default lives there on most boxes).
HOOK_ENV=()
run_hook() {
  local payload="$1"
  if [[ -n "$HOOK_PATH_PREFIX" ]]; then
    HOOK_OUT=$(printf '%s' "$payload" | PATH="$HOOK_PATH_PREFIX:$PATH" \
      env ${HOOK_ENV[@]+"${HOOK_ENV[@]}"} bash "$HOOK")
  else
    HOOK_OUT=$(printf '%s' "$payload" | env ${HOOK_ENV[@]+"${HOOK_ENV[@]}"} bash "$HOOK")
  fi
  HOOK_CODE=$?
}

# expect_allow <label> <payload-json>
expect_allow() {
  local label="$1" payload="$2"
  run_hook "$payload"
  if [[ "$HOOK_CODE" -ne 0 ]]; then
    fail "$label" "expected exit 0, got $HOOK_CODE (out=[$HOOK_OUT])"
    return
  fi
  if [[ -z "$HOOK_OUT" ]]; then
    pass "$label"
  else
    fail "$label" "expected ALLOW (empty stdout), got: $HOOK_OUT"
  fi
}

# expect_deny <label> <payload-json> [reason-substring]
expect_deny() {
  local label="$1" payload="$2" want_substr="${3:-}"
  run_hook "$payload"
  if [[ "$HOOK_CODE" -ne 0 ]]; then
    fail "$label" "expected exit 0, got $HOOK_CODE (out=[$HOOK_OUT])"
    return
  fi
  local decision reason
  decision=$(printf '%s' "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecision // ""' 2>/dev/null)
  reason=$(printf '%s' "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecisionReason // ""' 2>/dev/null)
  if [[ "$decision" != "deny" ]]; then
    fail "$label" "expected DENY, got decision=[$decision] out=[$HOOK_OUT]"
    return
  fi
  if [[ -n "$want_substr" && "$reason" != *"$want_substr"* ]]; then
    fail "$label" "deny reason missing expected substring [$want_substr]: $reason"
    return
  fi
  pass "$label"
}

# expect_deny_without <label> <payload-json> <substring-that-must-be-absent>
expect_deny_without() {
  local label="$1" payload="$2" unwanted="$3"
  run_hook "$payload"
  local decision reason
  decision=$(printf '%s' "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecision // ""' 2>/dev/null)
  reason=$(printf '%s' "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecisionReason // ""' 2>/dev/null)
  if [[ "$decision" != "deny" ]]; then
    fail "$label" "expected DENY, got decision=[$decision] out=[$HOOK_OUT]"
    return
  fi
  if [[ "$reason" == *"$unwanted"* ]]; then
    fail "$label" "deny reason must not mention [$unwanted]: $reason"
    return
  fi
  pass "$label"
}

# new_repo <dir> -- inits a repo, one commit, on branch master
new_repo() {
  local dir="$1"
  mkdir -p "$dir"
  git -C "$dir" init -q
  git -C "$dir" config user.email test@example.com
  git -C "$dir" config user.name "House Test"
  git -C "$dir" config commit.gpgsign false
  git -C "$dir" checkout -q -b master
  echo seed >"$dir/.seed"
  git -C "$dir" add .seed
  git -C "$dir" commit -q -m seed
}

# adopt <dir> [json] -- writes house.json and COMMITS it, still on master.
# The commit matters: since the round-2 fix the hook reads the policy from
# HEAD, so an uncommitted house.json is only a fallback for a repo that has
# none on HEAD at all.
adopt() {
  local dir="$1" json="${2:-}"
  [[ -n "$json" ]] || json='{"branchPolicy":"pr"}'
  printf '%s' "$json" >"$dir/house.json"
  git -C "$dir" add house.json
  git -C "$dir" commit -q -m house
}

# install_floor <dir> [extra-branches...] -- copies the vendored floor into
# <dir>/.githooks, makes it executable, and COMMITS it, which is what
# floor_is_armed needs: byte-identity with the plugin's own copy, the execute
# bit, and a clean `git status` on the hooks directory. Any extra branch names
# are created from that commit, so a later `git checkout` of one does not take
# the hooks back out of the working tree.
install_floor() {
  local dir="$1" rel b
  shift
  mkdir -p "$dir/.githooks/pre-commit.d" "$dir/.githooks/pre-push.d" "$dir/.githooks/reference-transaction.d"
  for rel in $FLOOR_PATHS; do
    cp "$FLOOR_SRC/$rel" "$dir/.githooks/$rel"
    chmod +x "$dir/.githooks/$rel"
  done
  git -C "$dir" add .githooks
  git -C "$dir" commit -q -m floor
  for b in "$@"; do git -C "$dir" branch "$b"; done
}

# arm_hookspath <repo-dir> [hooks-owner-dir] -- points core.hooksPath at the
# ABSOLUTE .githooks of the owner (itself, unless a linked worktree shares
# another checkout's). Always last: every fixture mutation happens before the
# real floor is in git's way.
arm_hookspath() {
  git -C "$1" config core.hooksPath "${2:-$1}/.githooks"
}

# arm_floor <dir> [extra-branches...] -- install_floor plus arm_hookspath.
arm_floor() {
  local dir="$1"
  shift
  install_floor "$dir" "$@"
  arm_hookspath "$dir"
}

# lock_floor <dir> -- plants the .house/lock.json files[] records. The
# Edit/Write scan no longer consults them (every path under .githooks/ is
# refused now), but a real adopted repo has them and the fixture should look
# like one.
lock_floor() {
  local dir="$1"
  mkdir -p "$dir/.house"
  cat >"$dir/.house/lock.json" <<'EOF'
{
  "files": [
    { "path": ".githooks/pre-commit", "module": "github" },
    { "path": ".githooks/pre-push", "module": "github" },
    { "path": ".githooks/reference-transaction", "module": "github" },
    { "path": ".githooks/house-lib.sh", "module": "github" },
    { "path": ".githooks/pre-commit.d/10-house-branch", "module": "github" },
    { "path": ".githooks/pre-push.d/10-house-branch", "module": "github" },
    { "path": ".githooks/reference-transaction.d/10-house-branch", "module": "github" }
  ]
}
EOF
}

echo "=== house guard: PreToolUse hook regression tests ==="
echo "hook: $HOOK"
echo "floor fixture: vendored sources from $FLOOR_SRC"
echo "fixture git: $(git --version)"
echo "git >= 2.28 for the armed cases: ${GIT_NEW_DIR:-NONE FOUND (those cases skip)}"
echo "git <  2.28 for the version cases: ${GIT_OLD_DIR:-NONE FOUND (those cases skip)}"
echo

# ── ADR 0002 adoption gates ──────────────────────────────────────────────

# --- 1. no house.json, commit on master: ALLOW (fail open) ---
r="$TMP_ROOT/case01"; new_repo "$r"
expect_allow "no house.json, commit on master (fail open)" \
  "$(mk_payload "git commit -m x" "$r")"

# --- 2. house.json branchPolicy direct, commit on main: ALLOW ---
r="$TMP_ROOT/case02"; new_repo "$r"
adopt "$r" '{"branchPolicy":"direct"}'
git -C "$r" checkout -q -b main
expect_allow "house.json branchPolicy direct, commit on main" \
  "$(mk_payload "git commit -m x" "$r")"

# --- 3. repo-local .claude/settings.json with a PreToolUse hook: ALLOW ---
r="$TMP_ROOT/case03"; new_repo "$r"
echo '{"branchPolicy":"pr"}' >"$r/house.json"
mkdir -p "$r/.claude"
echo '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"x"}]}]}}' >"$r/.claude/settings.json"
git -C "$r" add house.json .claude/settings.json && git -C "$r" commit -q -m house
expect_allow "repo-local settings.json PreToolUse hook defers, on master" \
  "$(mk_payload "git commit -m x" "$r")"

# --- 4. repo-local .claude/hooks/no-direct-master.sh: only a SUBSTANTIVE one defers ---
# #27: deference used to be by mere file existence, so a no-op `exit 0` stub
# disarmed this hook entirely while the checker still reported the repo as
# guarded. The predicate fails toward DENY.
r="$TMP_ROOT/case04"; new_repo "$r"
echo '{"branchPolicy":"pr"}' >"$r/house.json"
mkdir -p "$r/.claude/hooks"
printf '#!/usr/bin/env bash\n# a real guard\nexit 2\n' >"$r/.claude/hooks/no-direct-master.sh"
git -C "$r" add house.json .claude/hooks/no-direct-master.sh && git -C "$r" commit -q -m house
expect_allow "a substantive repo-local hooks/no-direct-master.sh defers, on master" \
  "$(mk_payload "git commit -m x" "$r")"

# --- 4b. the no-op stub cases: each must NOT disarm the guard ---
i=0
for stub in '' '#!/usr/bin/env bash\n' '#!/usr/bin/env bash\nexit 0\n' '#!/usr/bin/env bash\n# only comments\n\n' '   \n\texit 0\n'; do
  i=$((i + 1))
  r="$TMP_ROOT/case04b$i"; new_repo "$r"
  echo '{"branchPolicy":"pr"}' >"$r/house.json"
  mkdir -p "$r/.claude/hooks"
  printf "$stub" >"$r/.claude/hooks/no-direct-master.sh"
  git -C "$r" add house.json .claude/hooks/no-direct-master.sh && git -C "$r" commit -q -m house
  expect_deny "a no-op repo-local hook (variant $i) does NOT disarm, on master" \
    "$(mk_payload "git commit -m x" "$r")"
done

# --- 5/6. house.json pr policy: commit on master DENY, commit on feat/x ALLOW ---
r="$TMP_ROOT/case05"; new_repo "$r"; adopt "$r"
expect_deny "house.json pr policy, commit on master" \
  "$(mk_payload "git commit -m x" "$r")" "feature branch"
git -C "$r" checkout -q -b feat/x
expect_allow "house.json pr policy, commit on feat/x" \
  "$(mk_payload "git commit -m x" "$r")"

# --- 7/8. UNARMED: push naming master DENY (and names the arming command),
#          push origin feat/x from feat/x ALLOW ---
r="$TMP_ROOT/case07"; new_repo "$r"; adopt "$r"
expect_deny "unarmed: push origin master from master" \
  "$(mk_payload "git push origin master" "$r")" "feature branch"
expect_deny "unarmed: the deny names the arming command" \
  "$(mk_payload "git push origin master" "$r")" "floor is not armed in this checkout"
expect_deny "unarmed: the arming command names this checkout's .githooks" \
  "$(mk_payload "git push origin master" "$r")" \
  "core.hooksPath \"$(git -C "$r" rev-parse --show-toplevel)/.githooks\""
git -C "$r" checkout -q -b feat/x
expect_allow "unarmed: push origin feat/x from feat/x" \
  "$(mk_payload "git push origin feat/x" "$r")"

# --- 9. UNARMED: push refspec targeting master from feat/x: DENY ---
r="$TMP_ROOT/case09"; new_repo "$r"; adopt "$r"
git -C "$r" checkout -q -b feat/x
expect_deny "unarmed: push refspec HEAD:master from feat/x" \
  "$(mk_payload "git push origin HEAD:master" "$r")" "protected branch"
expect_deny "unarmed: push refspec :master (a delete) from feat/x" \
  "$(mk_payload "git push origin :master" "$r")" "protected branch"
expect_deny "unarmed: push --all from feat/x" \
  "$(mk_payload "git push --all origin" "$r")" "without naming it"

# --- 9b. UNARMED, round 2 regression: the literal push grammar. A push whose
#         every refspec is a literal that is not a protected name is ALLOWED
#         from any branch (the release flow's tag push, the sync agents'
#         feature pushes), and a push with no refspec at all from a protected
#         branch is refused because push.default decides what moves. ---
u="$TMP_ROOT/unarmed-push"; new_repo "$u"; adopt "$u"
expect_allow "unarmed: a tag push from master is a literal refspec that is not protected" \
  "$(mk_payload "git push origin v0.11.0" "$u")"
expect_allow "unarmed: pushing a feature branch by name from master" \
  "$(mk_payload "git push origin feat/x" "$u")"
expect_allow "unarmed: pushing a feature branch with -u from master" \
  "$(mk_payload "git push -u origin feat/x" "$u")"
expect_allow "unarmed: deleting a feature branch on the remote from master" \
  "$(mk_payload "git push origin --delete feat/old" "$u")"
expect_deny "unarmed: a bare push from master names no refspec" \
  "$(mk_payload "git push" "$u")" "no refspec"
expect_deny "unarmed: push --tags from master names no branch refspec" \
  "$(mk_payload "git push --tags" "$u")" "no refspec"
expect_deny "unarmed: push --follow-tags from master names no refspec" \
  "$(mk_payload "git push --follow-tags origin" "$u")" "no refspec"
expect_deny "unarmed: a non-literal refspec cannot be read" \
  "$(mk_payload 'git push origin $BRANCH' "$u")" "not a literal refspec"
expect_deny "unarmed: a glob refspec cannot be read" \
  "$(mk_payload "git push origin refs/heads/*:refs/heads/*" "$u")" "not a literal refspec"
git -C "$u" checkout -q -b feat/u
# H7 (round-2 N7): a push with no refspec is not readable from a FEATURE
# branch either, unless the config says in so many words what moves.
# push.default=upstream with branch.<x>.merge on master, a remote.*.push
# refspec, or plain `matching` all send a feature branch onto master.
# push.default lives in the person's global config on most boxes, so the
# "unset" cases run with a HOME of their own.
mkdir -p "$TMP_ROOT/nohome"
HOOK_ENV=(HOME="$TMP_ROOT/nohome" XDG_CONFIG_HOME="$TMP_ROOT/nohome/.config" GIT_CONFIG_NOSYSTEM=1)
expect_deny "unarmed: a bare push from a feature branch, push.default unset" \
  "$(mk_payload "git push" "$u")" "push.default is unset"
expect_deny "unarmed: push --tags from a feature branch, push.default unset" \
  "$(mk_payload "git push --tags" "$u")" "no refspec"
HOOK_ENV=()
git -C "$u" config push.default matching
expect_deny "unarmed: push.default=matching pushes every same-named branch" \
  "$(mk_payload "git push" "$u")" "push.default=matching"
git -C "$u" config push.default current
expect_allow "unarmed: push.default=current names what moves, and it is this branch" \
  "$(mk_payload "git push" "$u")"
expect_allow "unarmed: push.default=current, push --tags" \
  "$(mk_payload "git push --tags" "$u")"
git -C "$u" config remote.origin.push refs/heads/feat/u:refs/heads/master
expect_deny "unarmed: a remote.<name>.push refspec decides instead" \
  "$(mk_payload "git push" "$u")" "remote.origin.push"
git -C "$u" config --unset remote.origin.push
git -C "$u" config push.default simple
git -C "$u" config branch.feat/u.merge refs/heads/master
expect_deny "unarmed: push.default=simple with the upstream on master" \
  "$(mk_payload "git push" "$u")" "branch.feat/u.merge"
git -C "$u" config branch.feat/u.merge refs/heads/feat/u
expect_allow "unarmed: push.default=simple with the upstream on the same branch" \
  "$(mk_payload "git push" "$u")"
git -C "$u" config push.default upstream
expect_deny "unarmed: push.default=upstream is not readable, whatever the upstream is" \
  "$(mk_payload "git push" "$u")" "push.default=upstream"
git -C "$u" config --unset push.default
git -C "$u" config --unset branch.feat/u.merge
expect_allow "unarmed: naming the branch is always readable" \
  "$(mk_payload "git push origin feat/u" "$u")"

# H1 (round-2 N1): send-pack is a push that pre-push never sees. Unarmed, the
# push grammar reads it exactly like a push.
expect_deny "unarmed: send-pack onto master is read like a push" \
  "$(mk_payload "git send-pack ../bare.git feat/u:master" "$u")" "protected branch"
expect_deny "unarmed: send-pack --all" \
  "$(mk_payload "git send-pack --all ../bare.git" "$u")" "without naming it"
expect_deny "unarmed: send-pack --mirror" \
  "$(mk_payload "git send-pack --mirror ../bare.git" "$u")" "without naming it"
expect_allow "unarmed: send-pack naming a feature branch on both sides" \
  "$(mk_payload "git send-pack ../bare.git feat/u:feat/u" "$u")"

# --- 9c. UNARMED: the verbs that write history without the word commit ---
h="$TMP_ROOT/unarmed-history"; new_repo "$h"; adopt "$h"
for v in merge cherry-pick revert rebase am; do
  expect_deny "unarmed: git $v on master writes onto a protected branch" \
    "$(mk_payload "git $v feat/x" "$h")" "writes onto a protected branch"
done
git -C "$h" checkout -q -b feat/h
expect_allow "unarmed: git merge on a feature branch" \
  "$(mk_payload "git merge feat/x" "$h")"

# --- 9d. UNARMED: a verb this hook cannot read is refused, not guessed ---
x="$TMP_ROOT/unarmed-verb"; new_repo "$x"; adopt "$x"
git -C "$x" config alias.po "push origin master"
git -C "$x" checkout -q -b feat/x
expect_deny "unarmed: an alias verb is not resolved and not readable" \
  "$(mk_payload "git po origin master" "$x")" "not one of git's own commands"
expect_deny "unarmed: a computed verb is not readable" \
  "$(mk_payload 'git ${v} -m x' "$x")" "computed git verb"
expect_allow "unarmed: a real git verb that only reads is fine" \
  "$(mk_payload "git status --porcelain" "$x")"

# --- 10. git -C <other-worktree-on-master> commit: DENY even when cwd is elsewhere ---
base="$TMP_ROOT/case10"
new_repo "$base/main"; adopt "$base/main"
git -C "$base/main" checkout -q -b feat/main
git -C "$base/main" worktree add "$base/other" master >/dev/null 2>&1  # no -q: git < 2.19 lacks it
expect_deny "git -C other-worktree-on-master commit, cwd is the (non-protected) main worktree" \
  "$(mk_payload "git -C $base/other commit -m x" "$base/main")" "feature branch"

# --- 11/12. cd <path> && / ; git commit resolution ---
r="$TMP_ROOT/case11"; new_repo "$r"; adopt "$r"
# cwd is TMP_ROOT itself (not a git repo): a DENY here can only come from
# resolving the target via the `cd` clause, not from a cwd fallback.
expect_deny "cd <path> && git commit resolution" \
  "$(mk_payload "cd $r && git commit -m x" "$TMP_ROOT")" "feature branch"
expect_deny "cd <path> ; git commit resolution" \
  "$(mk_payload "cd $r ; git commit -m x" "$TMP_ROOT")" "feature branch"

# --- 13. quoted false positive: commit -m "fix master bug" on feat/x: ALLOW ---
r="$TMP_ROOT/case13"; new_repo "$r"; adopt "$r"
git -C "$r" checkout -q -b feat/x
expect_allow "quoted false positive (fix master bug) on feat/x" \
  "$(mk_payload 'git commit -m "fix master bug"' "$r")"
expect_allow "quoted false positive (push to master later) on feat/x" \
  "$(mk_payload 'git commit -m "push to master later"' "$r")"

# --- 14. push-clause isolation: push origin feat && checkout master: ALLOW ---
r="$TMP_ROOT/case14"; new_repo "$r"; adopt "$r"
git -C "$r" checkout -q -b feat/x
expect_allow "unarmed: push-clause isolation (push feat && checkout master)" \
  "$(mk_payload "git push origin feat && git checkout master" "$r")"

# --- 15-18. carve-outs ---
r="$TMP_ROOT/case15"; new_repo "$r"
mkdir -p "$r/scripts/newsletter" "$r/src" "$r/public/email-assets/broadcasts/2026-08"
adopt "$r" '{"branchPolicy":"pr","carveOuts":["scripts/newsletter/issue-*.json","public/email-assets/broadcasts/*"]}'
echo x >"$r/scripts/newsletter/issue-9.json"
echo y >"$r/src/foo.ts"
echo z >"$r/public/email-assets/broadcasts/2026-08/x.png"

git -C "$r" add scripts/newsletter/issue-9.json
expect_allow "carve-out: staged only issue-9.json on master" \
  "$(mk_payload "git commit -m x" "$r")"

git -C "$r" add src/foo.ts
expect_deny "carve-out: staged issue-9.json plus src/foo.ts" \
  "$(mk_payload "git commit -m x" "$r")" "feature branch"

git -C "$r" reset -q
git -C "$r" add public/email-assets/broadcasts/2026-08/x.png
expect_allow "carve-out: nested path under public/email-assets/broadcasts/* (star crosses slash)" \
  "$(mk_payload "git commit -m x" "$r")"

git -C "$r" reset -q
expect_deny "carve-out: empty staged diff on master never satisfies a carve-out" \
  "$(mk_payload "git commit -m x" "$r")" "feature branch"

# --- 19. jq missing: DENY JSON still emitted (hand-written, not built with jq) ---
r="$TMP_ROOT/case19"; new_repo "$r"
STRIPPED="$TMP_ROOT/stripped-path/bin"
mkdir -p "$STRIPPED"
for c in bash git cat sed grep printf tr true false env sh cmp; do
  p=$(command -v "$c" 2>/dev/null)
  if [[ -n "$p" ]]; then
    ln -sf "$p" "$STRIPPED/$c"
  fi
done
payload="$(mk_payload "git commit -m x" "$r")"
HOOK_OUT=$(printf '%s' "$payload" | PATH="$STRIPPED" bash "$HOOK")
HOOK_CODE=$?
decision=$(printf '%s' "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecision // ""' 2>/dev/null)
if [[ "$HOOK_CODE" -eq 0 && "$decision" == "deny" ]]; then
  pass "jq missing still emits deny JSON"
else
  fail "jq missing still emits deny JSON" "exit=$HOOK_CODE decision=[$decision] out=[$HOOK_OUT]"
fi

# --- 20. planted internal failure AFTER the manifest read: DENY with crashed message ---
r="$TMP_ROOT/case20"; new_repo "$r"; adopt "$r"
payload="$(mk_payload "git status" "$r")"
HOOK_OUT=$(printf '%s' "$payload" | HOUSE_TEST_CRASH=1 bash "$HOOK")
HOOK_CODE=$?
reason=$(printf '%s' "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecisionReason // ""' 2>/dev/null)
CRASHED_REASON="house guard internal error in plugins/house/hooks/no-direct-master.sh; refusing rather than guessing. This is a bug in the guard, not a policy refusal: report the command that hit it."
if [[ "$HOOK_CODE" -eq 0 && "$reason" == "$CRASHED_REASON" ]]; then
  pass "planted internal failure denies with the crashed message"
else
  fail "planted internal failure denies with the crashed message" "exit=$HOOK_CODE reason=[$reason] out=[$HOOK_OUT]"
fi

# --- 20b. planted FATAL error (an unset variable under set -u) after the manifest read ---
# A fatal shell error exits non-zero without firing the ERR trap, and the
# harness reads that exit as an allow (#147). The fault is planted in a scratch
# copy of the hook, in place of the HOUSE_TEST_CRASH seam's `false`, so the
# tracked hook carries no second seam.
r="$TMP_ROOT/case20b"; new_repo "$r"; adopt "$r"
planted="$TMP_ROOT/case20b-hook.sh"
sed 's/^    false$/    : "$house_test_planted_unset"/' "$HOOK" >"$planted"
if ! grep -q 'house_test_planted_unset' "$planted"; then
  fail "planted fatal error denies with the crashed message" "could not plant the fault: the seam line moved"
else
  payload="$(mk_payload "git status" "$r")"
  HOOK_OUT=$(printf '%s' "$payload" | HOUSE_TEST_CRASH=1 bash "$planted" 2>/dev/null)
  HOOK_CODE=$?
  reason=$(printf '%s' "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecisionReason // ""' 2>/dev/null)
  if [[ "$HOOK_CODE" -eq 0 && "$reason" == "$CRASHED_REASON" ]]; then
    pass "planted fatal error denies with the crashed message"
  else
    fail "planted fatal error denies with the crashed message" "exit=$HOOK_CODE reason=[$reason] out=[$HOOK_OUT]"
  fi
fi

# --- 21. non-git command (ls), and a tool this hook does not handle: ALLOW ---
r="$TMP_ROOT/case21"; new_repo "$r"; adopt "$r"
expect_allow "non-git command (ls) allowed instantly" \
  "$(mk_payload "ls -la" "$r")"
expect_allow "a tool_name this hook does not handle is allowed instantly" \
  "$(jq -n --arg cwd "$r" '{tool_name:"Read", tool_input:{file_path:"/etc/gitconfig"}, cwd:$cwd}')"

# --- 22. malformed house.json in an adopted repo: deny, never a disarmed guard ---
r="$TMP_ROOT/case22"; new_repo "$r"
echo '{broken' >"$r/house.json"
expect_deny "malformed house.json on protected branch: DENY (refuse rather than guess)" \
  "$(mk_payload 'git commit -m test' "$r")" "cannot be read as the branch policy"

# ── the policy comes from HEAD, not the working tree ──────────────────────
# Round 1 shipped with the policy read off disk, so one Write to house.json
# turned every layer off at once. HEAD decides; the working tree is consulted
# only when HEAD has no house.json at all.
p="$TMP_ROOT/head-policy"; new_repo "$p"; adopt "$p"
printf '%s' '{"branchPolicy":"direct"}' >"$p/house.json"
expect_deny "a working-tree house.json set to direct does not disarm the guard" \
  "$(mk_payload "git commit -m x" "$p")" "feature branch"
printf '%s' '{"branchPolicy":"pr","protectedBranches":["nothing"]}' >"$p/house.json"
expect_deny "a working-tree house.json that unprotects master does not disarm the guard" \
  "$(mk_payload "git commit -m x" "$p")" "feature branch"
rm -f "$p/house.json"
expect_deny "deleting house.json from the working tree does not disarm the guard" \
  "$(mk_payload "git commit -m x" "$p")" "feature branch"
printf '%s' '{broken' >"$p/house.json"
expect_deny "a broken working-tree house.json is ignored while HEAD has a good one" \
  "$(mk_payload "git commit -m x" "$p")" "feature branch"
git -C "$p" checkout -q -- house.json 2>/dev/null || git -C "$p" checkout -q HEAD -- house.json
# The other direction: HEAD says direct, the working tree says pr. HEAD wins.
p2="$TMP_ROOT/head-policy-direct"; new_repo "$p2"; adopt "$p2" '{"branchPolicy":"direct"}'
printf '%s' '{"branchPolicy":"pr"}' >"$p2/house.json"
expect_allow "a working-tree house.json set to pr does not arm a repo whose HEAD says direct" \
  "$(mk_payload "git commit -m x" "$p2")"
# A repo adopting house before its first commit has no HEAD:house.json at all,
# so the working-tree file is the only policy there is.
p3="$TMP_ROOT/head-policy-unborn"; new_repo "$p3"
printf '%s' '{"branchPolicy":"pr"}' >"$p3/house.json"
expect_deny "with no house.json on HEAD, the working-tree file is the policy" \
  "$(mk_payload "git commit -m x" "$p3")" "feature branch"
# house.json itself stays editable: render and people change it legitimately,
# and the change only counts once it is on the branch.
expect_allow "Write on house.json is allowed" \
  "$(mk_file_payload Write "$p/house.json" "$p")"
expect_allow "Edit on house.json is allowed" \
  "$(mk_file_payload Edit "house.json" "$p")"

# ── the github module off: C and the arming advice stand down (#159) ─────
# ADR 0017. Turning the module off removes the floor, so the guard used to
# switch to its unarmed rules and tell the user to arm what they had removed.
# Only the JSON literal false, on HEAD, stands C down; A, B, D and E stay.
_gh_off='{"branchPolicy":"pr","modules":{"github":{"enabled":false}}}'
_gh_on='{"branchPolicy":"pr","modules":{"github":{"enabled":true}}}'
_ps="git"" push"; _gu="git"" config --unset core.hooks""Path"
_nv="--no-""verify"; _gcm="git"" commit"; _co="git"" check""out -b"
g="$TMP_ROOT/gh-off"; new_repo "$g"; adopt "$g" "$_gh_off"
expect_allow "github off at HEAD, no floor: a commit on the protected branch" \
  "$(mk_payload "$_gcm -m x" "$g")"
expect_allow "github off at HEAD, no floor: a push to the protected branch" \
  "$(mk_payload "$_ps origin master" "$g")"
expect_allow "github off at HEAD, no floor: a merge on the protected branch" \
  "$(mk_payload "git merge topic" "$g")"
expect_deny_without "github off at HEAD: unsetting the hooks path is still refused, with no arming advice" \
  "$(mk_payload "$_gu" "$g")" "arm it"
expect_deny_without "github off at HEAD: an rm of .githooks is still refused, with no arming advice" \
  "$(mk_payload "rm -rf .githooks" "$g")" "arm it"
expect_deny_without "github off at HEAD: an Edit under .githooks is still refused, with no arming advice" \
  "$(mk_file_payload Edit "$g/.githooks/pre-push" "$g")" "arm it"
expect_deny_without "github off at HEAD: $_nv is still refused, with no arming advice" \
  "$(mk_payload "$_gcm $_nv -m x" "$g")" "arm it"
expect_deny "github off at HEAD: section E still refuses a branch in the main checkout" \
  "$(mk_payload "$_co topic" "$g")" "Branch in a worktree"
git -C "$g" checkout -q -b feat
expect_allow "github off at HEAD on a feature branch: a push onto the protected branch" \
  "$(mk_payload "$_ps origin HEAD:master" "$g")"
expect_deny_without "github off at HEAD on a feature branch: unsetting the hooks path is still refused" \
  "$(mk_payload "$_gu" "$g")" "arm it"
# The two-call sequence: commit the module off on a feature branch of an
# ARMED repo, then unset the hooks path and push onto master. The first call
# is refused, so the floor stays armed and its pre-push decides the second.
g2="$TMP_ROOT/gh-off-armed"; new_repo "$g2"; adopt "$g2" "$_gh_on"; install_floor "$g2"
git -C "$g2" checkout -q -b feat; adopt "$g2" "$_gh_off"; arm_hookspath "$g2"
expect_deny "github off on a feature-branch commit, floor armed: unsetting the hooks path is refused" \
  "$(mk_payload "$_gu" "$g2")" "disables or moves the git-hook floor"
# Default on and fail closed: anything but the literal false is on.
for _j in '{"branchPolicy":"pr","modules":{"github":{"enabled":"false"}}}' \
          '{"branchPolicy":"pr","modules":{"github":{"enabled":null}}}' \
          '{"branchPolicy":"pr","modules":{"github":{"enabled":0}}}' \
          '{"branchPolicy":"pr","modules":{"github":{}}}' \
          '{"branchPolicy":"pr","modules":{}}' \
          '{"branchPolicy":"pr","modules":"github"}' \
          "$_gh_on"; do
  _k=$((${_k:-0} + 1)); g3="$TMP_ROOT/gh-on-$_k"; new_repo "$g3"; adopt "$g3" "$_j"
  expect_deny "house.json $_j at HEAD: a commit on the protected branch is refused" \
    "$(mk_payload "$_gcm -m x" "$g3")" "feature branch"
  expect_deny "house.json $_j at HEAD: a push to the protected branch is refused" \
    "$(mk_payload "$_ps origin master" "$g3")" "protected branch"
done
g4="$TMP_ROOT/gh-malformed"; new_repo "$g4"; adopt "$g4" '{"branchPolicy":"pr","modules":{"github":{"enabled":false}}'
expect_deny "a malformed house.json at HEAD that would turn github off: refused" \
  "$(mk_payload "$_gcm -m x" "$g4")" "cannot be read as the branch policy"
# Off only in the working tree: HEAD decides, so the module is still on,
# including for a commit that would carry that very edit onto master.
g5="$TMP_ROOT/gh-off-worktree"; new_repo "$g5"; adopt "$g5" "$_gh_on"
printf '%s' "$_gh_off" >"$g5/house.json"
git -C "$g5" add house.json
expect_deny "github off only in the working tree: a commit carrying it onto master is refused" \
  "$(mk_payload "$_gcm -m x" "$g5")" "feature branch"
expect_deny "github off only in the working tree: a push to the protected branch is refused" \
  "$(mk_payload "$_ps origin master" "$g5")" "protected branch"
expect_deny "github on at HEAD: section E refuses a branch in the main checkout" \
  "$(mk_payload "$_co topic" "$g5")" "Branch in a worktree"
# An alias body is text the floor never sees, so the disable list and the
# plumbing scan read it with the module off too, in every floor state, and in
# a `direct` repo. Only the commit, push and history refusals stand down: an
# alias whose body is a plain push is allowed like a typed one.
_alias_cases() { # <repo> <label>
  git -C "$1" config alias.hp "-c core.hooks""Path=/dev/null push"
  git -C "$1" config alias.pd "push --delete origin master"
  git -C "$1" config alias.ur "update-ref refs/heads/master HEAD"
  git -C "$1" config alias.nuke '!rm -rf .githooks && git push'
  git -C "$1" config alias.pn "push $_nv"
  git -C "$1" config alias.pp "push"
  expect_deny "$2: an alias body carrying core.hooksPath is refused" \
    "$(mk_payload "git hp origin master" "$1")" "disables or moves"
  expect_deny "$2: an alias body deleting a protected branch is refused" \
    "$(mk_payload "git pd" "$1")" "disables or moves"
  expect_deny "$2: an alias body writing a protected ref is refused" \
    "$(mk_payload "git ur" "$1")" "disables or moves"
  expect_deny "$2: a shell alias that removes the floor is refused" \
    "$(mk_payload "git nuke" "$1")" "shell alias"
  expect_deny "$2: an alias body skipping the hooks is refused" \
    "$(mk_payload "git pn origin feat:master" "$1")" "disables or moves"
}
_alias_cases "$g" "github off at HEAD, no floor"
expect_allow "github off at HEAD, no floor: an alias whose body is a plain push" \
  "$(mk_payload "git pp origin feat:master" "$g")"
_alias_cases "$g2" "github off on a feature-branch commit, floor armed"
expect_allow "github off on a feature-branch commit, floor armed: an alias whose body is a plain push" \
  "$(mk_payload "git pp origin feat:master" "$g2")"
g6="$TMP_ROOT/direct-armed"; new_repo "$g6"; adopt "$g6"; install_floor "$g6"
git -C "$g6" checkout -q -b feat; adopt "$g6" '{"branchPolicy":"direct"}'; arm_hookspath "$g6"
_alias_cases "$g6" "direct on a feature-branch commit, floor armed"
# An alias the command defines inline (`git -c alias.z=<body> z`) is NOT read
# as an alias body (ADR 0017's residue): a text scan for it misread commit
# messages, echoes, heredocs and grep patterns, missed quoted and escaped
# spellings, and ran past the hook's timeout. What the command text itself
# shows is still read: an inline body carrying `--no-verify` or a hooks-path
# change is refused by the disable list. The ordinary commands below that the
# scan once refused are pinned as allowed, so a future scan cannot bring the
# false denies back.
g8="$TMP_ROOT/gh-off-broken"; new_repo "$g8"; adopt "$g8" "$_gh_on"; install_floor "$g8"
git -C "$g8" checkout -q -b feat; adopt "$g8" "$_gh_off"; arm_hookspath "$g8"
echo '# edited' >>"$g8/.githooks/pre-push"
g9="$TMP_ROOT/defer-inline"; new_repo "$g9"; mkdir -p "$g9/.claude"
echo '{"branchPolicy":"pr"}' >"$g9/house.json"
echo '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"x"}]}]}}' >"$g9/.claude/settings.json"
git -C "$g9" add house.json .claude/settings.json && git -C "$g9" commit -q -m house
_ur="update-ref refs/heads/master HEAD"
_inline_cases() { # <repo> <label>
  expect_deny "$2: an inline alias body skipping the hooks is refused by the disable list" \
    "$(mk_payload "git -c alias.x='push $_nv' x origin feat:master" "$1")" "disables or moves"
  expect_deny "$2: an inline alias body changing the hooks path is refused by the disable list" \
    "$(mk_payload "git -c alias.y='-c core.hooks""Path=/dev/null push' y origin feat:master" "$1")" "disables or moves"
  expect_allow "$2: an inline alias with a harmless body is allowed" \
    "$(mk_payload "git -c alias.s=status s" "$1")"
  expect_allow "$2: a commit message quoting an inline alias is allowed" \
    "$(mk_payload "$_gcm -m \"Guard: -c alias.z='$_ur' is now checked\"" "$1")"
  expect_allow "$2: a grep counting alias lines in the git config is allowed" \
    "$(mk_payload "grep -c 'alias.*=!' ~/.gitconfig" "$1")"
  expect_allow "$2: a grep for an alias-shaped pattern is allowed" \
    "$(mk_payload "grep -c \"alias.z=update-ref\" docs/git-notes.md" "$1")"
  expect_allow "$2: an echo of an inline alias into a file is allowed" \
    "$(mk_payload "echo \"git -c alias.z='$_ur' z\" >> notes.md" "$1")"
  expect_allow "$2: a heredoc holding an inline alias is allowed" \
    "$(mk_payload "cat <<'EOT' > notes.md"$'\n'"git -c alias.z='$_ur' z"$'\n'"EOT" "$1")"
}
_inline_cases "$g" "github off at HEAD, no floor"
_inline_cases "$g2" "github off on a feature-branch commit, floor armed"
_inline_cases "$g8" "github off on a feature-branch commit, floor broken"
_inline_cases "$g6" "direct on a feature-branch commit, floor armed"
_inline_cases "$g9" "a repo deferring to its own guard"
# The switch is the jq pass's FIRST field, a fixed token, but nothing pins
# that order: the control-character refusal below already keeps every value
# on its own line, so no string can reach another field whatever the order.
# The switch cannot be set from a string: no value in house.json can shift
# the jq pass's fields, and a second JSON document is not read.
g7="$TMP_ROOT/gh-sep"; new_repo "$g7"
echo staged >"$g7/staged.txt"
for _j in '{"branchPolicy":"pr","carveOuts":["\u001e","off"]}' \
          '{"branchPolicy":"pr","protectedBranches":["master","\u001e","off"]}' \
          '{"branchPolicy":"pr","carveOuts":["a\n\u001e\noff"]}' \
          '{"branchPolicy":"pr"}{"modules":{"github":{"enabled":false}}}' \
          '{"branchPolicy":"pr","protectedBranches":["master","\u001e","*"]}' \
          '{"branchPolicy":"pr\ndirect"}'; do
  printf '%s' "$_j" >"$g7/house.json"
  git -C "$g7" add house.json && git -C "$g7" commit -q -m house
  git -C "$g7" add staged.txt
  expect_deny "house.json $_j at HEAD: a commit on the protected branch is refused" \
    "$(mk_payload "$_gcm -m x" "$g7")"
  git -C "$g7" reset -q staged.txt
done

# ── the deference matrix: only a PreToolUse entry that can SEE the call ───
repo_d="$TMP_ROOT/defer"; new_repo "$repo_d"; adopt "$repo_d"
mkdir -p "$repo_d/.claude"
_gc="git"" commit"

echo '{"hooks":{"PostToolUse":[{"matcher":"Bash","hooks":[]}]}}' >"$repo_d/.claude/settings.json"
expect_deny "PostToolUse-only settings.json does not disarm the guard" \
  "$(mk_payload "$_gc -m x" "$repo_d")"
echo '{"hooks":{"PreToolUse":{"matcher":"Bash"}}}' >"$repo_d/.claude/settings.json"
expect_deny "a non-array PreToolUse value does not disarm the guard" \
  "$(mk_payload "$_gc -m x" "$repo_d")"
echo '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[]}]}}' >"$repo_d/.claude/settings.json"
expect_deny "a Bash-matching entry with an empty hooks array does not disarm the guard" \
  "$(mk_payload "$_gc -m x" "$repo_d")"
# 2026-09-20 audit: an entry whose matcher names other tools never sees a git
# command, so deferring to it gave up enforcement for nothing.
for _m in 'Edit|Write' 'Edit' 'Read' 'mcp__.*' 'bash' '('; do
  printf '{"hooks":{"PreToolUse":[{"matcher":"%s","hooks":[{"type":"command","command":"x"}]}]}}' "$_m" >"$repo_d/.claude/settings.json"
  expect_deny "a PreToolUse entry with matcher '$_m' cannot see Bash and does not disarm the guard" \
    "$(mk_payload "$_gc -m x" "$repo_d")"
done
for _m in 'Bash|Edit' '.*' '' '*' 'Ba.h'; do
  printf '{"hooks":{"PreToolUse":[{"matcher":"Edit","hooks":[{"type":"command","command":"y"}]},{"matcher":"%s","hooks":[{"type":"command","command":"x"}]}]}}' "$_m" >"$repo_d/.claude/settings.json"
  expect_allow "a PreToolUse entry with matcher '$_m' covers Bash and defers" \
    "$(mk_payload "$_gc -m x" "$repo_d")"
done
echo '{"hooks":{"PreToolUse":[{"hooks":[{"type":"command","command":"x"}]}]}}' >"$repo_d/.claude/settings.json"
expect_allow "a PreToolUse entry with no matcher at all covers every tool and defers" \
  "$(mk_payload "$_gc -m x" "$repo_d")"
rm -f "$repo_d/.claude/settings.json"

# ADR 0009: house.json's guard record is a CHECKER signal only; the hook never
# reads it.
printf '{"branchPolicy":"pr","guard":{"by":"plugin","decided":"2026-08-31","why":"recorded choice"}}' >"$repo_d/house.json"
git -C "$repo_d" add house.json && git -C "$repo_d" commit -q -m guard
expect_deny "a recorded plugin guard in house.json is not a stand-down signal" \
  "$(mk_payload "$_gc -m x" "$repo_d")"

# ── the strip's direction: prose cannot steer which checkout is decided ───
# The target regexes used to run on the RAW command, so `cd /nonexistent &&`
# inside a commit message pointed the check at a non-repo path and the
# deliberate non-repo fail-open turned into an attacker-controlled disarm.
r="$TMP_ROOT/strip"; new_repo "$r"; adopt "$r"
o="$TMP_ROOT/strip-other"; new_repo "$o"; adopt "$o"
git -C "$o" checkout -q -b feat/y
_c="git"" commit"
_verb="com""mit"
expect_deny "a message naming a missing path cannot disarm the guard" \
  "$(mk_payload "$_c -m \"note: cd /nonexistent && done\"" "$r")" "feature branch"
expect_deny "a -C at a missing path cannot disarm the guard" \
  "$(mk_payload "git -C /nonexistent status && $_c -m z" "$r")" "feature branch"
expect_allow "a real cd to another repo still resolves to THAT repo" \
  "$(mk_payload "cd $o && $_c -m x" "$r")"
expect_allow "a real -C to another repo still resolves to THAT repo" \
  "$(mk_payload "git -C $o $_verb -m x" "$r")"
expect_deny "a real -C INTO the protected repo is still caught from elsewhere" \
  "$(mk_payload "git -C $r $_verb -m x" "$o")" "feature branch"
# #69 refuses `git checkout -b` in the MAIN checkout now, so this fixture
# needs a linked worktree of $r to still exercise BRANCH_CREATED_AT.
rw="$TMP_ROOT/strip-wt"
git -C "$r" worktree add "$rw" -b strip-wt-base master >/dev/null 2>&1  # no -q: git < 2.19 lacks it
expect_allow "a branch created earlier in the same call is where the commit lands" \
  "$(mk_payload "git checkout -b feat/new && $_c -m x" "$rw")"

# ── a commit or push whose git target this hook cannot read is refused ────
# Both modes: a computed directory cannot be checked at all, and a bare repo
# has no working tree, no house.json and no floor.
git init -q --bare "$TMP_ROOT/bare.git"
expect_deny "a commit at a computed -C target is refused" \
  "$(mk_payload 'git -C $d commit -m x' "$r")" "computed git target"
expect_deny "a push at a computed -C target is refused" \
  "$(mk_payload 'git -C ${WT} push origin feat/x' "$r")" "computed git target"
expect_deny "a push into a bare repository is refused" \
  "$(mk_payload "git -C $TMP_ROOT/bare.git push origin master" "$r")" "bare repository"
expect_deny "a push at a -C target that does not exist is refused" \
  "$(mk_payload "git -C /nonexistent-xyz push origin feat/x" "$r")" "does not exist"
expect_allow "a computed -C on a read-only verb is not our business" \
  "$(mk_payload 'git -C $d status' "$r")"

# ── the verb walk: a global option is stepped over ────────────────────────
expect_deny "git --no-pager commit on master still denies" \
  "$(mk_payload "git --no-pager $_verb -m x" "$r")" "feature branch"
expect_deny "git -c key=value (space-free value) commit still denies on master" \
  "$(mk_payload "git -c user.name=x $_verb -m y" "$r")" "feature branch"
expect_allow "git -c key=value status is untouched" \
  "$(mk_payload 'git -c user.name=x status' "$r")"

# ── the disable list: every literal, each with an innocent neighbour ──────
# Run from a FEATURE branch, so only the disable list can produce a deny.
d="$TMP_ROOT/disable"; new_repo "$d"; adopt "$d"
git -C "$d" checkout -q -b feat/d
_cm="com""mit"
_ph="hooks""Path"

expect_deny "--no-verify on a commit" \
  "$(mk_payload "git $_cm --no-verify -m x" "$d")" "disables or moves the git-hook floor"
expect_deny "--no-verif (git accepts the abbreviation)" \
  "$(mk_payload "git $_cm --no-verif -m x" "$d")" "disables or moves"
expect_deny "--no-veri (git accepts the abbreviation)" \
  "$(mk_payload "git $_cm --no-veri -m x" "$d")" "disables or moves"
expect_allow "the same letters inside a commit message are prose" \
  "$(mk_payload "git $_cm -m \"no --no-verify here\"" "$d")"
expect_deny "-n as a commit option is --no-verify's short form" \
  "$(mk_payload "git $_cm -n -m x" "$d")" "disables or moves"
expect_deny "-n inside a short-flag cluster on a commit" \
  "$(mk_payload "git $_cm -an -m x" "$d")" "disables or moves"
expect_allow "-n on a push is a dry run, not a hook switch" \
  "$(mk_payload "git push -n origin feat/d" "$d")"
expect_allow "-n on git log is not a commit option" \
  "$(mk_payload "git log -n 5 --oneline" "$d")"
expect_deny "core.hooksPath on the command line" \
  "$(mk_payload "git -c core.$_ph=/dev/null $_cm -m x" "$d")" "disables or moves"
expect_deny "git config core.hooksPath (writing it)" \
  "$(mk_payload "git config core.$_ph /dev/null" "$d")" "disables or moves"
# #69: a bare `git config --get`/`--get-all`/`--get-regexp` only READS the
# key, so it is allowed; every other git-clause spelling still is not.
expect_allow "git config --get core.hooksPath is readable" \
  "$(mk_payload "git config --get core.$_ph" "$d")"
expect_allow "git config --get-all core.hooksPath is readable" \
  "$(mk_payload "git config --get-all core.$_ph" "$d")"
expect_deny "git config --unset core.hooksPath" \
  "$(mk_payload "git config --unset core.$_ph" "$d")" "disables or moves"
expect_deny "git config --get core.hooksPath chained with --unset" \
  "$(mk_payload "git config --get core.$_ph && git config --unset core.$_ph" "$d")" "disables or moves"
expect_deny "a -c assignment next to a readable --get" \
  "$(mk_payload "git -c core.$_ph=/dev/null config --get core.$_ph" "$d")" "disables or moves"
expect_deny "core.hooksPath inside bash -c is still a git clause" \
  "$(mk_payload "bash -c 'git config core.$_ph /x'" "$d")" "disables or moves"
expect_deny "an echo-and-append past .gitignore still assigns the key" \
  "$(mk_payload "echo \"core.$_ph=/x\" | tee -a ~/.gitconfig" "$d")" "disables or moves"
expect_allow "prose naming core.hooksPath with no git token passes" \
  "$(mk_payload "gh issue create --title \"core.$_ph is unreadable\" --body-file /tmp/x" "$d")"
expect_allow "echo core.hooksPath with no git token and no assignment passes" \
  "$(mk_payload "echo core.$_ph" "$d")"
# Refuter round: the space-separated INI spelling (`hooksPath = /x`) is a key
# token immediately followed by a token starting with `=`, with no git token
# and no `=` glued to the key itself, and it must deny like every other spelling.
expect_deny "echo appending the INI spelling to .gitconfig" \
  "$(mk_payload "echo \"[core] $_ph = /x\" >> ~/.gitconfig" "$d")" "disables or moves"
expect_deny "printf appending the INI spelling to .gitconfig" \
  "$(mk_payload "printf '[core] $_ph = /x' >> ~/.gitconfig" "$d")" "disables or moves"
expect_deny "sed -i writing the INI spelling into .gitconfig" \
  "$(mk_payload "sed -i '' -e \"1a $_ph = /x\" ~/.gitconfig" "$d")" "disables or moves"
# A config include can point core.hooksPath anywhere, and `git config --get`
# resolves it, so the floor reads as disarmed while .git/config looks clean.
expect_deny "git config include.path (a config include can set hooksPath)" \
  "$(mk_payload "git config include.path ../evil" "$d")" "disables or moves"
expect_deny "-c include.path on the command line" \
  "$(mk_payload "git -c include.path=/tmp/evil $_cm -m x" "$d")" "disables or moves"
expect_deny "includeIf in any case" \
  "$(mk_payload "git config includeif.gitdir:/x.path /tmp/evil" "$d")" "disables or moves"
expect_deny "ACCEPTED FALSE DENY: reading include.path is refused too" \
  "$(mk_payload "git config --get include.path" "$d")" "disables or moves"
expect_deny "GIT_CONFIG_COUNT through the environment" \
  "$(mk_payload "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.x GIT_CONFIG_VALUE_0=y git $_cm -m x" "$d")" "disables or moves"
expect_deny "GIT_CONFIG_PARAMETERS through the environment" \
  "$(mk_payload "GIT_CONFIG_PARAMETERS=\"'core.x=y'\" git $_cm -m x" "$d")" "disables or moves"
expect_deny "GIT_CONFIG_GLOBAL through the environment" \
  "$(mk_payload "GIT_CONFIG_GLOBAL=/dev/null git $_cm -m x" "$d")" "disables or moves"
expect_deny "--config-env" \
  "$(mk_payload "git --config-env=core.x=VAR $_cm -m y" "$d")" "disables or moves"
expect_deny "--exec-path" \
  "$(mk_payload "git --exec-path=/tmp/fake $_cm -m y" "$d")" "disables or moves"
expect_deny "GIT_EXEC_PATH through the environment" \
  "$(mk_payload "GIT_EXEC_PATH=/tmp/fake git $_cm -m y" "$d")" "disables or moves"
expect_deny "HUSKY=0" \
  "$(mk_payload "HUSKY=0 git $_cm -m y" "$d")" "disables or moves"
expect_deny "LEFTHOOK=0, with no git command in the call at all" \
  "$(mk_payload "LEFTHOOK=0 npm run release" "$d")" "disables or moves"

# Mutating the floor's own files. Reading them passes.
expect_allow "cat .githooks/pre-push is a read" \
  "$(mk_payload "cat .githooks/pre-push" "$d")"
expect_allow "ls .githooks is a read" \
  "$(mk_payload "ls -la .githooks" "$d")"
expect_allow "running the floor's own suite is a read" \
  "$(mk_payload "bash tests/githooks/run.sh" "$d")"
expect_deny "rm .githooks/pre-push" \
  "$(mk_payload "rm .githooks/pre-push" "$d")" "disables or moves"
expect_deny "mv .githooks/pre-push aside" \
  "$(mk_payload "mv .githooks/pre-push /tmp/x" "$d")" "disables or moves"
expect_deny "chmod -x .githooks/pre-push" \
  "$(mk_payload "chmod -x .githooks/pre-push" "$d")" "disables or moves"
expect_deny "sed -i on a floor file" \
  "$(mk_payload "sed -i.bak s/x/y/ .githooks/pre-commit" "$d")" "disables or moves"
expect_deny "a redirection into a floor file" \
  "$(mk_payload "echo x > .githooks/pre-push" "$d")" "disables or moves"
# #69: a redirection onto another stream, next to a floor file in the same
# clause, goes nowhere near the floor's bytes and is allowed; a redirection to
# a path, or to /dev/null, still is not.
expect_allow "listing the floor with stderr folded into stdout" \
  "$(mk_payload "ls .githooks/pre-commit.d/ 2>&1" "$d")"
expect_deny "listing the floor with stderr discarded" \
  "$(mk_payload "ls .githooks 2>/dev/null" "$d")" "disables or moves"
expect_deny "cat redirected onto a floor file" \
  "$(mk_payload "cat x > .githooks/pre-commit" "$d")" "disables or moves"
expect_deny "truncating .git/config" \
  "$(mk_payload "truncate -s 0 .git/config" "$d")" "disables or moves"
expect_deny "writing into .git/hooks" \
  "$(mk_payload "cp /tmp/x .git/hooks/pre-commit" "$d")" "disables or moves"
# Residue, documented and deliberate: a wildcard that never spells `.githooks`
# is not on the list. The NEXT call sees a floor that is gone and refuses
# everything the floor used to cover, which is the safe direction.
expect_allow "RESIDUE: a wildcard removal the literal list cannot see" \
  "$(mk_payload "rm -rf .gith*" "$d")"

# Ref-writing plumbing that moves a protected branch without a commit.
expect_deny "git update-ref on a protected branch" \
  "$(mk_payload "git update-ref refs/heads/master HEAD" "$d")" "disables or moves"
expect_deny "git symbolic-ref onto a protected branch" \
  "$(mk_payload "git symbolic-ref HEAD refs/heads/master" "$d")" "disables or moves"
# Spoofing the remote-tracking ref is how the reference-transaction guard's
# "the remote already has this commit" test was fooled.
expect_deny "git update-ref on a remote-tracking ref for a protected branch" \
  "$(mk_payload "git update-ref refs/remotes/origin/master HEAD" "$d")" "disables or moves"
expect_deny "git update-ref on an upstream-named remote's protected ref" \
  "$(mk_payload "git update-ref refs/remotes/upstream/main HEAD" "$d")" "disables or moves"
expect_allow "git update-ref on a remote-tracking ref for a feature branch" \
  "$(mk_payload "git update-ref refs/remotes/origin/feat/x HEAD" "$d")"
expect_deny "git branch -f on a protected branch" \
  "$(mk_payload "git branch -f master HEAD" "$d")" "disables or moves"
# The -m value is stripped before the general scan, so `branch` clauses get a
# second pass over text that kept it.
expect_deny "git branch -m renames a protected branch" \
  "$(mk_payload "git branch -m master old-master" "$d")" "disables or moves"
expect_deny "git branch -M force-renames a protected branch" \
  "$(mk_payload "git branch -M master old-master" "$d")" "disables or moves"
# A delete is NOT on the list any more: throwing away a local ref the remote
# still has is safe, and the floor allows it.
expect_allow "git branch -D on a protected branch is a local delete, not a move" \
  "$(mk_payload "git branch -D master" "$d")"
expect_allow "git branch -d on a protected branch is a local delete" \
  "$(mk_payload "git branch -d master" "$d")"
expect_allow "git branch -D on a feature branch" \
  "$(mk_payload "git branch -D feat/old" "$d")"
expect_allow "git update-ref on a feature branch" \
  "$(mk_payload "git update-ref refs/heads/feat/old HEAD" "$d")"
expect_allow "git branch (a listing) is untouched" \
  "$(mk_payload "git branch --list" "$d")"

# #69: a branch-creating checkout/switch in the (unarmed) main checkout of an
# adopted repo is refused as a workspace rule; a plain checkout, a checkout of
# a path, and a branch listing are still the floor's or git's business.
expect_deny "unarmed main checkout: git checkout -b is refused" \
  "$(mk_payload "git checkout -b feat/x" "$d")" "worktree add"
expect_deny "unarmed main checkout: git switch -c is refused" \
  "$(mk_payload "git switch -c feat/x" "$d")" "worktree add"
expect_allow "checking out an existing branch is untouched" \
  "$(mk_payload "git checkout main" "$d")"
expect_allow "checking out a path is untouched" \
  "$(mk_payload "git checkout -- README.md" "$d")"
expect_allow "git branch <name> creates no worktree conflict" \
  "$(mk_payload "git branch feat/x" "$d")"
# Refuter round: the create letter counts glued or clustered, not just as its
# own token, and stops at a `--` separator.
expect_deny "git checkout -bnewb (glued branch name) is refused" \
  "$(mk_payload "git checkout -bnewb" "$d")" "worktree add"
expect_deny "git checkout -Bnewb (glued, force) is refused" \
  "$(mk_payload "git checkout -Bnewb" "$d")" "worktree add"
expect_deny "git switch -cnewb (glued branch name) is refused" \
  "$(mk_payload "git switch -cnewb" "$d")" "worktree add"
expect_deny "git checkout -qb newb (clustered short flags) is refused" \
  "$(mk_payload "git checkout -qb newb" "$d")" "worktree add"
expect_allow "git checkout -q master (no create letter) is untouched" \
  "$(mk_payload "git checkout -q master" "$d")"
expect_allow "git checkout -- -b (a pathspec after --, not a flag)" \
  "$(mk_payload "git checkout -- -b" "$d")"
# #112: the clause is judged by the directory it acts in, not the payload cwd.
# From the main checkout, a branch created in a linked worktree (by `-C` or a
# leading `cd`) is allowed; from the worktree, one aimed at the main checkout
# is refused; a computed `-C` keys to the payload cwd and is refused there.
git -C "$d" worktree add "$d-wt" -b wt-base master >/dev/null 2>&1
expect_allow "main checkout cwd: git -C <worktree> switch -c is allowed" \
  "$(mk_payload "git -C $d-wt switch -c feat/x" "$d")"
expect_allow "main checkout cwd: cd <worktree> && git switch -c is allowed" \
  "$(mk_payload "cd $d-wt && git switch -c feat/x" "$d")"
expect_deny "main checkout cwd: a bare git switch -c is still refused" \
  "$(mk_payload "git switch -c feat/x" "$d")" "worktree add"
expect_deny "worktree cwd: git -C <main> switch -c is refused" \
  "$(mk_payload "git -C $d switch -c feat/x" "$d-wt")" "worktree add"
expect_deny "worktree cwd: cd <main> && git checkout -b is refused" \
  "$(mk_payload "cd $d && git checkout -b feat/x" "$d-wt")" "worktree add"
expect_deny "main checkout cwd: a computed -C keys to the payload cwd and is refused" \
  "$(mk_payload 'git -C "$WT" switch -c feat/x' "$d")" "worktree add"
# Refuter round: a `cd` the target keying never sees (inside a stripped -m or
# -c value, a subshell, or mid-clause) and a git directory named by the
# environment cannot move the clause out of the main checkout.
expect_deny "a cd inside a computed -m value does not re-key the next clause" \
  "$(mk_payload "true -m \"\$X; cd $d-wt\"; git switch -c feat/x" "$d")" "worktree add"
expect_deny "a cd inside a -c value does not re-key the next clause" \
  "$(mk_payload "git -c \"a=\$(cd $d-wt)\" status; git switch -c feat/x" "$d")" "worktree add"
expect_deny "GIT_DIR= on a branch create aimed at a worktree is refused" \
  "$(mk_payload "GIT_DIR=$d/.git git -C $d-wt switch -c feat/x" "$d")" "worktree add"
expect_deny "--git-dir= on a branch create aimed at a worktree is refused" \
  "$(mk_payload "git -C $d-wt --git-dir=$d/.git switch -c feat/x" "$d")" "worktree add"
expect_deny "a cd in a subshell does not carry into the next clause" \
  "$(mk_payload "(cd $d-wt); git switch -c feat/x" "$d")" "worktree add"
expect_deny "a cd that is not the clause's first word is not a directory change" \
  "$(mk_payload "echo cd $d-wt && git switch -c feat/x" "$d")" "worktree add"
# Round 2: only two exact shapes skip the refusal, `git -C <wt> ...` alone and
# `cd [--] <wt> && git ...`; anything else is scanned whole, as before #112.
expect_allow "cd -- <worktree> && git switch -c is allowed" \
  "$(mk_payload "cd -- $d-wt && git switch -c feat/x" "$d")"
expect_allow "git -C <worktree> with a global option before the verb is allowed" \
  "$(mk_payload "git -C $d-wt --no-pager switch -c feat/x" "$d")"
expect_deny "a hidden cd in a -m value next to a real -C is refused" \
  "$(mk_payload "git -C $d-wt status; true -m \"\$X; cd $d-wt\"; git switch -c feat/x" "$d")" "worktree add"
expect_deny "a hidden cd in a -m value before a real cd is refused" \
  "$(mk_payload "true -m \"\$X; cd $d-wt\"; git switch -c feat/x; cd $d-wt && git status" "$d")" "worktree add"
expect_deny "a hidden cd in a -c value next to a real -C is refused" \
  "$(mk_payload "git -c \"a=\$X; cd $d-wt\" status; git switch -c feat/x; git -C $d-wt status" "$d")" "worktree add"
expect_deny "cd - after a literal cd is refused" \
  "$(mk_payload "cd $d-wt; cd -; git switch -c feat/x" "$d")" "worktree add"
expect_deny "popd after pushd is refused" \
  "$(mk_payload "pushd $d-wt; popd; git switch -c feat/x" "$d")" "worktree add"
expect_deny "cd \$OLDPWD after a literal cd is refused" \
  "$(mk_payload "cd $d-wt; cd \"\$OLDPWD\"; git switch -c feat/x" "$d")" "worktree add"
expect_deny "a computed cd after a literal cd is refused" \
  "$(mk_payload "cd $d-wt && cd \$(pwd)/../disable && git switch -c feat/x" "$d")" "worktree add"
expect_deny "a cd in a brace group, then cd -, is refused" \
  "$(mk_payload "{ cd $d-wt; }; cd -; git switch -c feat/x" "$d")" "worktree add"
expect_deny "shape exclusion: a second cd" \
  "$(mk_payload "cd $d-wt && cd $d && git switch -c feat/x" "$d")" "worktree add"
expect_deny "shape exclusion: pushd" \
  "$(mk_payload "pushd $d-wt && git switch -c feat/x" "$d")" "worktree add"
expect_deny "shape exclusion: popd" \
  "$(mk_payload "cd $d-wt && popd && git switch -c feat/x" "$d")" "worktree add"
expect_deny "shape exclusion: a -C after a cd" \
  "$(mk_payload "cd $d-wt && git -C $d switch -c feat/x" "$d")" "worktree add"
expect_deny "shape exclusion: GIT_WORK_TREE=" \
  "$(mk_payload "GIT_WORK_TREE=$d git -C $d-wt switch -c feat/x" "$d")" "worktree add"
expect_deny "shape exclusion: GIT_COMMON_DIR=" \
  "$(mk_payload "GIT_COMMON_DIR=$d/.git git -C $d-wt switch -c feat/x" "$d")" "worktree add"
expect_deny "shape exclusion: --work-tree" \
  "$(mk_payload "git -C $d-wt --work-tree=$d switch -c feat/x" "$d")" "worktree add"
expect_deny "shape exclusion: a command substitution" \
  "$(mk_payload "git -C $d-wt switch -c feat/\$(date +%s)" "$d")" "worktree add"
expect_deny "shape exclusion: a backtick" \
  "$(mk_payload "git -C $d-wt switch -c feat/\`date +%s\`" "$d")" "worktree add"
expect_deny "shape exclusion: a \$ in a message value" \
  "$(mk_payload "cd $d-wt && git commit -m \"\$X\" && git switch -c feat/x" "$d")" "worktree add"
expect_deny "shape exclusion: a second branch-creating verb" \
  "$(mk_payload "cd $d-wt && git switch -c feat/x && git checkout -b feat/y" "$d")" "worktree add"
expect_deny "shape exclusion: a global -c before -C" \
  "$(mk_payload "git -c k=v -C $d-wt switch -c feat/x" "$d")" "worktree add"
# Round 3: the shapes are read from the raw command, so a bare `&` (which
# backgrounds what precedes it and runs the rest in the payload cwd), a
# separator a -m strip swallowed, a quote, `||` or `;` all fall back to the
# whole-command scan; a redirect is not a background.
expect_allow "shape A with a 2>&1 redirect is allowed" \
  "$(mk_payload "git -C $d-wt switch -c feat/x 2>&1" "$d")"
expect_deny "shape exclusion: a bare & after cd <wt> && ..." \
  "$(mk_payload "cd $d-wt && git status & git switch -c feat/x" "$d")" "worktree add"
expect_deny "shape exclusion: a bare & glued to a stripped -m value" \
  "$(mk_payload "git -C $d-wt switch -mx&git switch -c feat/x" "$d")" "worktree add"
expect_deny "shape exclusion: a quote in the -C path" \
  "$(mk_payload "git -C \"$d switch\" switch -c feat/x" "$d")" "worktree add"
expect_deny "shape exclusion: || after cd <wt> && ..." \
  "$(mk_payload "cd $d-wt && git status || git switch -c feat/x" "$d")" "worktree add"
expect_deny "shape exclusion: ; after cd <wt> && ..." \
  "$(mk_payload "cd $d-wt && git status; git switch -c feat/x" "$d")" "worktree add"
expect_deny "shape exclusion: --ignore-other-worktrees can move the main checkout's branch" \
  "$(mk_payload "git -C $d-wt checkout --ignore-other-worktrees -B master" "$d")" "worktree add"
expect_deny "shape exclusion: an abbreviated --git-dir global option" \
  "$(mk_payload "git -C $d-wt --git-di=$d/.git switch -c feat/x" "$d")" "worktree add"
# #125: a bare message value ends at a shell separator as well as at
# whitespace, so a separator glued to it cannot vanish with it and take the
# command behind it out of the scan.
expect_deny "a bare -m value glued to & does not hide the next command" \
  "$(mk_payload "cd $d-wt && git status -mx&git switch -c f" "$d")" "worktree add"
expect_deny "a bare -m value glued to ; does not hide the next command" \
  "$(mk_payload "cd $d-wt && git status -mx;git switch -c f" "$d")" "worktree add"
expect_deny "a bare -m value glued to | does not hide the next command" \
  "$(mk_payload "cd $d-wt && git status -mx|git switch -c f" "$d")" "worktree add"
expect_deny "a bare --message= value glued to & does not hide the next command" \
  "$(mk_payload "cd $d-wt && git status --message=x&git switch -c f" "$d")" "worktree add"
expect_deny "a bare -F value glued to & does not hide the next command" \
  "$(mk_payload "cd $d-wt && git status -Fx&git switch -c f" "$d")" "worktree add"
expect_allow "a bare -m value glued to && on a feature branch is a commit, then echo" \
  "$(mk_payload "git $_cm -mfix&&echo ok" "$d-wt")"
r="$TMP_ROOT/case125"; new_repo "$r"; adopt "$r"
expect_deny "a bare -m value glued to && on a protected branch is still a commit" \
  "$(mk_payload "git $_cm -mfix&&echo ok" "$r")" "feature branch"
expect_allow "a quoted -m value holding a separator is still stripped whole" \
  "$(mk_payload "git $_cm -m \"a & git switch -c f\"" "$d-wt")"
# A redirect glued to a bare value is one command, not a separator: the value
# ends at it, and the flags behind it stay in the commit's clause.
expect_deny "-n behind a >&2 glued to a bare -m value is still a commit's" \
  "$(mk_payload "git $_cm -mx>&2 -n" "$d")" "disables or moves"
expect_deny "-n behind a &>/dev/null glued to a bare -m value is still a commit's" \
  "$(mk_payload "git $_cm -mx&>/dev/null -n" "$d")" "disables or moves"
expect_deny "-an behind a >&2 glued to a bare -m value is still a commit's" \
  "$(mk_payload "git $_cm -mx>&2 -an" "$d")" "disables or moves"
expect_deny "-n behind a glued >&2, from a linked worktree" \
  "$(mk_payload "git $_cm -mx>&2 -n" "$d-wt")" "disables or moves"
expect_deny "update-ref behind a >&2 glued to a bare -m value" \
  "$(mk_payload "git update-ref -mx>&2 refs/heads/master HEAD" "$d")" "disables or moves"
expect_deny "update-ref behind a &>/dev/null glued to a bare -m value" \
  "$(mk_payload "git update-ref -mx&>/dev/null refs/heads/master HEAD" "$d")" "disables or moves"
expect_allow "a 2>&1 after a bare -m value on a feature branch" \
  "$(mk_payload "git $_cm -mfix 2>&1" "$d")"
expect_allow "a >out.log glued to a bare -m value on a feature branch" \
  "$(mk_payload "git $_cm -mfix>out.log" "$d")"
expect_deny "a & after a glued >&2 still ends the command" \
  "$(mk_payload "cd $d-wt && git status -mx>&2&git switch -c f" "$d")" "worktree add"
# #147: `|&` is a pipe (stderr along with stdout), one clause break, and a
# clause left empty by a separator is skipped rather than crashing the hook,
# whose non-zero exit the harness reads as an allow.
expect_allow "|& on a feature branch is a pipe, not a crash" \
  "$(mk_payload "git status |&cat" "$d-wt")"
expect_allow "a separator followed by a space leaves an empty clause, not a crash" \
  "$(mk_payload "git status & " "$d-wt")"
expect_deny "a branch create behind |& is still the main checkout's" \
  "$(mk_payload "cd $d-wt && git status |&git switch -c f" "$d")" "worktree add"
expect_deny "a commit behind |& on a protected branch is refused" \
  "$(mk_payload "echo x |&git $_cm -m x" "$r")" "feature branch"
git -C "$d" worktree remove --force "$d-wt" >/dev/null 2>&1
git -C "$d" branch -D wt-base >/dev/null 2>&1

# The disable list only applies in an ADOPTED repo (ADR 0002).
n="$TMP_ROOT/unadopted"; new_repo "$n"
expect_allow "--no-verify in a repo that never adopted house is not our business" \
  "$(mk_payload "git $_cm --no-verify -m x" "$n")"
expect_allow "git checkout -b in a repo that never adopted house is not our business" \
  "$(mk_payload "git checkout -b feat/x" "$n")"

# ── H2 (round-2 N2): a replace ref rewrites HEAD without moving a branch ──
# `git replace <head> <other>` makes `git show HEAD:house.json` return another
# commit's manifest, so the policy read must pass --no-replace-objects and the
# verb itself must be refused.
rp="$TMP_ROOT/replace"; new_repo "$rp"; adopt "$rp"
git -C "$rp" checkout -q -b side
printf '%s' '{"branchPolicy":"direct"}' >"$rp/house.json"
git -C "$rp" commit -q -a -m direct
rp_side=$(git -C "$rp" rev-parse HEAD)
git -C "$rp" checkout -q master
rp_head=$(git -C "$rp" rev-parse HEAD)
git -C "$rp" replace -f "$rp_head" "$rp_side"
expect_deny "a replace ref cannot turn the policy into direct" \
  "$(mk_payload "git $_cm -m x" "$rp")" "feature branch"
expect_deny "git replace is refused in an adopted repo" \
  "$(mk_payload "git replace -f $rp_head $rp_side" "$rp")" "disables or moves"
expect_deny "ACCEPTED FALSE DENY: listing replace refs is refused with writing them" \
  "$(mk_payload "git replace --list" "$rp")" "disables or moves"
expect_deny "git update-ref on a refs/replace ref is the same move as plumbing" \
  "$(mk_payload "git update-ref refs/replace/$rp_head $rp_side" "$rp")" "disables or moves"
expect_allow "reading the manifest is not writing a replace ref" \
  "$(mk_payload "git cat-file blob HEAD:house.json" "$rp")"

# ── H3 (round-2 N3): the floor's own protection is not the branch policy ──
# branchPolicy direct and a repo-local branch guard both say who decides which
# BRANCH may move. Neither licenses unarming core.hooksPath, editing a hook, or
# writing a ref by hand, so the disable list runs in front of both gates.
dr="$TMP_ROOT/direct-disable"; new_repo "$dr"; adopt "$dr" '{"branchPolicy":"direct"}'
lock_floor "$dr"; install_floor "$dr"
expect_deny "direct policy: unsetting core.hooksPath is still refused" \
  "$(mk_payload "git config --unset core.$_ph" "$dr")" "disables or moves"
expect_deny "direct policy: --no-verify is still refused" \
  "$(mk_payload "git $_cm --no-verify -m x" "$dr")" "disables or moves"
expect_deny "direct policy: removing a floor file is still refused" \
  "$(mk_payload "rm .githooks/pre-push" "$dr")" "disables or moves"
expect_deny "direct policy: update-ref on master is still refused" \
  "$(mk_payload "git update-ref refs/heads/master HEAD" "$dr")" "disables or moves"
expect_deny "direct policy: an Edit of a floor file is still refused" \
  "$(mk_file_payload Edit "$dr/.githooks/pre-push" "$dr")" "git-hook floor"
expect_allow "direct policy: the BRANCH refusals are still off (commit on master)" \
  "$(mk_payload "git $_cm -m x" "$dr")"
expect_allow "direct policy: a push naming master is still allowed" \
  "$(mk_payload "git push origin master" "$dr")"

dfr="$TMP_ROOT/defer-disable"; new_repo "$dfr"
echo '{"branchPolicy":"pr"}' >"$dfr/house.json"
mkdir -p "$dfr/.claude"
echo '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"x"}]}]}}' >"$dfr/.claude/settings.json"
git -C "$dfr" add house.json .claude/settings.json && git -C "$dfr" commit -q -m house
expect_deny "deference: a repo-local guard does not license unarming the floor" \
  "$(mk_payload "git $_cm --no-verify -m x" "$dfr")" "disables or moves"
expect_allow "deference: the branch decision is still the local guard's" \
  "$(mk_payload "git $_cm -m x" "$dfr")"

# ── H6 (round-2 N9): the default macOS volume is case-insensitive ─────────
ci="$TMP_ROOT/caseins"; new_repo "$ci"; adopt "$ci"; lock_floor "$ci"; install_floor "$ci"
mkdir -p "$ci/src"
git -C "$ci" checkout -q -b feat/c
expect_deny "rm .GITHOOKS/pre-push names the same file" \
  "$(mk_payload "rm .GITHOOKS/pre-push" "$ci")" "disables or moves"
expect_deny "a redirection into .GitHooks/pre-push" \
  "$(mk_payload "echo x > .GitHooks/pre-push" "$ci")" "disables or moves"
expect_deny "Edit on .GITHOOKS/pre-push" \
  "$(mk_file_payload Edit "$ci/.GITHOOKS/pre-push" "$ci")" "git-hook floor"
expect_deny "Write on .Git/config" \
  "$(mk_file_payload Write "$ci/.Git/config" "$ci")" "git-hook floor"
ln -s "$ci/.githooks" "$ci/hooks-link"
expect_deny "Edit through a symlink into the hooks directory" \
  "$(mk_file_payload Edit "$ci/hooks-link/pre-push" "$ci")" "git-hook floor"
expect_deny "Edit through a .. segment" \
  "$(mk_file_payload Edit "$ci/src/../.githooks/pre-push" "$ci")" "git-hook floor"
expect_allow "Edit on a file whose name merely starts like the hooks directory" \
  "$(mk_file_payload Edit "$ci/.githooks-notes.md" "$ci")"
expect_allow "a read of the hooks directory in any case is still a read" \
  "$(mk_payload "cat .GITHOOKS/pre-push" "$ci")"

# ── H8 (round-2 N11): a repository named rather than entered ──────────────
e="$TMP_ROOT/envdir"; new_repo "$e"; adopt "$e"; git -C "$e" checkout -q -b feat/e
for _pfx in "GIT_DIR=$e/.git" "GIT_WORK_TREE=$e" "GIT_COMMON_DIR=$e/.git"; do
  expect_deny "a commit under $_pfx is refused" \
    "$(mk_payload "$_pfx git $_cm -m x" "$e")" "environment-named repository"
done
expect_deny "a push under GIT_DIR= is refused" \
  "$(mk_payload "GIT_DIR=$e/.git git push origin feat/e" "$e")" "environment-named repository"
expect_deny "git --git-dir= on a commit is refused" \
  "$(mk_payload "git --git-dir=$e/.git $_cm -m x" "$e")" "environment-named repository"
expect_deny "git --work-tree= on a merge is refused" \
  "$(mk_payload "git --work-tree=$e --git-dir=$e/.git merge feat/e" "$e")" "environment-named repository"
expect_deny "git --git-dir with a separate value is refused" \
  "$(mk_payload "git --git-dir $e/.git $_cm -m x" "$e")" "environment-named repository"
expect_deny "send-pack under GIT_DIR= is refused" \
  "$(mk_payload "GIT_DIR=$e/.git git send-pack origin feat/e:feat/e" "$e")" "environment-named repository"
expect_allow "GIT_DIR= on a read-only verb is not our business" \
  "$(mk_payload "GIT_DIR=$e/.git git log --oneline -3" "$e")"
expect_allow "git --git-dir= on a read-only verb is not our business" \
  "$(mk_payload "git --git-dir=$e/.git status --porcelain" "$e")"

# ── H10: git's per-user config can arm or disarm every repo on the box ────
expect_deny "Write on ~/.gitconfig from inside an adopted checkout" \
  "$(mk_file_payload Write "$HOME/.gitconfig" "$d")" "per-user config"
expect_deny "Edit on ~/.gitconfig from inside an adopted checkout" \
  "$(mk_file_payload Edit "$HOME/.gitconfig" "$d")" "per-user config"
expect_allow "Edit on a lookalike beside it" \
  "$(mk_file_payload Edit "$HOME/.gitconfig.bak" "$d")"
xdg="$TMP_ROOT/xdg"; mkdir -p "$xdg/git"
payload="$(mk_file_payload Write "$xdg/git/config" "$d")"
HOOK_OUT=$(printf '%s' "$payload" | XDG_CONFIG_HOME="$xdg" bash "$HOOK")
reason=$(printf '%s' "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecisionReason // ""' 2>/dev/null)
if [[ "$reason" == *"per-user config"* ]]; then
  pass "Write on \$XDG_CONFIG_HOME/git/config"
else
  fail "Write on \$XDG_CONFIG_HOME/git/config" "expected the per-user config deny, got: [$reason]"
fi
expect_allow "the same path with XDG_CONFIG_HOME pointing elsewhere" \
  "$(mk_file_payload Write "$xdg/git/config" "$d")"

# ── the floor ARMED: only a commit is refused; everything else is the floor's ──
# Every case in this section needs the hook to see a git >= 2.28; below that
# the floor cannot cover history and the hook reads the repo as unarmed (the
# next section pins exactly that).
a="$TMP_ROOT/armed"; new_repo "$a"; adopt "$a"; lock_floor "$a"
arm_floor "$a" feat/a
git -C "$a" config alias.po "push origin master"

# ── ARMED THROUGH A LINKED WORKTREE ───────────────────────────────────────
# core.hooksPath lives in the main checkout's config and the hooks directory
# is the main checkout's too. Round 1 read a worktree as unarmed and then told
# the session to run the config write, which would have disarmed the whole
# clone.
w="$TMP_ROOT/wtfloor"
new_repo "$w/main"; adopt "$w/main"; lock_floor "$w/main"
install_floor "$w/main" feat/main
git -C "$w/main" checkout -q feat/main
git -C "$w/main" worktree add "$w/wt" master >/dev/null 2>&1
arm_hookspath "$w/main"

# ── the floor ARMED BUT NOT INTACT: one edited file and it is not trusted ──
# The integrity check is the real guard: byte-identity with the plugin's own
# copy, the execute bit, the set of files HEAD tracks, and a clean git status
# on the hooks directory with ignored files included.
mk_broken_floor() {
  local dir="$1"
  new_repo "$dir"; adopt "$dir"
  arm_floor "$dir" feat/b
  git -C "$dir" checkout -q feat/b
}

if [[ -z "$GIT_NEW_DIR" ]]; then
  skip "the whole armed-floor section" \
    "no git >= 2.28 on this box, so the hook reads every floor as unarmed"
else
  HOOK_PATH_PREFIX="$GIT_NEW_DIR"

  expect_deny "armed: commit on master denies with the short message" \
    "$(mk_payload "git commit -m x" "$a")" "needs a PR"
  expect_deny_without "armed: the commit deny does NOT tell you to arm the floor" \
    "$(mk_payload "git commit -m x" "$a")" "not armed in this checkout"
  expect_deny_without "armed: the commit deny does NOT tell you to re-render" \
    "$(mk_payload "git commit -m x" "$a")" "house render --apply"
  expect_allow "armed: push origin master from master is the floor's business" \
    "$(mk_payload "git push origin master" "$a")"
  expect_allow "armed: a bare push from master is the floor's business" \
    "$(mk_payload "git push" "$a")"
  expect_allow "armed: git merge on master is the floor's business" \
    "$(mk_payload "git merge feat/a" "$a")"
  expect_allow "armed: a computed verb is the floor's business" \
    "$(mk_payload 'git ${v} -m x' "$a")"
  git -C "$a" checkout -q feat/a
  expect_allow "armed: push origin master from a feature branch is the floor's business" \
    "$(mk_payload "git push origin master" "$a")"
  expect_allow "armed: a tag push is the floor's business" \
    "$(mk_payload "git push origin v1.2.3" "$a")"
  expect_allow "armed: commit on a feature branch" \
    "$(mk_payload "git commit -m x" "$a")"
  expect_deny "armed: the disable list still applies" \
    "$(mk_payload "git commit --no-verify -m x" "$a")" "disables or moves"
  expect_deny "armed: push --delete on a protected branch is plumbing, not a push scan" \
    "$(mk_payload "git push origin --delete master" "$a")" "disables or moves"
  expect_allow "armed: push --delete on a feature branch is the floor's business" \
    "$(mk_payload "git push origin --delete feat/old" "$a")"
  # A force-push to a protected branch IS refused by pre-push, so the plumbing
  # scan deliberately does not read it here; unarmed, the push scan still does.
  expect_allow "armed: a force-push to master is left to pre-push" \
    "$(mk_payload "git push --force origin master" "$a")"

  # H1 (round-2 N1): git send-pack pushes without pre-push running at all, so
  # armed there is nothing behind a refusal here.
  expect_deny "armed: git send-pack is refused because no git hook sees it" \
    "$(mk_payload "git send-pack ../bare.git feat/a:master" "$a")" "git runs no hook for it"
  expect_deny "armed: send-pack naming a feature branch is refused too" \
    "$(mk_payload "git send-pack origin feat/a:feat/a" "$a")" "Use git push"
  expect_allow "armed: a verb that merely looks like send-pack is untouched" \
    "$(mk_payload "git send-email --dry-run" "$a")"

  # H9 (round-2 N5): armed, an unknown verb is the floor's business, but an
  # alias BODY is text the floor never sees. One level, no further.
  expect_allow "armed: an alias verb whose body is innocent is the floor's business" \
    "$(mk_payload "git po origin master" "$a")"
  git -C "$a" config alias.hp "-c core.hooksPath=/dev/null push"
  expect_deny "armed: an alias body carrying core.hooksPath is refused" \
    "$(mk_payload "git hp origin master" "$a")" "disables or moves"
  git -C "$a" config alias.pd "push --delete origin master"
  expect_deny "armed: an alias body deleting a protected branch is refused" \
    "$(mk_payload "git pd" "$a")" "disables or moves"
  git -C "$a" config alias.ur "update-ref refs/heads/master HEAD"
  expect_deny "armed: an alias body writing a protected ref is refused" \
    "$(mk_payload "git ur" "$a")" "disables or moves"
  git -C "$a" config alias.nuke '!rm -rf .githooks && git push'
  expect_deny "armed: a shell alias is not readable and is refused" \
    "$(mk_payload "git nuke" "$a")" "shell alias"
  git -C "$a" config alias.lg "log --oneline -5"
  expect_allow "armed: a read-only alias body is allowed" \
    "$(mk_payload "git lg" "$a")"
  expect_allow "armed: an undefined verb with no alias at all is the floor's business" \
    "$(mk_payload "git nosuchverb --flag" "$a")"

  expect_allow "worktree: commit on a feature branch in the main checkout" \
    "$(mk_payload "git commit -m x" "$w/main")"
  expect_deny "worktree: commit on master inside the linked worktree" \
    "$(mk_payload "git commit -m x" "$w/wt")" "needs a PR"
  expect_deny_without "worktree: the deny does NOT tell the session to write core.hooksPath" \
    "$(mk_payload "git commit -m x" "$w/wt")" "git config core.hooksPath"
  expect_allow "worktree: push origin master from the linked worktree is the floor's business" \
    "$(mk_payload "git push origin master" "$w/wt")"
  expect_allow "worktree: a bare push from the linked worktree is the floor's business" \
    "$(mk_payload "git push" "$w/wt")"
  expect_deny "worktree: the disable list still applies inside the worktree" \
    "$(mk_payload "git commit --no-verify -m x" "$w/wt")" "disables or moves"

  # #69: git state is shared across every session on the checkout, so a
  # branch-creating checkout/switch is refused on the MAIN checkout and
  # allowed in a linked worktree, whatever the floor's armed state is.
  expect_allow "worktree: git checkout -b in the linked worktree" \
    "$(mk_payload "git checkout -b feat/x" "$w/wt")"
  expect_deny "main checkout: git checkout -b is refused" \
    "$(mk_payload "git checkout -b feat/x" "$w/main")" "worktree add"
  expect_deny "main checkout: git switch -c is refused" \
    "$(mk_payload "git switch -c feat/x" "$w/main")" "worktree add"
  # #112, armed: the clause's own directory decides, not the payload cwd.
  expect_allow "armed, main checkout cwd: git -C <worktree> switch -c is allowed" \
    "$(mk_payload "git -C $w/wt switch -c feat/x" "$w/main")"
  expect_allow "armed, main checkout cwd: cd <worktree> && git switch -c is allowed" \
    "$(mk_payload "cd $w/wt && git switch -c feat/x" "$w/main")"
  expect_deny "armed, worktree cwd: git -C <main> switch -c is refused" \
    "$(mk_payload "git -C $w/main switch -c feat/x" "$w/wt")" "worktree add"

  b="$TMP_ROOT/broken-edit"; mk_broken_floor "$b"
  printf '\n# tampered\n' >>"$b/.githooks/pre-push"
  expect_deny "not intact: an edited floor file makes a push naming master refusable again" \
    "$(mk_payload "git push origin master" "$b")" "protected branch"
  expect_deny "not intact: and the message names house render --apply" \
    "$(mk_payload "git push origin master" "$b")" "house render --apply"
  expect_deny_without "not intact: the message does NOT tell you to write core.hooksPath" \
    "$(mk_payload "git push origin master" "$b")" "git config core.hooksPath"

  b2="$TMP_ROOT/broken-missing"; mk_broken_floor "$b2"
  rm -f "$b2/.githooks/pre-push.d/10-house-branch"
  expect_deny "not intact: a missing guard file reads as unarmed" \
    "$(mk_payload "git push origin master" "$b2")" "house render --apply"

  b3="$TMP_ROOT/broken-mode"; mk_broken_floor "$b3"
  chmod -x "$b3/.githooks/pre-commit"
  expect_deny "not intact: a floor file without the execute bit reads as unarmed" \
    "$(mk_payload "git push origin master" "$b3")" "house render --apply"

  b4="$TMP_ROOT/broken-untracked"; mk_broken_floor "$b4"
  printf '#!/usr/bin/env bash\nexit 0\n' >"$b4/.githooks/pre-commit.d/00-mine"
  chmod +x "$b4/.githooks/pre-commit.d/00-mine"
  expect_deny "not intact: an untracked .d file reads as unarmed" \
    "$(mk_payload "git push origin master" "$b4")" "house render --apply"

  # H5 (round-2 N7/N8): an IGNORED planted file is invisible to `git status`,
  # and the dispatcher runs it anyway. The set of files on disk must equal the
  # set HEAD tracks, whatever .gitignore and .git/info/exclude say.
  b4b="$TMP_ROOT/broken-ignored"; mk_broken_floor "$b4b"
  printf '.githooks/00-mine\n' >>"$b4b/.git/info/exclude"
  printf '#!/usr/bin/env bash\nexit 0\n' >"$b4b/.githooks/00-mine"
  chmod +x "$b4b/.githooks/00-mine"
  expect_deny "not intact: a planted .githooks file that .git/info/exclude hides" \
    "$(mk_payload "git push origin master" "$b4b")" "house render --apply"
  rm -f "$b4b/.githooks/00-mine"
  expect_allow "intact again once the planted file is gone" \
    "$(mk_payload "git push origin master" "$b4b")"
  # The same through a tracked .gitignore, and in a .d directory.
  b4c="$TMP_ROOT/broken-gitignored"; mk_broken_floor "$b4c"
  printf '*.local\n' >"$b4c/.gitignore"
  git -C "$b4c" add .gitignore && git -C "$b4c" commit -q -m ignore
  printf '#!/usr/bin/env bash\nexit 0\n' >"$b4c/.githooks/pre-commit.d/00-mine.local"
  expect_deny "not intact: a planted .d file that .gitignore hides" \
    "$(mk_payload "git push origin master" "$b4c")" "house render --apply"
  # A symlinked hook file is not a regular file, so the set comparison sees it.
  b4d="$TMP_ROOT/broken-symlink"; mk_broken_floor "$b4d"
  cp "$b4d/.githooks/pre-push" "$TMP_ROOT/copy-pre-push"
  rm -f "$b4d/.githooks/pre-push"
  ln -s "$TMP_ROOT/copy-pre-push" "$b4d/.githooks/pre-push"
  expect_deny "not intact: a floor file replaced by a symlink to an identical copy" \
    "$(mk_payload "git push origin master" "$b4d")" "protected branch"
  # A hard link to a floor file carries no path marker, so the Edit itself is
  # not refused (residue); the edit changes the floor file's bytes, and the
  # integrity check refuses the next guarded command.
  b4e="$TMP_ROOT/broken-hardlink"; mk_broken_floor "$b4e"
  expect_allow "hard link: the floor reads as armed before the edit" \
    "$(mk_payload "git push origin master" "$b4e")"
  ln "$b4e/.githooks/pre-push" "$b4e/notes.txt"
  expect_allow "RESIDUE: an Edit through a hard link to a floor file is not refused" \
    "$(mk_real_file_payload Edit "$b4e/notes.txt" "$b4e")"
  printf '\nexit 0\n' >>"$b4e/notes.txt"
  expect_deny "hard link: an edit through it makes the floor read as not intact" \
    "$(mk_payload "git push origin master" "$b4e")" "protected branch"

  b5="$TMP_ROOT/broken-devnull"; mk_broken_floor "$b5"
  printf '[core]\n\thooksPath = /dev/null\n' >"$b5/../broken-devnull-include"
  git -C "$b5" config include.path "$b5/../broken-devnull-include"
  expect_deny "not intact: an include.path that repoints hooksPath reads as unarmed" \
    "$(mk_payload "git push origin master" "$b5")" "floor is not armed in this checkout"

  b6="$TMP_ROOT/broken-elsewhere"; mk_broken_floor "$b6"
  mkdir -p "$b6/.husky/_"
  git -C "$b6" config core.hooksPath "$b6/.husky/_"
  expect_deny "not intact: a foreign hooksPath reads as unarmed" \
    "$(mk_payload "git push origin master" "$b6")" "floor is not armed in this checkout"

  HOOK_PATH_PREFIX=''
fi

expect_deny "unarmed: a force-push to master is refused by the push scan" \
  "$(mk_payload "git push --force origin master" "$d")" "protected branch"

# ── H4 (round-2 N6): the floor needs git 2.28, or it cannot cover history ──
# reference-transaction is the only hook that sees a merge, rebase, amend,
# reset or update-ref. On an older git an armed, intact floor is still not a
# floor for those, so the repo reads as unarmed and the unarmed scans stay on.
if [[ -z "$GIT_OLD_DIR" ]]; then
  skip "the git < 2.28 cases" "no git older than 2.28 on this box"
else
  HOOK_PATH_PREFIX="$GIT_OLD_DIR"
  git -C "$a" checkout -q master
  expect_deny "old git: an armed, intact floor still reads as unarmed" \
    "$(mk_payload "git push origin master" "$a")" "protected branch"
  expect_deny "old git: and the deny says which git and why" \
    "$(mk_payload "git push origin master" "$a")" "has no reference-transaction hook"
  expect_deny "old git: the upgrade is the remedy, not a re-render" \
    "$(mk_payload "git push origin master" "$a")" "upgrade git to 2.28 or newer"
  expect_deny_without "old git: and it does NOT tell you to write core.hooksPath" \
    "$(mk_payload "git push origin master" "$a")" "git config core.hooksPath"
  expect_deny "old git: a merge on master is refused, because nothing else sees it" \
    "$(mk_payload "git merge feat/a" "$a")" "writes onto a protected branch"
  git -C "$a" checkout -q feat/a
  expect_allow "old git: a commit on a feature branch is still fine" \
    "$(mk_payload "git commit -m x" "$a")"
  HOOK_PATH_PREFIX=''
fi
git -C "$a" checkout -q feat/a

# ── Edit/Write/MultiEdit/NotebookEdit: nothing under .githooks/ or the git dir
expect_deny "Edit on a vendored .githooks file" \
  "$(mk_file_payload Edit "$a/.githooks/pre-push" "$a")" "part of the git-hook floor"
expect_deny "MultiEdit on a vendored .githooks file" \
  "$(mk_file_payload MultiEdit "$a/.githooks/pre-commit.d/10-house-branch" "$a")" "part of the git-hook floor"
expect_deny "Write on .git/config" \
  "$(mk_file_payload Write "$a/.git/config" "$a")" "git-hook floor"
# NotebookEdit names its target in notebook_path, not file_path, and gets
# exactly the Edit/Write rules. A payload with no readable notebook_path is an
# unreadable payload, refused in an adopted repo the way an Edit with no
# file_path is.
expect_deny "NotebookEdit on a vendored .githooks file" \
  "$(mk_notebook_payload "$a/.githooks/pre-push" "$a")" "part of the git-hook floor"
expect_deny "NotebookEdit on .git/config given as a relative path" \
  "$(mk_notebook_payload ".git/config" "$a")" "git-hook floor"
expect_allow "NotebookEdit on an ordinary notebook" \
  "$(mk_notebook_payload "$a/analysis.ipynb" "$a")"
expect_deny "NotebookEdit with no notebook_path" \
  "$(jq -n --arg cwd "$a" '{tool_name:"NotebookEdit", tool_input:{new_source:"x"}, cwd:$cwd, hook_event_name:"PreToolUse"}')" "names no path"
expect_deny "NotebookEdit with a notebook_path that is not a string" \
  "$(jq -n --arg cwd "$a" '{tool_name:"NotebookEdit", tool_input:{notebook_path:["x.ipynb"], new_source:"x"}, cwd:$cwd, hook_event_name:"PreToolUse"}')" "names no path"
for _tool in Edit Write MultiEdit; do
  expect_deny "$_tool with no file_path" \
    "$(jq -n --arg t "$_tool" --arg cwd "$a" '{tool_name:$t, tool_input:{old_string:"x"}, cwd:$cwd, hook_event_name:"PreToolUse"}')" "names no path"
  expect_deny "$_tool with an empty file_path" \
    "$(mk_file_payload "$_tool" "" "$a" | jq -c '. + {hook_event_name: "PreToolUse"}')" "names no path"
  expect_deny "$_tool with a file_path that is not a string" \
    "$(jq -n --arg t "$_tool" --arg cwd "$a" '{tool_name:$t, tool_input:{file_path:7}, cwd:$cwd, hook_event_name:"PreToolUse"}')" "names no path"
done
expect_allow "Write with no file_path in a repo that never adopted house" \
  "$(jq -n --arg cwd "$n" '{tool_name:"Write", tool_input:{content:"x"}, cwd:$cwd, hook_event_name:"PreToolUse"}')"
expect_allow "NotebookEdit does not read a stray file_path" \
  "$(jq -n --arg cwd "$a" --arg fp "$a/.githooks/pre-push" '{tool_name:"NotebookEdit", tool_input:{file_path:$fp, notebook_path:($cwd + "/n.ipynb")}, cwd:$cwd}')"
expect_deny "Write on .git/hooks/pre-commit" \
  "$(mk_file_payload Write "$a/.git/hooks/pre-commit" "$a")" "git-hook floor"
# Round 2: the repo's own scaffold is refused too. It runs inside the same
# dispatcher, and an edit to it is exactly what makes floor_is_armed false for
# every command after it.
expect_deny "Edit on the repo's own .githooks/pre-commit.d/20-secrets scaffold" \
  "$(mk_file_payload Edit "$a/.githooks/pre-commit.d/20-secrets" "$a")" "part of the git-hook floor"
expect_deny "Write of a brand new .githooks/pre-commit.d/00-mine" \
  "$(mk_file_payload Write "$a/.githooks/pre-commit.d/00-mine" "$a")" "part of the git-hook floor"
expect_allow "Edit on an ordinary file" \
  "$(mk_file_payload Edit "$a/README.md" "$a")"
expect_allow "Edit on an ordinary file given as a relative path" \
  "$(mk_file_payload Edit "README.md" "$a")"
expect_deny "Edit on a floor file given as a relative path" \
  "$(mk_file_payload Edit ".githooks/pre-push" "$a")" "part of the git-hook floor"
# A linked worktree edits the MAIN checkout's hooks directory.
expect_deny "Edit on the main checkout's .githooks from inside a linked worktree" \
  "$(mk_file_payload Edit "$w/main/.githooks/pre-push" "$w/wt")" "part of the git-hook floor"
# A `..` through a directory that does not exist, and a symlink whose name
# says neither git nor hook. These payloads carry hook_event_name, as every
# real one does: without it the whole-payload prefilter would end a path that
# spells neither word before the file-mode checks under test ever ran.
pg="$TMP_ROOT/pathgaps"; new_repo "$pg"; adopt "$pg"; lock_floor "$pg"; install_floor "$pg"
mkdir -p "$pg/docs"
ln -s .githooks "$pg/link"
ln -s .git "$pg/gl"
ln -s .githooks/pre-push "$pg/notes.txt"
ln -s docs "$pg/shortcut"
for _tool in Edit Write; do
  expect_deny "$_tool through a .. segment under a directory that does not exist" \
    "$(mk_real_file_payload "$_tool" "$pg/nosuch/../.githooks/pre-push" "$pg")" "git-hook floor"
  expect_deny "$_tool through a directory symlink into .githooks with a plain name" \
    "$(mk_real_file_payload "$_tool" "$pg/link/pre-push" "$pg")" "git-hook floor"
  expect_deny "$_tool through a directory symlink into the git directory with a plain name" \
    "$(mk_real_file_payload "$_tool" "$pg/gl/config" "$pg")" "git-hook floor"
  expect_deny "$_tool on a plainly named file symlink to a floor file" \
    "$(mk_real_file_payload "$_tool" "$pg/notes.txt" "$pg")" "git-hook floor"
done
expect_allow "Edit through a symlink that points somewhere harmless" \
  "$(mk_real_file_payload Edit "$pg/shortcut/guide.md" "$pg")"
expect_allow "Edit through a .. segment that lands on an ordinary file" \
  "$(mk_real_file_payload Edit "$pg/nosuch/../README.md" "$pg")"
expect_allow "Edit on an ordinary file with no symlink on its path" \
  "$(mk_real_file_payload Edit "$pg/docs/guide.md" "$pg")"
# A target inside ANOTHER repo's git directory, from a cwd in a different
# repo. git run from inside a git directory reports no toplevel, so the
# decision used to fall back to the cwd's repo and allow. The repo is the
# parent of the .git component, adopted or not.
po="$TMP_ROOT/plain-other"; new_repo "$po"; ln -s .git "$po/gl"
for _cwd in "$a" "$n"; do
  expect_deny "Edit on another adopted repo's .git/config from cwd ${_cwd##*/}" \
    "$(mk_real_file_payload Edit "$pg/.git/config" "$_cwd")" "git-hook floor"
  expect_deny "Edit through another adopted repo's plainly named link to .git from cwd ${_cwd##*/}" \
    "$(mk_real_file_payload Edit "$pg/gl/config" "$_cwd")" "git-hook floor"
done
expect_allow "Edit on a repo's .git/config that never adopted house, from an adopted cwd" \
  "$(mk_real_file_payload Edit "$po/.git/config" "$a")"
expect_allow "Edit through a link to .git in a repo that never adopted house, from an adopted cwd" \
  "$(mk_real_file_payload Edit "$po/gl/config" "$a")"

# ── MCP write tools: no standard path field, so every string is a candidate
# mk_mcp_payload <tool> <tool_input-json> <cwd>
# tool_input goes in on stdin: Linux caps one argv string at 128 KB, and the
# large-input cases below pass several hundred KB.
mk_mcp_payload() {
  printf '%s' "$2" | jq -c --arg tool "$1" --arg cwd "$3" \
    '{tool_name: $tool, tool_input: ., cwd: $cwd, hook_event_name: "PreToolUse"}'
}
expect_deny "MCP write_file to a vendored .githooks file" \
  "$(mk_mcp_payload mcp__fs__write_file "$(jq -n --arg p "$pg/.githooks/pre-push" '{path: $p, content: "x"}')" "$pg")" "git-hook floor"
expect_deny "MCP edit_file with the git directory nested in an edits array" \
  "$(mk_mcp_payload mcp__fs__edit_file "$(jq -n --arg p "$pg/.git/config" '{edits: [{target: $p, text: "x"}]}')" "$pg")" "git-hook floor"
expect_deny "MCP write_file through a plainly named link into .githooks" \
  "$(mk_mcp_payload mcp__fs__write_file "$(jq -n --arg p "$pg/link/pre-push" '{path: $p}')" "$pg")" "git-hook floor"
expect_deny "MCP write_file to a relative path into the git directory" \
  "$(mk_mcp_payload mcp__fs__write_file '{"path": ".git/hooks/pre-commit"}' "$pg")" "git-hook floor"
HOOK_ENV=(HOME="$pg")
expect_deny "MCP write_file to a ~ path into the git directory" \
  "$(mk_mcp_payload mcp__fs__write_file '{"path": "~/.git/config"}' "$n")" "git-hook floor"
HOOK_ENV=()
expect_allow "MCP write_file to an ordinary path" \
  "$(mk_mcp_payload mcp__fs__write_file "$(jq -n --arg p "$pg/docs/guide.md" '{path: $p, content: "see .githooks/pre-push"}')" "$pg")"
expect_deny "ACCEPTED FALSE DENY: MCP write_file with a floor path in a field it does not write" \
  "$(mk_mcp_payload mcp__fs__write_file "$(jq -n --arg p "$pg/docs/guide.md" '{path: $p, note: ".githooks/pre-push"}')" "$pg")" "git-hook floor"
expect_allow "MCP write_file whose strings are not paths" \
  "$(mk_mcp_payload mcp__fs__write_file '{"name": "notes", "content": "git hooks"}' "$pg")"
expect_allow "MCP write_file to a .githooks file in a repo that never adopted house" \
  "$(mk_mcp_payload mcp__fs__write_file "$(jq -n --arg p "$n/.githooks/pre-push" '{path: $p}')" "$n")"
# A field of the wrong type used to throw in the one jq pass, and the
# valid-JSON fallback then allowed the whole call.
for _extra in '1' '{"op": "x"}'; do
  expect_deny "MCP write_file whose command field is $_extra" \
    "$(mk_mcp_payload mcp__fs__write_file "$(jq -n --arg p "$pg/.githooks/pre-push" --argjson c "$_extra" '{path: $p, command: $c}')" "$pg")" "git-hook floor"
done
expect_deny "MCP write_file with a numeric file_path beside the real path" \
  "$(mk_mcp_payload mcp__fs__write_file "$(jq -n --arg p "$pg/.githooks/pre-push" '{path: $p, file_path: 7}')" "$pg")" "git-hook floor"
expect_deny "Edit whose file_path is an array holding a floor path" \
  "$(jq -n --arg p "$pg/.githooks/pre-push" --arg cwd "$pg" '{tool_name: "Edit", tool_input: {file_path: [$p]}, cwd: $cwd, hook_event_name: "PreToolUse"}')" "names no path"
for _ti in '"x"' '["x"]'; do
  expect_deny "Edit whose tool_input is $_ti" \
    "$(jq -n --arg cwd "$pg" --argjson ti "$_ti" '{tool_name: "Edit", tool_input: $ti, cwd: $cwd, hook_event_name: "PreToolUse"}')" "names no path"
done
expect_deny "an MCP write whose cwd is not a string" \
  "$(jq -n --arg p "$pg/.githooks/pre-push" '{tool_name: "mcp__fs__write_file", tool_input: {path: $p}, cwd: 5, hook_event_name: "PreToolUse"}')" "git-hook floor"
# A file:// URI names a path too.
expect_deny "MCP write with a file:// URI into .githooks" \
  "$(mk_mcp_payload mcp__fs__write_file "$(jq -n --arg p "file://$pg/.githooks/pre-push" '{uri: $p}')" "$pg")" "git-hook floor"
expect_deny "MCP write with a file:// URI into another repo's .git, from another cwd" \
  "$(mk_mcp_payload mcp__fs__write_file "$(jq -n --arg p "file://$pg/.git/config" '{uri: $p}')" "$n")" "git-hook floor"
expect_deny "MCP write with a file://localhost URI into .githooks" \
  "$(mk_mcp_payload mcp__fs__write_file "$(jq -n --arg p "file://localhost$pg/.githooks/pre-push" '{uri: $p}')" "$pg")" "git-hook floor"
# An object key can be the path.
expect_deny "MCP write whose path is an object key" \
  "$(mk_mcp_payload mcp__fs__write_file "$(jq -n --arg p "$pg/.githooks/pre-push" '{files: {($p): "x"}}')" "$pg")" "git-hook floor"
# The hooks.json matcher is plain mcp__; the script decides write-likeness
# from the name, in any case.
for _tool in mcp__fs__Write_file mcp__fs__copy_file mcp__serena__replace_symbol_body mcp__x__INSERT_row; do
  expect_deny "$_tool is decided as a write" \
    "$(mk_mcp_payload "$_tool" "$(jq -n --arg p "$pg/.githooks/pre-push" '{path: $p}')" "$pg")" "git-hook floor"
done
expect_allow "an MCP tool with no write verb in its name is not decided" \
  "$(mk_mcp_payload mcp__fs__read_file "$(jq -n --arg p "$pg/.githooks/pre-push" '{path: $p}')" "$pg")"
# A relative MCP path is read against the project directory as well as cwd.
HOOK_ENV=(CLAUDE_PROJECT_DIR="$pg")
expect_deny "MCP relative path from a subdirectory, read against CLAUDE_PROJECT_DIR" \
  "$(mk_mcp_payload mcp__fs__write_file '{"path": ".githooks/pre-push"}' "$pg/docs")" "git-hook floor"
HOOK_ENV=()
expect_allow "the same relative path with no project directory set is an ordinary path" \
  "$(mk_mcp_payload mcp__fs__write_file '{"path": ".githooks/pre-push"}' "$pg/docs")"
# Many path-like strings: git calls must not scale with them, or the 5 s
# timeout lets the call through. The deny sorts last.
mkdir -p "$pg/many"
_many=$(for ((i = 0; i < 200; i++)); do mkdir -p "$pg/many/d$i"; printf '%s\n' "$pg/many/d$i/.gitkeep"; done | jq -R . | jq -s --arg last "$pg/zz/../.git/config" '{paths: (. + [$last])}')
_start=$(perl -MTime::HiRes=time -e 'printf "%d", time()*1000')
run_hook "$(mk_mcp_payload mcp__fs__write_file "$_many" "$pg")"
_end=$(perl -MTime::HiRes=time -e 'printf "%d", time()*1000')
_ms=$((_end - _start))
if [[ "$(printf '%s' "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecision // ""' 2>/dev/null)" == deny && "$_ms" -lt 2500 ]]; then
  pass "201 .git-bearing MCP strings into one repo deny in ${_ms} ms"
else
  fail "201 .git-bearing MCP strings into one repo deny under 2500 ms" "took ${_ms} ms, out=[$HOOK_OUT]"
fi
# Past the scan's time budget (kept under the 5 s timeout in hooks.json, which
# would let the call through) the hook stops and refuses. Whether a given
# input outruns the default budget depends on the machine (a fast CI runner
# finished these 4000 strings inside it), so every overrun case lowers the
# budget to 1 ms through HOUSE_SCAN_BUDGET_MS, which can only shrink it, and
# the overrun is certain anywhere.
_huge=$(for ((i = 0; i < 200; i++)); do for ((j = 0; j < 20; j++)); do printf '%s\n' "$pg/many/d$i/f$j.gitkeep"; done; done | jq -R . | jq -s '{paths: .}')
HOOK_ENV=(HOUSE_SCAN_BUDGET_MS=1)
_start=$(perl -MTime::HiRes=time -e 'printf "%d", time()*1000')
run_hook "$(mk_mcp_payload mcp__fs__write_file "$_huge" "$pg")"
_end=$(perl -MTime::HiRes=time -e 'printf "%d", time()*1000')
_ms=$((_end - _start))
if [[ "$HOOK_OUT" == *'"deny"'* && "$HOOK_OUT" == *"too large to check"* && "$_ms" -lt 4000 ]]; then
  pass "4000 MCP strings outrun the scan budget and deny in ${_ms} ms"
else
  fail "4000 MCP strings outrun the scan budget and deny under 4000 ms" "took ${_ms} ms, out=[$HOOK_OUT]"
fi
# Past the budget, only a string still unchecked with a .git or .githooks
# path component refuses the call whatever repo it is in. A string whose only
# marker is a substring (`.gitkeep`, `src/hooks/`, `webhook`) is decided by
# adoption, so the same input aimed at a repo that never adopted house passes.
expect_allow "the same 4000 strings in a repo that never adopted house" \
  "$(mk_mcp_payload mcp__fs__write_file "$(printf '%s' "$_huge" | jq --arg n "$n" '.paths |= map(sub("^.*/many/"; $n + "/many/"))')" "$n")"
_hooky=$(for ((i = 0; i < 2000; i++)); do printf '%s\n' "src/hooks/use$i.ts" "api/webhook$i/route.ts"; done | jq -R . | jq -s '{paths: .}')
expect_allow "4000 src/hooks and webhook strings past the budget in a repo that never adopted house" \
  "$(mk_mcp_payload mcp__fs__write_file "$_hooky" "$n")"
expect_deny "the same src/hooks and webhook strings past the budget from an adopted cwd" \
  "$(mk_mcp_payload mcp__fs__write_file "$_hooky" "$pg")" "too large to check"
expect_deny "4000 strings past the budget in a repo that never adopted house, one a .githooks path" \
  "$(mk_mcp_payload mcp__fs__write_file "$(printf '%s' "$_hooky" | jq --arg m "$n/.GitHooks/pre-push" '.paths += [$m]')" "$n")" "too large to check"
expect_deny "4000 strings past the budget in a repo that never adopted house, one a file: URI into .git" \
  "$(mk_mcp_payload mcp__fs__write_file "$(printf '%s' "$_hooky" | jq --arg m "file://$n/%2Egit" '.paths += [$m]')" "$n")" "too large to check"
expect_deny "4000 strings past the budget in a repo that never adopted house, one a bare file: URI into .git" \
  "$(mk_mcp_payload mcp__fs__write_file "$(printf '%s' "$_hooky" | jq '.paths += ["file:%2egit%2Fconfig"]')" "$n")" "too large to check"
# RESIDUE, pinned: past the budget a weak-marker symlink into an adopted
# repo's floor, from a cwd that never adopted house, passes. Closing it needs
# a link walk per string, which costs the hook's timeout (a fail open) and
# denies system-link paths in repos that never adopted the guard.
mkdir -p "$n/A"; ln -s "$pg/.githooks" "$n/A/hooklink"
expect_allow "RESIDUE: 4000 strings past the budget in a repo that never adopted house, one through a hooklink symlink to .githooks" \
  "$(mk_mcp_payload mcp__fs__write_file "$(printf '%s' "$_hooky" | jq '.paths += ["A/hooklink/pre-push"]')" "$n")"
# A strong-marker string that sorts last among the marked ones, behind 300
# src/hooks strings, is still reached by the look past the budget.
_last=$(for ((i = 0; i < 300; i++)); do printf '%s\n' "src/hooks/use$i.ts"; done | jq -R . | jq -s '{paths: (. + ["zz/.git/config"])}')
expect_deny "300 src/hooks strings past the budget, then a .git path sorting last" \
  "$(mk_mcp_payload mcp__fs__write_file "$_last" "$n")" "too large to check"
HOOK_ENV=()
# At the default budget, the look past it over 8000 weak-marker strings with
# distinct parents still reaches a .git path sorting last, inside the timeout.
_wide=$(for ((i = 0; i < 8000; i++)); do printf '%s\n' "pkg$i/x/x/x/x/hooks.ts"; done | jq -R . | jq -s '{paths: (. + ["zzz/.git/config"])}')
_start=$(perl -MTime::HiRes=time -e 'printf "%d", time()*1000')
run_hook "$(mk_mcp_payload mcp__fs__write_file "$_wide" "$n")"
_end=$(perl -MTime::HiRes=time -e 'printf "%d", time()*1000')
_ms=$((_end - _start))
if [[ "$(printf '%s' "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecision // ""' 2>/dev/null)" == deny && "$_ms" -lt 4000 ]]; then
  pass "8000 weak-marker strings at the default budget, then a .git path sorting last, deny in ${_ms} ms"
else
  fail "8000 weak-marker strings at the default budget, then a .git path sorting last, deny under 4000 ms" "took ${_ms} ms, out=[$HOOK_OUT]"
fi
# A file: URI is percent-decoded after its scheme is dropped.
expect_deny "MCP write with a file:// URI spelling .githooks as %2Egithooks" \
  "$(mk_mcp_payload mcp__fs__write_file "$(jq -n --arg p "file://$pg/%2Egithooks/pre-push" '{uri: $p}')" "$pg")" "git-hook floor"
expect_deny "MCP write with a file:// URI spelling .git/config as .git%2Fconfig" \
  "$(mk_mcp_payload mcp__fs__write_file "$(jq -n --arg p "file://$pg/.git%2Fconfig" '{uri: $p}')" "$n")" "git-hook floor"
# A file: URI is a path whatever it holds, a `/` or not.
expect_deny "MCP write with a bare file: URI spelling .git/config as %2egit%2Fconfig" \
  "$(mk_mcp_payload mcp__fs__write_file '{"uri": "file:%2egit%2Fconfig"}' "$pg")" "git-hook floor"
# Strings that name a floor marker are scanned first, and one left unchecked
# when the budget runs out refuses the call whatever the cwd's adoption. The
# padding, through a symlink in a repo that never adopted house, is unmarked,
# so it sorts after the marker string, which the look past the budget meets
# first.
ap="$TMP_ROOT/a-pad"; new_repo "$ap"; mkdir -p "$ap/docs"; ln -s docs "$ap/sl"
_pad=$(for ((i = 0; i < 3000; i++)); do printf '%s\n' "$ap/sl/f$i.txt"; done | jq -R . | jq -s --arg m "$pg/.githooks/pre-push" '{paths: (. + [$m])}')
HOOK_ENV=(HOUSE_SCAN_BUDGET_MS=1)
_start=$(perl -MTime::HiRes=time -e 'printf "%d", time()*1000')
run_hook "$(mk_mcp_payload mcp__fs__write_file "$_pad" "$n")"
HOOK_ENV=()
_end=$(perl -MTime::HiRes=time -e 'printf "%d", time()*1000')
_ms=$((_end - _start))
if [[ "$HOOK_OUT" == *'"deny"'* && "$_ms" -lt 4000 ]]; then
  pass "3000 padding strings do not hide a .githooks string, from a cwd that never adopted house (${_ms} ms)"
else
  fail "3000 padding strings do not hide a .githooks string, from a cwd that never adopted house" "took ${_ms} ms, out=[$HOOK_OUT]"
fi
# With no marker left unchecked, an input past the budget is decided by
# adoption as before: here, nothing adopted, so it passes.
_pad=$(for ((i = 0; i < 8000; i++)); do printf '%s\n' "$ap/sl/f$i.txt"; done | jq -R . | jq -s '{paths: .}')
HOOK_ENV=(HOUSE_SCAN_BUDGET_MS=1)
_start=$(perl -MTime::HiRes=time -e 'printf "%d", time()*1000')
run_hook "$(mk_mcp_payload mcp__fs__write_file "$_pad" "$n")"
HOOK_ENV=()
_end=$(perl -MTime::HiRes=time -e 'printf "%d", time()*1000')
_ms=$((_end - _start))
if [[ -z "$HOOK_OUT" && "$_ms" -lt 4000 ]]; then
  pass "8000 unmarked strings past the budget, nothing adopted, pass (${_ms} ms)"
else
  fail "8000 unmarked strings past the budget, nothing adopted, pass" "took ${_ms} ms, out=[$HOOK_OUT]"
fi
# Large payloads. Linux caps one argv string at 128 KB (MAX_ARG_STRLEN) where
# macOS does not, so a payload-sized value handed to a process as an argument
# fails there with E2BIG. These payloads are built over stdin, and the hook
# must never put payload text on a command line either.
_big=$(printf '%0300000d' 0 | tr 0 x)
# A path longer than 4096 bytes (the largest PATH_MAX of a supported platform)
# names nothing the OS can resolve, and checking it costs time quadratic in
# its length, which used to outrun the 5 s timeout and pass the call.
_long=$(printf '%05000d' 0 | tr 0 a)
_start=$(perl -MTime::HiRes=time -e 'printf "%d", time()*1000')
run_hook "$(mk_real_file_payload Edit "$pg/.githooks/$_long" "$pg")"
_end=$(perl -MTime::HiRes=time -e 'printf "%d", time()*1000')
_ms=$((_end - _start))
if [[ "$HOOK_OUT" == *'"deny"'* && "$HOOK_OUT" == *"4096 bytes"* && "$_ms" -lt 1000 ]]; then
  pass "an Edit path of 5000 bytes in an adopted repo denies as too long in ${_ms} ms"
else
  fail "an Edit path of 5000 bytes in an adopted repo denies as too long under 1000 ms" "took ${_ms} ms, out=[$HOOK_OUT]"
fi
expect_allow "an Edit path of 5000 bytes in a repo that never adopted house" \
  "$(mk_real_file_payload Edit "$n/$_long" "$n")"
expect_allow "an ordinary Edit path of about 4000 bytes still decides normally" \
  "$(mk_real_file_payload Edit "$pg/docs/${_long:0:$((4000 - ${#pg} - 6))}" "$pg")"
# In an MCP input an over-length string is content, not a path, unless it
# names a floor marker.
_line="$(printf '%06000d' 0 | tr 0 x)"
expect_allow "an MCP write whose content is one 6000-byte line with a / and no marker" \
  "$(mk_mcp_payload mcp__fs__write_file "$(jq -n --arg p "$pg/docs/min.js" --arg c "a/$_line" '{path: $p, content: $c}')" "$pg")"
expect_deny "an MCP write whose content is one 6000-byte line naming .githooks" \
  "$(mk_mcp_payload mcp__fs__write_file "$(jq -n --arg p "$pg/docs/min.js" --arg c "$pg/.githooks/$_line" '{path: $p, content: $c}')" "$pg")" "4096 bytes"
expect_allow "a Write of 300 KB to an ordinary path in an adopted repo" \
  "$(printf '%s' "$_big" | jq -Rs --arg fp "$pg/docs/big.md" --arg cwd "$pg" '{tool_name: "Write", tool_input: {file_path: $fp, content: .}, cwd: $cwd, hook_event_name: "PreToolUse"}')"
expect_deny "an MCP write with a 300 KB string beside a floor path denies for the floor path" \
  "$(printf '%s' "$_big/x" | jq -Rs --arg p "$pg/.githooks/pre-push" --arg cwd "$pg" '{tool_name: "mcp__fs__write_file", tool_input: {path: $p, content: .}, cwd: $cwd, hook_event_name: "PreToolUse"}')" "git-hook floor"
# ── a payload jq cannot parse: tool and cwd are unknown, so the hook's own
# working directory (the project the harness runs it in) decides adoption
# expect_in_dir <allow|deny> <label> <dir> <stdin>
expect_in_dir() {
  local want="$1" label="$2" dir="$3" decision
  HOOK_OUT=$(cd "$dir" && printf '%s' "$4" | bash "$HOOK")
  HOOK_CODE=$?
  decision=$(printf '%s' "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecision // ""' 2>/dev/null)
  if [[ "$HOOK_CODE" -ne 0 ]]; then
    fail "$label" "expected exit 0, got $HOOK_CODE (out=[$HOOK_OUT])"
  elif [[ "$want" == deny && "$decision" == deny && "$HOOK_OUT" == *"could not be parsed"* ]]; then
    pass "$label"
  elif [[ "$want" == allow && -z "$HOOK_OUT" ]]; then
    pass "$label"
  else
    fail "$label" "expected ${want}, got out=[$HOOK_OUT]"
  fi
}
expect_in_dir deny "garbage stdin from an adopted repo's directory" "$pg" 'this is not json'
expect_in_dir deny "garbage stdin naming git from an adopted repo's directory" "$pg" '{"tool_name": "Edit", git'
expect_in_dir deny "empty stdin from an adopted repo's directory" "$pg" ''
expect_in_dir allow "garbage stdin from a repo that never adopted house" "$n" 'this is not json'
expect_in_dir allow "garbage stdin naming git from a repo that never adopted house" "$n" '{"tool_name": "Edit", git'
expect_in_dir allow "empty stdin from a repo that never adopted house" "$n" ''
expect_in_dir allow "garbage stdin from a directory that is no repo" "$TMP_ROOT" 'this is not json'
expect_in_dir deny "a brace-wrapped malformed payload with no hook text, from an adopted repo" "$pg" '{not json}'
expect_in_dir allow "a valid object with no hook text naming no guarded tool, from an adopted repo" "$pg" '{"tool_name": "Read", "tool_input": {"file_path": "README.md"}}'
HOOK_OUT=$(cd "$n" && printf '%s' 'this is not json' | PATH="$STRIPPED" bash "$HOOK")
HOOK_CODE=$?
decision=$(printf '%s' "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecision // ""' 2>/dev/null)
if [[ "$HOOK_CODE" -eq 0 && "$decision" == "deny" && "$HOOK_OUT" == *"could not find jq"* ]]; then
  pass "jq missing denies garbage stdin too"
else
  fail "jq missing denies garbage stdin too" "exit=$HOOK_CODE decision=[$decision] out=[$HOOK_OUT]"
fi
expect_in_dir allow "parseable JSON that is not an object, from an adopted repo" "$pg" '[1, 2]'
# A Bash command that is not a string is an unreadable payload: the hook
# cannot read what would run.
expect_in_dir deny "a Bash payload whose command is a number, from an adopted repo" "$pg" \
  '{"tool_name": "Bash", "tool_input": {"command": 7}, "hook_event_name": "PreToolUse"}'
expect_in_dir deny "a Bash payload whose command is an object, cwd an adopted repo" "$n" \
  "$(jq -n --arg cwd "$pg" '{tool_name: "Bash", tool_input: {command: {argv: ["git", "push"]}}, cwd: $cwd, hook_event_name: "PreToolUse"}')"
expect_in_dir allow "a Bash payload whose command is a number, in a repo that never adopted house" "$n" \
  "$(jq -n --arg cwd "$n" '{tool_name: "Bash", tool_input: {command: 7}, cwd: $cwd, hook_event_name: "PreToolUse"}')"

payload="$(mk_mcp_payload mcp__fs__write_file "$(jq -n --arg p "$pg/.githooks/pre-push" '{path: $p}')" "$pg")"
HOOK_OUT=$(printf '%s' "$payload" | PATH="$STRIPPED" bash "$HOOK")
HOOK_CODE=$?
decision=$(printf '%s' "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecision // ""' 2>/dev/null)
if [[ "$HOOK_CODE" -eq 0 && "$decision" == "deny" ]]; then
  pass "jq missing still denies an MCP write"
else
  fail "jq missing still denies an MCP write" "exit=$HOOK_CODE decision=[$decision] out=[$HOOK_OUT]"
fi
# Round 3 (H3): a repo on branchPolicy direct reaches the file scan too. The
# policy says who decides which BRANCH may move; it is not permission to edit
# the hooks, and the repo is one merged PR away from "pr".
pd="$TMP_ROOT/direct-floor"; new_repo "$pd"; adopt "$pd" '{"branchPolicy":"direct"}'; lock_floor "$pd"
expect_deny "ACCEPTED FALSE DENY: Edit on a .githooks file in a branchPolicy direct repo" \
  "$(mk_file_payload Edit "$pd/.githooks/pre-push" "$pd")" "git-hook floor"
# A repo that never adopted house is still nobody's business here.
expect_allow "Edit on a .githooks file in a repo that never adopted house" \
  "$(mk_file_payload Edit "$n/.githooks/pre-push" "$n")"

# ── latency: the hook runs on every Bash call, so it has a budget ─────────
echo
echo "=== latency (informational; 20 runs each, real payloads carrying hook_event_name) ==="
now_ms() { perl -MTime::HiRes=time -e 'printf "%d", time()*1000' 2>/dev/null || echo 0; }
latency() {
  local label="$1" payload="$2" i start end
  start=$(now_ms)
  for ((i = 0; i < 20; i++)); do printf '%s' "$payload" | bash "$HOOK" >/dev/null; done
  end=$(now_ms)
  if [[ "$start" -eq 0 || "$end" -eq 0 ]]; then
    printf '  %-46s (perl not available for ms timing)\n' "$label"
  else
    printf '  %-46s %s ms per call\n' "$label" "$(( (end - start) / 20 ))"
  fi
}
# Every payload below carries hook_event_name, as a real one does, so each
# line measures the path a real call takes.
mk_real_payload() { mk_payload "$@" | jq -c '. + {hook_event_name: "PreToolUse"}'; }
latency "baseline: a non-git command (early exit)" "$(mk_real_payload 'ls -la' "$a")"
latency "git status, armed fixture" "$(mk_real_payload 'git status' "$a")"
latency "git status, unarmed fixture" "$(mk_real_payload 'git status' "$u")"
latency "git status, not-adopted repo" "$(mk_real_payload 'git status' "$n")"
latency "six clauses, armed fixture" \
  "$(mk_real_payload 'git fetch origin && git status && git diff --stat && git log --oneline -5 && git branch --list && git remote -v' "$a")"
latency "six clauses, unarmed fixture" \
  "$(mk_real_payload 'git fetch origin && git status && git diff --stat && git log --oneline -5 && git branch --list && git remote -v' "$u")"
latency "Edit on an ordinary file (early exit)" "$(mk_real_file_payload Edit "$a/README.md" "$a")"
latency "Edit on a file whose name holds git" "$(mk_real_file_payload Edit "$a/src/gitlab-client.ts" "$a")"
latency "Edit on a floor file (the deny)" "$(mk_real_file_payload Edit "$a/.githooks/pre-push" "$a")"

echo
echo "=== shellcheck (informational; does not gate this suite) ==="
if command -v shellcheck >/dev/null 2>&1; then
  if shellcheck "$HOOK"; then
    echo "  shellcheck: clean"
  else
    echo "  shellcheck: reported findings on the hook (see above); not failing the test run"
  fi
else
  echo "  shellcheck not installed, skipping"
fi

echo
echo "passed: $TESTS_PASSED / $TESTS_TOTAL"
if [[ "$TESTS_SKIPPED" -gt 0 ]]; then
  echo "skipped: $TESTS_SKIPPED group(s), for want of a git version on this box"
fi
if [[ "$TESTS_FAILED" -gt 0 ]]; then
  echo "$TESTS_FAILED case(s) failed."
  exit 1
fi
exit 0
