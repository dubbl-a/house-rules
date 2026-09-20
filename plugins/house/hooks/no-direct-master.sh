#!/usr/bin/env bash
# PreToolUse hook for Bash: enforce the branch+PR workflow for repos that
# have adopted house and opted a policy in via <toplevel>/house.json.
#
# Blocks:
#   - `git commit ...` while the target worktree is on a protected branch
#   - `git push ...`   while the target worktree is on a protected branch,
#     unless every push clause in the command moves only tags (see
#     push_args_are_tag_only: a positive grammar, refused when in doubt)
#   - `git push <args> <protected>` whose refspec targets a protected branch,
#     in ANY clause of the command, from any branch
#   - from any branch, a push that can move a protected branch without naming
#     it: --all, --branches, --mirror, --prune, a wildcard or computed ref, a
#     `-c push.*` or `remote.<name>.push=` key
#   - a git verb the shell computes (`git pu${x}sh`): refused on a protected
#     branch, and read as a push from any branch
#   - from any branch, a push whose meaning lives outside the text (#34): a
#     push or a verb handed to git by xargs; a push that names no refspec
#     while the repo's config carries `push.default=matching` or a
#     `remote.<name>.push`; a `-c alias.*` or a git config variable passed
#     through the environment (GIT_CONFIG_PARAMETERS, GIT_CONFIG_COUNT); a
#     shell alias (`!...`) that runs git, and any shell alias on a protected
#     branch; a verb that is neither a command git lists nor an alias it
#     can find. A plain alias is read as the verb it expands to.
#
# The command is read by one token walker (git_split), not by adjacency: a
# global option between `git` and the verb, a nested git command inside an
# argument, and every clause behind a separator are all read. Each verb is
# looked up in the target repo's git config so an alias is read as what it
# expands to.
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
#     does not defer this one). Every matching PreToolUse hook still runs
#     and the most restrictive decision wins, so this deferral is a
#     deliberate migration choice here, not something the harness requires.
#
# Also fails open, silently, wherever this hook never runs or never sees the
# command: a session started bare or in safe mode loads no project hooks,
# restricted mode ignores project settings, and a shell command routed
# through a Cowork workspace tool or a git operation performed by an MCP
# server arrives as an MCP tool call rather than a Bash one, so nothing here
# inspects it. Where that coverage matters, a deny rule naming the whole tool
# is the only floor that still binds; an allow rule for Bash never carries
# over to the Cowork tool.
#
# Fails CLOSED (deny) whenever jq is missing (cannot parse the payload, so
# cannot tell a safe command from a dangerous one) and whenever an
# unexpected internal failure happens after the policy has been read (see
# the trap below). Those are the only two deny-without-a-specific-rule
# paths; every other deny names the offending branch and rule source.
#
# Worktree-aware: every `git -C <path>`, `cd <path> &&`, `cd <path> ;`
# (a `cd` inside an interpreter's -c body included), and every
# `GIT_DIR=`/`GIT_WORK_TREE=` prefix or `--git-dir`/`--work-tree` option in
# the command is a candidate target, and the whole command is decided once
# per candidate against THAT repo's branch and toplevel, not the hook's own
# cwd. Any candidate that refuses, refuses the call (#34).
#
# Still open by decision (#34, item 5): a git verb inside a quoted value that
# is prose (`--body "... git push ..."`) is refused on a protected branch,
# and the refusal names the file route. Scanning text rather than parsing
# shell cannot tell that prose from code, and the file route costs nothing.
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
# `-f`: no pathname expansion anywhere in this script. Nothing here needs it
# (carve-out globs are matched by `case`, which -f does not touch), and an
# unquoted `$push_clause` token such as `m?ster` or `ma[s]ter` used to expand
# against the hook's own cwd, so the decision depended on which files happened
# to be there (#1, review round 3).
set -Euf -o pipefail

payload=$(cat)

# Cheap early exit, before any jq work: if the raw payload text doesn't
# even contain "git", tool_input.command can't be a git invocation either,
# so there is nothing to check. String match before any jq where possible:
# this skips spawning jq entirely for the large majority of Bash calls,
# and for every non-Bash payload this hook is ever handed.
case "$payload" in
  *git*) ;;
  *\\*) ;;   # a backslash can spell the word (`gi\t`); JSON doubles it, so it shows here
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

