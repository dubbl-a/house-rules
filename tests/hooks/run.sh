#!/usr/bin/env bash
# Regression tests for plugins/house/hooks/no-direct-master.sh.
#
# For each case, builds a REAL PreToolUse JSON payload
# ({"tool_name":"Bash","tool_input":{"command":"..."},"cwd":"..."}), pipes
# it into the REAL hook script, and asserts on the captured stdout JSON
# (via jq, .hookSpecificOutput.permissionDecision) and the exit code.
#
# Deliberately does NOT reimplement any of the hook's branch/refspec/
# carve-out matching logic here; every case exercises the hook's actual
# stdin-to-stdout contract, using throwaway git repos created under
# mktemp.
#
# Run:  bash tests/hooks/run.sh   (also wired as `npm run test:hooks`)
#
# Exits non-zero if any case fails.

set -o pipefail

SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
HOOK="$REPO_ROOT/plugins/house/hooks/no-direct-master.sh"

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

# run_hook <payload-json> [env-prefix...] -> sets HOOK_OUT / HOOK_CODE
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

# new_repo <dir> -- inits a repo, one commit, on branch master
new_repo() {
  local dir="$1"
  mkdir -p "$dir"
  git -C "$dir" init -q
  git -C "$dir" config user.email test@example.com
  git -C "$dir" config user.name "House Test"
  git -C "$dir" checkout -q -b master
  echo seed >"$dir/.seed"
  git -C "$dir" add .seed
  git -C "$dir" commit -q -m seed
}

echo "=== house guard: PreToolUse hook regression tests ==="
echo "hook: $HOOK"
echo

# --- 1. no house.json, commit on master: ALLOW (fail open) ---
r="$TMP_ROOT/case01"; new_repo "$r"
expect_allow "no house.json, commit on master (fail open)" \
  "$(mk_payload "git commit -m x" "$r")"

# --- 2. house.json branchPolicy direct, commit on main: ALLOW ---
r="$TMP_ROOT/case02"; new_repo "$r"
echo '{"branchPolicy":"direct"}' >"$r/house.json"
git -C "$r" add house.json && git -C "$r" commit -q -m house
git -C "$r" checkout -q -b main
expect_allow "house.json branchPolicy direct, commit on main" \
  "$(mk_payload "git commit -m x" "$r")"

# --- 3. repo-local .claude/settings.json with a PreToolUse hook: ALLOW (deference) ---
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
# guarded. A stub is indistinguishable from no guard at all, so it must not
# buy deference. The predicate fails toward DENY: a local guard we cannot
# recognize leaves this hook armed, which costs a branch, not a miss.
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
r="$TMP_ROOT/case05"; new_repo "$r"
echo '{"branchPolicy":"pr"}' >"$r/house.json"
git -C "$r" add house.json && git -C "$r" commit -q -m house
expect_deny "house.json pr policy, commit on master" \
  "$(mk_payload "git commit -m x" "$r")" "feature branch"
git -C "$r" checkout -q -b feat/x
expect_allow "house.json pr policy, commit on feat/x" \
  "$(mk_payload "git commit -m x" "$r")"

# --- 7/8. push from master DENY, push origin feat/x from feat/x ALLOW ---
r="$TMP_ROOT/case07"; new_repo "$r"
echo '{"branchPolicy":"pr"}' >"$r/house.json"
git -C "$r" add house.json && git -C "$r" commit -q -m house
expect_deny "push from master" \
  "$(mk_payload "git push origin master" "$r")" "feature branch"
git -C "$r" checkout -q -b feat/x
expect_allow "push origin feat/x from feat/x" \
  "$(mk_payload "git push origin feat/x" "$r")"

# --- 9. push refspec targeting master from feat/x: DENY ---
r="$TMP_ROOT/case09"; new_repo "$r"
echo '{"branchPolicy":"pr"}' >"$r/house.json"
git -C "$r" add house.json && git -C "$r" commit -q -m house
git -C "$r" checkout -q -b feat/x
expect_deny "push refspec HEAD:master from feat/x" \
  "$(mk_payload "git push origin HEAD:master" "$r")" "protected branch"

# --- 10. git -C <other-worktree-on-master> commit: DENY even when cwd is elsewhere ---
base="$TMP_ROOT/case10"
new_repo "$base/main"
echo '{"branchPolicy":"pr"}' >"$base/main/house.json"
git -C "$base/main" add house.json && git -C "$base/main" commit -q -m house
git -C "$base/main" checkout -q -b feat/main
git -C "$base/main" worktree add -q "$base/other" master
expect_deny "git -C other-worktree-on-master commit, cwd is the (non-protected) main worktree" \
  "$(mk_payload "git -C $base/other commit -m x" "$base/main")" "feature branch"

