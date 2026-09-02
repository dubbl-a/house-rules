---
status: accepted
date: 2026-08-29
---

# Warn, never fail, when the checker reads machine-local state outside the repo

## Context and problem statement

Every family of the checker has so far read only the repo it was pointed at: tracked files, `house.json`, the lock. The auto-memory index breaks that boundary. It loads in full at the start of every session, the harness cuts it at 200 lines or 25KB with no notice, and it lives in the harness's own config directory rather than in the working tree. So the one file most able to quietly spend a repo's session context is the one file the repo cannot see.

## Decision drivers

* The index is machine-local: untracked, per-user, absent from every CI checkout, and not fixable by a pull request.
* A gate that fails on state no reviewer can change teaches people to bypass the gate.
* The checker is vendored byte-identical into every consuming repo, so whatever it reads must be safe to read on any machine, including one with no harness config at all.

## Considered options

* Leave the index unchecked and keep the checker strictly repo-local.
* Read the index and treat an over-threshold one as a finding.
* Read the index and warn, staying silent when it is absent.

## Decision outcome

Chosen option: read it and warn, because the cost of the cliff is invisible without a check while the fix belongs to a person's machine rather than to a pull request.

The `lengths` family derives the path from `CLAUDE_CONFIG_DIR`, or the default config directory under the user's home when that is unset, plus the project directory name: the repo's absolute path with every separator turned into a dash, or the literal name in `CLAUDE_CODE_PROJECT_DIR_NAME` when both are set, as the harness requires: it honors that name only beside `CLAUDE_CONFIG_DIR` and ignores it on its own, so the checker does too. If the file is not there the check does nothing. If it is there and past a warn threshold, it emits one warning naming the counts and the first few over-long lines. Never a finding. There is no `house.json` slot for the thresholds, because the caps belong to the harness and not to any repo's policy.

### Consequences

* Good, because the only always-loaded file outside the repo is now measured, and it is measured while there is still room to move facts into topic files in one pass rather than after the tail has stopped loading.
* Good, because CI stays quiet on its own: a fresh checkout has no config directory, so the check is a no-op there by construction rather than by a flag someone has to remember.
* Bad, because a reader of the checker can no longer assume `--repo` bounds everything it touches, and the two environment variables, along with the rule that the second counts only beside the first, are now part of its contract.
* Bad, because the thresholds are compiled in, so a repo that wants a different one has nowhere to say so; that is deliberate, and it is the first thing to revisit if the harness caps ever change.

### Confirmation

Three cases in `tests/check/lengths.test.mjs`: an over-threshold index warns and still exits 0, an index under every threshold prints nothing, and a config directory with no project tree prints nothing. Each points the checker at a sandbox config directory, so the run never reads the machine's real one.

## More information

Receipts: `docs/handbook/claude-code.md`, section "Keep the auto-memory index to hooks, and hold it under its cap", which carries the measured incident (repo-b's index at 94 lines and 20.9 KB, 58 of 75 entries past 200 characters) and the documentation this ADR takes the caps from: "The first 200 lines of MEMORY.md, or the first 25KB, whichever comes first, are loaded at the start of every conversation" (code.claude.com/docs/en/memory).
