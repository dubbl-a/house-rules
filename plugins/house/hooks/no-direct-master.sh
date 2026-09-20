#!/usr/bin/env bash
# PreToolUse hook (Bash, Edit, Write, MultiEdit) for repos that have adopted
# house and opted a policy in via <toplevel>/house.json. ADR 0013 carries the
# reasoning; this header states the contract.
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
# them ways to turn the floor OFF, plus one courtesy refusal:
#   A. a disable literal: --no-verify and its abbreviations, -n on a commit,
#      any spelling of core.hooksPath, git config injected through the
#      environment (GIT_CONFIG_*, --config-env, --exec-path, GIT_EXEC_PATH),
#      HUSKY=0, LEFTHOOK=0, a mutation of the floor's own files, and the
#      ref-writing plumbing that moves a protected branch (update-ref,
#      symbolic-ref, branch -f/-D, push --delete)
#   B. an Edit/Write/MultiEdit whose file_path is a managed .githooks file
#      (listed in <toplevel>/.house/lock.json), .git/config, or .git/hooks/*
#   C. a commit on a protected branch, refused here so the agent reads one
#      sentence instead of a git hook's stderr, and, only while the floor is
#      NOT armed in this checkout, a push as well
#
# Fails OPEN (allow, exit 0), as ADR 0002 requires, whenever: the tool is not
# one of the four; the payload names no git, hook, HUSKY or LEFTHOOK text at
# all; the target is not inside a git repo; <toplevel>/house.json is absent
# (the repo has not adopted house); house.json sets "branchPolicy": "direct";
# or the target repo has its own substantive .claude/hooks/no-direct-master.sh
# or a .claude/settings.json PreToolUse entry whose matcher can see Bash (the
# repo-local guard wins during migration onto house; an entry scoped to other
# tools, or carrying only other events, is not a branch guard and does not
# defer this one). Deference is a deliberate choice here, not something the
# harness requires: every matching PreToolUse hook runs and the most
# restrictive decision wins. It also fails open silently wherever it never
# runs at all, which a bare, safe or restricted session and every non-Bash
# route (Cowork, MCP) do. That gap is why the floor exists.
#
# Fails CLOSED (deny) when jq is missing (cannot parse the payload, so cannot
# tell a safe command from a dangerous one) and on an unexpected internal
# failure after the policy has been read (the ERR trap below). Those are the
# only two deny-without-a-specific-rule paths.
#
# Accepted false denies, all in the safe direction, all pinned in
# tests/hooks/run.sh: reading core.hooksPath is refused along with writing it
# (ask `house doctor` instead); any `-n`-bearing short flag in a clause that
# also holds the word `commit`; a redirection in a clause that also names
# .githooks; GIT_CONFIG_NOSYSTEM. Deliberately NOT chased, because the floor
# covers it: a computed verb (`git ${v} -m x`), a computed directory
# (`cd "$d"`), a `popd`, an alias, a refspec the config supplies, xargs, and a
# git command inside a file this command runs. Each was a scan here before #58
# and each cost a seam.
#
# Worktree-aware: the payload cwd plus every LITERAL path after `git -C`, `cd`
# or `pushd` is a candidate target, and the command is decided once per
# candidate against THAT repo's toplevel, house.json and branch, over the
# clauses whose git command runs there. Any candidate that refuses, refuses
# the call. Quote-aware: a message-bearing flag's value goes, then the quote
# characters, so `git commit -m "fix master bug"` on a feature branch cannot
# false-positive on the word "master" (the strip's direction is load-bearing,
# see _strip_flag_args). Carve-out aware: on a protected branch a commit or
# push is allowed anyway when EVERY path in the relevant diff matches one of
# house.json's `carveOuts` globs under shell `case` semantics (`*` crosses
# `/`); an empty diff never satisfies one, since "nothing staged" is not
# evidence the change is carve-out-only.
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
# shellcheck disable=SC2221,SC2222 # the patterns differ by case, which matters
case "$payload" in
  *git*|*GIT_*|*hook*|*HUSKY*|*LEFTHOOK*|*\\*) ;;
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

tool_name=$(jq -r '.tool_name // ""' <<<"$payload" 2>/dev/null || echo "")
payload_cwd=$(jq -r '.cwd // ""' <<<"$payload" 2>/dev/null || echo "")
cmd=''; file_path=''
case "$tool_name" in
  Bash) MODE='bash'; cmd=$(jq -r '.tool_input.command // ""' <<<"$payload" 2>/dev/null || echo "") ;;
  Edit|Write|MultiEdit) MODE='file'; file_path=$(jq -r '.tool_input.file_path // ""' <<<"$payload" 2>/dev/null || echo "") ;;
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
  # shellcheck disable=SC2221,SC2222 # the patterns differ by case, which matters
  case "$cmd" in
    *git*|*GIT_*|*hook*|*HUSKY*|*LEFTHOOK*) ;;
    *) exit 0 ;;
  esac