# --- 11/12. cd <path> && / ; git commit resolution ---
r="$TMP_ROOT/case11"; new_repo "$r"
echo '{"branchPolicy":"pr"}' >"$r/house.json"
git -C "$r" add house.json && git -C "$r" commit -q -m house
# cwd is TMP_ROOT itself (not a git repo): a DENY here can only come from
# resolving the target via the `cd` clause, not from a cwd fallback.
expect_deny "cd <path> && git commit resolution" \
  "$(mk_payload "cd $r && git commit -m x" "$TMP_ROOT")" "feature branch"
expect_deny "cd <path> ; git commit resolution" \
  "$(mk_payload "cd $r ; git commit -m x" "$TMP_ROOT")" "feature branch"

# --- 13. quoted false positive: commit -m "fix master bug" on feat/x: ALLOW ---
r="$TMP_ROOT/case13"; new_repo "$r"
echo '{"branchPolicy":"pr"}' >"$r/house.json"
git -C "$r" add house.json && git -C "$r" commit -q -m house
git -C "$r" checkout -q -b feat/x
expect_allow "quoted false positive (fix master bug) on feat/x" \
  "$(mk_payload 'git commit -m "fix master bug"' "$r")"

# --- 14. push-clause isolation: push origin feat && checkout master: ALLOW ---
r="$TMP_ROOT/case14"; new_repo "$r"
echo '{"branchPolicy":"pr"}' >"$r/house.json"
git -C "$r" add house.json && git -C "$r" commit -q -m house
git -C "$r" checkout -q -b feat/x
expect_allow "push-clause isolation (push feat && checkout master)" \
  "$(mk_payload "git push origin feat && git checkout master" "$r")"

