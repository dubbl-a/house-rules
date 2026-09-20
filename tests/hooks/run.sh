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
# floor is. So the suite is in four parts:
#   - the ADR 0002 adoption gates and the deference matrix (unchanged)
#   - the disable list: every literal that turns the floor off, each next to
#     an innocent neighbour that must still pass
#   - the branch refusals, run twice: against a fixture where the floor is
#     ARMED (only a commit is refused, pushes are the floor's) and one where
#     it is NOT (commit and push are both refused, and the message names the
#     arming command)
#   - the two fail-closed paths: missing jq and the ERR trap
#
# The armed fixture copies the vendored floor from
# plugins/house/modules/github/files/githooks/ when it exists, and plants
# minimal executable stand-ins when it does not, so this suite never depends
# on the floor's own content, only on its presence and its mode.
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

# adopt <dir> [json] -- writes house.json and records it, still on master
adopt() {
  local dir="$1" json="${2:-}"
  [[ -n "$json" ]] || json='{"branchPolicy":"pr"}'
  printf '%s' "$json" >"$dir/house.json"
  git -C "$dir" add house.json
  git -C "$dir" commit -q -m house
}

# arm_floor <dir> -- installs the git-hook floor in <dir> and points
# core.hooksPath at it, which is what the hook reads to decide that pushes
# are the floor's business rather than its own. Copies the vendored sources
# when they exist (the github module's files[] entries); when they do not,
# plants minimal executable stand-ins, because this suite asserts on the
# floor's PRESENCE and mode, never on what it does. Call it AFTER the
# fixture's own commits: a real floor refuses a commit on master.
arm_floor() {
  local dir="$1" rel
  mkdir -p "$dir/.githooks/pre-commit.d" "$dir/.githooks/pre-push.d" "$dir/.githooks/reference-transaction.d"
  for rel in $FLOOR_PATHS; do
    if [[ -f "$FLOOR_SRC/$rel" ]]; then
      cp "$FLOOR_SRC/$rel" "$dir/.githooks/$rel"
    else
      printf '#!/usr/bin/env bash\nexit 0\n' >"$dir/.githooks/$rel"
    fi
    chmod +x "$dir/.githooks/$rel"
  done
  git -C "$dir" config core.hooksPath "$dir/.githooks"
}

# lock_floor <dir> -- plants the .house/lock.json files[] records that make
# the floor's paths managed, which is what the Edit/Write scan reads.
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
if [[ -d "$FLOOR_SRC" ]]; then
  echo "floor fixture: vendored sources from $FLOOR_SRC"
else
  echo "floor fixture: stand-ins (vendored sources not present yet)"
fi
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

# --- 7/8. UNARMED: push from master DENY (and names the arming command),
#          push origin feat/x from feat/x ALLOW ---
r="$TMP_ROOT/case07"; new_repo "$r"; adopt "$r"
expect_deny "unarmed: push from master" \
  "$(mk_payload "git push origin master" "$r")" "feature branch"
expect_deny "unarmed: the deny names the arming command" \
  "$(mk_payload "git push origin master" "$r")" "floor is not armed in this checkout"
git -C "$r" checkout -q -b feat/x
expect_allow "unarmed: push origin feat/x from feat/x" \
  "$(mk_payload "git push origin feat/x" "$r")"

# --- 9. UNARMED: push refspec targeting master from feat/x: DENY ---
r="$TMP_ROOT/case09"; new_repo "$r"; adopt "$r"
git -C "$r" checkout -q -b feat/x
expect_deny "unarmed: push refspec HEAD:master from feat/x" \
  "$(mk_payload "git push origin HEAD:master" "$r")" "protected branch"
expect_deny "unarmed: push --all from feat/x" \
  "$(mk_payload "git push --all origin" "$r")" "without naming it"

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
for c in bash git cat sed grep printf tr true false env sh; do
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
  "$(mk_payload 'git commit -m test' "$r")" "not valid JSON"

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

