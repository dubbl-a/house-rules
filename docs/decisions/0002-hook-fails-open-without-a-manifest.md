---
status: accepted
date: 2026-08-24
---

# Hook fails open without a manifest, and the repo hook wins during migration

## Context and problem statement

The branch guard hook installs at user scope, which means it fires in every repo the session touches, including repos that never asked for house and repos mid-migration onto it. Two of the fleet's repos (a legacy-redirect repo, and repo-e pre-adoption) must see zero behavior change from the install. Two others (repo-c, repo-a) already run their own repo-local guard and need a migration window where both cannot be simultaneously enforcing, possibly disagreeing, verdicts. The hook has to encode all three states correctly: not adopted, adopted and migrating, adopted and fully on.

## Decision drivers

* A missing dependency inside the hook (no `jq`, an unreadable file) must never silently resolve to "no decision" and pass the command through. That exact trap, a missing `jq` exiting 0, is the documented failure mode the fleet has already hit once.
* The `if:` matcher filter on a hook is best-effort and fails open on an unparseable command, so the guard has to match broadly and decide inside the script rather than lean on the filter to narrow anything.
* Installing house at user scope must not change behavior in a repo that has not adopted it. A repo with no `house.json` is, by definition, not adopted.
* An adopted repo's own pre-existing hook is the thing the migration is walking away from, not something house should race or contradict mid-migration.

## Considered options

* **Always fail closed**, deny on anything short of a fully valid manifest. Rejected: the instant the plugin installs at user scope, every non-adopted repo starts getting denied commits it never asked to be gated on.
* **Always fail open**, pass through unless a manifest explicitly says otherwise. Rejected: this reintroduces the missing-dependency trap inside an adopted repo, where a broken manifest should not make the guard quietly vanish.
* **Defer to a repo-local hook unconditionally**, regardless of whether a manifest exists. Rejected: it does nothing for the untouched-repo case, since those repos have no repo-local hook to defer to either.
* **Branch on manifest presence and repo-hook presence separately.** No `house.json` at the repo's toplevel: exit 0, house has nothing to enforce here. `house.json` present and a repo-local hook file or a `hooks` block in the repo's own `.claude/settings.json` is present: exit 0, the repo hook wins for the duration of the migration. `house.json` present, parseable, no repo hook: enforce normally. `house.json` present but malformed or unreadable: deny, the same fail-closed posture the missing-dependency case demands, because a broken manifest in an already-adopted repo is an internal error, not an absence of policy.

## Decision outcome

Chosen option: branch on manifest and repo-hook presence. The base is repo-b's existing hook (quote/comment stripping, worktree-aware branch resolution, push-clause isolation, `jq` fail-closed with a hand-written deny JSON when `jq` itself is missing), with a `trap 'emit_deny "guard crashed; refusing rather than guessing"' ERR` added so an internal script error denies instead of exiting 1, which Claude Code treats as non-blocking rather than as a denial.

Public prior art (karanb192/claude-code-hooks' `git-safety`) was evaluated and not adopted wholesale: it is more thoroughly tested, but it documents no worktree handling and no per-repo carve-outs, which are exactly the two things repo-b's hook already has and this package cannot ship without.

### Consequences

* Good, because a repo that has never heard of house behaves identically before and after the plugin installs at user scope.
* Good, because an adopted repo's own guard is never silently overridden mid-migration; removing it is a deliberate second commit, not a race.
* Good, because a broken manifest in an adopted repo cannot be mistaken for "not adopted" and cannot quietly disable enforcement.
* Bad, because the state machine has four branches instead of one, which is more surface for a hook test suite to cover and more for a reader of the script to hold in their head.

### Confirmation

`tests/hooks/run.sh` sends real `PreToolUse` payloads through the real `hooks.json` wiring against fixture repos: no manifest (must exit 0), manifest plus repo hook present (must exit 0), manifest malformed (must deny, `ERR` trap fires), manifest present and repo hook removed (must enforce and deny a `git commit` on `master`). `house doctor` prints "effective branch guard: plugin | repo | NONE" so the state is never left to inference.

## More information

Base hook and the fail-closed `jq` pattern: `~/Documents/repo-b/.claude/hooks/no-direct-master.sh`. The best-effort `if:` caveat and the karanb192 evaluation: `docs/handbook/sources/prior-art.md` §3.
