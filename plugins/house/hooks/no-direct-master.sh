#!/usr/bin/env bash
# PreToolUse hook (Bash, Edit, Write, MultiEdit) for repos that have adopted
# house and opted a policy in via house.json. ADR 0013 carries the reasoning;
# this header states the contract.
#
# Since #58 this hook is NOT the branch guard. The guard is the git-hook floor
# the github module vendors (.githooks/pre-commit, pre-push,
# reference-transaction, armed through core.hooksPath), which runs inside git
# after the shell has resolved every variable, alias, refspec, remote and
# config key, so it sees the ref that is actually about to move. Eight review
# rounds on #1 and #34 established that a text scan cannot: the branch is
# known where git resolves it, not in the command's characters.
#
# What is left here is the small, enumerable set the floor cannot see, all of
# them ways to turn the floor OFF, plus the refusals that stand in for the
# floor while it is not there:
#   A. a disable literal: --no-verify and its abbreviations, -n on a commit,
#      any spelling of core.hooksPath, include.path / includeIf (a config
#      include can set hooksPath from outside the repo), git config injected
#      through the environment (GIT_CONFIG_*, --config-env, --exec-path,
#      GIT_EXEC_PATH), HUSKY=0, LEFTHOOK=0, a mutation of the floor's own
#      files, and the ref-writing plumbing that moves a protected branch or
#      rewrites an object (update-ref, symbolic-ref including a refs/remotes
#      spoof, branch -f/-M, push --delete, git replace and any refs/replace/
#      ref, which changes what HEAD:house.json even says)
#   B. an Edit/Write/MultiEdit whose file_path is anywhere under the repo's
#      .githooks/ or under its git directory, in any case and through any
#      symlink or `..`, plus git's per-user config (~/.gitconfig,
#      $XDG_CONFIG_HOME/git/config), which can set hooksPath or an alias for
#      every repository on the machine with nothing in the repo to show it
#   C. a commit on a protected branch, refused here so the agent reads one
#      sentence instead of a git hook's stderr; `git send-pack`, which no git
#      hook runs for at all; and, only while the floor is NOT intact and armed
#      in this checkout, the rest of the branch-moving surface (push, merge,
#      rebase, cherry-pick, revert, am, commit-tree) by a literal grammar that
#      refuses what it cannot read
#   D. a branch-moving command aimed at a repository it NAMES rather than
#      enters, refused in BOTH modes: a `-C` target that is computed, missing
#      or bare (a bare mirror has no working tree, no house.json and no
#      floor), and any GIT_DIR=, GIT_WORK_TREE=, GIT_COMMON_DIR=, --git-dir or
#      --work-tree, where the git directory, the work tree, house.json and
#      core.hooksPath can each come from somewhere else
#   E. `git checkout -b/-B`, `git switch -c/-C/--create/--force-create`, and an
#      `--orphan` checkout or switch, refused when the resolved target is the
#      MAIN checkout of an adopted repo: a workspace rule (git state is shared
#      across every peer session and the user), not a floor protection, so it
#      is allowed in a linked worktree, where it does not touch the checkout
#      anyone else is holding
#
# A and B and D run in EVERY repo that has house.json on HEAD, before the
# policy and deference gates below: `branchPolicy: direct` and a repo-local
# branch guard each say who decides which BRANCH may move, and neither is a
# reason to let a session unarm core.hooksPath or edit a vendored hook. Only C
# and E sit behind those gates.
#
# "Armed" (floor_is_armed) is verified against the plugin's own copy of the
# floor, never against literals in the command: core.hooksPath must resolve to
# this checkout's (or, in a linked worktree, the main checkout's) .githooks;
# each of the seven vendored files there must be executable and byte-identical
# to the plugin source; the set of regular files in that directory must be
# exactly the set HEAD tracks, so a planted file an ignore rule hides still
# breaks it; `git status` must report the hooks directory clean, untracked
# files included; and the git that will run the hooks must be 2.28 or newer,
# because reference-transaction (the only hook that sees a merge, rebase,
# amend, reset or update-ref) arrived there and without it the floor cannot
# cover history. A missing, stale, edited, symlinked, uncommitted or
# unwatchable floor is not a floor. That is why the disable list below is fast
# feedback only: the integrity check is the real guard.
#
# POLICY IS READ FROM HEAD, not the working tree: one Write to house.json used
# to turn every layer off. `git --no-replace-objects show HEAD:house.json`
# decides (a replace ref is another way to rewrite what HEAD says), and the
# working-tree file is consulted only when HEAD carries none (a repo adopting
# house before its first commit). A working-tree edit is then harmless until it
# lands on the protected branch through a PR, which is the whole point.
#
# Fails OPEN (allow, exit 0), as ADR 0002 requires, whenever: the tool is not
# one of the four; the payload names no git, hook, HUSKY or LEFTHOOK text at
# all; the target is not inside a git repo; house.json is absent from HEAD and
# from the working tree (the repo has not adopted house); it sets
# "branchPolicy": "direct" (for the BRANCH refusals only, see A/B/D above); or
# the target repo has its own substantive
# .claude/hooks/no-direct-master.sh or a .claude/settings.json PreToolUse entry
# whose matcher can see Bash (the repo-local guard wins during migration onto
# house; an entry scoped to other tools, or carrying only other events, is not
# a branch guard and does not defer this one). Deference is a deliberate choice
# here, not something the harness requires: every matching PreToolUse hook runs
# and the most restrictive decision wins. It also fails open silently wherever
# it never runs at all, which a bare, safe or restricted session and every
# non-Bash route (Cowork, MCP) do. That gap is why the floor exists.
#
# Fails CLOSED (deny) when jq is missing (cannot parse the payload, so cannot
# tell a safe command from a dangerous one), when the policy JSON will not
# parse, and on an unexpected internal failure after the policy has been read
# (the ERR trap below).
#
# Accepted false denies, all in the safe direction, all pinned in
# tests/hooks/run.sh:
#   1. core.hooksPath (and include.path / includeIf, see 2) is refused in any
#      clause that holds a git token, an `=`-bearing token spelling the key, or
#      a key token whose NEXT token starts with `=` (the space-separated INI
#      form, `hooksPath = /x`, however it lands in the file); `git config
#      --get`/`--get-all`/`--get-regexp core.hooksPath` alone is readable (ask
#      `house doctor` for anything more), `git config --file <f> --get
#      core.hooksPath` is readable too because `--file` and its value are
#      stripped before this scan ever runs, and prose naming the key in a
#      clause with no git token and no assignment (a `gh issue create
#      --title`, an `echo`) passes
#   2. reading include.path / includeIf is refused along with writing it
#   3. any `-n`-bearing short flag in a clause that also holds the word
#      `commit`
#   4. a redirection to a path or to /dev/null in a clause that also names
#      .githooks; `2>&1`, `1>&2`, `>&1` and `>&2` are not redirections to
#      anywhere the floor lives, and pass
#   5. GIT_CONFIG_NOSYSTEM (harmless, but it is a GIT_CONFIG_ prefix)
#   6. `git replace` in every form, listing included: the verb rewrites what
#      every reader of an object sees, and no release flow needs it
#   7. while the floor is not armed: every git verb that is not one of git's
#      own command names, so a personal alias (`git lg`) is refused until the
#      floor is armed, even when it only reads
#   8. a push or send-pack with NO refspec is refused from ANY branch unless
#      `push.default` is `current` or `nothing`, no `remote.<name>.push` is
#      set and `branch.<current>.merge` names no protected branch: an unset
#      push.default, `upstream`, `matching`, or an upstream on master can all
#      send a feature branch onto a protected one. `git push` and
#      `git push --tags` from a feature branch are therefore refused while the
#      floor is not armed; naming the branch or the tag is always readable
#   9. a `git branch -f <protected>` quoted inside the message of a clause
#      that also holds the word `branch`: the plumbing scan gets a second pass
#      over text that kept -m, so that `git branch -m master old` (a rename of
#      a protected branch, whose argument the -m strip otherwise eats) is seen
#  10. a commit, push, send-pack or history verb under GIT_DIR=,
#      GIT_WORK_TREE=, GIT_COMMON_DIR=, --git-dir or --work-tree, even when
#      the target is this very checkout
#  11. in a repo on `branchPolicy: direct`, or one deferring to a repo-local
#      guard, the whole disable list still applies (an Edit under .githooks, a
#      hooksPath write, a replace ref)
#  12. an Edit or Write of ~/.gitconfig or $XDG_CONFIG_HOME/git/config from
#      inside an adopted checkout, whatever the edit was for
#  13. while the floor IS armed: a `!shell` alias is refused on sight, since
#      its body is a script this hook cannot read
#  14. on git older than 2.28 an armed floor reads as unarmed, so every
#      unarmed refusal above applies in a repo that looks fully armed
# Deliberately NOT chased, because the floor covers it: a computed working
# directory (`cd "$d"`), a `popd`, a refspec the config supplies, xargs, and a
# git command inside a file this command runs. While the floor IS armed, a
# computed verb is not chased, and an alias is resolved exactly one level and
# never through a second alias. (A computed directory after `git -C` is
# different: on a commit, push or send-pack it is refused outright, see D.)
# Each was a scan here before #58 and each cost a seam. Known residue, all
# reported rather than guessed at: a Bash mutation of ~/.gitconfig (the Edit
# tool route is refused, `>> ~/.gitconfig` is not on the literal list); a
# wildcard that never spells .githooks (`rm -rf .gith*`), after which the next
# call reads the floor as gone and refuses what it covered; an Edit whose path
# reaches the hooks directory through a symlink named after neither git nor a
# hook, which the payload prefilter exits before; a planted file more than
# three levels under the hooks directory, which no dispatcher can run; and
# `git config --file <path> --get core.hooksPath`, readable for the same
# reason `--get` alone is (see 1) because `--file` and its value never reach
# the scan, while the write form with `--file` is still refused on the key
# token itself.
#
# Worktree-aware: the payload cwd plus every LITERAL path after `git -C`, `cd`
# or `pushd` is a candidate target, and the command is decided once per
# candidate against THAT repo's toplevel, house.json and branch, over the
# clauses whose git command runs there. Any candidate that refuses, refuses
# the call. A linked worktree reads core.hooksPath from the main checkout's
# config, so the arming advice names the main checkout. Quote-aware: a
# message-bearing flag's value goes, then the quote characters, so
# `git commit -m "fix master bug"` on a feature branch cannot false-positive on
# the word "master" (the strip's direction is load-bearing, see
# _strip_flag_args). Carve-out aware: on a protected branch a commit is allowed
# anyway when EVERY path in the staged diff matches one of house.json's
# `carveOuts` globs under shell `case` semantics (`*` crosses `/`); an empty
# diff never satisfies one, since "nothing staged" is not evidence the change
# is carve-out-only.
#
# Reads the standard Claude Code PreToolUse JSON payload on stdin and emits a
# `permissionDecision: deny` object (exit 0) to refuse the tool call, or
# silently exits 0 to allow it. Bash 3.2 compatible (macOS ships 3.2 as
# /bin/bash): no associative arrays, no `mapfile`.
#
# `-E` (errtrace) is required, not decorative: without it `trap ... ERR` does
# not propagate into shell functions, so a failure inside one would silently
# pass instead of tripping the crash-deny path. Deliberately no `-e`: the trap
# alone fires on an unguarded failing command, and skipping `-e` means a stray
# failure BEFORE the trap is armed falls through to the final `exit 0`, i.e.
# fails open, which is what the adoption gates want anyway. `-f`: nothing here
# needs pathname expansion (carve-out globs are matched by `case`, which -f
# does not touch), and an unquoted refspec token such as `m?ster` used to
# expand against the hook's own cwd, so the decision depended on which files
# happened to be there (#1, review round 3).
set -Euf -o pipefail