# --- 15-18. carve-outs ---
r="$TMP_ROOT/case15"; new_repo "$r"
mkdir -p "$r/scripts/newsletter" "$r/src" "$r/public/email-assets/broadcasts/2026-08"
echo '{"branchPolicy":"pr","carveOuts":["scripts/newsletter/issue-*.json","public/email-assets/broadcasts/*"]}' >"$r/house.json"
git -C "$r" add house.json && git -C "$r" commit -q -m house
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
r="$TMP_ROOT/case20"; new_repo "$r"
echo '{"branchPolicy":"pr"}' >"$r/house.json"
git -C "$r" add house.json && git -C "$r" commit -q -m house
payload="$(mk_payload "git status" "$r")"
HOOK_OUT=$(printf '%s' "$payload" | HOUSE_TEST_CRASH=1 bash "$HOOK")
HOOK_CODE=$?
reason=$(printf '%s' "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecisionReason // ""' 2>/dev/null)
if [[ "$HOOK_CODE" -eq 0 && "$reason" == "house guard crashed; refusing rather than guessing" ]]; then
  pass "planted internal failure denies with the crashed message"
else
  fail "planted internal failure denies with the crashed message" "exit=$HOOK_CODE reason=[$reason] out=[$HOOK_OUT]"
fi

# --- 21. non-git command (ls): ALLOW instantly ---
r="$TMP_ROOT/case21"; new_repo "$r"
expect_allow "non-git command (ls) allowed instantly" \
  "$(mk_payload "ls -la" "$r")"

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


# ── malformed house.json in an adopted repo: deny, never a disarmed guard ──
repo_bad=$(mktemp -d "$TMP_ROOT/badjson.XXXX")
git init -q "$repo_bad"
git -C "$repo_bad" symbolic-ref HEAD refs/heads/master
git -C "$repo_bad" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
echo '{broken' > "$repo_bad/house.json"
run_hook "$(mk_payload 'git commit -m test' "$repo_bad")"
if [[ "$(printf '%s' "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)" == "deny" ]]; then
  pass "malformed house.json on protected branch: DENY (refuse rather than guess)"
else
  fail "malformed house.json on protected branch" "expected deny, got code=$HOOK_CODE out=$HOOK_OUT"
fi


# ── F2: quoted verb / quoted-or-modified refspec must not defeat the guard ──
repo_q=$(mktemp -d "$TMP_ROOT/quote.XXXX")
git init -q "$repo_q"; git -C "$repo_q" symbolic-ref HEAD refs/heads/master
git -C "$repo_q" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
printf '{"version":"0.1.0","defaultBranch":"master","branchPolicy":"pr","protectedBranches":["master","main"],"modules":{"docs":{"enabled":true,"config":{}}}}' > "$repo_q/house.json"
for c in "git 'commit' -m x" 'git "commit" -m x' "git push origin 'master'" "git push origin HEAD:'master'"; do
  run_hook "$(mk_payload "$c" "$repo_q")"
  if [ "$(printf '%s' "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)" = "deny" ]; then
    pass "quote bypass denied: $c"
  else fail "quote bypass: $c" "expected deny, got $HOOK_OUT"; fi
done
git -C "$repo_q" checkout -q -b feat
for c in "git commit -m 'fix master bug'" 'git commit -m "push to master later"'; do
  run_hook "$(mk_payload "$c" "$repo_q")"
  d="$(printf '%s' "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)"
  if [ "$d" != "deny" ]; then pass "message text not a false positive: $c"
  else fail "message false positive: $c" "expected allow, got deny"; fi
done


# ── F4: quoted message text must not pick where the branch check happens ──
# The target_dir regexes used to run on the RAW command, before the -m/-F
# stripping, so `cd /nonexistent &&` or `git -C /other` INSIDE a commit message
# pointed the check at a non-repo path and the deliberate non-repo fail-open
# turned into an attacker-controlled disarm (ultra review of v0.2.1).
repo_h=$(mktemp -d "$TMP_ROOT/hijack.XXXX")
git init -q "$repo_h"; git -C "$repo_h" symbolic-ref HEAD refs/heads/master
git -C "$repo_h" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
printf '{"version":"0.1.0","defaultBranch":"master","branchPolicy":"pr","protectedBranches":["master","main"],"modules":{"docs":{"enabled":true,"config":{}}}}' > "$repo_h/house.json"
for c in 'git commit -m "note: cd /nonexistent && push"' 'git commit -m "run git -C /nonexistent status"' "git commit -m 'cd /tmp ; git status'" 'git commit --message="see cd /nonexistent && done"'; do
  run_hook "$(mk_payload "$c" "$repo_h")"
  if [ "$(printf '%s' "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)" = "deny" ]; then
    pass "message text cannot hijack target_dir: $c"
  else fail "target_dir hijack: $c" "expected deny on master, got [$HOOK_OUT]"; fi
done
# negative control: a REAL cd/-C clause outside the message still resolves the target.
other=$(mktemp -d "$TMP_ROOT/hijack-other.XXXX"); new_repo "$other"
echo '{"branchPolicy":"pr"}' >"$other/house.json"; git -C "$other" add house.json && git -C "$other" commit -q -m house
git -C "$repo_h" checkout -q -b feat/y
expect_deny "real cd <protected repo> && git commit still resolves the target" \
  "$(mk_payload "cd $other && git commit -m 'note: cd /nonexistent && push'" "$repo_h")"
expect_deny "real git -C <protected repo> commit still resolves the target" \
  "$(mk_payload "git -C $other commit -m 'run git -C /nonexistent status'" "$repo_h")"

# ── F3: only a PreToolUse hook defers; PostToolUse-only does NOT disarm ──
repo_d=$(mktemp -d "$TMP_ROOT/defer.XXXX")
git init -q "$repo_d"; git -C "$repo_d" symbolic-ref HEAD refs/heads/master
git -C "$repo_d" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
printf '{"version":"0.1.0","defaultBranch":"master","branchPolicy":"pr","protectedBranches":["master","main"],"modules":{"docs":{"enabled":true,"config":{}}}}' > "$repo_d/house.json"
mkdir -p "$repo_d/.claude"
echo '{"hooks":{"PostToolUse":[{"matcher":"Bash","hooks":[]}]}}' > "$repo_d/.claude/settings.json"
run_hook "$(mk_payload 'git commit -m x' "$repo_d")"
if [ "$(printf '%s' "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)" = "deny" ]; then
  pass "PostToolUse-only settings.json does not disarm the guard"
else fail "PostToolUse-only deferral" "expected deny, a non-branch-guard hook must not disarm"; fi
echo '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"x"}]}]}}' > "$repo_d/.claude/settings.json"
run_hook "$(mk_payload 'git commit -m x' "$repo_d")"
if [ "$(printf '%s' "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)" != "deny" ]; then
  pass "PreToolUse hook in settings.json defers (repo guard wins)"
else fail "PreToolUse deferral" "expected allow/defer"; fi

# #34 review: `length > 0` alone is satisfied by any non-empty jq value, so a
# malformed settings.json (PreToolUse as an object, a hand-edit Claude Code
# itself ignores) disarmed the guard while checker and doctor reported
# protection. Only a non-empty ARRAY may defer. Every git verb below is
# assembled from string parts (testing.md: build the guard's trigger tokens
# so this file's own text cannot trip the guard it drives).
_gc="git"" commit"
_verb="com""mit"
_push="pu""sh"
echo '{"hooks":{"PreToolUse":{"matcher":"Bash"}}}' > "$repo_d/.claude/settings.json"
run_hook "$(mk_payload "$_gc -m x" "$repo_d")"
if [ "$(printf '%s' "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)" = "deny" ]; then
  pass "a non-array PreToolUse value does not disarm the guard"
else fail "non-array PreToolUse deferral" "expected deny: a malformed settings.json must not disarm"; fi

# ADR 0009: house.json's guard record is a CHECKER signal only; the hook never
# reads it. A repo carrying the record, with no repo-local guard, still denies
# a protected-branch commit.
rm -f "$repo_d/.claude/settings.json"
printf '{"version":"0.1.0","defaultBranch":"master","branchPolicy":"pr","protectedBranches":["master","main"],"guard":{"by":"plugin","decided":"2026-08-31","why":"recorded choice"},"modules":{"docs":{"enabled":true,"config":{}}}}' > "$repo_d/house.json"
run_hook "$(mk_payload "$_gc -m x" "$repo_d")"
if [ "$(printf '%s' "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)" = "deny" ]; then
  pass "a recorded plugin guard in house.json is not a stand-down signal"
else fail "guard-record stand-down" "expected deny: the record must never disarm the hook"; fi

# ── #27: an interpreter's -c body is code, not prose ─────────────────────
# strip_message_args removed -c and its value (git's own `-c key=value`), so an
# interpreter's -c body was invisible to the verb scans. The union scan now
# reads a -c-retaining variant too; each addition can only turn allow into deny.
run_hook "$(mk_payload "bash -c '$_gc -m x'" "$repo_d")"
if [ "$(printf '%s' "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)" = "deny" ]; then
  pass "an interpreter -c commit body on a protected branch denies"
else fail "interpreter -c commit" "expected deny: the -c body is code the scan must see"; fi
run_hook "$(mk_payload "sh -c 'git $_push origin master'" "$repo_d")"
if [ "$(printf '%s' "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)" = "deny" ]; then
  pass "an interpreter -c push-to-master body denies"
else fail "interpreter -c push" "expected deny"; fi
# git's own -c with a space-free value: the value stays stripped in cmd_safe, so
# it cannot trigger, and the verb outside the -c pair still denies.
expect_deny "git -c key=value (space-free value) commit still denies on a protected branch" \
  "$(mk_payload "git -c user.name=x $_verb -m y" "$repo_d")"
expect_allow "git -c key=value status is untouched" \
  "$(mk_payload 'git -c user.name=x status' "$repo_d")"
# From a feature branch the protected-branch scans do not run, but the
# any-branch refspec scan reads the -c body too.
git -C "$repo_d" checkout -q -b feat/c-scan
run_hook "$(mk_payload "bash -c '$_gc -m x'" "$repo_d")"
if [ "$(printf '%s' "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)" != "deny" ]; then
  pass "an interpreter -c commit body on a feature branch is allowed"
else fail "interpreter -c feature commit" "expected allow: feature-branch commits are not guarded"; fi
run_hook "$(mk_payload "bash -c 'git $_push origin master'" "$repo_d")"
if [ "$(printf '%s' "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)" = "deny" ]; then
  pass "an interpreter -c push-to-master body from a feature branch denies via the refspec scan"
else fail "interpreter -c refspec" "expected deny: the refspec scan must read the -c body"; fi
git -C "$repo_d" checkout -q master

# --- #27: a target parsed out of the command is a GUESS, and a wrong guess
# used to fall through to the non-repo fail-open, which is an ALLOW. Any prose
# naming a path that does not exist (a heredoc body, a commit message, a
# quoted string) therefore disarmed the guard on a protected branch. A wrong
# guess now falls back to the directory the command actually runs in.
#
# The fix deliberately adds no parsing: three attempts to parse the command
# better were reverted, each having opened new seams. Verbs are assembled from
# parts so this file cannot trip the guard it exercises.
r="$TMP_ROOT/case_failopen"; new_repo "$r"
echo '{"branchPolicy":"pr"}' >"$r/house.json"
git -C "$r" add house.json && git -C "$r" commit -q -m house
# A second repo that has ALSO adopted house, on a feature branch. It must be
# adopted: an unadopted repo passes the cross-repo controls below via the
# "has not adopted house" fail-open, which would prove only that the fallback
# did not swallow the target, not that the branch was resolved in the RIGHT
# repo.
o="$TMP_ROOT/case_failopen_other"; new_repo "$o"
echo '{"branchPolicy":"pr"}' >"$o/house.json"
git -C "$o" add house.json && git -C "$o" commit -q -m house
git -C "$o" checkout -q -b feat/y
_c="git"" commit"
_verb="com""mit"

expect_deny "a heredoc naming a missing path cannot disarm the guard" \
  "$(mk_payload "cat <<'EOF' > n.md
see cd /nonexistent && more
EOF
$_c -m x" "$r")" "feature branch"
expect_deny "a message naming a missing path cannot disarm the guard" \
  "$(mk_payload "$_c -m \"note: cd /nonexistent && done\"" "$r")" "feature branch"