else
  [[ -n "$file_path" ]] || exit 0
  case "$file_path" in *.git*) ;; *) exit 0 ;; esac   # .githooks, .git/config, .git/hooks
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
  c="${c//\|\|/$'\n'}"; c="${c//&&/$'\n'}"; c="${c//;/$'\n'}"
  c="${c//&/$'\n'}"; c="${c//\|/$'\n'}"
  c="${c//\(/ }"; c="${c//\)/ }"; c="${c//\`/ }"
  CLAUSES="$c"
}

if [[ "$MODE" == bash ]]; then
  # The scanned text keeps `-c` values: `-c core.hooksPath=` is exactly what
  # the disable list has to see. The cost is a `-c` value carrying spaces,
  # whose tail is read as the verb; the floor catches that commit.
  cmd_safe=$(_strip_flag_args '-m|--message|-F|--file' "$cmd" | _unquote)
  # Target resolution reads the blind strip, `-c` included, so neither prose
  # nor a config value can steer which checkout is decided.
  cmd_for_target=$(_strip_flag_args_blind '-m|--message|-F|--file|-c' "$cmd" | _unquote)
else
  cmd_safe=''; cmd_for_target=''
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
# it, one per line). Returns 1 when the clause runs no git command, or when
# the verb is not a literal word: a computed verb is NOT chased any more,
# because the floor reads the ref the shell finally produces.
GV_VERB=''; GV_ARGS=''
git_split() {
  local toks=() i=0 n tok
  GV_VERB=''; GV_ARGS=''
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
        *'$'*|*'{'*) return 1 ;;
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

# ── Target candidates ────────────────────────────────────────────────────
# The payload cwd is always a candidate; every LITERAL path after `cd`,
# `pushd` or `git -C` is another. A path the shell computes is simply not a
# candidate: guessing at it was the #34 seam, and the floor covers the
# checkout the command really lands in. Each candidate carries the clauses
# whose git command runs there, so the release flow (commit in a worktree,
# come back to the shared checkout, git status) is not refused for a verb that
# belongs to another directory.
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
# shape-guessing, nothing an abbreviation or a rename quietly widens.
disable_scan() {
  local clause="$1" toks=() i n tok commit_seen=0 sed_seen=0 floorish=0
  case "$clause" in *.githooks*|*.git/config*|*.git/hooks*) floorish=1 ;; esac
  IFS=$' \t\n' read -r -a toks <<<"$clause"
  n="${#toks[@]}"
  for ((i = 0; i < n; i++)); do
    tok="${toks[$i]}"
    case "$tok" in
      # git takes unambiguous abbreviations; --no-ver is ambiguous with
      # --no-verbose, so the list starts a letter later.
      --no-veri|--no-verif|--no-verify) floor_deny "$tok" ;;
      --config-env|--config-env=*|--exec-path|--exec-path=*) floor_deny "$tok" ;;
      GIT_CONFIG_*|GIT_EXEC_PATH|GIT_EXEC_PATH=*) floor_deny "$tok" ;;
      HUSKY=0|LEFTHOOK=0) floor_deny "$tok" ;;
      # Any spelling of core.hooksPath, case-insensitively, wherever it sits:
      # `-c core.hooksPath=`, `git config core.hooksPath`, `--unset`.
      *[hH][oO][oO][kK][sS][pP][aA][tT][hH]*) floor_deny "$tok" ;;
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
        *'>'*) floor_deny "$tok" ;;
      esac
    fi
  done
  return 0
}
# The ref-writing plumbing that moves a protected branch with no commit and no
# push. reference-transaction catches these on git 2.28+; nothing does below
# that, so they are refused here on every git.
plumbing_scan() {
  local clause="$1" tok t need_flag flagged
  git_split "$clause" || return 0
  while :; do
    need_flag=-1
    case "$GV_VERB" in
      update-ref|symbolic-ref) need_flag=0 ;;
      branch|push) need_flag=1 ;;
    esac
    if [[ "$need_flag" -ge 0 ]]; then
      flagged=0
      while IFS= read -r tok; do
        case "$tok" in
          # A force-push is the floor's to refuse, and pre-push does; only the
          # delete is read here, because a deleted branch never reaches its
          # diff. On `git branch`, every mover counts.
          -d|--delete) flagged=1; continue ;;
          -f|-M|-m|-D|--force|--move)
            if [[ "$GV_VERB" == branch ]]; then flagged=1; fi
            continue ;;
          -*) continue ;;
        esac
        t="${tok#refs/heads/}"; t="${t#heads/}"
        if [[ "$need_flag" -eq 0 || "$flagged" -eq 1 ]] && is_protected_branch "$t"; then
          floor_deny "git $GV_VERB on '$t'"
        fi
      done <<<"$GV_ARGS"
    fi
    git_next || break
  done
  return 0
}

