#!/usr/bin/env bash
# Real-git tests for the vendored git-hook floor:
# plugins/house/modules/github/files/githooks/**.
#
# Every case runs an actual git command in a throwaway repo (mktemp -d) whose
# core.hooksPath points at a copy of the vendored hooks, and asserts on git's
# own exit code and output. Nothing here reimplements the guards' matching:
# what is under test is what git does when the hook says no.
#
# The reference-transaction cases need git 2.28 or newer. On an older git they
# print SKIP and say so, because the hook genuinely does not exist there (ADR
# 0013); CI runs a modern git, so they are enforced somewhere.
#
# Run:  bash tests/githooks/run.sh   (also wired as `npm run test:githooks`)
#
# Exits non-zero if any case fails.

set -o pipefail

SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SRC="$REPO_ROOT/plugins/house/modules/github/files/githooks"

if [[ ! -d "$SRC" ]]; then
  echo "FATAL: vendored hooks not found at $SRC" >&2
  exit 1
fi

TESTS_TOTAL=0
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0

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

skip() {
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  TESTS_SKIPPED=$((TESTS_SKIPPED + 1))
  printf '  SKIP  %s -- %s\n' "$1" "$2"
}

TMP_ROOT=$(mktemp -d)
# shellcheck disable=SC2329 # invoked indirectly via `trap cleanup EXIT` below
cleanup() { chmod -R u+w "$TMP_ROOT" 2>/dev/null; rm -rf "$TMP_ROOT"; }
trap cleanup EXIT

