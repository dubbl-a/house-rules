---
status: accepted
date: 2026-08-24
---

# Evaluate prior art against the real trees, and record the deciding case, not the star count

## Context and problem statement

house is not the first tool to touch any of its pieces. A public survey turned up close candidates across five areas: docs-drift checkers, vendoring and sync tools, branch-guard hooks, workflow skills, and decision-record tooling. Building blind risks re-solving a problem that already has a strict-superset public answer, or missing that a candidate looks close on paper but fails the one thing house actually needs. The package needs a standing rule for how a candidate gets adopted, borrowed, or set aside, and a record of what was decided so far.

## Decision drivers

* An adoption decision must rest on the same real-tree evidence the package holds its own checks to, not a star count or a README's feature list.
* Depending on an external tool is only worth the coupling if it is a strict superset of what house needs, with zero false positives against the fleet's actual repos.
* Borrowing an idea or a chunk of text is cheaper than rebuilding when a source is close but not quite a fit, and cheaper still than depending on code under an incompatible license.
* A decision that cannot be made yet, because the evidence has not been gathered yet, should say so plainly rather than be forced early.

## Considered options

* **Adopt every close public candidate as a dependency.** Rejected: several of the closest candidates (copier, native symlink distribution) are close on the vendoring axis specifically but fail the deviation-ledger and no-runtime-service requirements this package cannot compromise on.
* **Ignore prior art and build from scratch.** Rejected: several candidates already solve pieces of `check.mjs` well, and depending on one where it is a genuine superset is less code for this package to own and maintain.
* **Evaluate each candidate against the real trees (repo-a, repo-b, repo-c) with the same positive and negative controls this package uses on itself, and record adopt, borrow, or reject with the deciding case for each.** Adopted.

## Decision outcome

Chosen option: per-candidate evaluation with a recorded deciding case. Decisions already reached:

* **MADR 4.0.0** is adopted verbatim as `docs/decisions/0000-template.md`, paired with adr-tools' zero-padded numbering and bidirectional supersede-link convention. adr-tools' code is not reused; it is GPL, and house stays unencumbered by taking the convention, not the implementation.
* **`obra/superpowers`** is borrowed, not depended on: its worktree and finish-branch skills supply starting text for house's own later skills, and its `writing-skills` guidance is the authoring reference, but none of its code ships inside house.
* **Anthropic's official `claude-md-management`** is borrowed with its routing replaced: its audit half (checking CLAUDE.md against the codebase) is kept, but its append half, writing session learnings straight into CLAUDE.md, is precisely the failure mode `/house-rules:revise-docs` exists to prevent. house's version keeps the audit and routes a learning to its matching rule file and an incident to the handbook, never to the root file.
* **copier's replay-and-merge model and native `.claude/rules/` symlink distribution** are both rejected as vendoring mechanisms; the reasoning is ADR 0001's, and this record exists so the survey shows they were considered, not overlooked.
* **`ctxlint` 0.24.1**, run against the three real trees. Verdict: evaluated, not adopted. It does not honor this package's `docs-drift-ignore` marker, does not strip HTML comments before scanning (so a commented-out example anchor still counts as a live claim), and false-positives on URL routes. It is not a strict superset, so it stays a BORROW: its `paths:`-glob-matches-zero check (a real gap this package had -- see Phase 5's fixes, below) was ported into `validateRulesFrontmatter` rather than depended on.
* **`agnix` 0.49.0**, run against the three real trees. Verdict: evaluated, not adopted. It is a prompt-hygiene linter, not a docs-drift checker, so its rule set is orthogonal to `check.mjs`'s anchor resolution: it misses the bare-script class entirely, and it actively flags this package's own `.claude/` convention as a portability smell, which is backwards for a package whose entire distribution model is `.claude/`-shaped files.
* **`agents-lint`** was not separately run. Its checks (referenced-path existence, `npm run` script existence against package.json) are a subset of what `ctxlint`'s evaluation and `check.mjs`'s own kind (a) and (c) anchors already cover; running it a second time would have re-confirmed coverage this package already had evidence for, not surfaced anything new. Recorded as rejected on that basis, not on a failing case of its own.
* Phase 5's dogfood run against repo-a, repo-b, and repo-c also turned up four gaps in `check.mjs` itself, unrelated to any candidate: kind (b) (bare script) flagged ordinary `key:value` prose tokens like `og:description`; kind (c) (file path) resolved only against `git ls-files` and missed real gitignored directories; a path inside a SKILL.md was not resolved relative to its own skill directory; and the `paths:` frontmatter check (independently of ctxlint's version of it) only probed a glob's root directory, not whether the glob matched anything. All four are fixed in `check.mjs`, each with a positive and negative control test under `tests/check/drift.test.mjs`.
* **Commodity checks** (external-link liveness, heading style, prose style such as em dashes) are deliberately left to existing generic tools rather than reimplemented. `check.mjs` keeps only the anchor resolver, the `paths:` glob validator, the ratchet, and the small set of house-shape rules no generic linter expresses.

### Consequences

* Good, because the package does not rebuild what markdownlint, remark-validate-links, Vale, and lychee already do well.
* Good, because a reader of this record can tell exactly which decisions are settled and which are still open, rather than the survey reading as uniformly final.
* Good, because evaluating ctxlint against the real trees surfaced a genuine gap in `check.mjs` (the `paths:` glob-matches-zero check) that a read-only survey would not have forced to the surface; borrowing that one check cost less than depending on the whole tool.
* Bad, because none of the three candidates turned out to be a strict superset, so this package still owns and maintains its own anchor resolver and rule-shape checks in full; the survey did not shrink `check.mjs`.

### Confirmation

All three `CANDIDATE REUSE` rows in `docs/handbook/upstreams.md` are resolved: ctxlint and agnix to evaluated-not-adopted (BORROW for ctxlint's one ported check; REJECTED for agnix), agents-lint to REJECTED without a separate run. The dogfood run itself (repo-a, repo-b, repo-c) is recorded in the same pass; `git log` on `plugins/house/payload/check.mjs` and `tests/check/drift.test.mjs` is the record of what changed.

## More information

Full candidate tables, per-tool verdicts, and the "nothing does versioned cross-repo distribution with drift detection" finding: `docs/handbook/sources/prior-art.md`, all sections. Candidate status: `docs/handbook/upstreams.md`.