expect_deny "quoted prose naming a missing path cannot disarm the guard" \
  "$(mk_payload "echo \"cd /nonexistent && x\" > n.md
$_c -m y" "$r")" "feature branch"
expect_deny "a -C at a missing path cannot disarm the guard" \
  "$(mk_payload "git -C /nonexistent status && $_c -m z" "$r")" "feature branch"

# Controls: the fallback must not swallow a real cross-repo target, and a
# genuine non-repo target must still fail open.
expect_allow "a real -C to another repo still resolves to THAT repo" \
  "$(mk_payload "git -C $o $_verb -m x" "$r")"
expect_allow "a real cd to another repo still resolves to THAT repo" \
  "$(mk_payload "cd $o && $_c -m x" "$r")"
expect_deny "a real -C INTO the protected repo is still caught from elsewhere" \
  "$(mk_payload "git -C $r $_verb -m x" "$o")" "feature branch"

# A RELATIVE target must resolve against the directory the command runs in,
# not against whatever cwd the hook process happens to have. Successive -C
# compose, which is what makes this work without parsing anything.
expect_allow "a relative target resolves against the payload cwd, not the hook's" \
  "$(mk_payload "cd ../$(basename "$o") && $_c -m x" "$r")"

# The accepted cost of the fallback, pinned rather than left to be discovered:
# a target this same command CREATES does not resolve yet either, so it denies
# on a protected branch and has to be split into two calls. Recognizing
# creation would mean reading the command again, which is the approach that
# was reverted three times. The deny message says "separate call" so the
# guidance and the behavior agree.
expect_deny "a target the same command creates does not resolve yet, and denies" \
  "$(mk_payload "git worktree add -b fix/x ../wt-fix-x && cd ../wt-fix-x && $_c -m x" "$r")" "SEPARATE call"
