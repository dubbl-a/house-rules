---
status: accepted
date: 2026-08-24
---

# Ratchet a file's length ceiling, never trim it, and never let it rise unrecorded

## Context and problem statement

Rule files, README, and CLAUDE.md all carry line budgets, because a shorter file gets better adherence than a long one. A fixed hand-typed ceiling needs a human to notice and update it every time a file legitimately grows, and invites an argument about whether 190 or 220 is the right number. The check has to enforce a ceiling mechanically, but a mechanical ceiling that a bot can silently raise defeats its own purpose just as thoroughly as no ceiling at all.

## Decision drivers

* Files should not grow monotonically. Cutting is the default expectation, not appending, and finding no candidate to cut on a trim pass is a valid outcome, not a failure of the exercise.
* The ceiling has to be enforced by the check, not documented and hoped for, because a documented-only limit is exactly the kind of rule that quietly stops being true.
* Whatever raises the ceiling must not be the same process that is currently failing against it. A failing run writing a new, larger "passing" count is the ceiling gaming itself.
* CLAUDE.md's cost is different in kind from a rule file's: it loads into every session unconditionally, where a `paths:`-scoped rule file loads only on a matching read. Its size is a fixed editorial decision, not something that should climb through the same mechanism that lets a rule file's budget drift upward as it earns more content.

## Considered options

* **A fixed ceiling, hand-updated when a real need arises.** Rejected: nothing forces the update to be deliberate, and nothing stops it from becoming a rubber stamp the first time a file trips it.
* **A ratchet that auto-trims content when a file exceeds budget.** Rejected: an automated trim on prose is an automated edit to a rule's meaning, and the package's own stance is that a docs edit needs a human decision, not a bot's guess at what to cut.
* **A ratchet that only tightens on shrink, only rises with a recorded human-approved reason, and never writes on a failing run; with CLAUDE.md excluded from ratchet eligibility entirely.** Adopted.

## Decision outcome

Chosen option: the tightening-only ratchet, seeded from live counts at adoption rather than hand-typed, with two hard rules layered on top. First, a ceiling only rises through a `ratchetRaises` entry (`{path, from, to, why, decided}`), so the reason is on record beside the number, not implied by a diff. Second, `check` never writes updated counts on a failing run, so a broken checker cannot quietly relabel a bloated file as the new normal. CLAUDE.md sits outside the ratchet entirely: its limit is a fixed pair (lines and bytes) set by a human, and a `ratchet` entry naming CLAUDE.md is itself a manifest error.

### Consequences

* Good, because the ceiling reflects the file's actual best-known size and tightens for free the moment someone cuts, with no separate bookkeeping step.
* Good, because raising a ceiling leaves a paper trail: the why sits next to the number that changed, for the next person to judge.
* Bad, because nothing polices whether a given why is a good one beyond a human reading it; a file with several past raises can still be quietly creeping even though each individual raise looked reasonable in isolation.
* Bad, because CLAUDE.md's exclusion means its budget has to be revisited by hand as the fleet's needs change, rather than adjusting itself the way a rule file's does.

### Confirmation

`check.mjs`'s lengths-and-ratchet family: the largest ratcheted file at its recorded count passes, that same file at count-plus-one fails, a `ratchet` entry naming CLAUDE.md fails manifest validation, and a raise applied without a `why` field fails. A failing check run is asserted to leave the ratchet file byte-identical to before the run.

## More information

The underlying "cut, don't append" and "hold every file to a target" rules this ADR mechanizes: `docs/handbook/docs.md`, sourced from `repo-a:CLAUDE.md §Targets and discipline` and `repo-b:.claude/rules/maintaining-docs.md §Targets`.