# Backslashes go first, the way the shell reads them: a backslash-newline is a
# line continuation and vanishes; an escaped quote is a literal character that
# must NOT re-pair with the quotes around it, so it vanishes whole (leaving the
# bare quote behind re-paired `-m "a\" cd <sibling> && x"` into a stripped
# `"a"` and a live `cd <sibling> &&`, which steered target resolution); and
# every other backslash escapes the next character, which stays. Done to the
# whole command before any scan or strip, because a backslash anywhere in a
# word hid that word from every reader here: `gi\t commit`, `git co\mmit`,
# `git \`+newline+`commit` and `mas\ter` were all invisible (#1, adversarial
# round 2). Deleting a backslash can only merge characters into a word the
# scans then see, never split one apart.
cmd="${cmd//\\$'\n'/}"
cmd="${cmd//\\\"/}"
cmd="${cmd//\\\'/}"
cmd="${cmd//\\/}"
# Then the expansions this text can predict, on the whole command for the same
# reason: every spelling of IFS (`$IFS`, `${IFS}`, `${IFS:0:1}`) is what the
# shell splits on and becomes a space; a parameter expansion with a default or
# alternate value (`${x:-master}`, `${x:-git} commit`, `git ${x:-} commit`) is
# read as that value, since the shell may well produce it. Done here rather
# than in the clause splitter alone, because the verb scans read the unsplit
# text and `${x:-git} commit` on master was invisible to them (#1, adversarial
# round 3). What this text cannot predict (`$BR`, `pu${x}sh`) is refused
# further down as computed rather than guessed at.
cmd=$(printf '%s' "$cmd" | sed -E '
  s/\$\{IFS[^}]*\}/ /g;
  s/\$IFS/ /g;
  s/\$\{[A-Za-z_][A-Za-z0-9_]*:?[-+=?]([^}]*)\}/\1/g')

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
# match. Single-pass, not a full shell parser. One helper for the two verb-scan
# variants below (stripped and -c-retaining) so they can never desynchronize
# their sed rules; target resolution has its own blind helper further down,
# and the difference between the two is deliberate (see there).
#
# The flag must START a token, hence the `(^|[[:space:]])` and the `\1` that
# puts the separator back. Without it the alternation matched INSIDE a word:
# the -c of a directory named ...-council-audit-findings was read as the flag,
# the rest of the segment was eaten as its value, and the path the target
# resolution below parsed out was a directory that does not exist. The fallback
# then sent the check to the payload cwd, so a commit from a perfectly good
# feature branch was refused as being on the protected one (#17, and the
# addendum to #1). Any segment beginning -c, -m, or -F after a hyphen hit it.
#
# There is deliberately NO boundary on the RIGHT. Requiring `=` or whitespace
# after the flag reads better and was wrong: it left git's own attached form
# `git -cuser.name=x commit` unstripped, and while the verb scans still matched
# by adjacency that string did not match, so a real commit on a protected
# branch was ALLOWED. The token walker (git_split, below) now finds the verb
# past any global option, so today the cost would only be a value left in the
# text; the rule stays because a flag's value is never a verb and removing it
# whole is the direction this strip is allowed to fail in. Under-stripping
# costs a false deny, over-stripping costs a bypass. Both directions are
# pinned in tests/hooks/run.sh.
#
# A value that would EXPAND is never stripped. A double-quoted or bare value
# holding `$` or a backtick is code the shell will run, not prose: the strip
# used to remove `-m "$(git push origin master)"` whole, the verb scans saw a
# bare commit, and the push inside the substitution ran (#1). So the
# double-quoted and bare classes stop at either character and the text stays
# in view. A single-quoted value does not expand and stays strippable; a `$`
# in double-quoted prose now costs a false deny only when a verb sits beside
# it, which is the direction this strip is allowed to fail in.
_strip_flag_args() {
  printf '%s' "$2" | sed -E "
    s/(^|[[:space:]])($1)=?[[:space:]]*'[^']*'/\1/g;
    s/(^|[[:space:]])($1)=?[[:space:]]*\"[^\"\`\$]*\"/\1/g;
    s/(^|[[:space:]])($1)=?[[:space:]]*[^[:space:]'\"\`\$(]+/\1/g"
}
# The bare class above also stops at `(`: a process substitution `-F <(git
# push origin master)` is code too, and stripping `<(git` as a bare value left
# `push origin master)` with no `git` before it (#1, review round 3).
# Full strip for the verb scans: message flags expand-aware, -c BLIND. The
# expand-aware rule is right only for a flag that sits AFTER the verb, where a
# residue can add a match but never break one. git's -c sits BEFORE the verb:
# leaving `$USER` behind from `-c user.name=$USER commit` put a token between
# `git` and `commit`, neither scan variant matched, and a commit on master was
# allowed (#1, adversarial round). So -c is stripped whole here; the
# -c-retaining variant below still shows an interpreter's body to the scans.
strip_message_args() { _strip_flag_args_blind '-c' "$(_strip_flag_args '-m|--message|-F|--file' "$1")"; }
# The BLIND strip, quoted and bare values removed whole, `$` and backtick
# included, for target resolution and for -c in the verb scans. The two kinds
# of consumer fail in opposite directions. For a message flag in the verb
# scans, text left in can only add a deny.
# For target resolution, text left in is a steering wheel: a `cd <repo> &&`
# inside a message value that survived the strip is parsed as the target, and
# a real sibling repo on a feature branch is a fail-open. The first version of
# the expand-aware strip above was used here too and did exactly that (#1,
# review round 1): `-m "cost $5. cd ../sibling && done"` on master was allowed.
# So target resolution keeps the old rules. A -c value must not steer either,
# hence -c is in this alternation as well.
#
# The value is one shell WORD: a run of bare characters, quoted spans,
# substitutions (`$(...)`, backticks) and parameter expansions (`${...}`) in
# any mix, ending at unquoted whitespace. Three separate rules (quoted, quoted,
# bare) left `-c a="b c"` half-stripped, `a=` gone and `"b c"` behind, which
# put a token between `git` and the verb and hid the commit (#1, the quoted
# -c seam); the same happened to `-c a=$(id -un)` once the word stopped at the
# space inside the substitution. One rule over the whole word closes both. More
# stripping is safe for these two consumers and no other: target resolution
# guesses less, and the -c-retaining variant still shows an interpreter's body
# to the verb scans.
_strip_flag_args_blind() {
  printf '%s' "$2" | sed -E "
    s/(^|[[:space:]])($1)=?[[:space:]]*([^[:space:]'\"]|'[^']*'|\"[^\"]*\"|\\\$\([^)]*\)|\\\$\{[^}]*\}|\`[^\`]*\`)+/\1/g"
}
strip_message_args_for_target() { _strip_flag_args_blind '-m|--message|-F|--file|-c' "$1"; }
# The same strip with -c RETAINED. An interpreter's -c body is code that will
# run (`bash -c 'git commit -m x'`), not prose, so the verb scans below must
# see it; stripping it blinded them to every interpreter since v0.2.2 (#1).
# git's own `git -c key=value commit` with a space-free value still denies
# through the full strip, so scanning the UNION of the two variants can only
# add denials, never remove one. Known still-open (#1, NOT closed here): a -c
# body that changes directory into another repo is target-blind. That is the
# parser seam #1 warns against chasing; the quoted -c value with spaces was
# closed later by the blind whole-word strip below.
strip_flag_args_keep_dash_c() { _strip_flag_args '-m|--message|-F|--file' "$1"; }

# ── Target candidates ─────────────────────────────────────────────────────
# Every directory the command names is a candidate target, and the whole
# command is decided once per candidate; any candidate that refuses, refuses
# the call. Until 0.10.0 the FIRST `git -C <path>` or `cd <path> &&` won and
# everything else was invisible (#34): a `cd` inside an interpreter's -c body
# was stripped before resolution, so `bash -c 'cd ../main-repo && git commit'`
# from a feature-branch cwd was checked against the feature branch; a second
# `cd` behind the first was never read; and an environment prefix
# (`GIT_DIR=<other>/.git GIT_WORK_TREE=<other> git commit`) or the same pair
# as `--git-dir`/`--work-tree` options redirected git to a repo the check
# never looked at. Reading every candidate is the safe direction: the cost is
# a false deny when one directory in a chain is on a protected branch and the
# guarded verb was meant for another, and the refusal names the branch.
#
# Candidates come from the BLIND-stripped command (message values gone, so
# prose cannot steer) plus a second text that keeps -c values (an
# interpreter's body is code, and the `cd` in it is real). A path that is
# not a repo is a wrong guess and falls back to the payload cwd, as before.
#   1. `git -C <path> ...`               -> dir <path>
#   2. `cd <path> && ...` / `cd <path> ; ...` -> dir <path>
#   3. `GIT_DIR=<g> GIT_WORK_TREE=<w>` or `--git-dir <g>` / `--work-tree <w>`
#                                        -> env <g> <w>, handed to git as its
#                                           own --git-dir/--work-tree so git
#                                           resolves them the way it will
#   4. none of the above                 -> the payload's cwd
cmd_for_target=$(strip_message_args_for_target "$cmd")
cmd_for_target_c=$(_strip_flag_args_blind '-m|--message|-F|--file' "$cmd")
payload_cwd=$(jq -r '.cwd // ""' <<<"$payload" 2>/dev/null || echo "")

# One candidate per line, fields joined by a unit separator (a tab would
# collapse an empty field under `read`): kind, path, second path.
US=$'\x1f'
CANDIDATES=''
add_candidate() { CANDIDATES+="$1"$'\n'; }
collect_dir_targets() {
  local rest="$1"
  while [[ "$rest" =~ git[[:space:]]+-C[[:space:]]+([^[:space:]]+) ]]; do
    add_candidate "dir${US}${BASH_REMATCH[1]}${US}"
    rest="${rest#*"${BASH_REMATCH[0]}"}"
  done
  rest="$1"
  while [[ "$rest" =~ (^|[^[:alnum:]])cd[[:space:]]+([^[:space:]&\;|]+)[[:space:]]*(\&\&|\;) ]]; do
    add_candidate "dir${US}${BASH_REMATCH[2]}${US}"
    rest="${rest#*"${BASH_REMATCH[0]}"}"
  done
  return 0
}
collect_env_targets() {
  local text="$1" gd='' wt=''
  [[ "$text" =~ (^|[[:space:]])GIT_DIR=([^[:space:]]+) ]] && gd="${BASH_REMATCH[2]}"
  [[ "$text" =~ (^|[[:space:]])GIT_WORK_TREE=([^[:space:]]+) ]] && wt="${BASH_REMATCH[2]}"
  [[ "$text" =~ [[:space:]]--git-dir(=|[[:space:]]+)([^[:space:]]+) ]] && gd="${BASH_REMATCH[2]}"
  [[ "$text" =~ [[:space:]]--work-tree(=|[[:space:]]+)([^[:space:]]+) ]] && wt="${BASH_REMATCH[2]}"
  [[ -n "$gd$wt" ]] && add_candidate "env${US}${gd}${US}${wt}"
  return 0
}
unquote_path() {
  local p="$1"
  p="${p/#\~/$HOME}"
  p="${p%\"}"; p="${p#\"}"
  p="${p%\'}"; p="${p#\'}"
  printf '%s' "$p"
}

# The git commands this hook can name, for the alias seam below: a verb that
# is neither on this list nor an alias git can look up is refused, since git
# itself would fail on it and an alias defined earlier in the same call is
# exactly what it would otherwise be. Empty on a git too old to list its
# commands, in which case only the alias lookup runs.
known_cmds=$(git --list-cmds=builtins,main,others 2>/dev/null || true)
verb_is_known() {
  [[ -n "$known_cmds" ]] || return 0
  case $'\n'"$known_cmds"$'\n' in
    *$'\n'"$1"$'\n'*) return 0 ;;
  esac
  return 1
}

# True when a repo-local guard file has at least one line that is not blank,
# a comment, or a bare `exit`/`exit 0`; shared definition with the checker.
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

# decide_for_target KIND PATH PATH2: resolve one candidate, read the policy
# it lands in, and run every scan against it. Returns 0 to let the call
# through for THIS candidate; a refusal exits the process from inside deny.
decide_for_target() {
  local kind="$1" p1 p2 from_command=1
  p1=$(unquote_path "$2"); p2=$(unquote_path "$3")
  # Disarmed while resolving: a bad guess here is a fail-open by design, and
  # the trap armed by an earlier candidate must not turn it into a crash-deny.
  trap - ERR

  case "$kind" in
    cwd) from_command=0; git_dir_arg=(-C "${payload_cwd:-.}") ;;
    # Successive -C compose, and an absolute second path still wins, so this
    # resolves a RELATIVE guess (`cd ../other-repo`) against the directory the
    # command actually runs in rather than against whatever cwd the hook
    # process happens to have.
    dir) git_dir_arg=(-C "${payload_cwd:-.}" -C "$p1") ;;
    env)
      git_dir_arg=(-C "${payload_cwd:-.}")
      [[ -n "$p1" ]] && git_dir_arg+=("--git-dir=$p1")
      [[ -n "$p2" ]] && git_dir_arg+=("--work-tree=$p2") ;;
  esac

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
  if [[ "$from_command" -eq 1 ]] \
     && ! git "${git_dir_arg[@]}" rev-parse --show-toplevel >/dev/null 2>&1; then
    git_dir_arg=(-C "${payload_cwd:-.}")
  fi
  # Known cost of the fallback, accepted rather than parsed around: a target
  # this command is about to CREATE (a worktree, a clone, a fresh init) does not
  # resolve yet either, so those deny on a protected branch and have to be run
  # as two calls. Recognizing creation would mean reading the command again,
  # which is what three reverted attempts did; the deny message below says
  # "separate call" instead so the guidance and the behavior agree.

  # Deliberate fail-open, not an error: a non-repo dir is not our business.
  toplevel=$(git "${git_dir_arg[@]}" rev-parse --show-toplevel 2>/dev/null) || return 0
  [[ -z "$toplevel" ]] && return 0

  branch=$(git "${git_dir_arg[@]}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

  # POLICY: <toplevel>/house.json. Absent means the repo has not adopted
  # house; that is fail-open, not an error.
  house_json="$toplevel/house.json"
  [[ -f "$house_json" ]] || return 0

  # An adopted repo whose manifest cannot be parsed gets a refusal, not a
  # silently disarmed guard: existence signals adoption, so unreadable policy
  # is treated like a crash (refuse rather than guess). The loud fix surface
  # is `node .house/check.mjs` (manifest family), which names the parse error.
  if ! jq empty "$house_json" >/dev/null 2>&1; then
    deny "house.json exists but is not valid JSON, so the branch policy cannot be read. Refusing rather than guessing. Fix house.json (node .house/check.mjs names the error), then retry."
  fi

  branch_policy=$(jq -r '.branchPolicy // "pr"' "$house_json" 2>/dev/null || echo "pr")
  [[ "$branch_policy" == "direct" ]] && return 0

  # Repo-local guard present: defer to it during migration onto house. Either
  # a repo-local hook script, or a repo-local .claude/settings.json that
  # declares its own "hooks" key.
  #
  # #1: deference used to be by mere file EXISTENCE, which made an empty or
  # no-op `exit 0` file a complete disarm -- and `checkGuard` certified that same
  # file by bare existsSync, so the checker reported the repo as protected while
  # nothing was enforcing anything. Protection reported, none present, is worse
  # than no guard at all.
  #
  # So require substance, with the predicate failing toward DENY: a local guard
  # whose shape we do not recognize leaves THIS hook armed, which costs a branch
  # creation, never a miss. That is the direction #1 asks every allowlist here
  # to fail in. The checker shares this definition.
  local local_hook="$toplevel/.claude/hooks/no-direct-master.sh"
  if [[ -f "$local_hook" ]] && local_hook_is_substantive "$local_hook"; then
    return 0
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
      return 0
    fi
  fi

  # From here on, the repo has adopted house, wants "pr" enforcement, and has
  # no repo-local guard taking precedence. Arm the crash trap: an unexpected
  # failure from this point forward denies with a message that says so,
  # instead of exiting non-zero (which Claude Code treats as non-blocking,
  # i.e. the guard would silently vanish exactly when it matters most).
  trap crashed ERR

  protected_list=$(jq -r '(.protectedBranches // ["master","main"])[]' "$house_json" 2>/dev/null)
  if [[ -z "$protected_list" ]]; then
    protected_list=$'master\nmain'
  fi

  # carveOuts: glob patterns, shell `case` semantics (`*` crosses `/`); schema
  # in plugins/house/schema/house.schema.json.
  carve_outs=$(jq -r '(.carveOuts // [])[]' "$house_json" 2>/dev/null)

  carve_out_reason_suffix=""
  if [[ -n "$carve_outs" ]]; then
    local carve_out_list
    carve_out_list=$(printf '%s' "$carve_outs" | tr '\n' ' ')
    carve_out_reason_suffix=" (paths matching a house.json carveOuts glob are exempt: ${carve_out_list% })"
  fi

  # TEST HOOK ONLY: lets the test harness plant a deliberate internal
  # failure inside the guarded region, after the policy read, to exercise
  # the ERR trap's crash-deny path. Never set in normal operation.
  if [[ "${HOUSE_TEST_CRASH:-}" == "1" ]]; then
    false
  fi

  run_scans
  return 0
}

