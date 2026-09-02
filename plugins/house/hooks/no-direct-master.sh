#!/usr/bin/env bash
# PreToolUse hook for Bash: enforce the branch+PR workflow for repos that
# have adopted house and opted a policy in via <toplevel>/house.json.
#
# Blocks:
#   - `git commit ...` while the target worktree is on a protected branch
#   - `git push ...`   while the target worktree is on a protected branch
#   - `git push <args> <protected>` whose refspec targets a protected branch
#
# Fails OPEN (allow, exit 0) whenever:
#   - the payload/command isn't a git invocation
#   - the target directory is not inside a git repo
#   - <toplevel>/house.json is absent (repo has not adopted house)
#   - house.json sets "branchPolicy": "direct"
#   - the target repo has its OWN .claude/hooks/no-direct-master.sh, or its
#     own .claude/settings.json declares a non-empty .hooks.PreToolUse
#     array (repo-local guard wins during migration onto house; a
#     settings.json carrying only other events is not a branch guard and
#     does not defer this one)
#
# Fails CLOSED (deny) whenever jq is missing (cannot parse the payload, so
# cannot tell a safe command from a dangerous one) and whenever an
# unexpected internal failure happens after the policy has been read (see
# the trap below). Those are the only two deny-without-a-specific-rule
# paths; every other deny names the offending branch and rule source.
#
# Worktree-aware: parses the command for `git -C <path>`, `cd <path> &&`,
# and `cd <path> ;` so a command targeting a sibling worktree is checked
# against THAT worktree's branch and toplevel, not the hook's own cwd.
#
# Quote-aware: strips single- and double-quoted string contents (and shell
# comments) before pattern matching, so `git commit -m "fix master bug"`
# on a feature branch can't false-positive on the literal word "master".
#
# Carve-out aware: house.json may declare `carveOuts` (an array of glob
# patterns). On a protected branch, a commit or push is allowed anyway if
# EVERY path in the relevant diff matches at least one carve-out glob
# under shell `case` semantics (`*` crosses `/`). An empty diff list never
# satisfies a carve-out; it denies, because "nothing staged" is not
# evidence the change is carve-out-only.
#
# Reads the standard Claude Code PreToolUse JSON payload on stdin and emits
# a `permissionDecision: deny` object (exit 0) to refuse the tool call, or
# silently exits 0 to allow it.
#
# Bash 3.2 compatible (macOS ships 3.2 as /bin/bash): no associative
# arrays, no `mapfile`.
#
# `-E` (errtrace) is required, not decorative: without it, `trap ... ERR`
# does not propagate into shell functions (is_protected_branch,
# carve_out_satisfied below), so a failure inside one would silently pass
# instead of tripping the crash-deny path. Deliberately no `-e`: the trap
# alone already fires on an unguarded failing command in a non-exempted
# context (verified against this bash), and skipping `-e` means a stray
# failure BEFORE the trap is armed (see below) just falls through to the
# final `exit 0`, i.e. fails open, which is what steps 2-3 want anyway.
set -Euo pipefail

payload=$(cat)

# Cheap early exit, before any jq work: if the raw payload text doesn't
# even contain "git", tool_input.command can't be a git invocation either,
# so there is nothing to check. String match before any jq where possible:
# this skips spawning jq entirely for the large majority of Bash calls,
# and for every non-Bash payload this hook is ever handed.
case "$payload" in
  *git*) ;;
  *) exit 0 ;;
esac

# jq is a hard dependency for parsing the stdin payload and house.json. If
# it's missing, we cannot read tool_input.command at all, which means we
# cannot tell a safe command from a dangerous one. Fail CLOSED: deny
# outright rather than let the harness treat a crash as "hook produced no
# decision" (non-blocking, i.e. the guard silently vanishes). This decision
# is hand-written JSON, not built with jq, since jq is exactly what's
# missing.
if ! command -v jq >/dev/null 2>&1; then
  cat <<'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "This hook could not find jq, so it cannot parse the command to check whether it targets a protected branch. Refusing git commands until jq is installed, rather than letting them through unchecked. Install jq: 'brew install jq' (macOS) or 'apt-get install jq' (Debian/Ubuntu), then retry."
  }
}
EOF
  exit 0
fi

cmd=$(jq -r '.tool_input.command // ""' <<<"$payload" 2>/dev/null || echo "")

# Precise re-check on the parsed field (the raw-text prefilter above can
# false-positive, e.g. a cwd path containing "git" with a non-git command).
case "$cmd" in
  *git*) ;;
  *) exit 0 ;;
