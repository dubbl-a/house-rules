---
status: accepted
date: 2026-10-08
---

# The guard blocks when it cannot decide in time, in every repo

> Amends [0002](0002-hook-fails-open-without-a-manifest.md): this changes none of the guard's own
> decisions, but a guard that cannot start, outlasts its timeout, or exits unexpectedly now
> refuses the call in a repo with no `house.json` too.

## Context and problem statement

Claude Code 2.1.295 added `onFailure: "block"` for command hooks: a hook that cannot start, times
out, or exits with an unexpected code blocks the action instead of letting it through. Without it,
a Bash command long enough to outlast the branch guard's 5 second timeout reaches the shell with
no decision (#157). The guard's entry in `plugins/house/hooks/hooks.json` is one entry for every
repo, and the Bash scans run before adoption is known, since a command can `cd` into an adopted
repo; so the setting cannot apply to adopted repos alone. In a repo that never adopted house, a
command of several hundred KB that names git can now be refused with no reason, where before it
ran (a reviewer measured a 640 KB command at about 7 s against a plain `git init` repo).

## Decision drivers

* ADR 0002 and ADR 0013 both ask a guard that cannot decide to refuse, not to vanish.
* ADR 0002 also promises a repo that never adopted house no change from the install, and the
  guard already breaks that promise where it cannot decide at all: a missing `jq` denies in every
  repo, and an MCP scan past its budget denies in any repo when an unchecked string names `.git`.
* A command that large is rare in practice, and the refusal is recoverable by splitting it.

## Considered options

* **Set `onFailure: "block"` on the guard's entry.** One line; a timeout or a crash refuses in
  every repo.
* **Give the Bash scans a time budget that allows when nothing adopted has been seen.** Keeps
  ADR 0002's promise exactly, but it is new logic in the guard's longest path, the kind ADR 0013
  warns grows a new branch every review round, and a budget that allows is a fail open.
* **Leave the key unset.** Keeps ADR 0002's promise and the #157 gap with it.

## Decision outcome

Chosen option: "set `onFailure: "block"` on the guard's entry", because a refusal the user can
work around by splitting a command costs less than a guard that silently stands aside, and it
matches what the guard already does where it cannot decide.

### Consequences

* Good, because on 2.1.295 and later the #157 gap closes: a command the guard cannot finish
  reading in time is refused rather than run.
* Good, because a fatal shell error before the guard's traps are armed, or a missing `bash`,
  refuses too.
* Bad, because in a repo that never adopted house a very large Bash command naming git can be
  refused with no reason, which ADR 0002 said would never change.
* Bad, because a CLI older than 2.1.295 ignores the key, so there the gap stays as before.

### Confirmation

`tests/hooks/run.sh` fails when the guard's entry in `plugins/house/hooks/hooks.json` does not set
`onFailure` to `block`, or when the guard's scan budget is not under its timeout.

## Pros and cons of the options

### Set `onFailure: "block"` on the guard's entry

* Good, because it is one line, with no new logic in the guard.
* Good, because it also covers a fatal shell error before the traps are armed and a missing
  `bash`.
* Bad, because a timeout refuses with no reason, in every repo, a repo with no manifest included.

### A Bash time budget that allows when nothing adopted has been seen

* Good, because a repo with no manifest keeps ADR 0002's promise exactly.
* Bad, because it adds a new decision branch to the guard's longest path.
* Bad, because a budget that allows is a fail open, which ADR 0002 and ADR 0013 both refuse
  inside an adopted repo, and the scan cannot yet tell which repo a command reaches.

### Leave the key unset

* Good, because nothing changes.
* Bad, because the #157 gap stays: a command the guard cannot read in time runs.

## More information

The changelog line and the observed behavior are recorded in `docs/handbook/claude-code.md` under
"Make a must-hold rule a hook, fail it closed, and test it with real payloads", and in the
2026-10-08 addendum for Claude Code 2.1.295 in `docs/handbook/sources/harness-survey.md`.