# Strip quoted-string contents and shell comments before pattern matching so
# commit message text and trailing comments can't trigger false positives.
# Single-pass strip, not a full shell parser; fail-fast UX for Claude's
# direct invocations.
#
# Which protection is real (this hook vs. GitHub's own) is a per-repo fact,
# not a constant: see docs/handbook/github.md, "The branch guard's reach, and
# which protection is real."
#
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
# One clause per line: the text split on every shell separator, so a scan
# that walks the clauses reads ALL of them. The refspec scan below used to
# take the first regex match per variant and stop, so a push to a protected
# branch chained behind an innocent one (`git push origin feat && git push
# origin master`) was never read (#1). Parentheses and backticks become
# SPACES, not clause breaks: a substitution or subshell closes with `)` glued
# to the last token (`$(git push origin master)`), and a space frees it. A
# clause break there was tried and rejected: it moved everything after the
# character out of the push clause, so `git push $(echo origin) master` was
# never scanned. A redirection goes with its target (`2>&1`, `>/dev/null`,
# `>>log`): the target is a file, never a ref, and reading `/dev/null` as a
# refspec refused `git push --tags origin >/dev/null` (#1, adversarial round
# 4); `<(` keeps its parenthesis, since what follows is code. Parameter
# expansion for the split itself: BSD sed has no `\n` in a replacement.
# Backslashes, IFS and parameter defaults were already handled on the whole
# command, above.
# Sets CLAUSES rather than printing, so it runs in the parent shell: called
# through a process substitution, a failing sed here would have fired the ERR
# trap in the subshell, and the crash-deny JSON would have come back as clause
# text with no git token in it, which is an allow. In the parent a failure
# denies the way the contract promises.
CLAUSES=''
split_clauses() {
  local c="$1"
  if ! c=$(printf '%s' "$c" | sed -E 's/[0-9]*(&>>|&>|>&|<&|>>|>|<)[[:space:]]*[^[:space:](]*/ /g'); then
    crashed
  fi
  c="${c//\|\|/$'\n'}"
  c="${c//&&/$'\n'}"
  c="${c//;/$'\n'}"
  c="${c//&/$'\n'}"
  c="${c//\|/$'\n'}"
  c="${c//\(/ }"
  c="${c//\)/ }"
  c="${c//\`/ }"
  CLAUSES="$c"
}