esac

deny() {
  jq -n --arg msg "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $msg
    }
  }'
  exit 0
}

# Fires on any unexpected internal failure once armed (see the `trap`
# call below, which is deliberately deferred until after the policy read).
# Hand-written JSON, not jq, and disables its own trap first: if something
# inside THIS handler ever failed, jq is the most likely culprit, and
# retriggering the same ERR trap from inside its own handler would recurse.
# shellcheck disable=SC2329 # invoked indirectly via `trap crashed ERR` below
crashed() {
  trap - ERR
  cat <<'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "house guard crashed; refusing rather than guessing"
  }
}
EOF
  exit 0
}

# True if branch $1 appears in the newline-delimited protected-branch list
# in $protected_list (set below, once house.json's policy has been read).
is_protected_branch() {
  local b="$1" p
  while IFS= read -r p; do
    [[ -z "$p" ]] && continue
    [[ "$b" == "$p" ]] && return 0
  done <<<"$protected_list"
  return 1
}

# True (0) only if carve_outs (set below) is non-empty AND every
# newline-delimited path in $1 matches at least one carve-out glob, under
# shell `case` semantics (`*` crosses `/`). An empty diff never satisfies
# a carve-out, so "nothing staged" cannot be mistaken for "carve-out-only".
carve_out_satisfied() {
  local diff_paths="$1"
  [[ -z "$carve_outs" ]] && return 1
  [[ -z "$diff_paths" ]] && return 1
  local path glob ok
  while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    ok=1
    while IFS= read -r glob; do
      [[ -z "$glob" ]] && continue
      # Intentional unquoted glob expansion: $glob is a house.json-provided
      # pattern, matched as a shell glob (so `*` crosses `/`), not a
      # literal string.
      # shellcheck disable=SC2254
      case "$path" in
        $glob) ok=0; break ;;
      esac
    done <<<"$carve_outs"
    [[ "$ok" -ne 0 ]] && return 1
  done <<<"$diff_paths"
  return 0
}

# Remove flag-borne arguments (a quoted or bare value, `=`-joined or not) whose
# ALTERNATION is passed in, so their text can neither trigger nor defeat a
# match. Single-pass, not a full shell parser. One helper so the stripped and
# the -c-retaining variants below can never desynchronize their sed rules.
_strip_flag_args() {
  printf '%s' "$2" | sed -E "
    s/($1)=?[[:space:]]*'[^']*'//g;
    s/($1)=?[[:space:]]*\"[^\"]*\"//g;
    s/($1)=?[[:space:]]*[^[:space:]'\"]+//g"
}
# Full strip, including -c. Used for target resolution, where a -c value must
# not be allowed to steer the target.
strip_message_args() { _strip_flag_args '-m|--message|-F|--file|-c' "$1"; }
# The same strip with -c RETAINED. An interpreter's -c body is code that will
# run (`bash -c 'git commit -m x'`), not prose, so the verb scans below must
# see it; stripping it blinded them to every interpreter since v0.2.2 (#27).
# git's own `git -c key=value commit` with a space-free value still denies
# through the full strip, so scanning the UNION of the two variants can only
# add denials, never remove one. Known still-open (#27, NOT closed here): a
# quoted -c value containing spaces (`git -c a='b c' commit`) survives the
# bare-value rule and a -c body that changes directory into another repo is
# target-blind. Those are the parser seams #27 warns against chasing; this
# change closes only the direct-interpreter case.
strip_flag_args_keep_dash_c() { _strip_flag_args '-m|--message|-F|--file' "$1"; }

# Resolve the target git directory:
#   1. `git -C <path> ...`         -> use <path>
#   2. `cd <path> && git ...`      -> use <path>
#   3. `cd <path> ; git ...`       -> use <path>
#   4. otherwise                   -> use tool_input.cwd from the payload,
#      falling back to "." (the hook process's own cwd)
# Resolved against the message-stripped command: text inside a commit
# message (`-m "note: cd /nonexistent && push"`) must not be able to point
# the check at a non-repo path, because a non-repo path is a deliberate
# fail-open below and quoted prose would turn it into a disarm.
cmd_for_target=$(strip_message_args "$cmd")
target_dir=""
if [[ "$cmd_for_target" =~ git[[:space:]]+-C[[:space:]]+([^[:space:]]+) ]]; then
  target_dir="${BASH_REMATCH[1]}"