# ── B. Is the floor armed for THIS candidate? ────────────────────────────
# core.hooksPath from any scope (a global one governs too) has to resolve to
# <toplevel>/.githooks, and the pre-push guard has to be executable there.
floor_is_armed() {
  local hp resolved
  hp=$(trap - ERR; git "${git_dir_arg[@]}" config --get core.hooksPath 2>/dev/null || true)
  [[ -n "$hp" ]] || return 1
  case "$hp" in
    /*) resolved="$hp" ;;
    '~'*) resolved="$HOME${hp#\~}" ;;
    *) resolved="$toplevel/$hp" ;;
  esac
  resolved="${resolved%/}"
  if [[ "$resolved" != "$toplevel/.githooks" ]] && ! [[ "$resolved" -ef "$toplevel/.githooks" ]]; then
    return 1
  fi
  [[ -x "$toplevel/.githooks/pre-push" ]] || return 1
  return 0
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
# Only while the floor is NOT armed here: armed, pre-push reads the refs git
# is about to move, and this scan could only add false denies (a tag push, a
# refspec the config supplies).
push_decision() {
  local tok part unpushed
  while IFS= read -r tok; do
    [[ -n "$tok" ]] || continue
    case "$tok" in
      --all|--mirror|--branches|--prune)
        deny "Refusing: '$tok' can move a protected branch without naming it (house.json at $toplevel). Push one feature branch by name and open a PR.${arm_suffix}" ;;
    esac
    for part in ${tok//:/ }; do
      part="${part#+}"; part="${part#refs/heads/}"; part="${part#heads/}"
      if is_protected_branch "$part"; then
        deny "Refusing: this push targets protected branch '$part' directly (house.json at $toplevel). Push a feature branch and open a PR.${arm_suffix}"
      fi
    done
  done <<<"$GV_ARGS"
  is_protected_branch "$branch" || return 0
  unpushed=$(trap - ERR; git "${git_dir_arg[@]}" diff '@{push}..' --name-only 2>/dev/null \
             || git "${git_dir_arg[@]}" diff "origin/${branch}.." --name-only 2>/dev/null || true)
  if carve_out_satisfied "$unpushed"; then return 0; fi
  deny "Refusing to push from '$branch'. house.json at $toplevel requires a feature branch and a PR for this repo. Push a feature branch and open a PR.${carve_out_reason_suffix}${arm_suffix}"
}

BRANCH_CREATED_AT=''
CLAUSE_IDX=0
run_scans() {
  local clause armed=0 n=0
  # A, over the whole command, whichever directory each clause runs in.
  split_clauses "$cmd_safe"
  while IFS= read -r clause; do
    disable_scan "$clause"
    plumbing_scan "$clause"
  done <<<"$CLAUSES"
  if floor_is_armed; then armed=1; fi
  arm_suffix=''
  if [[ "$armed" -eq 0 ]]; then
    arm_suffix=" The git-hook floor is not armed in this checkout; arm it: git config core.hooksPath \"$toplevel/.githooks\" (house render --apply also does this)."
  fi
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
    git_split "$clause" || continue
    while :; do
      case "$GV_VERB" in
        commit) commit_decision ;;
        push) if [[ "$armed" -eq 0 ]]; then push_decision; fi ;;
      esac
      git_next || break
    done
  done <<<"$CLAUSES"
  return 0
}

# ── B for Edit/Write/MultiEdit ───────────────────────────────────────────
# A managed .githooks path is one the lock records; an unmanaged one (the
# repo's own .githooks/pre-commit.d/20-secrets scaffold) is the repo's to edit.
# The repo root is compared with -ef, not as a string prefix: git reports the
# toplevel with its symlinks resolved (/private/var on macOS) while the tool
# payload carries the path as the session spelled it (/var), and a prefix
# match missed every file.
run_file_scan() {
  local fp="$file_path" root rel managed p
  case "$fp" in /*) ;; *) fp="${payload_cwd:-.}/$fp" ;; esac
  case "$fp" in
    */.git/config|*/.git/hooks/*)
      root="${fp%%/.git/*}"; rel=".git/${fp#*/.git/}"
      if [[ -d "$root" && "$root" -ef "$toplevel" ]]; then
        deny "Refusing to write '$rel': it is where the git-hook floor that enforces this repo's branch policy is wired (house.json at $toplevel). Change the floor upstream in the house plugin and re-render; house doctor reports what is wrong with it."
      fi
      return 0 ;;
    */.githooks/*)
      root="${fp%%/.githooks/*}"; rel=".githooks/${fp#*/.githooks/}" ;;
    *) return 0 ;;
  esac
  [[ -d "$root" && "$root" -ef "$toplevel" ]] || return 0
  managed=$(trap - ERR; jq -r '(.files[]? | .path // empty)' "$toplevel/.house/lock.json" 2>/dev/null || true)
  while IFS= read -r p; do
    if [[ -n "$p" && "$p" == "$rel" ]]; then
      deny "Refusing to write '$rel': it is a managed file of the git-hook floor that enforces this repo's branch policy (recorded in .house/lock.json, house.json at $toplevel). Change it upstream in the house plugin and run house render --apply."
    fi
  done <<<"$managed"
  return 0
}