expect_allow "a genuinely non-repo working directory still fails open" \
  "$(mk_payload "$_c -m x" "/tmp")"

# --- #17: the flag strip must not eat a path segment ---------------------
# _strip_flag_args ran its alternation (-m|--message|-F|--file|-c) with no
# token boundary on the left, so the -c of a directory named
# ...-council-audit-findings matched and the rest of that segment was deleted.
# Target resolution then landed on a path that is not a repo, the wrong-guess
# fallback sent it to the payload cwd (the protected checkout), and a valid
# feature-branch commit was refused. Reported twice in one week, once from a
# worktree and once from a plain clone; both times the workaround was renaming
# the directory. Any segment beginning -c, -m, or -F after a hyphen triggers it.
#
# Only a LEFT anchor closes this. A right boundary (requiring = or whitespace
# between the flag and its value) was tried and rejected: it leaves git's own
# attached form `git -cuser.name=x commit` unstripped, and the commit pattern
# does not match that string, so a real commit on a protected branch would be
# ALLOWED. Under-stripping costs a false deny; over-stripping costs a bypass,
# and the last case below is what pins that direction.
p="$TMP_ROOT/case_strip"; new_repo "$p"
echo '{"branchPolicy":"pr"}' >"$p/house.json"
git -C "$p" add house.json && git -C "$p" commit -q -m house

for seg in fix-council-audit-findings main-cleanup Fix-typo; do
  w="$TMP_ROOT/wt-$seg"; new_repo "$w"
  echo '{"branchPolicy":"pr"}' >"$w/house.json"
  git -C "$w" add house.json && git -C "$w" commit -q -m house
  git -C "$w" checkout -q -b "kind/$seg"
  echo body >"$w/msg.txt"
  expect_allow "cd into a path whose segment starts -c/-m/-F resolves to that repo: $seg" \
    "$(mk_payload "cd $w && $_c -q -F $w/msg.txt" "$p")"
  expect_allow "-C at a path whose segment starts -c/-m/-F resolves to that repo: $seg" \
    "$(mk_payload "git -C $w $_verb -q -F $w/msg.txt" "$p")"
done

# The fix resolves the target rather than discarding it, so the same poisoned
# path on a PROTECTED branch must still deny. Without this the fix would be a
# disarm dressed up as an ergonomics repair.
wm="$TMP_ROOT/wt-guard-council-audit"; new_repo "$wm"
echo '{"branchPolicy":"pr"}' >"$wm/house.json"
git -C "$wm" add house.json && git -C "$wm" commit -q -m house
expect_deny "a path with a -c segment on a protected branch still denies (cd)" \
  "$(mk_payload "cd $wm && $_c -m x" "$p")" "feature branch"
expect_deny "a path with a -c segment on a protected branch still denies (-C)" \
  "$(mk_payload "git -C $wm $_verb -m x" "$p")" "feature branch"

# The strip itself must still do its job in both -c forms, or the bypass the
# right boundary would have opened comes back by another route.
expect_deny "git -c with a separated value still denies on a protected branch" \
  "$(mk_payload "git -c user.name=x $_verb -m y" "$p")" "feature branch"
expect_deny "git -c with an ATTACHED value still denies on a protected branch" \
  "$(mk_payload "git -cuser.name=x $_verb -m y" "$p")" "feature branch"