payload=$(cat)

# Cheap early exit before any jq work: a payload naming none of these can
# carry neither a git command nor a way to disable the floor. A backslash can
# spell the word (`gi\t`); JSON doubles it, so it shows here.
# The word is matched in ANY case: the default macOS volume is
# case-insensitive, so `.GITHOOKS/pre-push` is the same file as
# `.githooks/pre-push` and a case-sensitive prefilter never saw it.
case "$payload" in
  *[gG][iI][tT]*|*[hH][oO][oO][kK]*|*HUSKY*|*LEFTHOOK*|*\\*) ;;
  *) exit 0 ;;
esac

# jq is a hard dependency for parsing the payload and house.json. Missing, we
# cannot read tool_input at all, so we cannot tell a safe command from a
# dangerous one. Fail CLOSED rather than let the harness treat a crash as
# "hook produced no decision" (non-blocking, i.e. the guard silently
# vanishes). Hand-written JSON, since jq is exactly what is missing.
if ! command -v jq >/dev/null 2>&1; then
  cat <<'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "This hook could not find jq, so it cannot parse the tool call to check whether it disables the git-hook floor or targets a protected branch. Refusing until jq is installed, rather than letting commands through unchecked. Install jq: 'brew install jq' (macOS) or 'apt-get install jq' (Debian/Ubuntu), then retry."
  }
}
EOF
  exit 0
fi

# The plugin's own copy of the floor: what an armed checkout's .githooks must
# be byte-identical to. Sits beside this hook inside the plugin, so a stale
# render (a floor from an older plugin version) reads as not armed.
SELF_DIR=$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" >/dev/null 2>&1 && pwd || echo '')
FLOOR_SRC="$SELF_DIR/../modules/github/files/githooks"
# The seven vendored floor paths, relative to the hooks directory. Kept in
# step with the github module's files[] entries and with the checker's
# GUARD_FLOOR_FILES; a change to one is a change to all three.
FLOOR_RELPATHS="pre-commit pre-push reference-transaction house-lib.sh"
FLOOR_RELPATHS="$FLOOR_RELPATHS pre-commit.d/10-house-branch"
FLOOR_RELPATHS="$FLOOR_RELPATHS pre-push.d/10-house-branch"
FLOOR_RELPATHS="$FLOOR_RELPATHS reference-transaction.d/10-house-branch"

# git's own command names, from `git --list-cmds=builtins,main,others` on git
# 2.23 and 2.54 unioned. While the floor is not armed, a verb that is not on
# this list is not readable (an alias, a typo, a computed word) and is refused
# rather than guessed at. Aliases are never resolved: that was a seam.
GIT_VERBS=" add add--interactive am annotate apply archimport archive backfill
 bisect bisect--helper blame branch bugreport bundle cat-file check-attr
 check-ignore check-mailmap check-ref-format checkout checkout--worker
 checkout-index cherry cherry-pick citool clean clone column commit
 commit-graph commit-tree config count-objects credential credential-cache
 credential-cache--daemon credential-osxkeychain credential-store
 credential-wincred cvsexportcommit cvsimport cvsserver daemon describe
 diagnose diff diff-files diff-index diff-pairs diff-tree difftool
 difftool--helper env--helper fast-export fast-import fetch fetch-pack
 filter-branch filter-repo fmt-merge-msg for-each-ref for-each-repo
 format-patch fsck fsck-objects fsmonitor--daemon gc get-tar-commit-id grep
 gui gui--askpass gui--askyesno hash-object help history hook http-backend
 http-fetch http-push imap-send index-pack init init-db instaweb
 interpret-trailers last-modified legacy-stash log ls-files ls-remote ls-tree
 mailinfo mailsplit maintenance merge merge-base merge-file merge-index
 merge-octopus merge-one-file merge-ours merge-recursive
 merge-recursive-ours merge-recursive-theirs merge-resolve merge-subtree
 merge-tree mergetool mktag mktree multi-pack-index mv name-rev notes p4
 pack-objects pack-redundant pack-refs patch-id pickaxe prune prune-packed
 pull push quiltimport range-diff read-tree rebase rebase--interactive
 receive-pack reflog refs remote remote-ext remote-fd remote-ftp remote-ftps
 remote-http remote-https remote-testsvn repack replace replay repo
 request-pull rerere reset restore rev-list rev-parse revert rm send-email
 send-pack sh-i18n--envsubst shell shortlog show show-branch show-index
 show-ref sparse-checkout stage stash status stripspace submodule
 submodule--helper subtree svn switch symbolic-ref tag unpack-file
 unpack-objects update-index update-ref update-server-info upload-archive
 upload-archive--writer upload-pack var verify-commit verify-pack verify-tag
 version web--browse whatchanged worktree write-tree "
GIT_VERBS="${GIT_VERBS//$'\n'/ }"

# One jq pass for the payload: this hook runs on every Bash call, so each
# process it spawns is latency the session pays. Every field is emitted with a
# one-character prefix so an empty value still occupies a line, and the
# command goes LAST because it is the only field that can hold newlines.
payload_fields=$(jq -r '"t" + (.tool_name // ""), "w" + (.cwd // ""),
  "f" + (.tool_input.file_path // ""), "c" + (.tool_input.command // "")' \
  <<<"$payload" 2>/dev/null || echo "")
tool_name="${payload_fields%%$'\n'*}"; _rest="${payload_fields#*$'\n'}"
payload_cwd="${_rest%%$'\n'*}"; _rest="${_rest#*$'\n'}"
file_path="${_rest%%$'\n'*}"; cmd="${_rest#*$'\n'}"
tool_name="${tool_name#t}"; payload_cwd="${payload_cwd#w}"
file_path="${file_path#f}"; cmd="${cmd#c}"
case "$tool_name" in
  Bash) MODE='bash'; file_path='' ;;
  Edit|Write|MultiEdit) MODE='file'; cmd='' ;;
  *) exit 0 ;;
esac

deny() {
  jq -n --arg msg "$1" '{hookSpecificOutput: {hookEventName: "PreToolUse",
    permissionDecision: "deny", permissionDecisionReason: $msg}}'
  exit 0
}

# Fires on any unexpected internal failure once armed (the `trap` call in
# decide_for_target, deliberately deferred until after the policy read).
# Hand-written JSON, and it disables its own trap first: if something inside
# THIS handler failed, jq is the likely culprit, and retriggering the trap
# from inside its own handler would recurse.
# shellcheck disable=SC2329 # invoked indirectly via `trap crashed ERR`
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

# ── Text preparation ─────────────────────────────────────────────────────
# Backslashes go first, the way the shell reads them: a backslash-newline is a
# line continuation and vanishes; an escaped quote is a literal character that
# must NOT re-pair with the quotes around it, so it vanishes whole; every
# other backslash escapes the next character, which stays. A backslash
# anywhere in a word hid that word from every reader here (`--no-\verify`,
# `gi\t commit`), and deleting one can only merge characters into a word the
# scans then see, never split one apart.
if [[ "$MODE" == bash ]]; then
  cmd="${cmd//\\$'\n'/}"; cmd="${cmd//\\\"/}"; cmd="${cmd//\\\'/}"; cmd="${cmd//\\/}"
  # Precise re-check on the parsed field: the raw-payload prefilter above can
  # false-positive (a cwd path holding "git" with a non-git command).
  case "$cmd" in
    *[gG][iI][tT]*|*[hH][oO][oO][kK]*|*HUSKY*|*LEFTHOOK*) ;;
    *) exit 0 ;;
  esac
else
  [[ -n "$file_path" ]] || exit 0
  # .githooks, .GITHOOKS, .git/config, .git/hooks, ~/.gitconfig, the XDG
  # spelling of the per-user config (no dot at all), and any path whose name
  # says "hook", which is how a symlink into the hooks directory usually reads.
  # A symlink whose name says none of these is residue, documented above.
  case "$file_path" in
    *.[gG][iI][tT]*|*[gG][iI][tT]/[cC][oO][nN][fF][iI][gG]*|*[hH][oO][oO][kK]*) ;;
    *) exit 0 ;;
  esac