elif [[ "$cmd_for_target" =~ (^|[^[:alnum:]])cd[[:space:]]+([^[:space:]&;|]+)[[:space:]]*(\&\&|;) ]]; then
  target_dir="${BASH_REMATCH[2]}"
fi

# Where the target came from matters below: a path parsed OUT OF THE COMMAND
# is a guess, and a wrong guess must not be allowed to stand in for the real
# working directory.
target_from_command=0
[[ -n "$target_dir" ]] && target_from_command=1

# Tilde expansion + strip surrounding quotes.
target_dir="${target_dir/#\~/$HOME}"
target_dir="${target_dir%\"}"; target_dir="${target_dir#\"}"
target_dir="${target_dir%\'}"; target_dir="${target_dir#\'}"

payload_cwd=$(jq -r '.cwd // ""' <<<"$payload" 2>/dev/null || echo "")
if [[ -z "$target_dir" ]]; then
  target_dir="$payload_cwd"
fi
[[ -z "$target_dir" ]] && target_dir="."

# Successive -C compose, and an absolute second path still wins, so this
# resolves a RELATIVE guess (`cd ../other-repo`) against the directory the
# command actually runs in rather than against whatever cwd the hook process
# happens to have. Without it a perfectly valid relative target reads as "not
# a repo" and gets redirected to the session repo.
git_dir_arg=(-C "${payload_cwd:-.}" -C "$target_dir")

# A target parsed out of the command is a GUESS, and a guess that turns out
# not to be a repo used to fall straight through to the fail-open below. That
# is what let prose disarm the guard: any text naming a path that does not
# exist (a heredoc body, a commit message, a quoted string) pointed the check
# at nothing, and a real commit on a protected branch was allowed. Confirmed
# against this hook before the fix, on a protected branch:
#   `cat <<'EOF' > n.md` / `see cd /nonexistent && for details` / `EOF`
#   followed by a real commit  ->  allowed.
#
# The fix is deliberately NOT more parsing. Parsing the command better is what
# three reverted attempts tried; every added rule opened a new seam. Instead a
# wrong guess now falls back to the directory the command actually runs in,
# which is the safe default, so the guard no longer depends on the guess being
# right. Only a target that is genuinely not a repo still fails open.
if [[ "$target_from_command" -eq 1 ]] \
   && ! git "${git_dir_arg[@]}" rev-parse --show-toplevel >/dev/null 2>&1; then
  target_dir="${payload_cwd:-.}"
  git_dir_arg=(-C "$target_dir")
fi
# Known cost of the fallback, accepted rather than parsed around: a target
# this command is about to CREATE (a worktree, a clone, a fresh init) does not
# resolve yet either, so those deny on a protected branch and have to be run
# as two calls. Recognizing creation would mean reading the command again,
# which is what three reverted attempts did; the deny message below says
# "separate call" instead so the guidance and the behavior agree.

# Deliberate fail-open, not an error: a non-repo dir is not our business.
toplevel=$(git "${git_dir_arg[@]}" rev-parse --show-toplevel 2>/dev/null) || exit 0
[[ -z "$toplevel" ]] && exit 0

