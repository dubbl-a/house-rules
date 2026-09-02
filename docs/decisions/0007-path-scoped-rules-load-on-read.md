---
status: accepted
date: 2026-08-23
---

# Path-scoped rule files load on a matching read, so keep them scoped and bound their co-load

## Context and problem statement

The package vendors rule files into `.claude/rules/house/` with `paths:` frontmatter, on the premise that a scoped rule costs no context until Claude reads a matching file. That premise is disputed upstream: anthropics/claude-code#16299 (open, has repro) reports scoped rules loading globally on 2.0.76 and 2.1.5. If the premise is false, the package should be fewer, smaller files with procedures moved to skills.

## Decision drivers

* Context per session is the resource the whole design economizes.
* A disputed platform behavior must be measured, not assumed (the package's own rule: prove a check can fail before trusting that it passed).

## Considered options

* Assume the documented behavior.
* Measure it on the current build before writing content, and design for the measured result.

## Decision outcome

Chosen option: measure first. Measured 2026-08-23 on Claude Code 2.1.241 in `~/Documents/repo-b` (19 scoped rule files including nested `brain/` and `console/`), headless `claude -p`:

* Probe A (no file read, no tools): "which rules are in context" answered none; a second probe asked to quote the H1 of `.claude/rules/brain/corpus.md` without reading it answered `NOT IN CONTEXT`.
* Probe B (after a `Read` of a file under `brain/`): the H1 of `.claude/rules/brain/corpus.md` was quoted verbatim (`# GTM brain`), and the session reported `brain/corpus.md` and `maintaining-docs.md` loaded.

So on this build scoped rules are absent until a matching read and present afterwards for the rest of the session. Two consequences shape the design:

1. Scoping works, so vendored rule files keep `paths:` and no house rule file is always-on.
2. A rule that loads once stays loaded, and a bare filename glob (`README.md`) matches at any depth (`brain/README.md` triggered `maintaining-docs.md`). Globs must therefore be narrow and anchored, and the checker enforces a co-load ceiling: for any tracked path, the summed budgets of every house rule whose `paths:` match it stay under `house.json` `maxCoLoadLines` (default 400).

### Consequences

* Good, because the context economy the package promises is real on the current build.
* Bad, because the behavior is disputed upstream and may change; the measurement is dated and must be repeated when the build changes materially.

### Confirmation

`check.mjs` co-load gate (positive control: a path matched by three rules over the ceiling fails; negative control: a path matched by one rule passes). Re-run the two probes above after any Claude Code major.

## More information

Receipts: probe transcripts captured in the house v0.1 PR body; upstream report anthropics/claude-code#16299.
