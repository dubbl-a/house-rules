#!/usr/bin/env bash
# Regression tests for plugins/house/hooks/no-direct-master.sh.
#
# For each case, builds a REAL PreToolUse JSON payload (Bash:
# {"tool_name":"Bash","tool_input":{"command":"..."},"cwd":"..."}; Edit,
# Write and MultiEdit: tool_input.file_path), pipes it into the REAL hook
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
if [[ "$HOOK_CODE" -eq 0 && "$reason" == "house guard crashed; refusing rather than guessing" ]]; then
  pass "planted internal failure denies with the crashed message"
else
  fail "planted internal failure denies with the crashed message" "exit=$HOOK_CODE reason=[$reason] out=[$HOOK_OUT]"
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

# ── Edit/Write/MultiEdit: nothing under .githooks/ or the git dir ─────────
expect_deny "Edit on a vendored .githooks file" \
  "$(mk_file_payload Edit "$a/.githooks/pre-push" "$a")" "part of the git-hook floor"
expect_deny "MultiEdit on a vendored .githooks file" \
  "$(mk_file_payload MultiEdit "$a/.githooks/pre-commit.d/10-house-branch" "$a")" "part of the git-hook floor"
expect_deny "Write on .git/config" \
  "$(mk_file_payload Write "$a/.git/config" "$a")" "git-hook floor"
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
echo "=== latency (informational; 20 runs each) ==="
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
latency "baseline: a non-git command (early exit)" "$(mk_payload 'ls -la' "$a")"
latency "git status, armed fixture" "$(mk_payload 'git status' "$a")"
latency "git status, unarmed fixture" "$(mk_payload 'git status' "$u")"
latency "git status, not-adopted repo" "$(mk_payload 'git status' "$n")"
latency "six clauses, armed fixture" \
  "$(mk_payload 'git fetch origin && git status && git diff --stat && git log --oneline -5 && git branch --list && git remote -v' "$a")"
latency "six clauses, unarmed fixture" \
  "$(mk_payload 'git fetch origin && git status && git diff --stat && git log --oneline -5 && git branch --list && git remote -v' "$u")"
latency "Edit on an ordinary file (early exit)" "$(mk_file_payload Edit "$a/README.md" "$a")"
latency "Edit on a file whose name holds git" "$(mk_file_payload Edit "$a/src/gitlab-client.ts" "$a")"
latency "Edit on a floor file (the deny)" "$(mk_file_payload Edit "$a/.githooks/pre-push" "$a")"

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