# ── Deciding one candidate ───────────────────────────────────────────────
decide_for_target() {
  local dir="${1/#\~/$HOME}"
  CAND_TEXT="${2:-}"
  # Disarmed while resolving: a bad guess here is a fail-open by design, and
  # the trap armed by an earlier candidate must not turn it into a crash-deny.
  trap - ERR

  git_dir_arg=(-C "${payload_cwd:-.}")
  if [[ -n "$dir" ]]; then
    # Successive -C compose and an absolute second path still wins, so a
    # RELATIVE candidate resolves against the directory the command runs in.
    # A target parsed out of a command is a GUESS, and a guess that is not a
    # repo falls back to that directory: before the fallback, prose naming a
    # path that does not exist pointed the check at nothing and a real commit
    # on a protected branch was allowed (#1).
    # An EMPTY toplevel counts as "not a repo" too: run inside a .git
    # directory, rev-parse --show-toplevel exits 0 and prints nothing, and a
    # Write to .git/config resolved to no repo at all.
    git_dir_arg+=(-C "$dir")
    toplevel=$(git "${git_dir_arg[@]}" rev-parse --show-toplevel 2>/dev/null || true)
    [[ -n "$toplevel" ]] || git_dir_arg=(-C "${payload_cwd:-.}")
  fi

  # Deliberate fail-open, not an error: a non-repo dir is not our business.
  toplevel=$(git "${git_dir_arg[@]}" rev-parse --show-toplevel 2>/dev/null) || return 0
  [[ -z "$toplevel" ]] && return 0
  branch=$(git "${git_dir_arg[@]}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

  # POLICY: <toplevel>/house.json. Absent means the repo has not adopted
  # house; that is fail-open, not an error (ADR 0002).
  house_json="$toplevel/house.json"
  [[ -f "$house_json" ]] || return 0
  # An adopted repo whose manifest cannot be parsed gets a refusal, not a
  # silently disarmed guard: existence signals adoption, so unreadable policy
  # is treated like a crash.
  if ! jq empty "$house_json" >/dev/null 2>&1; then
    deny "house.json exists but is not valid JSON, so the branch policy cannot be read. Refusing rather than guessing. Fix house.json (node .house/check.mjs names the error), then retry."
  fi
  branch_policy=$(jq -r '.branchPolicy // "pr"' "$house_json" 2>/dev/null || echo "pr")
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
  # precedence. Arm the crash trap: an unexpected failure from here on denies
  # with a message that says so, instead of exiting non-zero (which Claude
  # Code treats as non-blocking, i.e. the guard silently vanishes exactly when
  # it matters). Every command substitution past this line disarms the trap in
  # its own subshell, or a failing git lookup would print the crash-deny JSON
  # into a variable instead of to stdout.
  trap crashed ERR

  protected_list=$(jq -r '(.protectedBranches // ["master","main"])[]' "$house_json" 2>/dev/null)
  [[ -n "$protected_list" ]] || protected_list=$'master\nmain'
  # carveOuts: glob patterns, shell `case` semantics (`*` crosses `/`); schema
  # in plugins/house/schema/house.schema.json.
  carve_outs=$(jq -r '(.carveOuts // [])[]' "$house_json" 2>/dev/null)
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

  if [[ "$MODE" == file ]]; then run_file_scan; else run_scans; fi
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