# ── #1: every push clause is scanned, a value that expands stays visible, and a
# tag-only publish passes ────────────────────────────────────────────────────
# Three seams found while re-reading the hook for #1, each confirmed against
# the shipped script before the fix:
#   - the any-branch refspec scan read only the FIRST push clause per variant,
#     so `git push origin feat && git push origin master` from a feature branch
#     was allowed;
#   - the flag strip removed a quoted value whole, substitution included, so
#     `git commit -m "$(git push origin master)"` was allowed and the inner push
#     ran;
#   - a tag-only push from a protected branch was denied, so the documented
#     release step was not runnable and tags went through `gh api`.
# The verbs below are assembled from parts so this file cannot trip the guard
# it exercises.
_p="pu""sh"
t="$TMP_ROOT/case_tags"; new_repo "$t"
echo '{"branchPolicy":"pr"}' >"$t/house.json"
git -C "$t" add house.json && git -C "$t" $_verb -q -m house
git -C "$t" tag v1.0
git -C "$t" tag v1.1
git -C "$t" tag dual && git -C "$t" branch dual
bare="$TMP_ROOT/case_tags_remote.git"; git init -q --bare "$bare"
git -C "$t" remote add origin "$bare"

# Tag-only forms, on the protected branch: allowed.
expect_allow "tag-only: bare tag name" \
  "$(mk_payload "git $_p origin v1.0" "$t")"
expect_allow "tag-only: refs/tags form" \
  "$(mk_payload "git $_p origin refs/tags/v1.0" "$t")"
expect_allow "tag-only: tag keyword form" \
  "$(mk_payload "git $_p origin tag v1.0" "$t")"
expect_allow "tag-only: --tags before the remote" \
  "$(mk_payload "git $_p --tags origin" "$t")"
expect_allow "tag-only: --tags after the remote" \
  "$(mk_payload "git $_p origin --tags" "$t")"
expect_allow "tag-only: --tags with no remote" \
  "$(mk_payload "git $_p --tags" "$t")"
expect_allow "tag-only: two tags in one push" \
  "$(mk_payload "git $_p origin v1.0 v1.1" "$t")"
expect_allow "tag-only: chained with a non-push command" \
  "$(mk_payload "git $_p origin v1.0 && gh release create v1.0" "$t")"

# Not tag-only, on the protected branch: every one denies. The grammar is an
# allowlist written in the safe direction, so the entry it forgets is a false
# deny, never a miss.
expect_deny "not tag-only: a name that is both a tag and a branch" \
  "$(mk_payload "git $_p origin dual" "$t")" "feature branch"
expect_deny "not tag-only: --tag (git's abbreviation of --tags)" \
  "$(mk_payload "git $_p --tag origin v1.0" "$t")" "feature branch"
expect_deny "not tag-only: --follow-tags moves the branch too" \
  "$(mk_payload "git $_p --follow-tags origin v1.0" "$t")" "feature branch"
expect_deny "not tag-only: an explicit refspec with a colon" \
  "$(mk_payload "git $_p origin v1.0:refs/heads/main" "$t")"
expect_deny "not tag-only: a tag push chained with a branch push" \
  "$(mk_payload "git $_p origin v1.0 && git $_p origin master" "$t")"
expect_deny "not tag-only: --delete" \
  "$(mk_payload "git $_p origin --delete v1.0" "$t")" "feature branch"
expect_deny "not tag-only: a force flag" \
  "$(mk_payload "git $_p -f origin v1.0" "$t")" "feature branch"
expect_deny "not tag-only: a remote git does not know" \
  "$(mk_payload "git $_p nowhere v1.0" "$t")" "feature branch"
expect_deny "not tag-only: a tag that does not exist" \
  "$(mk_payload "git $_p origin v9.9" "$t")" "feature branch"
expect_deny "not tag-only: a leading plus" \
  "$(mk_payload "git $_p origin +v1.0" "$t")" "feature branch"
expect_deny "not tag-only: no refspec at all" \
  "$(mk_payload "git $_p origin" "$t")" "feature branch"
expect_deny "not tag-only: bare push" \
  "$(mk_payload "git $_p" "$t")" "feature branch"
expect_deny "not tag-only: a dangling tag keyword" \
  "$(mk_payload "git $_p origin tag" "$t")" "feature branch"
expect_deny "the branch-push refusal names the tag-only form" \
  "$(mk_payload "git $_p origin master" "$t")" "Tag-only"

# Every push clause is scanned from any branch, not just the leftmost.
git -C "$t" checkout -q -b feat/x
expect_deny "every clause: && hides a push to master" \
  "$(mk_payload "git $_p origin feat/x && git $_p origin master" "$t")" "protected branch"
expect_deny "every clause: ; hides a push to master" \
  "$(mk_payload "git $_p origin feat/x; git $_p origin master" "$t")" "protected branch"
expect_deny "every clause: & hides a push to master" \
  "$(mk_payload "git $_p origin feat/x & git $_p origin master" "$t")" "protected branch"
