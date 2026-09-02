#!/usr/bin/env bash
# Bootstrap smoke test: mktemp git repo, house init + render --apply against
# it, run the vendored check there and expect it clean, then corrupt
# house.json and expect the check to fail.
#
# Prefers the REAL modules tree (plugins/house/modules/*/module.json) when
# it has at least one module, since that is the actual package this test
# guards end to end. Falls back to a throwaway one-module fixture plugin dir
# when the real tree is still empty -- it is written by a separate,
# concurrent workflow and may not exist yet at the time this runs. Prints
# which one it used.
#
# Run: bash tests/smoke-bootstrap.sh   (wired as `bash tests/smoke-bootstrap.sh` in ci.yml)
#
# Counts and reports pass/fail; exits non-zero if any check failed.

set -o pipefail

SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REAL_CLI="$REPO_ROOT/plugins/house/scripts/house"
REAL_MODULES_DIR="$REPO_ROOT/plugins/house/modules"

if [[ ! -f "$REAL_CLI" ]]; then
  echo "FATAL: house CLI not found at $REAL_CLI" >&2
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
  printf '  FAIL  %s\n' "$1"
}

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/house-smoke.XXXXXX")"
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

TARGET_REPO="$WORKDIR/target-repo"
mkdir -p "$TARGET_REPO"
git -C "$TARGET_REPO" -c init.defaultBranch=main init -q
echo '# smoke-bootstrap target' > "$TARGET_REPO/README.md"
# Enough tracked files that every default-on module vendors at least one rule.
# The manifest family's F4 flags an enabled module that vendored none, but it
# can only run where a plugin module tree is reachable (a machine with the
# plugin installed at user scope); a CI runner has none, so a README-only
# target passed there and failed everywhere the package was actually in use.
mkdir -p "$TARGET_REPO/scripts" "$TARGET_REPO/tests" "$TARGET_REPO/.github/workflows"
echo '# smoke' > "$TARGET_REPO/CLAUDE.md"
echo 'export const a = 1;' > "$TARGET_REPO/scripts/a.mjs"
echo "import 'node:test';" > "$TARGET_REPO/tests/a.test.mjs"
printf 'name: x\non: workflow_dispatch\n' > "$TARGET_REPO/.github/workflows/x.yml"
git -C "$TARGET_REPO" -c user.email=t@t.com -c user.name=t add -A
git -C "$TARGET_REPO" -c user.email=t@t.com -c user.name=t commit -q -m init

# Pick the CLI to exercise: the real package if its modules tree is
# populated, else a throwaway fixture plugin dir with one module.
HAS_REAL_MODULE="$(find "$REAL_MODULES_DIR" -name module.json 2>/dev/null | head -n 1)"
if [[ -n "$HAS_REAL_MODULE" ]]; then
  echo "smoke-bootstrap: real modules tree is populated ($REAL_MODULES_DIR) -- using it"
  CLI="$REAL_CLI"
else
  echo "smoke-bootstrap: real modules tree is empty -- using a throwaway fixture plugin dir"
  FIXTURE_DIR="$WORKDIR/fixture-plugin"
  mkdir -p "$FIXTURE_DIR/.claude-plugin" "$FIXTURE_DIR/payload" \
           "$FIXTURE_DIR/modules/alpha/rules" "$FIXTURE_DIR/scripts"
  cat > "$FIXTURE_DIR/.claude-plugin/plugin.json" <<'EOF'
{ "name": "house", "version": "0.0.1-smoke" }
EOF
  # Not a no-op: reads --repo's house.json like the real checker does, so
  # the "corrupt house.json -> nonzero exit" assertion below is meaningful
  # even when this fallback fixture (not the real payload/check.mjs) is
  # what got vendored to .house/check.mjs.
  cat > "$FIXTURE_DIR/payload/check.mjs" <<'EOF'
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const repoIdx = process.argv.indexOf('--repo');
const repo = repoIdx !== -1 ? process.argv[repoIdx + 1] : '.';
try {
  JSON.parse(readFileSync(join(repo, 'house.json'), 'utf8'));
} catch (e) {
  console.error(`fake house check: house.json unusable (${e.message})`);
  process.exit(2);
}
console.log('fake house check: ok');
process.exit(0);
EOF
  cat > "$FIXTURE_DIR/modules/alpha/module.json" <<'EOF'
{
  "name": "alpha",
  "default": "on",
  "rules": ["rules/alpha.md"],
  "files": [],
  "configSlots": [],
  "defaultPaths": ["src/**"]
}
EOF
  cat > "$FIXTURE_DIR/modules/alpha/rules/alpha.md" <<'EOF'