fi

# Remove flag-borne arguments (quoted or bare, `=`-joined or not) whose
# ALTERNATION is passed in, so their text can neither trigger nor defeat a
# match. Single-pass, not a shell parser. The flag must START a token, hence
# `(^|[[:space:]])` and the `\1` that puts the separator back: without it the
# -c of a directory named ...-council-audit-findings was read as the flag and
# the rest of the segment eaten as its value (#17). No boundary on the RIGHT,
# so git's attached form (`-mfix`) goes too: a flag's value is never a verb.
# A value that would EXPAND is never stripped: a double-quoted or bare value
# holding `$`, a backtick or `(` is code the shell will run, not prose, and
# this used to remove `-m "$(git push origin master)"` whole while the push
# inside ran (#1). Under-stripping costs a false deny, over-stripping costs a
# bypass; both directions are pinned in tests/hooks/run.sh.
_strip_flag_args() {
  printf '%s' "$2" | sed -E "
    s/(^|[[:space:]])($1)=?[[:space:]]*'[^']*'/\1/g;
    s/(^|[[:space:]])($1)=?[[:space:]]*\"[^\"\`\$]*\"/\1/g;
    s/(^|[[:space:]])($1)=?[[:space:]]*[^[:space:]'\"\`\$(]+/\1/g"
}
# The BLIND strip: the value is one shell WORD (bare characters, quoted spans,
# substitutions and parameter expansions in any mix, ending at unquoted
# whitespace) and it goes whole. Used only for target resolution, which fails
# in the opposite direction: a `cd <repo> &&` surviving inside a message value
# is parsed as the target, and a sibling repo on a feature branch is a
# fail-open (#1, review round 1).
_strip_flag_args_blind() {
  printf '%s' "$2" | sed -E "
    s/(^|[[:space:]])($1)=?[[:space:]]*([^[:space:]'\"]|'[^']*'|\"[^\"]*\"|\\\$\([^)]*\)|\\\$\{[^}]*\}|\`[^\`]*\`)+/\1/g"
}
# Quote characters go, but not the tokens: a blind strip of every quoted span
# turns `git 'commit'` into `git `, which is a bypass. Trailing comments go.
_unquote() { sed -E "s/['\"]//g; s/(^|[[:space:]])#.*\$//"; }

# One clause per line: the text split on every shell separator, so a scan that
# walks clauses reads ALL of them and a command chained behind an innocent one
# is not missed (#1). Parentheses and backticks become SPACES, not clause
# breaks: a substitution closes with `)` glued to the last token and a space
# frees it, while a break there would move the rest of the command out of the
# clause. Sets CLAUSES rather than printing, so a failure here cannot fire the
# ERR trap inside a subshell and come back as clause text.
CLAUSES=''
split_clauses() {
  local c="$1"
  # A bare `&` is the backgrounding operator and is a clause break; `>&`, a
  # stream-duplicating redirection (2>&1, 1>&2, >&1, >&2), is not one, and the
  # `&` split below must not cut it in half. Protected here with a control
  # character no shell text carries, and restored once the splits are done.
  c="${c//>&/>$'\x01'}"
  c="${c//\|\|/$'\n'}"; c="${c//&&/$'\n'}"; c="${c//;/$'\n'}"
  c="${c//&/$'\n'}"; c="${c//\|/$'\n'}"
  c="${c//\(/ }"; c="${c//\)/ }"; c="${c//\`/ }"
  # Restored with tr, not `${c//.../>&}`: since bash 5.2 (patsub_replacement)
  # a bare `&` in the replacement means "the matched text", which put the
  # placeholder back on CI, and `\&` stays a literal backslash on bash 3.2.
  c=$(printf '%s' "$c" | tr '\001' '&')
  CLAUSES="$c"
}

if [[ "$MODE" == bash ]]; then
  # The scanned text keeps `-c` values: `-c core.hooksPath=` is exactly what
  # the disable list has to see. The cost is a `-c` value carrying spaces,
  # whose tail is read as the verb; the floor catches that commit.
  cmd_safe=$(_strip_flag_args '-m|--message|-F|--file' "$cmd" | _unquote)
  # `git branch -m <protected>` is a rename of a protected branch, and the -m
  # strip above eats its argument before the plumbing scan can see it. So the
  # plumbing scan gets a second pass over text that kept -m, restricted to
  # `branch` clauses (see run_scans).
  cmd_plumb=$(_strip_flag_args '--message|-F|--file' "$cmd" | _unquote)
  # Target resolution reads the blind strip, `-c` included, so neither prose
  # nor a config value can steer which checkout is decided.
  cmd_for_target=$(_strip_flag_args_blind '-m|--message|-F|--file|-c' "$cmd" | _unquote)
else
  cmd_safe=''; cmd_plumb=''; cmd_for_target=''
fi

# ── Shared predicates (the checker mirrors these definitions) ────────────
# True if branch $1 is in $protected_list (set once house.json has been read).
is_protected_branch() {
  local b="$1" p
  while IFS= read -r p; do
    [[ -z "$p" ]] && continue
    [[ "$b" == "$p" ]] && return 0
  done <<<"$protected_list"
  return 1
}

# True (0) only if carve_outs is non-empty AND every newline-delimited path in
# $1 matches at least one carve-out glob, under shell `case` semantics (`*`
# crosses `/`). An empty diff never satisfies a carve-out, so "nothing staged"
# cannot be mistaken for "carve-out-only".
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
      # Intentional unquoted glob expansion: $glob is a house.json pattern,
      # matched as a shell glob (so `*` crosses `/`), not a literal string.
      # shellcheck disable=SC2254
      case "$path" in
        $glob) ok=0; break ;;
      esac
    done <<<"$carve_outs"
    [[ "$ok" -ne 0 ]] && return 1
  done <<<"$diff_paths"
  return 0
}

# True when a repo-local guard file has a line that is not blank, a comment,
# or a bare `exit`/`exit 0`. #1: deference used to be by mere file EXISTENCE,
# so a no-op stub disarmed this hook while the checker certified the repo as
# protected. The predicate fails toward DENY: a local guard whose shape we do
# not recognize leaves THIS hook armed, which costs a branch, never a miss.
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

# ── Reading one clause ───────────────────────────────────────────────────
# git_split CLAUSE sets GV_VERB (the first token after `git` that is not a
# global option, the value-taking ones skipped) and GV_ARGS (the tokens after
# it, one per line). Returns 1 when the clause runs no git command (GV_BAD=0)
# or when it runs one whose verb is not a literal word (GV_BAD=1): while the
# floor is armed a computed verb is simply not chased, because the floor reads
# the ref the shell finally produces; while it is not, GV_BAD is refused.
GV_VERB=''; GV_ARGS=''; GV_BAD=0
git_split() {
  local toks=() i=0 n tok
  GV_VERB=''; GV_ARGS=''; GV_BAD=0
  IFS=$' \t\n' read -r -a toks <<<"$1"
  n="${#toks[@]}"
  while [[ "$i" -lt "$n" ]]; do
    tok="${toks[$i]}"; i=$((i + 1))
    [[ "$tok" == git || "$tok" == */git ]] || continue
    while [[ "$i" -lt "$n" ]]; do
      tok="${toks[$i]}"; i=$((i + 1))
      case "$tok" in
        -c|-C|--git-dir|--work-tree|--namespace|--super-prefix|--config-env|--attr-source) i=$((i + 1)) ;;
        -*) ;;
        git|*/git) ;;   # a git where the verb should be starts a new command
        *'$'*|*'{'*) GV_BAD=1; return 1 ;;
        *)
          GV_VERB="$tok"
          while [[ "$i" -lt "$n" ]]; do GV_ARGS+="${toks[$i]}"$'\n'; i=$((i + 1)); done
          return 0 ;;
      esac
    done
    return 1
  done
  return 1
}
# A clause can hold more than one git command (one inside a substitution is a
# second). git_next reloads GV_* from what follows the verb just read.
git_next() { git_split "${GV_ARGS//$'\n'/ }"; }

# True when $1 is one of git's own command names (GIT_VERBS above).
verb_is_known() {
  case "$GIT_VERBS" in *" $1 "*) return 0 ;; esac
  return 1
}

# ── Target candidates ────────────────────────────────────────────────────
# The payload cwd is always a candidate; every LITERAL path after `cd`,
# `pushd` or `git -C` is another. A path the shell computes is simply not a
# candidate: guessing at it was the #34 seam, and the floor covers the
# checkout the command really lands in (a commit or push at a computed or bare
# target is refused outright by dir_target_scan). Each candidate carries the
# clauses whose git command runs there, so the release flow (commit in a
# worktree, come back to the shared checkout, git status) is not refused for a
# verb that belongs to another directory.
US=$'\x1f'
CANDIDATES=''
path_is_literal() {
  case "$1" in ''|-|*'$'*|*'`'*|*'{'*|*'}'*|*'*'*|*'?'*|*'['*) return 1 ;; esac
  return 0
}
# Where PATH lands when resolved from BASE: absolute or home-relative wins
# outright, relative is joined. Successive `-C` compose, which is git's rule.
compose_path() {
  case "$2" in
    /*|'~'*) printf '%s' "$2" ;;
    *) if [[ -n "$1" ]]; then printf '%s/%s' "$1" "$2"; else printf '%s' "$2"; fi ;;
  esac
}
collect_candidates() {
  local text="$1" dir='' clause toks i n tok cdir
  split_clauses "$text"
  while IFS= read -r clause; do
    IFS=$' \t\n' read -r -a toks <<<"$clause"
    n="${#toks[@]}"; i=0
    while [[ "$i" -lt "$n" ]]; do
      tok="${toks[$i]}"; i=$((i + 1))
      case "$tok" in
        cd|pushd)
          # A flag before the path (`cd -P <p>`, `cd --`) is not the path.
          while [[ "$i" -lt "$n" && "${toks[$i]}" != - && "${toks[$i]}" == -* ]]; do i=$((i + 1)); done
          if [[ "$i" -lt "$n" ]]; then
            if path_is_literal "${toks[$i]}"; then dir=$(compose_path "$dir" "${toks[$i]}"); fi
            i=$((i + 1))
          else
            dir='~'
          fi
          continue ;;
        git|*/git) ;;
        *) continue ;;
      esac
      cdir="$dir"
      while [[ "$i" -lt "$n" ]]; do
        tok="${toks[$i]}"
        case "$tok" in
          -C)
            if [[ $((i + 1)) -lt "$n" ]] && path_is_literal "${toks[$((i + 1))]}"; then
              cdir=$(compose_path "$cdir" "${toks[$((i + 1))]}")
            fi
            i=$((i + 2)) ;;
          -c|--git-dir|--work-tree|--namespace|--super-prefix|--config-env|--attr-source) i=$((i + 2)) ;;
          -*) i=$((i + 1)) ;;
          *) break ;;
        esac
      done
      CANDIDATES+="${cdir}${US}${clause}"$'\n'
      # Walk on: a second git in this clause is its own command.
    done
  done <<<"$CLAUSES"
  return 0
}