GIT_VERSION=$(git --version | awk '{print $3}')
GIT_MAJOR=${GIT_VERSION%%.*}
GIT_REST=${GIT_VERSION#*.}
GIT_MINOR=${GIT_REST%%.*}
RT_SUPPORTED=0
if [[ "$GIT_MAJOR" -gt 2 ]] || { [[ "$GIT_MAJOR" -eq 2 ]] && [[ "$GIT_MINOR" -ge 28 ]]; }; then
  RT_SUPPORTED=1
fi
RT_WHY="git $GIT_VERSION has no reference-transaction hook (needs 2.28)"

# --- fixture ----------------------------------------------------------------

# install_floor <dir> -- copies the seven vendored files into <dir>/.githooks,
# preserving the .d structure, and makes every one of them executable.
install_floor() {
  local dir="$1" h
  mkdir -p "$dir/.githooks/pre-commit.d" "$dir/.githooks/pre-push.d" \
    "$dir/.githooks/reference-transaction.d"
  for h in pre-commit pre-push reference-transaction house-lib.sh; do
    cp "$SRC/$h" "$dir/.githooks/$h"
  done
  for h in pre-commit pre-push reference-transaction; do
    cp "$SRC/$h.d/10-house-branch" "$dir/.githooks/$h.d/10-house-branch"
  done
  chmod +x "$dir/.githooks/pre-commit" "$dir/.githooks/pre-push" \
    "$dir/.githooks/reference-transaction" "$dir/.githooks/house-lib.sh" \
    "$dir/.githooks"/*.d/10-house-branch
}

arm() { git -C "$1" config core.hooksPath "$1/.githooks"; }
disarm() { git -C "$1" config --unset core.hooksPath 2>/dev/null || true; }

# unguarded <dir> <git args...> -- runs one git command with the floor off, so
# a fixture can be seeded with the state a case needs (an unpushed commit on a
# protected branch, say) without the hooks under test getting a vote.
unguarded() {
  local dir="$1"
  shift
  disarm "$dir"
  git -C "$dir" "$@" >/dev/null 2>&1
  local rc=$?
  arm "$dir"
  return $rc
}

# write_manifest <dir> <policy> [carveOuts-json] -- (re)writes the working-tree
# house.json. Whether that copy has any say is itself under test: the guards
# read the policy from HEAD, so an uncommitted write here must not move them.
#   policy: pr | direct | none (no house.json) | malformed
write_manifest() {
  local dir="$1" policy="$2" carveouts="${3:-[]}"
  case "$policy" in
    none) rm -f "$dir/house.json" ;;
    malformed) printf '{"branchPolicy": "pr",\n' >"$dir/house.json" ;;
    *)
      cat >"$dir/house.json" <<EOF
{
  "branchPolicy": "$policy",
  "protectedBranches": ["master", "main"],
  "carveOuts": $carveouts
}
EOF
      ;;
  esac
}

# init_repo <dir> -- an empty repo on master with the identity every fixture
# needs and nothing else: no manifest, no remote, no floor.
init_repo() {
  local dir="$1"
  mkdir -p "$dir"
  git -C "$dir" init -q
  git -C "$dir" config user.email test@example.com
  git -C "$dir" config user.name "House Floor Test"
  git -C "$dir" config commit.gpgsign false
  git -C "$dir" config advice.detachedHead false
  git -C "$dir" checkout -q -b master
}

# new_adopted_repo <dir> [policy] [carveOuts-json] -- a repo on master with
# house.json, a bare origin that already has master, and the floor armed.
# The seed push happens BEFORE arming, so the remote has master and the
# reference-transaction guard has something to call reachable.
#   policy: pr (default) | direct | none (no house.json) | malformed
new_adopted_repo() {
  local dir="$1" policy="${2:-pr}" carveouts="${3:-[]}"
  init_repo "$dir"
  write_manifest "$dir" "$policy" "$carveouts"

  echo seed >"$dir/seed.txt"
  mkdir -p "$dir/docs" "$dir/src"
  echo doc >"$dir/docs/seed.md"
  echo code >"$dir/src/seed.js"
  git -C "$dir" add -A
  git -C "$dir" commit -q -m seed

  git init -q --bare "$dir.git"
  # The bare repo's default HEAD may name a branch nobody ever pushes, which
  # would make a clone of it check out nothing.
  git -C "$dir.git" symbolic-ref HEAD refs/heads/master
  git -C "$dir" remote add origin "$dir.git"
  git -C "$dir" push -q origin master
  git -C "$dir" fetch -q origin
  git -C "$dir" branch -q --set-upstream-to=origin/master master 2>/dev/null

  install_floor "$dir"
  arm "$dir"
}

# advance_remote <dir> <clone-dir> -- lands a commit on origin/master the way a
# merged PR would: through a second clone that never has the floor armed.
advance_remote() {
  local dir="$1" clone="$2"
  git clone -q "$dir.git" "$clone"
  git -C "$clone" config user.email test@example.com
  git -C "$clone" config user.name "House Floor Test"
  git -C "$clone" config commit.gpgsign false
  echo "from elsewhere" >"$clone/src/remote.js"
  git -C "$clone" add -A
  git -C "$clone" commit -q -m "work landed through a PR"
  git -C "$clone" push -q origin master
}

# stage <dir> <path> <content>
stage() {
  local dir="$1" path="$2"
  mkdir -p "$(dirname "$dir/$path")"
  printf '%s\n' "$3" >"$dir/$path"
  git -C "$dir" add "$path"
}

# --- assertions -------------------------------------------------------------

RUN_OUT=""
RUN_CODE=0

# run_git <dir> <args...>
run_git() {
  local dir="$1"
  shift
  RUN_OUT=$(git -C "$dir" "$@" 2>&1)
  RUN_CODE=$?
}

# expect_ok <label> <dir> <args...>
expect_ok() {
  local label="$1"
  shift
  run_git "$@"
  if [[ "$RUN_CODE" -eq 0 ]]; then
    pass "$label"
  else
    fail "$label" "expected git to succeed, got exit $RUN_CODE: $RUN_OUT"
  fi
}

# expect_refused <label> <substring> <dir> <args...>
expect_refused() {
  local label="$1" want="$2"
  shift 2
  run_git "$@"
  if [[ "$RUN_CODE" -eq 0 ]]; then
    fail "$label" "expected git to be refused, it succeeded: $RUN_OUT"
    return
  fi
  if [[ -n "$want" && "$RUN_OUT" != *"$want"* ]]; then
    fail "$label" "refusal did not mention [$want]: $RUN_OUT"
    return
  fi
  pass "$label"
}

echo "=== house git-hook floor: real-git tests ==="
echo "hooks:  $SRC"
echo "git:    $GIT_VERSION (reference-transaction supported: $([[ $RT_SUPPORTED -eq 1 ]] && echo yes || echo no))"
echo

# --- 1. pre-commit ----------------------------------------------------------
echo "-- pre-commit --"

r="$TMP_ROOT/c01"; new_adopted_repo "$r"
stage "$r" "src/a.js" "one"
expect_refused "commit on master is refused" "needs a PR" "$r" commit -m "on master"

# The same fixture, on a feature branch: the floor has nothing to say.
git -C "$r" checkout -q -b feat/x
expect_ok "commit on feat/x passes" "$r" commit -m "on a feature branch"

# --- 2. carve-outs ----------------------------------------------------------
echo "-- carve-outs --"

r="$TMP_ROOT/c02"; new_adopted_repo "$r" pr '["docs/*"]'
stage "$r" "docs/a.md" "carved out"
expect_ok "carve-out: commit on master touching only docs/ passes" "$r" commit -m "docs only"

stage "$r" "docs/b.md" "carved out"
stage "$r" "src/b.js" "not carved out"
expect_refused "carve-out: one uncarved path refuses the whole commit" "needs a PR" \
  "$r" commit -m "docs and src"

r="$TMP_ROOT/c03"; new_adopted_repo "$r" pr '["docs/*"]'
expect_refused "carve-out: an empty commit on master is refused" "needs a PR" \
  "$r" commit --allow-empty -m "empty"

# --- 3. pre-push ------------------------------------------------------------
echo "-- pre-push --"

r="$TMP_ROOT/c04"; new_adopted_repo "$r"
git -C "$r" checkout -q -b feat/x
stage "$r" "src/f.js" "feature work"
git -C "$r" commit -q -m "feature work"
expect_ok "push a feature branch passes" "$r" push -q origin feat/x
expect_refused "push HEAD:master from a feature branch is refused" "needs a PR" \
  "$r" push origin HEAD:master
expect_refused "push a feature branch onto refs/heads/master is refused" "needs a PR" \
  "$r" push origin feat/x:refs/heads/master
expect_ok "push a glob refspec of feature branches passes" \
  "$r" push origin 'refs/heads/feat/*:refs/heads/feat/*'

# F3: a freshly adopted repo has to be able to publish its protected branch
# once. The remote here has master but no main, so this creates it.
expect_ok "creating a protected branch the remote does not have yet passes" \
  "$r" push -q origin feat/x:refs/heads/main
expect_refused "deleting that protected branch on the remote is still refused" \
  "needs a PR" "$r" push origin --delete main

# A fixture whose master is ahead of the remote, seeded with the floor off:
# with nothing to push git never calls pre-push, so the ahead state is what
# makes these cases real.
r="$TMP_ROOT/c05"; new_adopted_repo "$r"
echo "local only" >"$r/src/local.js"
unguarded "$r" add -A
unguarded "$r" commit -m "unpushed work on master"
expect_refused "push master from master is refused" "needs a PR" "$r" push origin master

git -C "$r" config push.default upstream
expect_refused "a bare push on master (push.default=upstream) is refused" "needs a PR" \
  "$r" push
git -C "$r" config --unset push.default

git -C "$r" config alias.pm "push origin master"
expect_refused "an alias for the push is refused (git expands it before the hook)" \
  "needs a PR" "$r" pm
git -C "$r" config --unset alias.pm

RUN_OUT=$(echo "push origin master" | (cd "$r" && xargs git) 2>&1)
RUN_CODE=$?
if [[ "$RUN_CODE" -ne 0 && "$RUN_OUT" == *"needs a PR"* ]]; then
  pass "the push through xargs is refused"
else
  fail "the push through xargs is refused" "exit $RUN_CODE: $RUN_OUT"
fi

expect_refused "deleting master on the remote is refused" "needs a PR" \
  "$r" push origin --delete master

git -C "$r" tag v1.0.0
expect_ok "pushing a tag from master passes" "$r" push -q origin v1.0.0
git -C "$r" tag v1.0.1
expect_ok "push --tags from master passes" "$r" push -q --tags

# --- 4. the --no-verify escape ----------------------------------------------
echo "-- the --no-verify escape --"

if [[ "$RT_SUPPORTED" -eq 1 ]]; then
  skip "--no-verify commits on master, then the push is refused" \
    "git $GIT_VERSION refuses the commit itself in the reference-transaction case below"
else
  r="$TMP_ROOT/c06"; new_adopted_repo "$r"
  stage "$r" "src/skip.js" "bypassed"
  expect_ok "--no-verify skips pre-commit on master (the documented human escape)" \
    "$r" commit --no-verify -m "bypassed"
  expect_refused "the push of that bypassed commit is still refused" "needs a PR" \
    "$r" push origin master
fi

# --- 5. the dispatcher ------------------------------------------------------
echo "-- dispatcher --"

r="$TMP_ROOT/c07"; new_adopted_repo "$r"
git -C "$r" checkout -q -b feat/x
cat >"$r/.githooks/pre-commit.d/50-marker" <<EOF
#!/usr/bin/env bash
printf 'ran\n' >"$r/marker.txt"
exit 0
EOF
chmod -x "$r/.githooks/pre-commit.d/50-marker"
cat >"$r/.githooks/pre-commit.d/90-skipme.disabled" <<EOF
#!/usr/bin/env bash
printf 'ran\n' >"$r/disabled-marker.txt"
exit 0
EOF
chmod +x "$r/.githooks/pre-commit.d/90-skipme.disabled"
stage "$r" "src/d.js" "dispatch"
run_git "$r" commit -m "dispatch"
if [[ "$RUN_CODE" -ne 0 ]]; then
  fail "a non-executable .d hook still runs" "commit failed: $RUN_OUT"
elif [[ ! -f "$r/marker.txt" ]]; then
  fail "a non-executable .d hook still runs" "the hook did not run"
else
  pass "a non-executable .d hook still runs"
fi
if [[ "$RUN_OUT" == *"50-marker"* && "$RUN_OUT" == *"chmod +x"* ]]; then
  pass "the dispatcher warns by name about the non-executable hook"
else
  fail "the dispatcher warns by name about the non-executable hook" "$RUN_OUT"
fi
if [[ -f "$r/disabled-marker.txt" ]]; then
  fail "a .disabled hook is skipped" "it ran anyway"
else
  pass "a .disabled hook is skipped"
fi

cat >"$r/.githooks/pre-commit.d/60-fail" <<'EOF'
#!/usr/bin/env bash
printf 'sixty says no\n' >&2
exit 3
EOF
chmod +x "$r/.githooks/pre-commit.d/60-fail"
stage "$r" "src/e.js" "dispatch again"
expect_refused "a .d hook exiting non-zero stops the commit, and its stderr shows" \
  "sixty says no" "$r" commit -m "dispatch again"

# F4: the branch guard runs before anything else in the .d directory. Name
# order alone would let an unmanaged `00-` hook run first, and the first hook
# to run is the one that can delete the guard behind it.
r="$TMP_ROOT/c07b"; new_adopted_repo "$r"
for n in 00-mine 20-after; do
  cat >"$r/.githooks/pre-commit.d/$n" <<EOF
#!/usr/bin/env bash
printf '%s\n' "$n" >>"$r/order.log"
exit 0
EOF
  chmod +x "$r/.githooks/pre-commit.d/$n"
done
stage "$r" "src/o.js" "ordering"
run_git "$r" commit -m "ordering"
if [[ "$RUN_CODE" -eq 0 ]]; then
  fail "the branch guard runs before an unmanaged 00- hook" "the commit succeeded: $RUN_OUT"
elif [[ -e "$r/order.log" ]]; then
  fail "the branch guard runs before an unmanaged 00- hook" \
    "00-mine ran before the guard refused: $(cat "$r/order.log")"
else
  pass "the branch guard runs before an unmanaged 00- hook"
fi

git -C "$r" checkout -q -b feat/x
run_git "$r" commit -m "ordering on a feature branch"
if [[ "$RUN_CODE" -ne 0 ]]; then
  fail "the other .d hooks still run in name order" "commit failed: $RUN_OUT"
elif [[ "$(tr '\n' ' ' <"$r/order.log" 2>/dev/null)" != "00-mine 20-after " ]]; then
  fail "the other .d hooks still run in name order" \
    "order.log was [$(tr '\n' ' ' <"$r/order.log" 2>/dev/null)]"
else
  pass "the other .d hooks still run in name order"
fi

# --- 6. manifest handling ---------------------------------------------------
echo "-- manifest --"

r="$TMP_ROOT/c08"; new_adopted_repo "$r" none
stage "$r" "src/a.js" "no manifest"
expect_ok "no house.json: a commit on master passes (fail open)" "$r" commit -m "no manifest"

r="$TMP_ROOT/c09"; new_adopted_repo "$r" direct
stage "$r" "src/a.js" "direct policy"
expect_ok "branchPolicy direct: a commit on master passes" "$r" commit -m "direct"

r="$TMP_ROOT/c10"; new_adopted_repo "$r" malformed
stage "$r" "src/a.js" "malformed manifest"
expect_refused "malformed house.json: a commit on master is refused, naming the file" \
  "house.json" "$r" commit -m "malformed"

# --- 7. no jq, no node ------------------------------------------------------
echo "-- json readers --"

# make_path_dir <dir> <tool...> -- a PATH holding only the named tools, as
# symlinks, so a case can take jq or node away from the hooks.
make_path_dir() {
  local dir="$1" t src
  shift
  mkdir -p "$dir"
  for t in "$@"; do
    src=$(command -v "$t" 2>/dev/null) || continue
    ln -sf "$src" "$dir/$t"
  done
}

BASE_TOOLS=(env bash sh git cat sed grep awk dirname basename ls rm mv cp mkdir
  chmod printf sort tr wc head tail uname expr date diff true false find xargs)

if command -v node >/dev/null 2>&1; then
  r="$TMP_ROOT/c11"; new_adopted_repo "$r"
  make_path_dir "$TMP_ROOT/bin-node" "${BASE_TOOLS[@]}" node
  stage "$r" "src/a.js" "node only"
  RUN_OUT=$(cd "$r" && env PATH="$TMP_ROOT/bin-node" git commit -m "node only" 2>&1)
  RUN_CODE=$?
  if [[ "$RUN_CODE" -ne 0 && "$RUN_OUT" == *"needs a PR"* ]]; then
    pass "jq absent, node present: the floor still enforces"
  else
    fail "jq absent, node present: the floor still enforces" "exit $RUN_CODE: $RUN_OUT"
  fi
else
  skip "jq absent, node present: the floor still enforces" "node is not on PATH"
fi

r="$TMP_ROOT/c12"; new_adopted_repo "$r"
make_path_dir "$TMP_ROOT/bin-bare" "${BASE_TOOLS[@]}"
stage "$r" "src/a.js" "no reader"
RUN_OUT=$(cd "$r" && env PATH="$TMP_ROOT/bin-bare" git commit -m "no reader" 2>&1)
RUN_CODE=$?
if [[ "$RUN_CODE" -ne 0 && "$RUN_OUT" == *"neither jq nor node"* ]]; then
  pass "neither jq nor node: the floor refuses and names the fix"
else
  fail "neither jq nor node: the floor refuses and names the fix" "exit $RUN_CODE: $RUN_OUT"
fi

# --- 8. reference-transaction ------------------------------------------------
echo "-- reference-transaction --"

if [[ "$RT_SUPPORTED" -ne 1 ]]; then
  for label in \
    "a merge commit on master is refused" \
    "commit --amend --no-verify on master is refused" \
    "a cherry-pick onto master is refused" \
    "reset --hard origin/master is allowed" \
    "a fast-forward pull on master is allowed" \
    "a fetch is allowed" \
    "deleting the local master branch is allowed" \
    "update-ref moving master to an unpublished commit is refused" \
    "branch -f master origin/master is allowed" \
    "pack-refs --all with master ahead of the remote is allowed" \
    "reset --hard HEAD with master ahead of the remote is allowed" \
    "stash push with master ahead of the remote is allowed" \
    "gc packs refs with master ahead of the remote" \
    "branch -f master master, a no-op force update, is allowed" \
    "worktree add on a protected branch ahead of the remote is allowed" \
    "fetch origin master:master is allowed and moves master"
  do
    skip "$label" "$RT_WHY"
  done
else
  # A merge commit on master is local work the remote has never seen.
  r="$TMP_ROOT/c13"; new_adopted_repo "$r"
  git -C "$r" checkout -q -b feat/x
  stage "$r" "src/m.js" "merge me"
  git -C "$r" commit -q -m "merge me"
  git -C "$r" checkout -q master
  expect_refused "a merge commit on master is refused" "no remote has" \
    "$r" merge --no-ff -m "merge feat/x" feat/x
  git -C "$r" merge --abort 2>/dev/null

  # --no-verify skips pre-commit; it does not skip the ref transaction.
  r="$TMP_ROOT/c14"; new_adopted_repo "$r"
  expect_refused "commit --amend --no-verify on master is refused" "no remote has" \
    "$r" commit --amend --no-verify -m "amended seed"

  r="$TMP_ROOT/c15"; new_adopted_repo "$r"
  git -C "$r" checkout -q -b feat/x
  stage "$r" "src/p.js" "pick me"
  git -C "$r" commit -q -m "pick me"
  pick=$(git -C "$r" rev-parse HEAD)
  git -C "$r" checkout -q master
  expect_refused "a cherry-pick onto master is refused" "no remote has" \
    "$r" cherry-pick "$pick"
  git -C "$r" cherry-pick --abort 2>/dev/null

  # Landing master back on what the remote has is always allowed.
  r="$TMP_ROOT/c16"; new_adopted_repo "$r"
  echo "local only" >"$r/src/local.js"
  unguarded "$r" add -A
  unguarded "$r" commit -m "unpushed work on master"
  expect_ok "reset --hard origin/master is allowed" "$r" reset --hard origin/master

  # A fast-forward pull: the remote moved first, so the new tip is reachable
  # from origin/master by the time refs/heads/master is updated.
  r="$TMP_ROOT/c17"; new_adopted_repo "$r"
  advance_remote "$r" "$TMP_ROOT/c17-clone"
  expect_ok "a fetch is allowed" "$r" fetch -q origin
  run_git "$r" pull -q --ff-only
  if [[ "$RUN_CODE" -ne 0 ]]; then
    fail "a fast-forward pull on master is allowed" "exit $RUN_CODE: $RUN_OUT"
  elif [[ ! -f "$r/src/remote.js" ]]; then
    # Guards against a vacuous pass: with nothing to pull, `pull --ff-only`
    # exits 0 without ever moving refs/heads/master.
    fail "a fast-forward pull on master is allowed" "the pull moved nothing"
  else
    pass "a fast-forward pull on master is allowed"
  fi

  r="$TMP_ROOT/c18"; new_adopted_repo "$r"
  git -C "$r" checkout -q -b feat/x
  expect_ok "deleting the local master branch is allowed" "$r" branch -D master

  r="$TMP_ROOT/c19"; new_adopted_repo "$r"
  git -C "$r" checkout -q -b feat/x
  stage "$r" "src/u.js" "unpublished"
  git -C "$r" commit -q -m "unpublished"
  unpublished=$(git -C "$r" rev-parse HEAD)
  expect_refused "update-ref moving master to an unpublished commit is refused" \
    "no remote has" "$r" update-ref refs/heads/master "$unpublished"
  expect_ok "branch -f master origin/master is allowed" \
    "$r" branch -f master origin/master

  # F1: a transaction that does not MOVE the protected branch is not this
  # guard's business, however far ahead of the remote that branch is. git
  # rewrites a ref to its own value all the time (pack-refs, gc, reset to the
  # current tip, stash, worktree add, a no-op `branch -f`), and refusing those
  # broke plumbing that has nothing to do with the branch policy.
  r="$TMP_ROOT/c21"; new_adopted_repo "$r"
  echo "local only" >"$r/src/local.js"
  unguarded "$r" add -A
  unguarded "$r" commit -m "unpushed work on master"
  expect_ok "pack-refs --all with master ahead of the remote is allowed" \
    "$r" pack-refs --all
  expect_ok "reset --hard HEAD with master ahead of the remote is allowed" \
    "$r" reset --hard HEAD
  echo "dirty" >>"$r/src/seed.js"
  expect_ok "stash push with master ahead of the remote is allowed" \
    "$r" stash push -m "work in progress"
  # gc exits 0 even when its pack-refs transaction is aborted, so the exit code
  # alone would pass vacuously; the refusal text is the real assertion.
  run_git "$r" gc --quiet
  if [[ "$RUN_CODE" -eq 0 && "$RUN_OUT" != *"house reference-transaction"* ]]; then
    pass "gc packs refs with master ahead of the remote"
  else
    fail "gc packs refs with master ahead of the remote" "exit $RUN_CODE: $RUN_OUT"
  fi

  r="$TMP_ROOT/c22"; new_adopted_repo "$r"
  echo "local only" >"$r/src/local.js"
  unguarded "$r" add -A
  unguarded "$r" commit -m "unpushed work on master"
  git -C "$r" checkout -q -b feat/x
  expect_ok "branch -f master master, a no-op force update, is allowed" \
    "$r" branch -f master master
  expect_ok "worktree add on a protected branch ahead of the remote is allowed" \
    "$r" worktree add -q "$TMP_ROOT/c22-wt" master

  # F2: the same transaction publishes the remote-tracking ref, so the remote
  # does have this commit. `git fetch origin master:master` is the shape.
  r="$TMP_ROOT/c23"; new_adopted_repo "$r"
  advance_remote "$r" "$TMP_ROOT/c23-clone"
  landed=$(git -C "$TMP_ROOT/c23-clone" rev-parse HEAD)
  git -C "$r" checkout -q -b feat/x
  run_git "$r" fetch origin master:master
  if [[ "$RUN_CODE" -ne 0 ]]; then
    fail "fetch origin master:master is allowed and moves master" "exit $RUN_CODE: $RUN_OUT"
  elif [[ "$(git -C "$r" rev-parse master)" != "$landed" ]]; then
    fail "fetch origin master:master is allowed and moves master" "master did not move"
  else
    pass "fetch origin master:master is allowed and moves master"
  fi
fi

# --- 9. the policy is read from HEAD, not from the working tree --------------
echo "-- policy source --"

# One Write to house.json must not turn the floor off. The committed manifest
# is the policy; a working-tree edit only counts once it lands on the protected
# branch, which takes the PR this guard is asking for.
r="$TMP_ROOT/c24"; new_adopted_repo "$r" pr
write_manifest "$r" direct
stage "$r" "src/a.js" "policy rewritten in the working tree"
expect_refused "an uncommitted branchPolicy: direct does not weaken the floor" \
  "needs a PR" "$r" commit -m "sneaky"

# The mirror, so the rule reads as "HEAD is the source" and not as "take the
# stricter of the two": a committed `direct` policy is honoured.
r="$TMP_ROOT/c25"; new_adopted_repo "$r" direct
write_manifest "$r" pr
stage "$r" "src/a.js" "policy tightened in the working tree only"
expect_ok "an uncommitted branchPolicy: pr does not arm a direct-policy repo" \
  "$r" commit -m "direct policy stands"

# pre-push reads the policy from the commit the REMOTE has, so a push cannot
# carry the manifest that would have allowed it.
r="$TMP_ROOT/c26"; new_adopted_repo "$r" pr
write_manifest "$r" direct
unguarded "$r" add -A
unguarded "$r" commit -m "weaken the policy on master"
expect_refused "a pushed commit cannot carry its own weaker policy" \
  "needs a PR" "$r" push origin master

# A repo that adopts house before its first commit has no HEAD to read, so the
# working-tree manifest is the only source there is.
r="$TMP_ROOT/c27"; init_repo "$r"
write_manifest "$r" pr
install_floor "$r"
arm "$r"
stage "$r" "src/a.js" "first commit ever"
expect_refused "before the first commit the working-tree house.json is read" \
  "needs a PR" "$r" commit -m "initial"

# --- 10. escapes and machine state -------------------------------------------
echo "-- escapes --"

# A commit that never saw the hooks at all (any git, any means) is still stopped
# at the push. This is the modern-git counterpart of the --no-verify case above,
# which git 2.28+ refuses at the ref transaction instead.
r="$TMP_ROOT/c28"; new_adopted_repo "$r"
mkdir -p "$TMP_ROOT/c28-nohooks"
stage "$r" "src/skip.js" "landed by other means"
run_git "$r" -c core.hooksPath="$TMP_ROOT/c28-nohooks" commit -m "no hooks ran"
if [[ "$RUN_CODE" -ne 0 ]]; then
  fail "a commit made with the hooks switched off is refused at push" \
    "the seeding commit itself failed: $RUN_OUT"
else
  expect_refused "a commit made with the hooks switched off is refused at push" \
    "needs a PR" "$r" push origin master
fi

# core.hooksPath is machine state, and a config include can set it: this pins
# that `git config --get` (what house doctor and the PreToolUse hook read)
# reports the included value, so a disarmed clone reads as disarmed.
r="$TMP_ROOT/c29"; new_adopted_repo "$r"
printf '[core]\n\thooksPath = /dev/null\n' >"$r/.git/extra-config"
git -C "$r" config include.path ./extra-config
run_git "$r" config --get core.hooksPath
if [[ "$RUN_CODE" -eq 0 && "$RUN_OUT" == "/dev/null" ]]; then
  pass "an include.path that sets core.hooksPath is what git config reports"
else
  fail "an include.path that sets core.hooksPath is what git config reports" \
    "exit $RUN_CODE: $RUN_OUT"
fi

# --- 11. worktrees share the hooks path --------------------------------------
echo "-- worktrees --"

r="$TMP_ROOT/c20"; new_adopted_repo "$r"
git -C "$r" checkout -q -b feat/x
if git -C "$r" worktree add -q "$TMP_ROOT/c20-wt" master 2>/dev/null; then
  stage "$TMP_ROOT/c20-wt" "src/w.js" "from a worktree"
  expect_refused "a commit on master from a linked worktree is refused" "needs a PR" \
    "$TMP_ROOT/c20-wt" commit -m "from a worktree"
else
  fail "a commit on master from a linked worktree is refused" "could not add the worktree"
fi

echo
printf 'total %d, passed %d, failed %d, skipped %d\n' \
  "$TESTS_TOTAL" "$TESTS_PASSED" "$TESTS_FAILED" "$TESTS_SKIPPED"
[[ "$TESTS_FAILED" -eq 0 ]] || exit 1
exit 0
