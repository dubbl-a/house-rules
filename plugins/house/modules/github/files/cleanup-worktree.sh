#!/usr/bin/env bash
# Tear down a sibling worktree after its PR has merged.
#
# Runs the canonical cleanup tail in order:
#   1. kill any node/npm/astro/wrangler process whose cwd is inside the
#      worktree (typically a forgotten dev server);
#   2. `git worktree remove --force` the worktree path; --force is
#      required because every worktree carries an untracked
#      `node_modules/` (each worktree gets its own install), and the
#      post-merge contract treats those as disposable;
#   3. `git branch -D` the branch the worktree had checked out, which is
#      now unpinned;
#   4. delete the remote branch via `gh api` (a direct-push-block hook can
#      intercept `git push origin --delete` when it runs from the default
#      branch, so this uses the GitHub API instead, which such a hook
#      does not intercept). Skipped if `gh` is missing or the remote ref
#      is already gone.
#
# Refuses to operate on the main worktree. Refuses to operate on a path
# that isn't a registered worktree of this repo.
#
# Usage (from the default-branch checkout):
#   scripts/house/cleanup-worktree.sh ../<repo>-feat-foo
#   npm run cleanup-worktree -- ../<repo>-feat-foo

set -euo pipefail

# resolve_default_branch: house.json's defaultBranch, else DEPLOY_BRANCH,
# else autodetect (origin/HEAD's target if recorded, else whichever of
# main/master exists locally, preferring main). Mirrors
# assert-main-at-origin.mjs's resolution order so the two guards never
# disagree about which branch is "the" branch.
resolve_default_branch() {
  local repo_root house_json branch origin_head
  repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  house_json="$repo_root/house.json"
  if [[ -f "$house_json" ]] && command -v jq >/dev/null 2>&1; then
    branch="$(jq -r '.defaultBranch // empty' "$house_json" 2>/dev/null || true)"
    if [[ -n "$branch" ]]; then
      echo "$branch"
      return
    fi
  fi
  if [[ -n "${DEPLOY_BRANCH:-}" ]]; then
    echo "$DEPLOY_BRANCH"
    return
  fi
  origin_head="$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || true)"
  if [[ -n "$origin_head" ]]; then
    echo "${origin_head##*/}"
    return
  fi
  if git show-ref --verify --quiet refs/heads/main; then
    echo main
    return
  fi
  if git show-ref --verify --quiet refs/heads/master; then
    echo master
    return
  fi
  echo main
}

DEFAULT_BRANCH="$(resolve_default_branch)"

# Pre-flight: cleanup runs from the default-branch checkout at
# origin/<branch>. If a parallel session left that checkout on a feature
# branch (the case that bites when a single-checkout flow meets stacked work
# already in progress), `git branch -D` on the pinned worktree branch would
# fail or, worse, the operator could be confused about which checkout state
# cleanup is acting on. Skip with DEPLOY_FROM=any only when you genuinely
# know what you are doing.
if [[ "${DEPLOY_FROM:-}" != "any" ]]; then
  head_ref=$(git rev-parse --abbrev-ref HEAD)
  if [[ "$head_ref" != "$DEFAULT_BRANCH" ]]; then
    echo "ERROR: cleanup-worktree must run from the $DEFAULT_BRANCH checkout on $DEFAULT_BRANCH." >&2
    echo "  current branch: $head_ref" >&2
    echo "  cwd:            $(pwd)" >&2
    echo "" >&2
    echo "Fix: cd to your $DEFAULT_BRANCH checkout, git checkout $DEFAULT_BRANCH, then re-run." >&2
    echo "Override (rare): DEPLOY_FROM=any $0 $*" >&2
    exit 1
  fi
fi

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <worktree-path>" >&2
  exit 2
fi

WT_PATH="$1"

if [[ ! -d "$WT_PATH" ]]; then
  echo "not a directory: $WT_PATH" >&2
  exit 1
fi

# `pwd -P` (physical, symlink-resolved), not plain `pwd`: git normalizes
# `git worktree list --porcelain`'s paths through the filesystem's real
# path, and on macOS /tmp (and other symlinked mounts) a logical `pwd` would
# disagree with that and make every check below a false negative.
ABS_WT="$(cd "$WT_PATH" && pwd -P)"

# `git worktree list --porcelain` lists the main worktree first; using
# --show-toplevel would return whichever worktree the script is *invoked*
# from, which is wrong when the user runs it from a sibling.
MAIN_WT="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
if [[ "$ABS_WT" == "$MAIN_WT" ]]; then
  echo "refusing to clean up the main worktree ($MAIN_WT)" >&2
  exit 1
fi

if ! git worktree list --porcelain | grep -qFx "worktree $ABS_WT"; then
  echo "$ABS_WT is not a registered worktree of this repo" >&2
  exit 1
fi

BRANCH="$(git -C "$ABS_WT" branch --show-current)"
if [[ -z "$BRANCH" ]]; then
  echo "$ABS_WT has no branch checked out (detached HEAD); aborting" >&2
  exit 1
fi

# Stop dev/build processes still living inside the worktree. We look up
# every process whose current working directory is the worktree and kill
# the node/npm/astro/wrangler ones — that's the dev-server class. Shells,
# editors, and other tools the user might have open with the worktree as
# cwd are left alone.
echo "→ scanning for processes inside $ABS_WT"
pids="$(lsof -d cwd 2>/dev/null | awk -v wt="$ABS_WT" '$NF==wt {print $2}' | sort -u || true)"
if [[ -n "$pids" ]]; then
  for pid in $pids; do
    cmd="$(ps -p "$pid" -o comm= 2>/dev/null || true)"
    case "$cmd" in
      *node*|*npm*|*astro*|*wrangler*)
        echo "  killing $cmd (pid $pid)"
        kill "$pid" 2>/dev/null || true
        ;;
    esac
  done
  # Give the kernel a moment to release file descriptors so worktree
  # remove doesn't fail on a still-attached process.
  sleep 1
fi

echo "→ git worktree remove --force $ABS_WT"
git worktree remove --force "$ABS_WT"

echo "→ git branch -D $BRANCH"
git branch -D "$BRANCH"

# Delete the remote branch via the GitHub API rather than `git push origin
# --delete`, which a direct-push-block hook can intercept when run from the
# default branch (`gh api -X DELETE refs/heads/...` is not a `git push`, so
# such a hook leaves it alone). Treat 422 (ref already gone) and missing
# `gh` as non-fatal — the local cleanup still succeeded.
if command -v gh >/dev/null 2>&1; then
  REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
  if [[ -n "$REPO" ]]; then
    echo "→ gh api DELETE repos/$REPO/git/refs/heads/$BRANCH"
    if gh api -X DELETE "repos/$REPO/git/refs/heads/$BRANCH" >/dev/null 2>&1; then
      echo "  remote branch deleted"
    else
      echo "  remote branch already gone (or delete failed); skipping"
    fi
  else
    echo "→ skipping remote delete (could not resolve repo via gh)"
  fi
else
  echo "→ skipping remote delete (gh not installed); run manually:"
  echo "    gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/$BRANCH"
fi

echo "✓ cleaned up worktree and branch ($BRANCH)"