# ── A. The disable list ──────────────────────────────────────────────────
floor_deny() {
  deny "Refusing '$1': it disables or moves the git-hook floor that enforces this repo's branch policy (house.json at $toplevel). Commit on a feature branch and open a PR."
}
# Read clause by clause over the WHOLE command. Every entry is a literal: no
# shape-guessing, nothing an abbreviation or a rename quietly widens. This list
# is fast feedback, not the guard: floor_is_armed re-reads the floor's own
# bytes on every call, so a disable this list misses shows up there.
disable_scan() {
  local clause="$1" toks=() i n tok next_tok='' commit_seen=0 sed_seen=0 floorish=0
  local has_git_tok=0 t2 t2s
  local config_read_ok=0 t3 config_bad=0 config_eq=0
  # Any case: the default macOS volume is case-insensitive, so `rm
  # .GITHOOKS/pre-push` removes the floor just as well.
  case "$clause" in
    *.[gG][iI][tT][hH][oO][oO][kK][sS]*|*.[gG][iI][tT]/[cC][oO][nN][fF][iI][gG]*|*.[gG][iI][tT]/[hH][oO][oO][kK][sS]*) floorish=1 ;;
  esac
  IFS=$' \t\n' read -r -a toks <<<"$clause"
  n="${#toks[@]}"
  # The three key patterns below fire only in a clause that could actually
  # RUN git, or that assigns the key with `=`: prose naming the key (a `gh
  # issue create --title`, an `echo`) is not a way to read or write it.
  for t2 in "${toks[@]}"; do
    t2s="$t2"
    case "$t2s" in "'"*|'"'*) t2s="${t2s:1}" ;; esac
    case "$t2s" in git|*/git) has_git_tok=1; break ;; esac
  done
  # `git config --get`/`--get-all`/`--get-regexp core.hooksPath`, and nothing
  # else the clause does at the same time, only READS the key: house doctor
  # is still the way to ask, but this one spelling is not a way to change it.
  # Read over the WHOLE clause, not just the args git_split hands back after
  # the verb: git's own `-c key=value` sits BEFORE the verb and never reaches
  # GV_ARGS, and `-c core.hooksPath=/dev/null config --get core.hooksPath` is
  # a write riding along with a read, not a read.
  if [[ "$has_git_tok" -eq 1 ]] && git_split "$clause" && [[ "$GV_VERB" == config ]]; then
    for t3 in "${toks[@]}"; do
      case "$t3" in
        --get|--get-all|--get-regexp) config_read_ok=1 ;;
        --add|--replace-all|--unset|--unset-all|--rename-section|--remove-section|--edit|-e|-c|--file|-f|--blob)
          config_bad=1 ;;
        *=*) config_eq=1 ;;
      esac
    done
    [[ "$config_bad" -eq 0 && "$config_eq" -eq 0 ]] || config_read_ok=0
  fi
  for ((i = 0; i < n; i++)); do
    tok="${toks[$i]}"
    next_tok=''
    [[ $((i + 1)) -lt "$n" ]] && next_tok="${toks[$((i + 1))]}"
    case "$tok" in
      # git takes unambiguous abbreviations; --no-ver is ambiguous with
      # --no-verbose, so the list starts a letter later.
      --no-veri|--no-verif|--no-verify) floor_deny "$tok" ;;
      --config-env|--config-env=*|--exec-path|--exec-path=*) floor_deny "$tok" ;;
      GIT_CONFIG_*|GIT_EXEC_PATH|GIT_EXEC_PATH=*) floor_deny "$tok" ;;
      HUSKY=0|LEFTHOOK=0) floor_deny "$tok" ;;
      # Any spelling of core.hooksPath, case-insensitively, wherever it sits:
      # `-c core.hooksPath=`, `git config core.hooksPath`, `--unset`, or the
      # space-separated INI form (`hooksPath = /x`, next token starts `=`). A
      # bare read (`git config --get core.hooksPath`, see config_read_ok
      # above) is readable; every other git-clause spelling, and any
      # assignment, is not.
      *[hH][oO][oO][kK][sS][pP][aA][tT][hH]*)
        if [[ "$config_read_ok" -eq 0 ]] && { [[ "$has_git_tok" -eq 1 ]] || [[ "$tok" == *=* ]] || [[ "$next_tok" == =* ]]; }; then
          floor_deny "$tok"
        fi ;;
      # A config include can set core.hooksPath from a file outside the repo,
      # and `git config --get core.hooksPath` resolves it, so the floor reads
      # as disarmed while nothing in .git/config says so.
      *[iI][nN][cC][lL][uU][dD][eE].[pP][aA][tT][hH]*)
        if [[ "$has_git_tok" -eq 1 ]] || [[ "$tok" == *=* ]] || [[ "$next_tok" == =* ]]; then floor_deny "$tok"; fi ;;
      *[iI][nN][cC][lL][uU][dD][eE][iI][fF]*)
        if [[ "$has_git_tok" -eq 1 ]] || [[ "$tok" == *=* ]] || [[ "$next_tok" == =* ]]; then floor_deny "$tok"; fi ;;
    esac
    if [[ "$tok" == commit ]]; then commit_seen=1; fi
    # `-n` is --no-verify's short form on a commit. Any short-flag cluster
    # holding an n, after the word commit in this clause, is refused; the
    # false denies push the author to --message, which is fine.
    if [[ "$commit_seen" -eq 1 && "$tok" =~ ^-[A-Za-z]*n[A-Za-z]*$ ]]; then floor_deny "$tok"; fi
    # A mutation of the floor's own files. Reading them (cat, ls, bash
    # tests/...) passes; a mutator in the same clause does not.
    if [[ "$floorish" -eq 1 ]]; then
      case "$tok" in
        rm|mv|cp|chmod|chflags|truncate|tee|install|ln) floor_deny "$tok" ;;
        sed) sed_seen=1 ;;
        -i|-i*) if [[ "$sed_seen" -eq 1 ]]; then floor_deny "sed -i"; fi ;;
        # A stream redirected onto another stream (2>&1, 1>&2, >&1, >&2) goes
        # nowhere near the floor's files; every other `>` does.
        '2>&1'|'1>&2'|'>&2'|'>&1') : ;;
        *'>'*) floor_deny "$tok" ;;
      esac
    fi
  done
  return 0
}
# The ref-writing plumbing that moves a protected branch with no commit and no
# push. reference-transaction catches these on git 2.28+; nothing does below
# that, so they are refused here on every git. Mode `all` reads every verb in
# the list; mode `branch` reads only `git branch`, over text whose -m value
# survived (`git branch -m master old`).
# A delete is deliberately NOT here: `git branch -D master` throws away a local
# ref the remote still has, and the floor allows it.
plumbing_scan() {
  local clause="$1" mode="$2" tok t need_flag flagged
  git_split "$clause" || return 0
  while :; do
    need_flag=-1
    case "$GV_VERB" in
      update-ref|symbolic-ref) if [[ "$mode" == all ]]; then need_flag=0; fi ;;
      push) if [[ "$mode" == all ]]; then need_flag=1; fi ;;
      branch) need_flag=1 ;;
      # A replace ref rewrites what every reader of an object sees, house.json
      # on HEAD included, with no commit and no ref move. The policy read above
      # passes --no-replace-objects; the verb itself is refused here, listing
      # included (accepted false deny: ask `git cat-file` instead).
      replace) if [[ "$mode" == all ]]; then floor_deny "git replace"; fi ;;
    esac
    if [[ "$need_flag" -ge 0 ]]; then
      flagged=0
      while IFS= read -r tok; do
        case "$tok" in
          # A force-push is the floor's to refuse, and pre-push does; only the
          # delete is read here, because a deleted branch never reaches its
          # diff. On `git branch`, the movers (-f, -M, -m) count.
          -d|--delete) if [[ "$GV_VERB" == push ]]; then flagged=1; fi; continue ;;
          -f|-M|-m|--force|--move)
            if [[ "$GV_VERB" == branch ]]; then flagged=1; fi
            continue ;;
          -*) continue ;;
        esac
        # A remote-tracking ref is a target too: writing refs/remotes/<r>/main
        # is how the reference-transaction guard's "the remote already has
        # this commit" test was fooled.
        t="$tok"
        case "$t" in
          # Writing refs/replace/<sha> by hand is `git replace` spelled as
          # plumbing, and it changes what the policy read sees.
          refs/replace/*|replace/*) floor_deny "git $GV_VERB on '$tok'" ;;
          refs/remotes/*) t="${t#refs/remotes/}"; t="${t#*/}" ;;
          *) t="${t#refs/heads/}"; t="${t#heads/}" ;;
        esac
        if [[ "$need_flag" -eq 0 || "$flagged" -eq 1 ]] && is_protected_branch "$t"; then
          floor_deny "git $GV_VERB on '$t'"
        fi
      done <<<"$GV_ARGS"
    fi
    git_next || break
  done
  return 0
}