expect_deny "every clause: || hides a push to master" \
  "$(mk_payload "git $_p origin feat/x || git $_p origin master" "$t")" "protected branch"
expect_deny "every clause: a newline hides a push to master" \
  "$(mk_payload "git $_p origin feat/x
git $_p origin master" "$t")" "protected branch"
expect_deny "every clause: a pipe hides a push to master" \
  "$(mk_payload "git $_p origin feat/x | cat; git $_p origin master" "$t")" "protected branch"
expect_deny "every clause: a subshell group hides a push to master" \
  "$(mk_payload "(git $_p origin master)" "$t")" "protected branch"
expect_deny "every clause: a redirection glued to the branch name" \
  "$(mk_payload "git $_p origin master>/dev/null" "$t")" "protected branch"
expect_allow "every clause: a later non-push clause naming master is still fine" \
  "$(mk_payload "git $_p origin feat/x; git log master" "$t")"

# A value that would expand is code, not prose, and must stay in the text the
# scans read. Single-quoted values do not expand and stay strippable.
expect_deny "expanding value: double-quoted substitution in -m" \
  "$(mk_payload "$_c -m \"\$(git $_p origin master)\"" "$t")" "protected branch"
expect_deny "expanding value: backticks in -m" \
  "$(mk_payload "$_c -m \"\`git $_p origin master\`\"" "$t")" "protected branch"
expect_deny "expanding value: bare substitution in -m" \
  "$(mk_payload "$_c -m \$(git $_p origin master)" "$t")" "protected branch"
expect_deny "expanding value: substitution glued to a bare word" \
  "$(mk_payload "$_c -m note\$(git $_p origin master)" "$t")" "protected branch"
expect_deny "expanding value: substitution in -F" \
  "$(mk_payload "$_c -F \"\$(git $_p origin master)\"" "$t")" "protected branch"
expect_deny "expanding value: substitution in --message=" \
  "$(mk_payload "$_c --message=\"\$(git $_p origin master)\"" "$t")" "protected branch"
expect_allow "a dollar sign in prose without a verb is still fine" \
  "$(mk_payload "$_c -m \"cost \$5 more\"" "$t")"
expect_allow "a single-quoted message naming the verb does not expand and is stripped" \
  "$(mk_payload "$_c -m 'note: git $_p origin master later'" "$t")"

# A deny whose verb sits only inside a quoted string says so, and points at the
# file route. The decision itself is unchanged: the text still denies.
git -C "$t" checkout -q master
expect_deny "quoted prose: the refusal names the file route" \
  "$(mk_payload "gh issue create --title t --body \"see git $_p origin main for details\"" "$t")" "quoted string"
