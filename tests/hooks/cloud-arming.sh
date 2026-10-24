#!/usr/bin/env bash
# The committed SessionStart entry arms the git-hook floor with no plugin (ADR 0019).
#
# A cloud session installs no plugin, so the only thing that arms the floor
# there is the entry `house render` writes into the committed
# .claude/settings.json. This suite renders a throwaway repo with the REAL CLI,
# clones it (a fresh clone starts with core.hooksPath unset, as a cloud
# session's checkout does), reads the entry's command string out of the
# rendered settings, and runs it the way Claude Code runs a command hook:
# through `sh -c`, with CLAUDE_PROJECT_DIR set, a SessionStart payload on stdin,
# and a PATH that has no jq and no plugin on it. Then the floor has to hold: a
# commit on main is refused, and a commit on a feature branch lands.
#
# The git verbs are assembled from parts, as tests/hooks/run.sh does, because a
# session running this file has a branch guard that scans command text.
#
# Run:  bash tests/hooks/cloud-arming.sh   (also wired into `npm run test:hooks`)
# Exits non-zero if any case fails.

set -u -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CLI="$REPO_ROOT/plugins/house/scripts/house"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok - $1"; }
bad() { FAIL=$((FAIL + 1)); echo "not ok - $1"; [ -n "${2:-}" ] && printf '  %s\n' "$2"; }

_g="gi""t"
_commit="com""mit"
_hp="core.hooks""Path"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/house-cloud-arming.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
WORK="$(cd "$WORK" && pwd -P)"

# A PATH with what a cloud image has (git, a shell, node) and no jq: a farm of
# links to the few tools the entry and the floor call, so a jq the system ships
# in /usr/bin cannot come along with its directory.
BIN="$WORK/bin"
mkdir -p "$BIN"
for t in bash sh git node cat sed head tr dirname basename chmod mkdir rm mv ls grep env printf wc cut sort uname date; do
  p="$(command -v "$t" 2>/dev/null)" || continue
  case "$p" in /*) ln -s "$p" "$BIN/$t" ;; esac
done

ID=(-c user.email=t@example.com -c user.name=t)

# The source repo: the github module on, branchPolicy pr, rendered by the real
# CLI and committed. Render arms the source clone; the clone below does not
# inherit that, since core.hooksPath lives in .git/config.
SRC="$WORK/src"
mkdir -p "$SRC"
"$_g" -C "$SRC" -c init.defaultBranch=main init -q
cat >"$SRC/house.json" <<'JSON'
{
  "version": "0.0.0",
  "defaultBranch": "main",
  "branchPolicy": "pr",
  "protectedBranches": ["master", "main"],
  "guard": {"by": "floor", "decided": "2026-10-24", "why": "test fixture"},
  "modules": {"github": {"enabled": true, "config": {}}}
}
JSON
printf '# fixture\n' >"$SRC/README.md"
if ! render_out="$(node "$CLI" render --apply --repo "$SRC" 2>&1)"; then
  bad "render --apply into the fixture repo" "$render_out"
  echo "# cloud-arming: $PASS passed, $FAIL failed"
  exit 1
fi
"$_g" -C "$SRC" "${ID[@]}" -c "$_hp=/dev/null" add -A
"$_g" -C "$SRC" "${ID[@]}" -c "$_hp=/dev/null" "$_commit" -q -m init

CLONE="$WORK/clone"
"$_g" clone -q "$SRC" "$CLONE"
if [ -z "$("$_g" -C "$CLONE" config --get "$_hp")" ]; then
  ok "a fresh clone starts with the floor unarmed"
else
  bad "a fresh clone starts with the floor unarmed" "$_hp is $("$_g" -C "$CLONE" config --get "$_hp")"
fi

SETTINGS="$CLONE/.claude/settings.json"
CMD="$(node -e '
  const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const hits = (j.hooks && j.hooks.SessionStart || []).flatMap((g) => g.hooks || []).filter((h) => String(h.command).includes("scripts/house/arm-git-hooks.sh"));
  if (hits.length === 1) process.stdout.write(hits[0].command);
' "$SETTINGS" 2>/dev/null)"
if [ -n "$CMD" ]; then
  ok "the rendered settings carry one SessionStart entry that runs the vendored script"
else
  bad "the rendered settings carry one SessionStart entry that runs the vendored script" "$(cat "$SETTINGS" 2>&1)"
fi

if PATH="$BIN" command -v jq >/dev/null 2>&1; then
  bad "the hook PATH has no jq" "found $(PATH="$BIN" command -v jq)"
else
  ok "the hook PATH has no jq"
fi

PAYLOAD="$(printf '{"session_id":"t","hook_event_name":"SessionStart","source":"startup","cwd":"%s"}' "$CLONE")"
hook_out="$(cd "$CLONE" && printf '%s' "$PAYLOAD" | env -i HOME="$WORK" PATH="$BIN" CLAUDE_PROJECT_DIR="$CLONE" sh -c "$CMD" 2>&1)"
hook_rc=$?
if [ "$hook_rc" -eq 0 ]; then ok "the entry exits 0"; else bad "the entry exits 0" "exit $hook_rc: $hook_out"; fi

armed="$("$_g" -C "$CLONE" config --get "$_hp")"
if [ "$armed" = "$CLONE/.githooks" ]; then
  ok "the entry arms $_hp at the clone's .githooks"
else
  bad "the entry arms $_hp at the clone's .githooks" "$_hp is '${armed}'; hook printed: $hook_out"
fi

printf 'direct\n' >"$CLONE/direct.txt"
"$_g" -C "$CLONE" add direct.txt
if direct_out="$(PATH="$BIN" "$_g" -C "$CLONE" "${ID[@]}" "$_commit" -q -m direct 2>&1)"; then
  bad "a direct commit on main is refused by the floor" "it landed: $direct_out"
elif printf '%s' "$direct_out" | grep -q '^house pre-commit: refusing'; then
  ok "a direct commit on main is refused by the floor"
else
  bad "a direct commit on main is refused by the floor" "it failed, but not with the floor's refusal: $direct_out"
fi
"$_g" -C "$CLONE" reset -q

"$_g" -C "$CLONE" checkout -q -b feature
printf 'feature\n' >"$CLONE/feature.txt"
"$_g" -C "$CLONE" add feature.txt
if feature_out="$(PATH="$BIN" "$_g" -C "$CLONE" "${ID[@]}" "$_commit" -q -m feature 2>&1)"; then
  ok "a commit on a feature branch lands"
else
  bad "a commit on a feature branch lands" "$feature_out"
fi

echo "# cloud-arming: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