# A branch-moving command whose target repository is named rather than entered
# is refused in BOTH modes. Two shapes:
#   - `-C <dir>`: the directory is checked. Computed, missing, or bare is a
#     refusal (a bare mirror has no working tree, no house.json and no floor).
#   - `GIT_DIR=`, `GIT_WORK_TREE=`, `GIT_COMMON_DIR=`, `--git-dir=`,
#     `--work-tree=`: refused outright. These name a git directory and a work
#     tree separately, so "the checkout" this hook would check does not exist
#     as one thing, and core.hooksPath, house.json and the branch can each come
#     from a different place.
dir_is_bare() {
  local out
  out=$(trap - ERR; git -C "$1" rev-parse --is-bare-repository 2>/dev/null || true)
  [[ "$out" == true ]]
}
dir_target_scan() {
  local clause="$1" toks=() i n tok verb ent k d targets=''
  IFS=$' \t\n' read -r -a toks <<<"$clause"
  n="${#toks[@]}"; i=0
  while [[ "$i" -lt "$n" ]]; do
    tok="${toks[$i]}"; i=$((i + 1))
    case "$tok" in
      GIT_DIR=*|GIT_WORK_TREE=*|GIT_COMMON_DIR=*) targets+="env${US}${tok%%=*}"$'\n'; continue ;;
      git|*/git) ;;
      *) continue ;;
    esac
    verb=''
    while [[ "$i" -lt "$n" ]]; do
      tok="${toks[$i]}"; i=$((i + 1))
      case "$tok" in
        -C) if [[ "$i" -lt "$n" ]]; then targets+="C${US}${toks[$i]}"$'\n'; i=$((i + 1)); fi ;;
        --git-dir|--work-tree) targets+="env${US}${tok}"$'\n'; i=$((i + 1)) ;;
        --git-dir=*|--work-tree=*) targets+="env${US}${tok%%=*}"$'\n' ;;
        -c|--namespace|--super-prefix|--config-env|--attr-source) i=$((i + 1)) ;;
        -*) ;;
        *) verb="$tok"; break ;;
      esac
    done
    case "$verb" in
      commit|push|send-pack|merge|rebase|cherry-pick|revert|am|commit-tree) ;;
      *) targets=''; continue ;;
    esac
    while IFS= read -r ent; do
      [[ -n "$ent" ]] || continue
      k="${ent%%"$US"*}"; d="${ent#*"$US"}"
      if [[ "$k" == env ]]; then
        deny "Refusing 'git $verb' with '$d': the target of an environment-named repository is not checked (its git directory, work tree, house.json and core.hooksPath can each point somewhere else). Run the command from inside that checkout."
      fi
      case "$verb" in commit|push|send-pack) ;; *) continue ;; esac
      if ! path_is_literal "$d"; then
        deny "Refusing 'git $verb' with a computed git target ('$d'): this hook cannot tell which checkout it lands in, and a directory the shell builds has no floor it can verify. Use a literal path, or run the command from that checkout."
      fi
      case "$d" in '~'*) d="$HOME${d#\~}" ;; esac
      case "$d" in /*) ;; *) d="${payload_cwd:-.}/$d" ;; esac
      if [[ ! -d "$d" ]]; then
        deny "Refusing 'git $verb' at '$d': that directory does not exist, so this hook cannot check the branch policy or the git-hook floor there."
      fi
      if dir_is_bare "$d"; then
        deny "Refusing 'git $verb' at '$d': it is a bare repository, which has no working tree, no house.json and no git-hook floor, so nothing there enforces the branch policy. Push from a checkout, or fix it on the remote with a ruleset."
      fi
    done <<<"$targets"
    targets=''
  done
  return 0
}

# ── B. Is the floor intact and armed for THIS candidate? ─────────────────
# Not "does the command mention hooksPath" but "is the floor there": the seven
# vendored files, byte-identical to the plugin's own copy, executable, clean in
# git's eyes, under a core.hooksPath this repo (or its main checkout) owns.
# core.hooksPath is read with `git config --get`, which resolves include.path
# and includeIf, so an include that points it at /dev/null reads as unarmed.
# Sets FLOOR_REASON to the first thing that failed, which picks the remedy.
FLOOR_REASON=''
# The reference-transaction hook, the only one of the three that sees a merge,
# rebase, cherry-pick, amend, reset or update-ref, arrived in git 2.28. On an
# older git the floor still refuses commits and pushes, but every history
# rewrite moves the branch with nothing watching, so a repo on such a git reads
# as NOT armed here and the unarmed scans stay on. Measured once per call.
GIT_VER=''; GIT_VER_OK=''
git_version_ok() {
  if [[ -z "$GIT_VER_OK" ]]; then
    local v maj min
    v=$(trap - ERR; git --version 2>/dev/null || true)
    v="${v#*version }"; v="${v%% *}"
    maj="${v%%.*}"; min="${v#*.}"; min="${min%%.*}"
    case "$maj" in ''|*[!0-9]*) maj=0 ;; esac
    case "$min" in ''|*[!0-9]*) min=0 ;; esac
    GIT_VER="$maj.$min"
    if [[ "$maj" -gt 2 ]] || { [[ "$maj" -eq 2 ]] && [[ "$min" -ge 28 ]]; }; then
      GIT_VER_OK=yes
    else
      GIT_VER_OK=no
    fi
  fi
  [[ "$GIT_VER_OK" == yes ]]
}
# The regular files under a hooks directory, relative to it, newline
# separated, in HD_LIST (HD_N counts them). Done with bash's own globbing
# rather than `find`, because this runs on the armed path of every call and a
# process costs about 8 ms here. Three levels is the whole shape a dispatcher
# can reach (<hook>.d/<file>); a symlink is deliberately NOT a regular file,
# the way `find -type f` reads it.
HD_LIST=''; HD_N=0
hooks_dir_files() {
  local base="$1" p q r
  HD_LIST=''; HD_N=0
  set +f
  shopt -s nullglob dotglob
  for p in "$base"/*; do
    if [[ -f "$p" && ! -L "$p" ]]; then HD_LIST+="${p#"$base"/}"$'\n'; HD_N=$((HD_N + 1))
    elif [[ -d "$p" && ! -L "$p" ]]; then
      for q in "$p"/*; do
        if [[ -f "$q" && ! -L "$q" ]]; then HD_LIST+="${q#"$base"/}"$'\n'; HD_N=$((HD_N + 1))
        elif [[ -d "$q" && ! -L "$q" ]]; then
          for r in "$q"/*; do
            if [[ -f "$r" && ! -L "$r" ]]; then HD_LIST+="${r#"$base"/}"$'\n'; HD_N=$((HD_N + 1)); fi
          done
        fi
      done
    fi
  done
  shopt -u nullglob dotglob
  set -f
  return 0
}
floor_is_armed() {
  local hp resolved owner rel st tracked t tn=0
  FLOOR_REASON='hookspath'
  hp=$(trap - ERR; git "${git_dir_arg[@]}" config --get core.hooksPath 2>/dev/null || true)
  [[ -n "$hp" ]] || return 1
  case "$hp" in
    /*) resolved="$hp" ;;
    '~'*) resolved="$HOME${hp#\~}" ;;
    *) resolved="$toplevel/$hp" ;;
  esac
  resolved="${resolved%/}"
  # Compared with -ef where both sides exist, because git reports the toplevel
  # with its symlinks resolved (/private/var on macOS) while the config may
  # hold the path as it was typed (/var).
  owner=''
  if [[ "$resolved" == "$toplevel/.githooks" ]]; then owner="$toplevel"
  elif [[ "$resolved" == "$MAIN_ROOT/.githooks" ]]; then owner="$MAIN_ROOT"
  elif [[ -d "$resolved" && -d "$toplevel/.githooks" && "$resolved" -ef "$toplevel/.githooks" ]]; then owner="$toplevel"
  elif [[ -d "$resolved" && -d "$MAIN_ROOT/.githooks" && "$resolved" -ef "$MAIN_ROOT/.githooks" ]]; then owner="$MAIN_ROOT"
  else return 1
  fi
  FLOOR_REASON='files'
  [[ -d "$FLOOR_SRC" ]] || return 1
  # Seven execs, measured at about 20 ms all together on bash 3.2, and the
  # cheapest exact answer available: bash's own `read -r -d ''` reads a byte at
  # a time and came out at 38 ms, `$(<file)` at 20 ms with the trailing
  # newlines dropped. If cmp is not on PATH at all, every comparison fails and
  # the floor reads as not armed, which is the safe direction.
  for rel in $FLOOR_RELPATHS; do
    [[ -x "$resolved/$rel" ]] || return 1
    cmp -s "$resolved/$rel" "$FLOOR_SRC/$rel" || return 1
  done
  # An untracked .d/00-mine or a modified 20-secrets means the hooks directory
  # in this checkout is not the one a PR reviewed. A session that wants to
  # change a hook does it through a PR from a checkout it does not commit from.
  #
  # Two conditions, because `git status` alone fails toward "clean": a planted
  # file that .gitignore or .git/info/exclude covers is invisible to it, and
  # the dispatcher runs the file anyway. So the set of REGULAR files on disk
  # must equal the set HEAD tracks, whatever the ignore rules say (a symlinked
  # hook is not a regular file and fails this too), AND status must be clean.
  hooks_dir_files "$resolved"
  tracked=$(trap - ERR; git -C "$owner" ls-tree -r --name-only HEAD -- .githooks 2>/dev/null || true)
  while IFS= read -r t; do
    [[ -n "$t" ]] || continue
    tn=$((tn + 1))
  done <<<"$tracked"
  [[ "$tn" -eq "$HD_N" ]] || return 1
  tracked=$'\n'"$tracked"$'\n'
  while IFS= read -r rel; do
    [[ -n "$rel" ]] || continue
    case "$tracked" in
      *$'\n'".githooks/$rel"$'\n'*) ;;
      *) return 1 ;;
    esac
  done <<<"$HD_LIST"
  st=$(trap - ERR; git -C "$owner" status --porcelain --untracked-files=all -- .githooks 2>/dev/null || true)
  [[ -z "$st" ]] || return 1
  # Last, because it is the one failure a re-render cannot fix and because the
  # remedy for a floor that is simply not there is to arm it, not to upgrade.
  FLOOR_REASON='gitversion'
  git_version_ok || return 1
  FLOOR_REASON=''
  return 0
}
# The remedy sentence every not-armed refusal ends with, chosen by the reason.
set_arm_suffix() {
  local extra=''
  case "$FLOOR_REASON" in
    gitversion)
      arm_suffix=" git $GIT_VER has no reference-transaction hook, so the floor cannot cover history; upgrade git to 2.28 or newer." ;;
    hookspath)
      if [[ "$MAIN_ROOT" != "$toplevel" ]]; then
        extra=" (this is a linked worktree; core.hooksPath lives in the main checkout, so run it there)"
      fi
      arm_suffix=" The git-hook floor is not armed in this checkout; arm it: git config core.hooksPath \"$MAIN_ROOT/.githooks\"$extra (house render --apply also does this)." ;;
    files)
      arm_suffix=" The git-hook floor is armed but not intact here: one of its vendored files is missing, not executable, edited, or uncommitted, so git is not enforcing the policy. Restore it with house render --apply, and house doctor reports what is wrong with it." ;;
    *) arm_suffix='' ;;
  esac
}

# ── C. The branch refusals, over this candidate's own clauses ────────────
commit_decision() {
  local staged
  is_protected_branch "$branch" || return 0
  # A branch created earlier in the same call is where the commit lands, which
  # is the shape the refusal itself recommends.
  if [[ -n "$BRANCH_CREATED_AT" && "$BRANCH_CREATED_AT" -lt "$CLAUSE_IDX" ]]; then return 0; fi
  staged=$(trap - ERR; git "${git_dir_arg[@]}" diff --cached --name-only 2>/dev/null || true)
  if carve_out_satisfied "$staged"; then return 0; fi
  deny "Refusing to commit on '$branch': this branch needs a PR. house.json at $toplevel requires a feature branch and a PR for this repo. Work in a worktree: git worktree add -b kind/short-name ../${toplevel##*/}-kind-short-name, in a separate call, then commit there and open a PR.${carve_out_reason_suffix}${arm_suffix}"
}
# Everything below runs ONLY while the floor is not intact and armed here.
# Armed, git itself reads the refs it is about to move and these scans could
# only add false denies (a tag push, a refspec the config supplies, an alias).