run_hook "$(mk_payload "$_c -m x" "$t")"
reason=$(printf '%s' "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecisionReason // ""' 2>/dev/null)
if [[ "$reason" == *"feature branch"* && "$reason" != *"quoted string"* ]]; then
  pass "a real verb outside quotes gets no prose hint"
else fail "prose hint on a real verb" "reason: $reason"; fi

# ── #1 review round 1: the fixes above opened seams of their own ──────────
# (1) A clause break at `(`, backtick, `<`, `>` moved everything after the
# character out of the push clause, so a push to master with a substitution
# or a redirection BEFORE the ref was never read. They are spaces now.
git -C "$t" checkout -q feat/x
expect_deny "round 1: a substitution before the ref is still scanned" \
  "$(mk_payload "git $_p \$(echo origin) master" "$t")" "protected branch"
expect_deny "round 1: backticks before the ref are still scanned" \
  "$(mk_payload "git $_p \`echo origin\` master" "$t")" "protected branch"
expect_deny "round 1: a redirection before the ref is still scanned" \
  "$(mk_payload "git $_p >/dev/null origin master" "$t")" "protected branch"
# (2) The expand-aware strip must not reach target resolution: a message value
# holding `$` survived the strip there, and a `cd <sibling> &&` inside it
# pointed the check at a repo on a feature branch.
git -C "$t" checkout -q master
t2="$TMP_ROOT/case_tags_sibling"; new_repo "$t2"
echo '{"branchPolicy":"pr"}' >"$t2/house.json"
git -C "$t2" add house.json && git -C "$t2" $_verb -q -m house
git -C "$t2" checkout -q -b feat/sib
expect_deny "round 1: a dollar-bearing message cannot steer the target (cd)" \
  "$(mk_payload "$_c -m \"cost \$5. cd $t2 && done\"" "$t")" "feature branch"
expect_deny "round 1: a backtick-bearing message cannot steer the target" \
  "$(mk_payload "$_c -m \"see \`x\`. cd $t2 && done\"" "$t")" "feature branch"
expect_deny "round 1: a dollar-bearing message cannot steer the target (-C)" \
  "$(mk_payload "$_c -m \"cost \$5. git -C $t2 status\"" "$t")" "feature branch"
# (3) The carve-out must not turn a push the recogniser cannot read into an
# escape from the protected-branch block.
expect_deny "round 1: a tag push chained with an unrecognised push form" \
  "$(mk_payload "git $_p origin v1.0 && git --git-dir=$t/.git/ $_p origin master" "$t")" "feature branch"
# (4) The refspec scan is the carve-out's safety net: a tag named after a
# protected branch passes the grammar and is still refused there.
git -C "$t" tag main
expect_deny "round 1: a tag named main passes the grammar and the refspec scan refuses it" \
  "$(mk_payload "git $_p origin tag main" "$t")" "protected branch"
# (5) The prose hint stays silent on a substitution: that is code, not prose.
git -C "$t" checkout -q feat/x
run_hook "$(mk_payload "$_c -m \"\$(git $_p origin master)\"" "$t")"
reason=$(printf '%s' "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecisionReason // ""' 2>/dev/null)
if [[ "$reason" == *"protected branch"* && "$reason" != *"quoted string"* ]]; then
  pass "round 1: no prose hint on a substitution"
else fail "prose hint on substitution" "reason: $reason"; fi
git -C "$t" checkout -q master

# ── #1 adversarial round: -c residue, backslashes, pushes that name no branch ──
# (1) A -c value ending in a variable left a residue between `git` and the
# verb, so neither scan variant matched. -c is stripped blind again.
expect_deny "adversarial: -c value ending in a variable still denies on master" \
  "$(mk_payload "git -c user.name=\$USER $_verb -m x" "$t")" "feature branch"
expect_deny "adversarial: attached -c value ending in a variable still denies" \
  "$(mk_payload "git -cuser.name=\$USER $_verb -m x" "$t")" "feature branch"
expect_deny "adversarial: quoted -c value with a substitution still denies on master" \
  "$(mk_payload "git -c a=\"\$(x)\" $_verb -m x" "$t")" "feature branch"
# (2) A backslash ended the push clause, so `v1.0 \master` read as tag-only
# while the shell handed git `master`.
expect_deny "adversarial: a backslash before the ref cannot hide it from the carve-out" \
  "$(mk_payload "git $_p origin v1.0 \\master" "$t")" "feature branch"
expect_deny "adversarial: a line continuation before the ref cannot hide it" \
  "$(mk_payload "git $_p origin v1.0 \\
master" "$t")" "feature branch"
expect_deny "adversarial: --tags with a backslashed branch behind it" \
  "$(mk_payload "git $_p --tags origin \\master" "$t")" "feature branch"
# (3) From any branch: redirection pairs and IFS are not clause ends, and a
# push that names no branch can still move a protected one.
git -C "$t" checkout -q feat/x
expect_deny "adversarial: -c value ending in a variable still denies a push to master" \
  "$(mk_payload "git -c user.name=\$USER $_p origin master" "$t")" "protected branch"
expect_deny "adversarial: a -c value that expands to a push is scanned" \
  "$(mk_payload "git -c a=\$(git $_p origin master) status" "$t")" "protected branch"
expect_deny "adversarial: 2>&1 before the ref does not end the clause" \
  "$(mk_payload "git $_p origin 2>&1 master" "$t")" "protected branch"
expect_deny "adversarial: &> before the ref does not end the clause" \
  "$(mk_payload "git $_p origin &>/dev/null master" "$t")" "protected branch"
expect_deny "adversarial: \${IFS} between remote and ref is a separator" \
  "$(mk_payload "git $_p origin\${IFS}master" "$t")" "protected branch"
expect_deny "adversarial: --all pushes every branch" \
  "$(mk_payload "git $_p --all origin" "$t")" "without naming it"
expect_deny "adversarial: --mirror pushes every branch" \
  "$(mk_payload "git $_p --mirror origin" "$t")" "without naming it"
expect_deny "adversarial: --al, git's abbreviation, is read the same way" \
  "$(mk_payload "git $_p --al origin" "$t")" "without naming it"
expect_deny "adversarial: --prune can delete a protected branch" \
  "$(mk_payload "git $_p --prune origin feat/x" "$t")" "without naming it"
expect_deny "adversarial: a wildcard refspec can match a protected branch" \
  "$(mk_payload "git $_p origin refs/heads/*:refs/heads/*" "$t")" "wildcard"
expect_allow "adversarial: a plain feature push is still fine" \
  "$(mk_payload "git $_p origin feat/x" "$t")"
expect_allow "adversarial: a feature push with 2>&1 after the ref is still fine" \
  "$(mk_payload "git $_p origin feat/x 2>&1" "$t")"
git -C "$t" checkout -q master
echo
echo "passed: $TESTS_PASSED / $TESTS_TOTAL"
if [[ "$TESTS_FAILED" -gt 0 ]]; then
  echo "$TESTS_FAILED case(s) failed."
  exit 1
fi
exit 0