# ── Reading one clause ───────────────────────────────────────────────────
# git_split CLAUSE finds the git command in a clause and sets:
#   GV_VERB     the first token after `git` that is not a global option,
#               with the options that take a separate value skipped;
#   GV_ARGS     the tokens after the verb, one per line;
#   GV_COMPUTED 1 when the verb holds a `$`, a backtick, a brace, or a quote,
#               so the shell computes it and this text cannot.
# Returns 1 when the clause has no git token or no verb after it.
#
# This replaces the adjacency regexes that required `git` and the verb to be
# neighbours, or separated only by `-C <path>`. Every other global option
# (`--no-pager`, `-p`, `--literal-pathspecs`, `--exec-path=`, `--git-dir=`)
# sat between them and defeated every scan, so `git --no-pager commit -m x`
# committed on master and `git -p push --force origin master` moved it (#1,
# adversarial round 4, open since e0fd6d1). Walking tokens has no such seam:
# a flag is a flag whatever it is called, and the verb is what comes after.
# The value-taking list is git's own; a flag missing from it costs a wrong
# verb read, which is a false deny or a miss only for a flag whose VALUE is a
# git verb, and git rejects `-C=x` and friends outright.
GV_VERB=''; GV_ARGS=''; GV_COMPUTED=0
git_split() {
  local toks=() i=0 n tok pre_xargs=0
  GV_VERB=''; GV_ARGS=''; GV_COMPUTED=0
  IFS=$' \t\n' read -r -a toks <<<"$1"
  n="${#toks[@]}"
  [[ "$n" -gt 0 ]] || return 1
  while [[ "$i" -lt "$n" ]]; do
    tok="${toks[$i]}"
    i=$((i + 1))
    # xargs hands git its arguments from stdin, which this text cannot read
    # (#34, seam 1): `echo master | xargs git push origin` names no ref in the
    # push clause, and `echo 'push origin master' | xargs git` names no verb.
    # Remembered here and acted on once the verb is known: a push, or a git
    # with no verb after it, is refused; a harmless verb (`xargs git add`) is
    # left alone.
    [[ "$tok" == xargs ]] && pre_xargs=1
    if [[ "$tok" == git || "$tok" == */git ]]; then
      while [[ "$i" -lt "$n" ]]; do
        tok="${toks[$i]}"
        i=$((i + 1))
        case "$tok" in
          -c|-C|--git-dir|--work-tree|--namespace|--super-prefix|--config-env|--attr-source) i=$((i + 1)) ;;
          -*) ;;
          # A `git` where the verb should be starts a new git command (the
          # -c value `a=$(git push …)` split into `a=$ git push …`); read on
          # from it rather than taking `git` as the verb.
          git|*/git) ;;
          *)
            GV_VERB="$tok"
            case "$tok" in
              *'$'*|*'`'*|*'{'*|*'"'*|*"'"*) GV_COMPUTED=1 ;;
            esac
            while [[ "$i" -lt "$n" ]]; do
              GV_ARGS+="${toks[$i]}"$'\n'
              i=$((i + 1))
            done
            [[ "$GV_COMPUTED" -eq 0 ]] && resolve_alias
            if [[ "$pre_xargs" -eq 1 && "$GV_VERB" == push ]]; then
              deny "Refusing: this push takes its arguments from xargs, so the branch guard cannot read the ref it will move (house.json at $toplevel). Spell the remote and the branch on the git command itself."
            fi
            return 0 ;;
        esac
      done
      if [[ "$pre_xargs" -eq 1 ]]; then
        deny "Refusing: xargs supplies this git command's verb from stdin, which the branch guard cannot read (house.json at $toplevel). Spell the git command in full."
      fi
      return 1
    fi
  done
  return 1
}
# A git alias is a verb this text cannot read (#34, seam 4): `git ci` with
# `alias.ci=commit` in config is not `commit` to the walker. The meaning lives
# in git's config, so ask git. A plain alias is read as the verb it expands
# to, its own arguments put in front of the command's, nested up to a few
# levels; a shell alias (`!...`) runs whatever it likes, so on a protected
# branch it is refused outright, and from any branch it is refused when its
# body, quotes and backslashes removed the way the command was, so much as
# mentions git or push. A verb that is neither a command git lists nor an
# alias git can find is refused too: git would fail on it anyway, and the one
# way it could succeed is an alias defined earlier in the same call, which is
# exactly the case a lookup cannot see. Looked up against the candidate
# target's config, so an alias in that repo or the user's global config is
# read; one injected on the command line or through the environment is
# refused before this runs.
resolve_alias() {
  local depth=0 alias_val first rest body
  while [[ "$depth" -lt 5 ]]; do
    # The lookup runs with the trap disarmed inside its own subshell: a
    # missing alias is git exiting 1, and with the trap armed that exit
    # would print the crash-deny JSON INTO alias_val (the same seam the
    # clause splitter records), which then read as a computed verb.
    alias_val=$(trap - ERR; git "${git_dir_arg[@]}" config --get "alias.$GV_VERB" 2>/dev/null || true)
    [[ -n "$alias_val" ]] || break
    if [[ "$alias_val" == '!'* ]]; then
      if is_protected_branch "$branch"; then
        deny "Refusing: 'git $GV_VERB' is a shell alias, which the branch guard cannot read on '$branch' (house.json at $toplevel). Run the underlying command in full."
      fi
      body="${alias_val//\\/}"; body="${body//\"/}"; body="${body//\'/}"
      case "$body" in
        *git*|*push*)
          deny "Refusing: 'git $GV_VERB' is a shell alias that runs git, which the branch guard cannot read (house.json at $toplevel). Run the underlying command in full." ;;
      esac
      return 0
    fi
    read -r first rest <<<"$alias_val"
    GV_VERB="$first"
    if [[ -n "$rest" ]]; then
      local w prefix=''
      for w in $rest; do prefix+="$w"$'\n'; done
      GV_ARGS="$prefix$GV_ARGS"
    fi
    case "$GV_VERB" in
      *'$'*|*'`'*|*'{'*|*'"'*|*"'"*) GV_COMPUTED=1; return 0 ;;
    esac
    depth=$((depth + 1))
  done
  if ! verb_is_known "$GV_VERB"; then
    deny "Refusing: '$GV_VERB' is an unknown git command here, neither one git lists nor an alias it can find, so the branch guard cannot read it (house.json at $toplevel). If it is an alias this same command defines, define it in a call of its own; if it is prose, write the text to a file and pass the file (--body-file, -F)."
  fi
  return 0
}
# A clause can hold more than one git command: a substitution inside an
# argument (`git commit -m $(git push origin master)`) is a second one, and
# reading only the first let the push inside run (#1, round 5). So every
# reader walks on: after one git command is read, the tokens after its verb
# are read again as a clause of their own until no git token remains.
# git_next reloads GV_* from what follows the verb just read; it returns 1
# when nothing is left.
git_next() { git_split "${GV_ARGS//$'\n'/ }"; }
# verb_in_text VERB TEXT: split TEXT into clauses and read every git command
# in every clause (git_next walks a clause holding more than one), returning
# 0 the moment VERB turns up as a verb anywhere. Shared by any_clause_verb
# (one text per scan variant) and blind_has_verb (one fixed text, cmd_blind).
verb_in_text() {
  local verb="$1" text="$2" clause
  split_clauses "$text"
  while IFS= read -r clause; do
    if git_split "$clause"; then
      while :; do
        [[ "$GV_VERB" == "$verb" ]] && return 0
        git_next || break
      done
    fi
  done <<<"$CLAUSES"
  return 1
}
# any_clause_verb VERB: does any clause of any scan variant run git with this
# verb? Decided per clause and per git command within it, over every variant,
# so a verb hidden behind any separator or any global option is read like one
# in front.
any_clause_verb() {
  local v
  for v in "${scan_variants[@]}"; do
    verb_in_text "$1" "$v" && return 0
  done
  return 1
}