# ── the verb walk: a global option is stepped over, a computed verb is not
#    chased (documented: the floor reads the ref the shell finally produces) ──
expect_deny "git --no-pager commit on master still denies" \
  "$(mk_payload "git --no-pager $_verb -m x" "$r")" "feature branch"
expect_deny "git -c key=value (space-free value) commit still denies on master" \
  "$(mk_payload "git -c user.name=x $_verb -m y" "$r")" "feature branch"
expect_allow "git -c key=value status is untouched" \
  "$(mk_payload 'git -c user.name=x status' "$r")"
expect_allow "a computed verb is NOT chased any more; the floor reads the ref" \
  "$(mk_payload 'git ${v} -m x' "$r")"

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

# Ref-writing plumbing that moves a protected branch without a commit.
expect_deny "git update-ref on a protected branch" \
  "$(mk_payload "git update-ref refs/heads/master HEAD" "$d")" "disables or moves"
expect_deny "git symbolic-ref onto a protected branch" \
  "$(mk_payload "git symbolic-ref HEAD refs/heads/master" "$d")" "disables or moves"
expect_deny "git branch -D on a protected branch" \
  "$(mk_payload "git branch -D master" "$d")" "disables or moves"
expect_deny "git branch -f on a protected branch" \
  "$(mk_payload "git branch -f master HEAD" "$d")" "disables or moves"
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

# ── the floor ARMED: only a commit is refused; pushes are the floor's ─────
a="$TMP_ROOT/armed"; new_repo "$a"; adopt "$a"; lock_floor "$a"; arm_floor "$a"
expect_deny "armed: commit on master denies with the short message" \
  "$(mk_payload "git commit -m x" "$a")" "needs a PR"
expect_deny_without "armed: the commit deny does NOT tell you to arm the floor" \
  "$(mk_payload "git commit -m x" "$a")" "not armed in this checkout"
expect_allow "armed: push origin master from master is the floor's business" \
  "$(mk_payload "git push origin master" "$a")"
git -C "$a" checkout -q -b feat/a
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

# ── Edit/Write/MultiEdit: the floor's managed files are not editable ──────
expect_deny "Edit on a managed .githooks file" \
  "$(mk_file_payload Edit "$a/.githooks/pre-push" "$a")" "managed file of the git-hook floor"
expect_deny "MultiEdit on a managed .githooks file" \
  "$(mk_file_payload MultiEdit "$a/.githooks/pre-commit.d/10-house-branch" "$a")" "managed file"
expect_deny "Write on .git/config" \
  "$(mk_file_payload Write "$a/.git/config" "$a")" "git-hook floor"
expect_deny "Write on .git/hooks/pre-commit" \
  "$(mk_file_payload Write "$a/.git/hooks/pre-commit" "$a")" "git-hook floor"
expect_allow "Edit on the repo's own .githooks/pre-commit.d/20-secrets scaffold" \
  "$(mk_file_payload Edit "$a/.githooks/pre-commit.d/20-secrets" "$a")"
expect_allow "Edit on an ordinary file" \
  "$(mk_file_payload Edit "$a/README.md" "$a")"
expect_allow "Edit on a managed floor file, relative path, resolved against the cwd" \
  "$(mk_file_payload Edit "README.md" "$a")"
expect_deny "Edit on a managed floor file given as a relative path" \
  "$(mk_file_payload Edit ".githooks/pre-push" "$a")" "managed file"
# Another repo's .githooks is not this repo's business, and a repo on
# branchPolicy direct never gets here at all.
p="$TMP_ROOT/direct-floor"; new_repo "$p"; adopt "$p" '{"branchPolicy":"direct"}'; lock_floor "$p"
expect_allow "Edit on a .githooks file in a branchPolicy direct repo" \
  "$(mk_file_payload Edit "$p/.githooks/pre-push" "$p")"

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