# A verb this hook cannot read. Refused rather than guessed at, because with
# no floor there is nothing behind it.
unreadable_deny() {
  local what="a computed git verb"
  if [[ -n "${1:-}" ]]; then what="the git verb '$1', which is not one of git's own commands (an alias, or a typo)"; fi
  deny "Refusing $what: this hook cannot tell what it does to a protected branch, and the git-hook floor that would decide is not enforcing the policy in this checkout. Aliases are never resolved here by design.${arm_suffix}"
}
# While the floor IS armed an unknown verb is the floor's business, with one
# exception: an alias body is text, and the disable literals in it (a
# `-c core.hooksPath=`, an `update-ref` on a protected branch) are exactly what
# the floor cannot see, because they run before git reaches a ref. So the body
# is looked up once, not resolved further, and read with the same two scans as
# a clause. A shell alias (`!...`) is a whole script and is refused instead.
alias_scan() {
  local verb="$1" body
  body=$(trap - ERR; git -C "$toplevel" config --get "alias.$verb" 2>/dev/null || true)
  [[ -n "$body" ]] || return 0
  case "$body" in
    '!'*)
      deny "Refusing 'git $verb': alias.$verb is a shell alias ($body), which is a script this hook cannot read and the git-hook floor never sees as text. Run the commands it stands for directly." ;;
  esac
  body=$(trap - ERR; printf '%s' "$body" | _unquote)
  disable_scan "git $body"
  plumbing_scan "git $body" all
  return 0
}
# The verbs that write history onto the current branch without the word
# `commit`. Carve-outs do not apply: a merge or a rebase has no staged diff to
# measure them against.
history_decision() {
  is_protected_branch "$branch" || return 0
  deny "Refusing 'git $GV_VERB' on '$branch': it writes onto a protected branch. house.json at $toplevel requires a feature branch and a PR for this repo.${arm_suffix}"
}
# A push is read by a literal grammar: every refspec token must be a literal
# that does not name a protected branch, and a push with no refspec at all from
# a protected branch is refused because push.default and remote.*.push decide
# what moves. A tag push, and a feature-branch push from a protected checkout,
# are therefore allowed: the release flow needs the first and the sync agents
# need the second.
push_decision() {
  local tok part refspecs='' nrefs=0 remote_seen=0 skip_next=0
  while IFS= read -r tok; do
    [[ -n "$tok" ]] || continue
    if [[ "$skip_next" -eq 1 ]]; then skip_next=0; continue; fi
    case "$tok" in
      --all|--mirror|--branches|--prune)
        deny "Refusing: '$tok' can move a protected branch without naming it (house.json at $toplevel). Push one feature branch by name and open a PR.${arm_suffix}" ;;
      # Only the flags whose value is a SEPARATE token are skipped. git's
      # other value-taking push options (--receive-pack=, --exec=, --repo=)
      # are `=`-joined, and treating them as separate would swallow the token
      # after them, which could be the protected branch itself.
      -o|--push-option) skip_next=1; continue ;;
      -*) continue ;;
    esac
    if [[ "$remote_seen" -eq 0 ]]; then remote_seen=1; continue; fi
    refspecs+="$tok"$'\n'; nrefs=$((nrefs + 1))
  done <<<"$GV_ARGS"
  while IFS= read -r tok; do
    [[ -n "$tok" ]] || continue
    case "$tok" in
      *'$'*|*'*'*|*'?'*|*'['*|*'{'*)
        deny "Refusing: '$tok' is not a literal refspec, so this hook cannot tell which branch the push moves (house.json at $toplevel). Name the branch, or arm the floor and let git decide.${arm_suffix}" ;;
    esac
    # shellcheck disable=SC2086 # deliberate split of a colon-joined refspec
    for part in ${tok//:/ }; do
      part="${part#+}"; part="${part#refs/heads/}"; part="${part#heads/}"
      if is_protected_branch "$part"; then
        deny "Refusing: this push targets protected branch '$part' directly (house.json at $toplevel). Push a feature branch and open a PR.${arm_suffix}"
      fi
    done
  done <<<"$refspecs"
  [[ "$nrefs" -eq 0 ]] || return 0
  if is_protected_branch "$branch"; then
    deny "Refusing a push with no refspec from protected branch '$branch': push.default and remote.*.push decide what moves, and this hook cannot read them (house.json at $toplevel). Name the branch or tag you mean.${arm_suffix}"
  fi
  # From a FEATURE branch a push with no refspec is still a protected-branch
  # push whenever the config says so: `push.default=upstream` with
  # `branch.<current>.merge = refs/heads/master` sends the feature branch
  # straight onto master, and a `remote.<name>.push` refspec does it with no
  # upstream at all. Only `current` and `nothing`, with no remote.*.push, name
  # what moves in a way this hook can read. Unset is refused with them: git
  # before 2.0 defaulted to `matching` (every same-named branch, master
  # included) and 2.x defaults to `simple`, which follows the upstream.
  local pd up rp
  rp=$(trap - ERR; git "${git_dir_arg[@]}" config --get-regexp '^remote\..*\.push$' 2>/dev/null | head -1 || true)
  if [[ -n "$rp" ]]; then
    deny "Refusing a push with no refspec: ${rp%% *} is set, so the config decides which branch moves and this hook cannot tell it is not a protected one (house.json at $toplevel). Name the branch or tag you mean.${arm_suffix}"
  fi
  up=$(trap - ERR; git "${git_dir_arg[@]}" config --get "branch.$branch.merge" 2>/dev/null || true)
  up="${up#refs/heads/}"
  if [[ -n "$up" ]] && is_protected_branch "$up"; then
    deny "Refusing a push with no refspec: branch.$branch.merge names protected branch '$up', so a push with no refspec can land there (house.json at $toplevel). Name the branch or tag you mean.${arm_suffix}"
  fi
  pd=$(trap - ERR; git "${git_dir_arg[@]}" config --get push.default 2>/dev/null || true)
  case "$pd" in
    current|nothing|simple) return 0 ;;
    '') deny "Refusing a push with no refspec: push.default is unset, so git's own default (simple on git 2.x, matching before it) decides what moves and this hook cannot read it (house.json at $toplevel). Name the branch or tag you mean.${arm_suffix}" ;;
    *) deny "Refusing a push with no refspec: push.default=$pd decides what moves, and this hook cannot tell it is not a protected branch (house.json at $toplevel). Name the branch or tag you mean.${arm_suffix}" ;;
  esac
}

