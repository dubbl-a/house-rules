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

The first adversarial round against this shape (2026-09-20, after the first commit) found that
the disable list was itself a text scan guarding the floor's off switch, and that the policy file
was the one thing neither layer protected. Two structural changes answer that, and neither is a
new literal:

* **Policy is read from HEAD.** Every guard reads `HEAD:house.json` (`pre-push` reads the
  remote's own commit where it has one), and the working-tree file counts only in a repo that
  has not committed one yet. A `Write` that flips `branchPolicy` therefore does nothing until it
  lands on the protected branch through a PR, which is the review the policy exists to force.
* **"Armed" means "intact", verified against the plugin's own source.** The PreToolUse hook
  treats a repo as armed only when `core.hooksPath` resolves to the floor (git resolves
  `include.path` for it), every vendored hook file is byte-identical to the plugin's copy and
  executable, and `.githooks/` carries no untracked or modified file. A hook edited by any tool,
  deleted by any spelling, shadowed by an unmanaged `.d` file, or pointed away by a config
  include reads as unarmed on the next call, whatever the command that did it looked like.
  Unarmed, the hook refuses every verb it cannot read as a literal git command and every push it
  cannot read as a literal refspec, and names the arming command.

A second round against those two mechanisms confirmed every round-one shape closed and the
release flow clean, then found the gaps that a structural fix leaves at its edges: `git send-pack`
is a push no git hook sees; `git replace` rewrites what `HEAD:house.json` resolves to unless the
readers pass `--no-replace-objects`; a feature branch that commits `branchPolicy: direct` stood the
whole disable list down because the policy gate ran first; an armed floor on git older than 2.28
was weaker than an unarmed one, since the history scans went quiet for a `reference-transaction`
hook that does not exist there; and an ignored file in `.githooks/` was invisible to `git status`
while the dispatcher ran it anyway. Each is closed the same way: the readers ignore replace refs,
the disable list runs before the policy gate, "armed" requires git 2.28, the integrity test
compares the hooks directory on disk with the tree at HEAD, the dispatchers run only tracked
files, and `send-pack` is read as the push it is. That was the last round by decision: three
rounds, each finding fewer and narrower gaps, is the shape a floor should show, and what follows
is what stays open.

Residue left open by decision, reported rather than chased: a disable and a push in the same
Bash call (the integrity check runs before the call); a git command inside a script whose text
never says `git`; a push from a second clone the session made earlier, whose `HEAD:house.json`
the session controls; and git older than 2.28, where `--no-verify` inside a script skips the
whole floor. The remote ruleset is the ceiling for all four, and `house doctor` names the git
version. Two smaller ones: the ADR 0002 deference files (`.claude/settings.json`, a repo-local
guard hook) are still read from the working tree, so a session can write a Bash-matching
PreToolUse entry and stand this hook down for its later calls in an unarmed repo (an armed one
never defers); and a floor that `house render --apply` has written but nobody has committed reads
as not intact, because the integrity test requires a clean `.githooks/`, so the floor counts once
it is committed, not once it is rendered.

### Confirmation

`tests/githooks/run.sh` runs real commits and real pushes against a bare remote and fixture repos,
so no text trick can fool it. `tests/hooks/run.sh` pins the PreToolUse hook's disable list, one
case per literal and its innocent neighbor, and the integrity test: an edited, deleted, or
shadowed floor file and a config include that moves `core.hooksPath` each read as unarmed on the
next call, and a tag push, a feature push, and a linked worktree each stay allowed. The `guard` family in `plugins/house/payload/check.mjs`
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
bypass creates a new one; #57, which shipped the PreToolUse hook this record shrinks; #66,
which lands the floor, the arming, the checker verdict, and this record together.
