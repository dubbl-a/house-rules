---
status: accepted
date: 2026-09-20
---

# Branch policy enforced by git hooks, not command text

## Context and problem statement

PR #57 shipped the current PreToolUse hook after eight review rounds, five each finding a new
bypass class and three confirming the regression fix that followed. Issue #58 records the five
classes those rounds found: the runtime directory, the runtime branch, the runtime config, where
an argument came from, and what is inside a file the command runs. A better parser inside the hook
fixes none of them, because POSIX expands words "immediately before the associated command is
executed, not at the time the command is parsed," and a git alias expands before parsing too, so
the value the hook would need was never in the text to begin with.

## Decision drivers

* A missing dependency or a script crash inside the hook must still fail closed, the posture ADR
  0002 already commits to; a redesign has to keep that instinct rather than trade it for less
  inference.
* git itself resolves the runtime directory, the runtime branch, and the runtime ref on every
  commit and every push, before any hook has to guess at them from a string.
* A GitHub ruleset closes the same gap server-side, but only where the plan allows it, so it
  cannot be the only layer for a fleet with private repos on a free plan.
* Whatever is left for a text scan to do should be a short, literal, enumerable list, not an
  open-ended inference problem that grows a new branch every review round.

## Considered options

* **A. Harden the text scan further.** Patch each bypass class as a review round finds it.
* **B. Give the PreToolUse hook a real shell parser.** Replace the ad hoc quote and clause
  stripping with an actual shell grammar.
* **C. Git hooks as the floor, a GitHub ruleset as the ceiling where the plan allows it, and the
  PreToolUse hook shrunk to the enumerable ways to disable both.**

## Decision outcome

Chosen option: "C: git hooks as the floor, a ruleset as the ceiling, a shrunk hook for the disable
list", because `pre-commit` and `pre-push` already run after git has resolved the real repository,
the real HEAD, and the real ref, so enforcement moves to the place that already knows the runtime
state instead of a hook that has to infer it from text, and the surface left over for the text
scan is short and literal rather than open-ended.

### Consequences

* Good, because `--no-verify` and its abbreviations become one enumerable escape the PreToolUse
  hook refuses outright, rather than one instance of five open-ended inference problems.
* Good, because `core.hooksPath` is machine-local state, so `house doctor` reports whether the
  floor is armed in this checkout instead of the checker inferring it from repo content alone.
* Good, because on git 2.28 and later `--no-verify` skips only `pre-commit` and `pre-push`: the
  `reference-transaction` hook still refuses the ref move, so the escape cannot land a commit on a
  protected branch there at all. That hook honours `carveOuts` the same way `pre-commit` does, or
  a carved-out commit would pass one hook and fail the other. It reads creation from the ref
  itself (`git rev-parse --verify`) rather than from an all-zero old sha, because `update-ref`
  reports zeros whenever the caller states no expected old value.
* Bad, because `reference-transaction` exists only on git 2.28 and later, so a clone on an older
  git has no coverage for the merge, rebase, cherry-pick, and update-ref paths that hook closes.
* Bad, because a linked worktree shares `core.hooksPath` with its main checkout, so arming from
  a worktree with an absolute path would point the whole clone at a directory that vanishes with
  the worktree; arming refuses there and names the command to run in the main checkout.
* Bad, because a foreign hook manager (husky, pre-commit, lefthook) and this floor both want the
  single `core.hooksPath` slot, so arming has to detect and refuse rather than overwrite silently.

### Confirmation

`tests/githooks/run.sh` runs real commits and real pushes against a bare remote and fixture repos,
so no text trick can fool it. `tests/hooks/run.sh` pins the PreToolUse hook's disable list, one
case per literal and its innocent neighbor. The `guard` family in `plugins/house/payload/check.mjs`
carries a floor verdict beside the three it already reports: a warning when the vendored hook
files are missing, and a finding when a present file is not executable or not substantive.

## Pros and cons of the options

### A. Harden the text scan further

* Good, because it is the smallest diff from what already exists.
* Bad, because eight rounds already proved this settles nothing: each fix bought a new bypass
  class in a new shape, unbounded by construction, and every added rule also bought new false
  denies on legitimate commands.

### B. Give the PreToolUse hook a real shell parser

* Good, because it would read a command's syntax correctly where the current ad hoc scan sometimes
  does not.
* Bad, because a correct parse of `git up` is still `["git", "up"]`, exactly as blind as a regex,
  since the alias body lives in `.gitconfig`, outside any AST a parser could build. It also boots a
  full interpreter on every Bash call for no runtime value gained.

### C. Git hooks as the floor, a ruleset as the ceiling, a shrunk hook for the disable list

* Good, because it settles all five classes at once: it stops mattering whether the command came
  from a shell, a Makefile, an MCP tool, or another agent, since git resolves the ref no matter
  which one produced it.
* Bad, because it is three moving pieces, a vendored hook, an armed config value, and a plan-gated
  ceiling, instead of one script, so a reader now holds a small system in their head instead of a
  single hook.

## More information

This record does not supersede [0002](0002-hook-fails-open-without-a-manifest.md); ADR 0002's
fail-open posture (no `house.json`, a deferred repo-local hook, a crash) stands unchanged, because
what shrinks here is only the piece of that hook that used to carry the entire branch-policy
decision by itself. It supersedes nothing else.

Receipts: #58, where the five classes and the eight review rounds are recorded; #34, the seams a
hardened text scan tried and failed to close; #1, the reverted fix that first showed a patched
bypass creates a new one; #57, which shipped the PreToolUse hook this record shrinks; #<this PR>,
which lands the floor, the arming, the checker verdict, and this record together.