# Is one push clause (its arguments after the verb) a tag-only publish? A
# positive grammar written in the safe direction: the form it does not name
# is refused, never let through, so a forgotten entry costs a false deny and
# not a miss. Exactly `--tags` is the only flag allowed; the first positional
# must be a remote git knows; every later token must be `refs/tags/<x>` with
# the tag present, the pair `tag <x>`, or a bare `<x>` that is a tag and NOT
# also a branch (git would push the branch); nothing may carry `:` or a
# leading `+`; and a tag must be named unless `--tags` is. `--tag`, git's
# abbreviation of `--tags`, is not `--tags` here and is refused, as is
# `--follow-tags`, which moves the branch too. A tag push moves no branch ref,
# so it cannot be the thing this guard exists to stop; the documented release
# step is a tag push from the default branch, and refusing it sent every tag
# through `gh api`.
# True if refs/<namespace>/<name> exists (namespace: tags or heads). One
# function for both lookups push_args_are_tag_only needs: is this token a
# real tag, and separately, is it also a branch (git would push the branch).
ref_exists() {
  if git "${git_dir_arg[@]}" show-ref --verify --quiet "refs/$1/$2"; then return 0; fi
  return 1
}
remote_known() {
  local r
  while IFS= read -r r; do
    [[ "$r" == "$1" ]] && return 0
  done < <(git "${git_dir_arg[@]}" remote 2>/dev/null)
  return 1
}
push_args_are_tag_only() {
  local tok remote_seen=0 refspecs=0 tags_flag=0 want_tag=0
  while IFS= read -r tok; do
    [[ -n "$tok" ]] || continue
    if [[ "$want_tag" -eq 1 ]]; then
      want_tag=0
      ref_exists tags "$tok" || return 1
      refspecs=$((refspecs + 1))
      continue
    fi
    case "$tok" in
      --tags) tags_flag=1 ;;
      -*|*:*|+*) return 1 ;;
      tag)
        [[ "$remote_seen" -eq 1 ]] || return 1
        want_tag=1 ;;
      refs/tags/*)
        [[ "$remote_seen" -eq 1 ]] || return 1
        ref_exists tags "${tok#refs/tags/}" || return 1
        refspecs=$((refspecs + 1)) ;;
      *)
        if [[ "$remote_seen" -eq 0 ]]; then
          remote_known "$tok" || return 1
          remote_seen=1
        else
          ref_exists tags "$tok" || return 1
          if ref_exists heads "$tok"; then return 1; fi
          refspecs=$((refspecs + 1))
        fi ;;
    esac
  done <<<"$1"
  [[ "$want_tag" -eq 0 ]] || return 1
  if [[ "$tags_flag" -eq 0 ]]; then
    [[ "$remote_seen" -eq 1 && "$refspecs" -gt 0 ]] || return 1
  fi
  return 0
}
# Every push clause across every scan variant is tag-only, and at least one
# push clause was seen. Decided over ALL clauses, never the leftmost: the tag
# carve-out in the reverted attempt read the first clause only, so a branch
# publish rode in behind a tag publish.
#
# Any other clause that runs git, or that carries the word `push` without a
# git token, refuses the carve-out outright: a push this text cannot read
# (`git pu${x}sh origin master`) must never ride through the protected-branch
# block behind a tag push (#1, review rounds 1 and 3). The cost is one push
# per call: a tag push chained with any other git command is refused, and the
# refusal says so.
all_push_clauses_tag_only() {
  local v clause args seen=0
  for v in "${scan_variants[@]}"; do
    split_clauses "$v"
    while IFS= read -r clause; do
      if git_split "$clause"; then
        [[ "$GV_VERB" == push && "$GV_COMPUTED" -eq 0 ]] || return 1
        seen=1
        args="$GV_ARGS"
        # A second git command inside the arguments is not tag-only either.
        if git_next; then return 1; fi
        push_args_are_tag_only "$args" || return 1
      elif [[ "$clause" =~ (^|[^[:alnum:]])(git|push)([^[:alnum:]_-]|$) ]]; then
        return 1
      fi
    done <<<"$CLAUSES"
  done
  [[ "$seen" -eq 1 ]] || return 1
  return 0
}

# The blind strip: every quoted span removed outright. Never used to DECIDE,
# because a blind strip turns `git 'commit'` into `git ` and that is a bypass;
# used only to choose the words of a refusal. When a verb is found in the
# decided text but not here, the verb sat inside quotes, and the refusal says
# so and names the file route. Writing ABOUT the guard used to be refused with
# a message about branches, which read as a bug rather than a rule (#1).
cmd_blind=$(strip_message_args "$cmd" | sed -E "
  s/'[^']*'//g;
  s/\"[^\"]*\"//g;
  s/(^|[[:space:]])#.*\$//")
blind_has_verb() {
  verb_in_text "$1" "$cmd_blind"
}
quoted_only_hint() {
  # A quoted span holding a substitution or a backtick is code that runs, not
  # prose; the file route would be the wrong advice, so say nothing.
  if [[ "$cmd" == *'$('* || "$cmd" == *'`'* ]]; then
    printf ''
  elif blind_has_verb "$1"; then
    printf ''
  else
    printf ' %s' "The git verb here appears only inside a quoted string. If that text is prose (an issue body, a note), write it to a file with the Write tool and pass the file instead (--body-file, -F)."
  fi
}

# run_scans: every decision, against the candidate decide_for_target has
# resolved (git_dir_arg, toplevel, branch, protected_list, carve_outs).
run_scans() {
# Config that arrives through the environment (#34, seam 2) can define an
# alias, a push key, or a remote refspec that none of the scans below can see,
# and nothing in a session needs it. Refused outright.
case "$cmd" in
  *GIT_CONFIG_PARAMETERS=*|*GIT_CONFIG_COUNT=*|*GIT_CONFIG_KEY_*)
    deny "Refusing: git config passed through the environment (GIT_CONFIG_PARAMETERS, GIT_CONFIG_COUNT) can redefine what this command does, and the branch guard cannot read it (house.json at $toplevel). Put the setting in the repo's config or on the command line where it can be read." ;;
esac

if is_protected_branch "$branch"; then
  if any_clause_verb commit; then
    staged=$(git "${git_dir_arg[@]}" diff --cached --name-only 2>/dev/null || true)
    if carve_out_satisfied "$staged"; then
      exit 0
    fi
    deny "Refusing to commit on '$branch'. house.json at $toplevel requires a feature branch and a PR for this repo. For anything that renders or runs in parallel with another session, spin up a worktree (git worktree add -b kind/short-name ../<repo>-kind-short-name) in a SEPARATE call, then commit in a call of its own: a target this same command creates does not exist yet when this check runs, so the chained one-liner is refused. For a small, single-commit change with nothing else in flight, a branch in this checkout (git checkout -b kind/short-name) is fine. Commit there and open a PR.$carve_out_reason_suffix$(quoted_only_hint commit)"
  fi
  if any_clause_verb push; then
    unpushed=$(git "${git_dir_arg[@]}" diff '@{push}..' --name-only 2>/dev/null \
               || git "${git_dir_arg[@]}" diff "origin/${branch}.." --name-only 2>/dev/null \
               || true)
    if carve_out_satisfied "$unpushed"; then
      exit 0
    fi
    # A tag-only publish moves no branch ref. It is not exited here: the
    # any-branch refspec scan below still reads every clause of it.
    if ! all_push_clauses_tag_only; then
      deny "Refusing to push from '$branch'. house.json at $toplevel requires a feature branch and a PR for this repo. Push a feature branch and open a PR instead. A tag-only push is allowed from here: git push origin v1.2.3, git push origin refs/tags/v1.2.3, or git push --tags origin, as the only git command in the call, with no other flag, no refspec colon, the tag already created in an earlier call, and no other clause mentioning git or push.$carve_out_reason_suffix$(quoted_only_hint push)"
    fi
  fi
fi

# On any branch: a `-c` key can redirect a push without a refspec after the
# verb. `-c remote.origin.push=+refs/heads/feat:refs/heads/master push origin`
# and `-c push.default=matching push origin` both moved master while the
# refspec scan below read an empty clause (#1, review round 3). The check runs
# on the -c-retaining variant, where the key is still visible, only when some
# clause actually pushes (`-c push.default=simple log` is not a push), and
# without regard to case, since git config keys have none (`remote.origin.PUSH`
# moved master past the first version of this check).
if any_clause_verb push && grep -qiE '(^|[[:space:]])-c=?[[:space:]]*(push\.|remote\.[^[:space:]=]*\.push=)' <<<"$cmd_safe2"; then
  deny "Refusing: a -c push or remote.<name>.push setting can redirect a push to a protected branch without naming it (house.json at $toplevel). Push one feature branch by name and open a PR."
fi
# An alias defined on the command line (#34, seam 4) is a verb the config
# lookup below cannot see, so it is refused the same way, whatever it names.
if grep -qiE '(^|[[:space:]])-c=?[[:space:]]*alias\.' <<<"$cmd_safe2"; then
  deny "Refusing: a -c alias.* setting defines a git verb on the command line, which the branch guard cannot read (house.json at $toplevel). Run the underlying command in full."
fi

# On any branch, block an explicit push targeting a protected branch.
# Each clause is read on its own (split_clauses), so a legitimate chained
# command like `git push origin my-feature && git checkout master` isn't
# wrongly blocked by the literal word "master" appearing later on the line,
# and a push hidden behind any separator is scanned like the one in front.
#
# Within a push clause, each positional token is split on ':' (a refspec's
# <src>:<dst> form), and each resulting part has a leading '+' (force-push),
# a 'refs/heads/' or a 'heads/' prefix (git reads `heads/master` as the same
# destination) stripped before comparison. This deliberately checks BOTH sides
# of a refspec, not just the destination: `push origin master:feature` is
# over-blocked (master is the source, not the destination there) in exchange
# for never missing a real destructive form. No regex is built from the
# protected-branch name, so there is nothing to escape.
#
# A verb the hook cannot read (`git pu${x}sh origin master` names no verb this
# text can read, while the shell hands git `push`) is handled inside the loop:
# refused outright on a protected branch, and read as a push from any branch
# so its arguments are checked for a protected name (#1, rounds 3 and 5).
for scan_cmd in "${scan_variants[@]}"; do
  split_clauses "$scan_cmd"
  while IFS= read -r clause; do
    git_split "$clause" || continue
    while :; do
    if [[ "$GV_COMPUTED" -eq 1 ]]; then
      # On a protected branch a verb this text cannot read is refused in any
      # position: it may be the commit or push the branch is guarded against,
      # and prose naming `git $x` here costs a retype, not a miss. From a
      # feature branch the arguments are walked below as if the verb were
      # push, so a computed verb aimed at a protected name is refused and one
      # aimed at nothing (`echo "git $CMD"`, `git $x status`) is left alone.
      # A command-position test was tried instead and reverted: `FOO=1 git
      # pu${x}sh origin master` was outside its list (#1, round 5).
      if is_protected_branch "$branch"; then
        deny "Refusing: the git verb in this command is computed by the shell, so the branch guard cannot read it on '$branch' (house.json at $toplevel). Spell the verb plainly and retry."
      fi
    elif [[ "$GV_VERB" != push ]]; then
      git_next || break
      continue
    fi
    push_args="$GV_ARGS"
    skip_value=0
    remote_name=''; positionals=0
    while IFS= read -r tok; do
      [[ -n "$tok" ]] || continue
      if [[ "$skip_value" -eq 1 ]]; then skip_value=0; continue; fi
      # A push that names no branch can still move a protected one: --all
      # (and its git 2.42 alias --branches) and --mirror push every branch,
      # --prune deletes what the remote has and the refspec lacks, and a
      # glob (`refs/heads/*`, `m?ster`, `ma[s]ter`) matches the protected
      # name without spelling it. git accepts any unambiguous abbreviation
      # of a long option, so each is refused from its shortest prefix; the
      # ambiguous `--a` and `--pr` are refused too, since git rejects them
      # anyway (#1, adversarial and review rounds). An option that takes a
      # separate value (`-o id=$CI`) has that value skipped: it is not a ref.
      #
      # A ref the shell computes (`$b`, `mast${x}er`, `{feat,master}`,
      # backticks) is refused for the same reason as a computed verb: this
      # text cannot know what it becomes, and the protected name is one of
      # the things it can become. Spell the branch name.
      case "$tok" in
        -o|--push-option|--receive-pack|--exec|--repo) skip_value=1; continue ;;
        --a|--al*|--m*|--pr|--pru*|--br*)
          deny "Refusing: '$tok' can move a protected branch without naming it (house.json at $toplevel). Push one feature branch by name and open a PR." ;;
        -*) continue ;;
        *'*'*|*'?'*|*'['*)
          deny "Refusing: a wildcard refspec ('$tok') can match a protected branch (house.json at $toplevel). Push one feature branch by name and open a PR." ;;
        *'$'*|*'`'*|*'{'*)
          deny "Refusing: the ref '$tok' is computed by the shell, so the branch guard cannot read it (house.json at $toplevel). Spell the branch name and retry." ;;
      esac
      if [[ -z "$remote_name" ]]; then remote_name="$tok"; else positionals=$((positionals + 1)); fi
      for part in ${tok//:/ }; do
        part="${part#+}"
        part="${part#refs/heads/}"
        part="${part#heads/}"
        if is_protected_branch "$part"; then
          deny "Refusing: command targets protected branch '$part' directly (house.json at $toplevel). Push a feature branch and open a PR.$(quoted_only_hint push)"
        fi
      done
    done <<<"$push_args"
    # A push that names no refspec takes its refspec from the target repo's
    # config (#34, seam 4): `push.default=matching` pushes every branch the
    # remote also has, and a `remote.<name>.push` entry is a refspec the
    # command never spelled. The hook already refuses both keys on the
    # command line; this asks git whether the repo carries them. Read with
    # the trap disarmed, see resolve_alias.
    if [[ "$positionals" -eq 0 ]]; then
      push_default=$(trap - ERR; git "${git_dir_arg[@]}" config --get push.default 2>/dev/null || true)
      remote_push=$(trap - ERR; git "${git_dir_arg[@]}" config --get-all "remote.${remote_name:-origin}.push" 2>/dev/null || true)
      if [[ "$push_default" == matching || -n "$remote_push" ]]; then
        deny "Refusing: this push names no refspec and the repo's config (push.default=matching or remote.${remote_name:-origin}.push) decides what it moves, which can be a protected branch (house.json at $toplevel). Push one feature branch by name and open a PR."
      fi
    fi
    git_next || break
    done
  done <<<"$CLAUSES"
done

}

# ── Decide ────────────────────────────────────────────────────────────────
collect_dir_targets "$cmd_for_target"
collect_dir_targets "$cmd_for_target_c"
collect_env_targets "$cmd_for_target"
if [[ -z "$CANDIDATES" ]]; then
  decide_for_target cwd '' ''
else
  seen=''
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    case "$seen" in *"|$line|"*) continue ;; esac
    seen+="|$line|"
    IFS="$US" read -r kind p1 p2 <<<"$line"
    decide_for_target "$kind" "$p1" "$p2"
  done <<<"$CANDIDATES"
fi

exit 0
