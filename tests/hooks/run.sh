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

echo
echo "passed: $TESTS_PASSED / $TESTS_TOTAL"
if [[ "$TESTS_FAILED" -gt 0 ]]; then
  echo "$TESTS_FAILED case(s) failed."
  exit 1
fi
exit 0
