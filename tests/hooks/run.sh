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
# floor is. So the suite is in five parts:
#   - the ADR 0002 adoption gates and the deference matrix
#   - the policy source: house.json as it is on HEAD, not in the working tree
#   - the disable list: every literal that turns the floor off, each next to
#     an innocent neighbour that must still pass
#   - the branch refusals, run three ways: against a fixture where the floor
#     is ARMED (only a commit is refused, everything else is the floor's), one
#     where core.hooksPath is unset, and one where the floor is armed but a
#     vendored file has been edited (so it is not intact and not trusted)
#   - the two fail-closed paths: missing jq and the ERR trap
#
# The armed fixture copies the vendored floor from
# plugins/house/modules/github/files/githooks/ AND COMMITS IT, because the
# hook's `armed` test is byte-identity with the plugin's own copy plus a clean
# `git status` on the hooks directory. Copying at test time is deliberate: the
# floor's contents change in the same PR, and the fixture must follow.
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

TESTS_TOTAL=0
TESTS_PASSED=0
TESTS_FAILED=0

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

# run_hook <payload-json> -> sets HOOK_OUT / HOOK_CODE
run_hook() {
  local payload="$1"
  HOOK_OUT=$(printf '%s' "$payload" | bash "$HOOK")
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
expect_allow "unarmed: a bare push from a feature branch is allowed" \
  "$(mk_payload "git push" "$u")"
expect_allow "unarmed: push --tags from a feature branch is allowed" \
  "$(mk_payload "git push --tags" "$u")"

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
git -C "$base/main" worktree add -q "$base/other" master
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
expect_allow "a branch created earlier in the same call is where the commit lands" \
  "$(mk_payload "git checkout -b feat/new && $_c -m x" "$r")"

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
# Accepted false deny, documented in the hook header: reading the value is
# refused along with writing it. `house doctor` reports the arming instead.
expect_deny "ACCEPTED FALSE DENY: reading core.hooksPath is refused too" \
  "$(mk_payload "git config --get core.$_ph" "$d")" "disables or moves"
expect_deny "git config --unset core.hooksPath" \
  "$(mk_payload "git config --unset core.$_ph" "$d")" "disables or moves"
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

# The disable list only applies in an ADOPTED repo (ADR 0002).
n="$TMP_ROOT/unadopted"; new_repo "$n"
expect_allow "--no-verify in a repo that never adopted house is not our business" \
  "$(mk_payload "git $_cm --no-verify -m x" "$n")"

# ── the floor ARMED: only a commit is refused; everything else is the floor's ──
a="$TMP_ROOT/armed"; new_repo "$a"; adopt "$a"; lock_floor "$a"
arm_floor "$a" feat/a
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
expect_allow "armed: an alias verb is the floor's business" \
  "$(mk_payload "git po origin master" "$a")"
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
expect_deny "unarmed: a force-push to master is refused by the push scan" \
  "$(mk_payload "git push --force origin master" "$d")" "protected branch"

# ── ARMED THROUGH A LINKED WORKTREE ───────────────────────────────────────
# core.hooksPath lives in the main checkout's config and the hooks directory
# is the main checkout's too. Round 1 read a worktree as unarmed and then told
# the session to run the config write, which would have disarmed the whole
# clone.
w="$TMP_ROOT/wtfloor"
new_repo "$w/main"; adopt "$w/main"; lock_floor "$w/main"
install_floor "$w/main" feat/main
git -C "$w/main" checkout -q feat/main
git -C "$w/main" worktree add -q "$w/wt" master
arm_hookspath "$w/main"
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

# ── the floor ARMED BUT NOT INTACT: one edited file and it is not trusted ──
# The integrity check is the real guard: byte-identity with the plugin's own
# copy, the execute bit, and a clean git status on the hooks directory.
mk_broken_floor() {
  local dir="$1"
  new_repo "$dir"; adopt "$dir"
  arm_floor "$dir" feat/b
  git -C "$dir" checkout -q feat/b
}
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
# Another repo's .githooks is not this repo's business, and a repo on
# branchPolicy direct never gets here at all.
pd="$TMP_ROOT/direct-floor"; new_repo "$pd"; adopt "$pd" '{"branchPolicy":"direct"}'; lock_floor "$pd"
expect_allow "Edit on a .githooks file in a branchPolicy direct repo" \
  "$(mk_file_payload Edit "$pd/.githooks/pre-push" "$pd")"

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
if [[ "$TESTS_FAILED" -gt 0 ]]; then
  echo "$TESTS_FAILED case(s) failed."
  exit 1
fi
exit 0