## Do the thing
Anchor: none (because fixture)

Body text for the smoke-bootstrap fixture.

## Don't
Anchor: none (because fixture)

Don't do the bad thing.
EOF
  cp "$REAL_CLI" "$FIXTURE_DIR/scripts/house"
  chmod +x "$FIXTURE_DIR/scripts/house"
  CLI="$FIXTURE_DIR/scripts/house"
fi

if node "$CLI" init --repo "$TARGET_REPO" --apply >"$WORKDIR/init.out" 2>&1; then
  pass "house init --apply exits 0"
else
  fail "house init --apply exits 0 (see $WORKDIR/init.out)"
  cat "$WORKDIR/init.out" >&2
fi

if [[ -f "$TARGET_REPO/house.json" ]]; then
  pass "house.json written by init --apply"
else
  fail "house.json written by init --apply"
fi

if node "$CLI" render --repo "$TARGET_REPO" --apply >"$WORKDIR/render.out" 2>&1; then
  pass "house render --apply exits 0"
else
  fail "house render --apply exits 0 (see $WORKDIR/render.out)"
  cat "$WORKDIR/render.out" >&2
fi

if [[ -f "$TARGET_REPO/.house/check.mjs" ]]; then
  pass ".house/check.mjs vendored by render --apply"
else
  fail ".house/check.mjs vendored by render --apply"
fi

if [[ -f "$TARGET_REPO/.house/lock.json" ]]; then
  pass ".house/lock.json vendored by render --apply"
else
  fail ".house/lock.json vendored by render --apply"
fi

# #18: render wrote files git does not track yet. A managed file git cannot
# see is one no other family reads, so the manifest family must say so: a
# warning (exit 0) before `git add`, gone once the files are staged. Only the
# real payload prints this; the fallback fixture checker is a stand-in.
if [[ "$CLI" == "$REAL_CLI" ]]; then
  if node "$TARGET_REPO/.house/check.mjs" --only=manifest --repo "$TARGET_REPO" >"$WORKDIR/check-unstaged.out" 2>&1 \
     && grep -q '\[untracked\]' "$WORKDIR/check-unstaged.out"; then
    pass "check.mjs warns [untracked] for rendered files before git add, and still exits 0"
  else
    fail "check.mjs warns [untracked] for rendered files before git add, and still exits 0 (see $WORKDIR/check-unstaged.out)"
    cat "$WORKDIR/check-unstaged.out" >&2
  fi
  git -C "$TARGET_REPO" -c user.email=t@t.com -c user.name=t add -A
  if node "$TARGET_REPO/.house/check.mjs" --only=manifest --repo "$TARGET_REPO" >"$WORKDIR/check-staged.out" 2>&1 \
     && ! grep -q '\[untracked\]' "$WORKDIR/check-staged.out"; then
    pass "check.mjs [untracked] warning clears once the rendered files are staged"
  else
    fail "check.mjs [untracked] warning clears once the rendered files are staged (see $WORKDIR/check-staged.out)"
    cat "$WORKDIR/check-staged.out" >&2
  fi
fi

# Clean state: the vendored checker's manifest + tamper families must pass.
if node "$TARGET_REPO/.house/check.mjs" --only=manifest,tamper --repo "$TARGET_REPO" >"$WORKDIR/check-clean.out" 2>&1; then
  pass "check.mjs --only=manifest,tamper exits 0 on a freshly rendered repo"
else
  fail "check.mjs --only=manifest,tamper exits 0 on a freshly rendered repo (see $WORKDIR/check-clean.out)"
  cat "$WORKDIR/check-clean.out" >&2
fi

# Corrupt house.json and confirm the checker now fails loudly rather than
# silently passing on unusable state.
printf '{broken' > "$TARGET_REPO/house.json"
if node "$TARGET_REPO/.house/check.mjs" --only=manifest,tamper --repo "$TARGET_REPO" >"$WORKDIR/check-broken.out" 2>&1; then
  fail "check.mjs exits nonzero against a corrupted house.json"
else
  pass "check.mjs exits nonzero against a corrupted house.json"
fi

echo ""
echo "smoke-bootstrap: ${TESTS_PASSED}/${TESTS_TOTAL} passed"

if [[ "$TESTS_FAILED" -gt 0 ]]; then
  exit 1
fi
exit 0