# E. Branching in the main checkout: a workspace rule, not a floor protection
# (git state is shared across every peer session and the user holding this
# checkout), so it sits behind the same policy and deference gates as C and
# only fires on the MAIN checkout, never in a linked worktree.
worktree_create_deny() {
  deny "Refusing '$1': the main checkout is the one every peer session and the user hold. Branch in a worktree: git worktree add -b <branch> <path> origin/<default>, or the harness's worktree tool. (house rule: treat git state as shared across sessions)"
}
worktree_branch_create_scan() {
  local verb="$1" tok flag='' seen_dashdash=0
  while IFS= read -r tok; do
    if [[ "$seen_dashdash" -eq 1 ]]; then continue; fi
    case "$tok" in
      --) seen_dashdash=1; continue ;;
    esac
    case "$verb:$tok" in
      checkout:--orphan) flag="$tok" ;;
      switch:--create|switch:--force-create|switch:--orphan) flag="$tok" ;;
    esac
    if [[ -z "$flag" ]]; then
      case "$tok" in
        --*) : ;;
        # A short-flag cluster counts whether the create letter is alone or
        # glued to others or to the branch name: `-b`, `-qb`, `-bnewb` on
        # checkout, `-c`, `-cnewb` on switch all create a branch.
        -*)
          case "$verb" in
            checkout) case "$tok" in *b*|*B*) flag="$tok" ;; esac ;;
            switch) case "$tok" in *c*|*C*) flag="$tok" ;; esac ;;
          esac ;;
      esac
    fi
  done <<<"$GV_ARGS"
  [[ -n "$flag" ]] || return 0
  [[ "$MAIN_ROOT" == "$toplevel" ]] || return 0
  worktree_create_deny "git $verb $flag"
}

# A, over the whole command, whichever directory each clause runs in. Runs in
# ANY repo that has adopted house, whatever its branchPolicy says and whoever
# else guards the branch: these are the ways to turn the floor off, and a repo
# on `direct` today is one merged PR away from `pr`.
run_early_scans() {
  local clause
  split_clauses "$cmd_safe"
  while IFS= read -r clause; do
    disable_scan "$clause"
    plumbing_scan "$clause" all
    dir_target_scan "$clause"
  done <<<"$CLAUSES"
  # The second plumbing pass: `git branch -m <protected>` only.
  split_clauses "$cmd_plumb"
  while IFS= read -r clause; do
    case "$clause" in *branch*) plumbing_scan "$clause" branch ;; esac
  done <<<"$CLAUSES"
  return 0
}

BRANCH_CREATED_AT=''
CLAUSE_IDX=0
run_branch_scans() {
  local clause armed=0 n=0
  if floor_is_armed; then armed=1; fi
  set_arm_suffix

  # E, over the WHOLE command (cmd_safe, not the blind-stripped CAND_TEXT: the
  # blind strip removes a bare `-c` for target resolution, which is also
  # switch's short create flag). Runs whatever this candidate's own clauses
  # say, because branching in the main checkout is a workspace rule, not a
  # target-directory question.
  split_clauses "$cmd_safe"
  while IFS= read -r clause; do
    git_split "$clause" || continue
    while :; do
      case "$GV_VERB" in
        checkout|switch) worktree_branch_create_scan "$GV_VERB" ;;
      esac
      git_next || break
    done
  done <<<"$CLAUSES"

  # B and C, over this candidate's clauses only. First pass: the clause that
  # creates a branch, if any.
  BRANCH_CREATED_AT=''
  split_clauses "$CAND_TEXT"
  while IFS= read -r clause; do
    n=$((n + 1))
    git_split "$clause" || continue
    case "$GV_VERB" in
      checkout|switch)
        case $'\n'"$GV_ARGS" in
          *$'\n'-b$'\n'*|*$'\n'-B$'\n'*|*$'\n'-c$'\n'*|*$'\n'-C$'\n'*|*$'\n'--orphan$'\n'*)
            [[ -n "$BRANCH_CREATED_AT" ]] || BRANCH_CREATED_AT="$n" ;;
        esac ;;
    esac
  done <<<"$CLAUSES"
  CLAUSE_IDX=0
  while IFS= read -r clause; do
    CLAUSE_IDX=$((CLAUSE_IDX + 1))
    if ! git_split "$clause"; then
      if [[ "$armed" -eq 0 && "$GV_BAD" -eq 1 ]]; then unreadable_deny ''; fi
      continue
    fi
    while :; do
      if ! verb_is_known "$GV_VERB"; then
        if [[ "$armed" -eq 0 ]]; then unreadable_deny "$GV_VERB"; else alias_scan "$GV_VERB"; fi
      fi
      case "$GV_VERB" in
        commit) commit_decision ;;
        push) if [[ "$armed" -eq 0 ]]; then push_decision; fi ;;
        # send-pack is a push no git hook sees: pre-push runs for `git push`
        # and for nothing else, so the floor cannot cover it at all. Armed, it
        # is refused outright; unarmed, the push grammar reads its refspecs.
        send-pack)
          if [[ "$armed" -eq 1 ]]; then
            deny "Refusing 'git send-pack': git runs no hook for it (pre-push runs only for git push), so the git-hook floor cannot see the refs it moves (house.json at $toplevel). Use git push, which the floor sees."
          else
            push_decision
          fi ;;
        merge|cherry-pick|revert|rebase|am|commit-tree)
          if [[ "$armed" -eq 0 ]]; then history_decision; fi ;;
      esac
      if ! git_next; then
        if [[ "$armed" -eq 0 && "$GV_BAD" -eq 1 ]]; then unreadable_deny ''; fi
        break
      fi
    done
  done <<<"$CLAUSES"
  return 0
}