branch=$(git "${git_dir_arg[@]}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

# POLICY: <toplevel>/house.json. Absent means the repo has not adopted
# house; that is fail-open, not an error.
house_json="$toplevel/house.json"
[[ -f "$house_json" ]] || exit 0

# An adopted repo whose manifest cannot be parsed gets a refusal, not a
# silently disarmed guard: existence signals adoption, so unreadable policy
# is treated like a crash (refuse rather than guess). The loud fix surface
# is `node .house/check.mjs` (manifest family), which names the parse error.
if ! jq empty "$house_json" >/dev/null 2>&1; then
  deny "house.json exists but is not valid JSON, so the branch policy cannot be read. Refusing rather than guessing. Fix house.json (node .house/check.mjs names the error), then retry."
fi

branch_policy=$(jq -r '.branchPolicy // "pr"' "$house_json" 2>/dev/null || echo "pr")
[[ "$branch_policy" == "direct" ]] && exit 0

# Repo-local guard present: defer to it during migration onto house. Either
# a repo-local hook script, or a repo-local .claude/settings.json that
# declares its own "hooks" key.
#
# #27: deference used to be by mere file EXISTENCE, which made an empty or
# no-op `exit 0` file a complete disarm -- and `checkGuard` certified that same
# file by bare existsSync, so the checker reported the repo as protected while
# nothing was enforcing anything. Protection reported, none present, is worse
# than no guard at all.
#
# So require substance, with the predicate failing toward DENY: a local guard
# whose shape we do not recognize leaves THIS hook armed, which costs a branch
# creation, never a miss. That is the direction #27 asks every allowlist here
# to fail in. The checker shares this definition.
local_hook_is_substantive() {
  local f="$1" line
  [[ -s "$f" ]] || return 1
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"   # ltrim
    line="${line%"${line##*[![:space:]]}"}"   # rtrim
    [[ -z "$line" ]] && continue              # blank
    [[ "$line" == '#'* ]] && continue         # comment, shebang included
    [[ "$line" == 'exit' ]] && continue       # bare no-op
    [[ "$line" =~ ^exit[[:space:]]+0$ ]] && continue
    return 0
  done < "$f"
  return 1
}
local_hook="$toplevel/.claude/hooks/no-direct-master.sh"
if [[ -f "$local_hook" ]] && local_hook_is_substantive "$local_hook"; then
  exit 0
fi
if [[ -f "$toplevel/.claude/settings.json" ]]; then
  # Defer only to a repo-local PreToolUse hook, which is the only kind that can
  # actually guard a git command. A settings.json carrying only PostToolUse,
  # SessionStart, or other events is not a branch guard, so it must NOT disarm
  # this one (the failure mode: an unrelated logging hook silently removes all
  # branch protection).
  # `length > 0` alone is satisfied by any non-empty value (an object's
  # key count, even a string's length), and a malformed settings.json that
  # Claude Code itself ignores must not disarm this guard. Require the real
  # shape: a non-empty ARRAY, the same predicate the checker uses.
  if jq -e '(.hooks.PreToolUse | type == "array") and ((.hooks.PreToolUse | length) > 0)' "$toplevel/.claude/settings.json" >/dev/null 2>&1; then
    exit 0
  fi
fi

# From here on, the repo has adopted house, wants "pr" enforcement, and has
# no repo-local guard taking precedence. Arm the crash trap: an unexpected
# failure from this point forward denies with a message that says so,
# instead of exiting non-zero (which Claude Code treats as non-blocking,
# i.e. the guard would silently vanish exactly when it matters most).
trap crashed ERR

# protectedBranches, default ["master","main"] when the key is absent.
protected_list=$(jq -r '(.protectedBranches // ["master","main"])[]' "$house_json" 2>/dev/null)
if [[ -z "$protected_list" ]]; then
  protected_list=$'master\nmain'
fi

# carveOuts: array of glob patterns. Empty/absent means no carve-out is
# configured for this repo.
carve_outs=$(jq -r '(.carveOuts // [])[]' "$house_json" 2>/dev/null)

carve_out_reason_suffix=""
if [[ -n "$carve_outs" ]]; then
  carve_out_list=$(printf '%s' "$carve_outs" | tr '\n' ' ')
  carve_out_reason_suffix=" (paths matching a house.json carveOuts glob are exempt: ${carve_out_list% })"
fi

# TEST HOOK ONLY: lets the test harness plant a deliberate internal
# failure inside the guarded region, after the policy read, to exercise
# the ERR trap's crash-deny path. Never set in normal operation.
if [[ "${HOUSE_TEST_CRASH:-}" == "1" ]]; then
  false
fi

# Strip quoted-string contents and shell comments before pattern matching so
# commit message text and trailing comments can't trigger false positives.
# Single-pass strip, not a full shell parser; fail-fast UX for Claude's
# direct invocations.
#
# Which protection is real is a per-repo fact, not a constant, and the fleet
# has shipped both readings at once: one hook documented server-side branch
# protection as ABSENT (private repo on a free plan: the protected-branch API
# answers "Upgrade to GitHub Pro"), so the hook and the deploy guards ARE the
# protection; a sibling hook documented it as PRESENT and called itself a
# convenience on top. Both cannot be true of the same repo. Check which case
# the target repo is in before deciding how much this hook is carrying: where
# the platform enforces protection server side, this is fail-fast UX and not a
# substitute for it; where the platform enforces nothing, this script and the
# deploy guards are the only thing standing between a session and the
# protected branch.
# Quote handling has to tell a commit MESSAGE from a quoted keyword. A blind
# strip of every quoted span turns `git 'commit'` into `git ` and
# `git push origin 'master'` into `git push origin `, silently defeating the
# guard. So: (1) remove a quoted or bare argument only when it FOLLOWS a
# message-bearing flag (-m/--message/-F/--file/-c), which is the real reason to
# ignore quoted text; (2) everywhere else, delete the quote CHARACTERS but keep
# the token, so 'commit' reads as commit and 'master' as master; (3) strip
# trailing shell comments. Single-pass, not a full shell parser.
cmd_safe=$(strip_message_args "$cmd" | sed -E "
  s/['\"]//g;
  s/(^|[[:space:]])#.*\$//")
# The variants every verb scan tests: the message-stripped command, plus, only
# when a -c actually changed something, the -c-retaining variant (see
# strip_flag_args_keep_dash_c). A scan denies when ANY variant matches, so the
# extra variant can only add denials. Skipping it when it is identical keeps the
# no-`-c` common case (every ordinary git command) off a second sed and scan.
scan_variants=("$cmd_safe")
cmd_safe2=$(strip_flag_args_keep_dash_c "$cmd" | sed -E "
  s/['\"]//g;
  s/(^|[[:space:]])#.*\$//")
[[ "$cmd_safe2" != "$cmd_safe" ]] && scan_variants+=("$cmd_safe2")
matches_any() {
  local v
  for v in "${scan_variants[@]}"; do grep -qE "$1" <<<"$v" && return 0; done
  return 1
}

if is_protected_branch "$branch"; then
  if matches_any '(^|[^[:alnum:]])git[[:space:]]+(-C[[:space:]]+[^[:space:]]+[[:space:]]+)?commit([[:space:]]|$)'; then
    staged=$(git "${git_dir_arg[@]}" diff --cached --name-only 2>/dev/null || true)
    if carve_out_satisfied "$staged"; then
      exit 0
    fi
    deny "Refusing to commit on '$branch'. house.json at $toplevel requires a feature branch and a PR for this repo. For anything that renders or runs in parallel with another session, spin up a worktree (git worktree add -b kind/short-name ../<repo>-kind-short-name) in a SEPARATE call, then commit in a call of its own: a target this same command creates does not exist yet when this check runs, so the chained one-liner is refused. For a small, single-commit change with nothing else in flight, a branch in this checkout (git checkout -b kind/short-name) is fine. Commit there and open a PR.$carve_out_reason_suffix"
  fi
  if matches_any '(^|[^[:alnum:]])git[[:space:]]+(-C[[:space:]]+[^[:space:]]+[[:space:]]+)?push([[:space:]]|$)'; then
    unpushed=$(git "${git_dir_arg[@]}" diff '@{push}..' --name-only 2>/dev/null \
               || git "${git_dir_arg[@]}" diff "origin/${branch}.." --name-only 2>/dev/null \
               || true)
    if carve_out_satisfied "$unpushed"; then
      exit 0
    fi
    deny "Refusing to push from '$branch'. house.json at $toplevel requires a feature branch and a PR for this repo. Push a feature branch and open a PR instead.$carve_out_reason_suffix"
  fi
fi

# On any branch, block an explicit push targeting a protected branch.
# Isolate the `git push` clause first (stop at the next &&, ;, or |) before
# scanning for a target ref, so a legitimate chained command like
# `git push origin my-feature && git checkout master` isn't wrongly
# blocked by the literal word "master" appearing later on the line.
#
# Within that isolated clause, tokens are split on whitespace, then each
# token is split again on ':' (a refspec's <src>:<dst> form), and each
# resulting part has a leading '+' (force-push) or 'refs/heads/' prefix
# stripped before comparison. This deliberately checks BOTH sides of a
# refspec, not just the destination: `push origin master:feature` is
# over-blocked (master is the source, not the destination there) in
# exchange for never missing a real destructive form. No regex is built
# from the protected-branch name, so there is nothing to escape.
for scan_cmd in "${scan_variants[@]}"; do
  if [[ "$scan_cmd" =~ (^|[^[:alnum:]])git[[:space:]]+(-C[[:space:]]+[^[:space:]]+[[:space:]]+)?push([^\&\;\|]*) ]]; then
    push_clause="${BASH_REMATCH[3]}"
    for tok in $push_clause; do
      for part in ${tok//:/ }; do
        part="${part#+}"
        part="${part#refs/heads/}"
        if is_protected_branch "$part"; then
          deny "Refusing: command targets protected branch '$part' directly (house.json at $toplevel). Push a feature branch and open a PR."
        fi
      done
    done
  fi
done

exit 0