# ── B for Edit/Write/MultiEdit ───────────────────────────────────────────
# EVERY path under the repo's .githooks/ is refused, not only the lock-listed
# ones: the scaffold the repo owns (.githooks/pre-commit.d/20-secrets) runs
# inside the same dispatcher and an unmanaged .d file added here is exactly
# what floor_is_armed reads as "not intact". Same for anything under the git
# directory. The repo root is compared with -ef, not as a string prefix: git
# reports the toplevel with its symlinks resolved (/private/var on macOS) while
# the tool payload carries the path as the session spelled it (/var).
# The path tests are case-INSENSITIVE, because the default macOS volume is:
# `.GITHOOKS/pre-push` and `.githooks/pre-push` are one file there, and a
# case-sensitive match saw only the second. Lowercasing preserves length, so
# the offsets taken from the lowercased copy index the original.
run_file_scan() {
  local fp="$file_path" lower pre root rel parent phys tphys target
  case "$fp" in /*) ;; *) fp="${payload_cwd:-.}/$fp" ;; esac
  lower=$(printf '%s' "$fp" | tr '[:upper:]' '[:lower:]')
  # git's per-user config can define an alias or core.hooksPath for every repo
  # on this machine, this one included, and neither the checker nor the floor
  # can see it. Editing it from inside an adopted checkout is refused.
  for target in "${HOME:-}/.gitconfig" "${XDG_CONFIG_HOME:-${HOME:-}/.config}/git/config"; do
    case "$target" in /*) ;; *) continue ;; esac
    if [[ "$fp" == "$target" ]] \
       || { [[ -e "$fp" ]] && [[ -e "$target" ]] && [[ "$fp" -ef "$target" ]]; }; then
      deny "Refusing to write '$fp': it is git's per-user config, which can set core.hooksPath or define an alias for every repository on this machine, including this one (house.json at $toplevel). Nothing in the repo would show the change. Set what you need with an explicit git config command in the repo, or ask house doctor what the floor reads."
    fi
  done
  case "$lower" in
    */.git/*|*/.git)
      pre="${lower%%/.git*}"; root="${fp:0:${#pre}}"
      if { [[ -d "$root" ]] && [[ "$root" -ef "$toplevel" ]]; } \
         || { [[ -n "$COMMON_DIR" ]] && [[ "$fp" == "$COMMON_DIR"/* ]]; }; then
        deny "Refusing to write '$fp': it is inside the git directory, where the git-hook floor that enforces this repo's branch policy is wired (house.json at $toplevel). Change a hook through a PR from a checkout you do not commit from; house render --apply restores the vendored ones and house doctor reports what is wrong."
      fi ;;
    */.githooks/*|*/.githooks)
      pre="${lower%%/.githooks*}"; root="${fp:0:${#pre}}"
      rel=".githooks${fp:$((${#pre} + 10))}"
      if [[ -d "$root" ]] \
         && { [[ "$root" -ef "$toplevel" ]] || { [[ -d "$MAIN_ROOT" ]] && [[ "$root" -ef "$MAIN_ROOT" ]]; }; }; then
        deny "Refusing to write '$rel': it is part of the git-hook floor that enforces this repo's branch policy (house.json at $toplevel), and an edited or added hook file makes the floor untrusted for every command after it. Change a hook through a PR from a checkout you do not commit from; house render --apply restores the vendored ones."
      fi ;;
  esac
  # A path that reaches the floor through a symlink or a `..` segment spells
  # neither .githooks nor .git, so the tests above cannot see it. Resolve the
  # parent directory physically (cd -P) and compare the directory itself. Only
  # for a path that says "hook" or ".git" somewhere, because this costs four
  # processes and an ordinary source file whose NAME merely holds "git"
  # (src/gitlab-client.ts) should not pay them.
  case "$lower" in *hook*|*.git*) ;; *) return 0 ;; esac
  parent="${fp%/*}"; [[ -n "$parent" ]] || parent='/'
  phys=$(trap - ERR; cd -P "$parent" >/dev/null 2>&1 && pwd -P || echo '')
  [[ -n "$phys" ]] || return 0
  phys=$(trap - ERR; printf '%s' "$phys" | tr '[:upper:]' '[:lower:]')
  for target in "$toplevel/.githooks" "$MAIN_ROOT/.githooks" "$COMMON_DIR"; do
    [[ -n "$target" && -d "$target" ]] || continue
    tphys=$(trap - ERR; cd -P "$target" >/dev/null 2>&1 && pwd -P || echo '')
    [[ -n "$tphys" ]] || continue
    tphys=$(trap - ERR; printf '%s' "$tphys" | tr '[:upper:]' '[:lower:]')
    if [[ "$phys" == "$tphys" || "$phys" == "$tphys"/* ]]; then
      deny "Refusing to write '$fp': it resolves into $target, which is part of the git-hook floor that enforces this repo's branch policy (house.json at $toplevel). Change a hook through a PR from a checkout you do not commit from; house render --apply restores the vendored ones."
    fi
  done
  return 0
}

# ── Deciding one candidate ───────────────────────────────────────────────
MAIN_ROOT=''; COMMON_DIR=''
decide_for_target() {
  local dir="${1/#\~/$HOME}"
  CAND_TEXT="${2:-}"
  # Disarmed while resolving: a bad guess here is a fail-open by design, and
  # the trap armed by an earlier candidate must not turn it into a crash-deny.
  trap - ERR

  # One rev-parse for the toplevel, the shared git directory and the branch.
  # `--git-common-dir` and `--abbrev-ref HEAD` always print a line (an unborn
  # HEAD prints "HEAD" and exits non-zero, which is fine); `--show-toplevel`
  # prints NOTHING when git is run from inside a .git directory. So a
  # three-line answer carries a toplevel and a two-line answer does not, which
  # is exactly the "not a repo for our purposes" case the fallback wants.
  local probe='' rest
  git_dir_arg=(-C "${payload_cwd:-.}")
  if [[ -n "$dir" ]]; then
    # Successive -C compose and an absolute second path still wins, so a
    # RELATIVE candidate resolves against the directory the command runs in.
    # A target parsed out of a command is a GUESS, and a guess that is not a
    # repo falls back to that directory: before the fallback, prose naming a
    # path that does not exist pointed the check at nothing and a real commit
    # on a protected branch was allowed (#1).
    git_dir_arg+=(-C "$dir")
    probe=$(trap - ERR; git "${git_dir_arg[@]}" rev-parse --show-toplevel --git-common-dir --abbrev-ref HEAD 2>/dev/null || true)
    case "$probe" in
      *$'\n'*$'\n'*) ;;
      *) probe=''; git_dir_arg=(-C "${payload_cwd:-.}") ;;
    esac
  fi
  if [[ -z "$probe" ]]; then
    probe=$(trap - ERR; git "${git_dir_arg[@]}" rev-parse --show-toplevel --git-common-dir --abbrev-ref HEAD 2>/dev/null || true)
  fi
  # Deliberate fail-open, not an error: a non-repo dir is not our business.
  case "$probe" in
    *$'\n'*$'\n'*)
      toplevel="${probe%%$'\n'*}"; rest="${probe#*$'\n'}"
      COMMON_DIR="${rest%%$'\n'*}"; branch="${rest#*$'\n'}" ;;
    *) return 0 ;;
  esac
  [[ -n "$toplevel" ]] || return 0

  # A linked worktree shares one config and one .githooks with the checkout
  # that created it, so both the arming advice and the file scan have to know
  # where that is. git reports an ABSOLUTE common dir exactly then; a relative
  # one (`.git`, `../.git`) is relative to the process cwd, not the toplevel,
  # and can only mean this checkout's own git directory, which the file scan
  # already recognises by its path.
  MAIN_ROOT="$toplevel"
  case "$COMMON_DIR" in
    /*/.git) if [[ -d "${COMMON_DIR%/.git}" ]]; then MAIN_ROOT="${COMMON_DIR%/.git}"; fi ;;
  esac
  case "$COMMON_DIR" in /*) ;; *) COMMON_DIR='' ;; esac

  # POLICY: house.json as it is on HEAD, not as the working tree has it. One
  # Write to the working-tree file used to turn every layer off; an edit now
  # only counts once it has landed on the branch through a PR. The working
  # tree is read only when HEAD carries no house.json at all, which is a repo
  # adopting house before its first commit.
  # --no-replace-objects, because a replace ref (refs/replace/<sha>) rewrites
  # what `git show HEAD:house.json` returns without touching a commit or a
  # branch: one `git replace` and HEAD reads as "direct". The plumbing scan
  # refuses the verb too; this is the belt.
  local house_json='' house_src="HEAD:house.json"
  house_json=$(trap - ERR; git --no-replace-objects "${git_dir_arg[@]}" show HEAD:house.json 2>/dev/null || true)
  if [[ -n "$house_json" ]]; then
    :
  elif [[ -f "$toplevel/house.json" ]]; then
    house_src="$toplevel/house.json (HEAD carries none yet)"
    house_json=$(trap - ERR; cat "$toplevel/house.json" 2>/dev/null || true)
  else
    # Absent means the repo has not adopted house; that is fail-open, not an
    # error (ADR 0002).
    return 0
  fi
  [[ -n "$house_json" ]] || return 0

  # One jq pass for the whole manifest: policy, then the protected list, then
  # the carve-outs, separated by a record-separator line. An adopted repo whose
  # manifest cannot be parsed gets a refusal, not a silently disarmed guard:
  # existence signals adoption, so unreadable policy is treated like a crash.
  local parsed ln section=0
  if ! parsed=$(printf '%s' "$house_json" | jq -r '
        (.branchPolicy // "pr"), "\u001e",
        ((.protectedBranches // ["master","main"])[]), "\u001e",
        ((.carveOuts // [])[])' 2>/dev/null); then
    deny "house.json ($house_src) cannot be read as the branch policy, so this hook cannot tell a safe command from a dangerous one. Refusing rather than guessing. Fix house.json (node .house/check.mjs names the error), then retry."
  fi
  branch_policy='pr'; protected_list=''; carve_outs=''
  while IFS= read -r ln; do
    if [[ "$ln" == $'\x1e' ]]; then section=$((section + 1)); continue; fi
    case "$section" in
      0) branch_policy="$ln" ;;
      1) protected_list+="$ln"$'\n' ;;
      *) carve_outs+="$ln"$'\n' ;;
    esac
  done <<<"$parsed"
  [[ -n "$protected_list" ]] || protected_list=$'master\nmain'

  # The repo has adopted house. Arm the crash trap: an unexpected failure from
  # here on denies with a message that says so, instead of exiting non-zero
  # (which Claude Code treats as non-blocking, i.e. the guard silently vanishes
  # exactly when it matters). Every command substitution past this line disarms
  # the trap in its own subshell, or a failing git lookup would print the
  # crash-deny JSON into a variable instead of to stdout.
  trap crashed ERR

  # carveOuts: glob patterns, shell `case` semantics (`*` crosses `/`); schema
  # in plugins/house/schema/house.schema.json.
  carve_out_reason_suffix=""
  if [[ -n "$carve_outs" ]]; then
    local list
    list=$(trap - ERR; printf '%s' "$carve_outs" | tr '\n' ' ')
    carve_out_reason_suffix=" (paths matching a house.json carveOuts glob are exempt: ${list% })"
  fi
  arm_suffix=''

  # TEST HOOK ONLY: lets the harness plant a deliberate internal failure
  # inside the guarded region, after the policy read, to exercise the ERR
  # trap's crash-deny path. Never set in normal operation.
  if [[ "${HOUSE_TEST_CRASH:-}" == "1" ]]; then
    false
  fi

  # A. The floor's OWN protection runs in any adopted repo, before the policy
  # and deference gates below: `branchPolicy: direct` and a repo-local branch
  # guard both say who decides which BRANCH may move, and neither of them is a
  # reason to let a session unarm core.hooksPath, edit a vendored hook, write a
  # replace ref or commit into a repository it names rather than enters. A repo
  # is adopted for this purpose whenever house.json is on HEAD at all.
  if [[ "$MODE" == file ]]; then
    run_file_scan
    return 0
  fi
  run_early_scans

  # B and C, the BRANCH refusals, are what the policy and the repo-local guard
  # speak to.
  [[ "$branch_policy" == "direct" ]] && return 0

  # Repo-local guard present: defer to it during migration onto house.
  local local_hook="$toplevel/.claude/hooks/no-direct-master.sh"
  if [[ -f "$local_hook" ]] && local_hook_is_substantive "$local_hook"; then return 0; fi
  if [[ -f "$toplevel/.claude/settings.json" ]]; then
    # Defer only to a PreToolUse entry that can SEE the call: a settings.json
    # carrying only PostToolUse is not a branch guard, `length > 0` alone is
    # satisfied by any non-empty value (a malformed file Claude Code itself
    # ignores), and an entry whose matcher names other tools guards something
    # else. So an entry counts only when its own hooks array is non-empty and
    # its matcher is absent, empty, `*`, or a regex matching `Bash`. A matcher
    # jq cannot read fails the test, leaving THIS hook armed: the safe way.
    if jq -e '[.hooks.PreToolUse[]? | objects
               | select((.hooks | type) == "array" and (.hooks | length) > 0)
               | . as $e | select(($e.matcher // "") == "" or $e.matcher == "*" or ("Bash" | test($e.matcher)))]
              | length > 0' "$toplevel/.claude/settings.json" >/dev/null 2>&1; then
      return 0
    fi
  fi

  # The repo has adopted house, wants "pr", and has no repo-local guard taking
  # precedence.
  run_branch_scans
  return 0
}

# ── Decide ───────────────────────────────────────────────────────────────
if [[ "$MODE" == file ]]; then
  fdir="${file_path%/*}"
  case "$fdir" in /*) ;; *) fdir='' ;; esac
  decide_for_target "$fdir" ''
  exit 0
fi

collect_candidates "$cmd_for_target"
# The payload cwd is always decided, even with no clause of its own: a command
# that runs git nowhere can still carry a disable literal.
keys=(''); texts=('')
while IFS= read -r line; do
  [[ -n "$line" ]] || continue
  IFS="$US" read -r key clause <<<"$line"
  found=''
  for ((k = 0; k < ${#keys[@]}; k++)); do
    [[ "${keys[$k]}" == "$key" ]] && { found="$k"; break; }
  done
  if [[ -n "$found" ]]; then texts[found]+=$'\n'"$clause"
  else keys+=("$key"); texts+=("$clause"); fi
done <<<"$CANDIDATES"
for ((k = 0; k < ${#keys[@]}; k++)); do
  decide_for_target "${keys[$k]}" "${texts[$k]}"
done

exit 0
