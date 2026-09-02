---
status: accepted
date: 2026-08-24
---

# Scan the archive tier by a per-repo flag, not a fleet-wide default

## Context and problem statement

Two repos already disagree on whether the drift gate should touch their archive tier by default. repo-a keeps dated evidence docs (`docs/match/design-history.md` and siblings) outside the drift gate entirely: they are point-in-time entries full of names, dates, and measured numbers by design, and scanning them would mean writing a file-level ignore onto nearly every one. repo-b and repo-c scan their archive by default and opt individual point-in-time files out one at a time, because they want the gate broad by default and treat an ignore as the exception, not the rule. The package has to pick one behavior for `scanArchive`, and either fleet-wide choice breaks a repo that is currently working correctly.

## Decision drivers

* Adoption must not silently change what a repo's drift gate currently catches. A rollout PR that also flips archive scanning on or off, unrequested, is a second change hiding inside a first one.
* The checker already carries per-file hatches (`docs-drift-ignore`, `docs-drift-ignore-file`), so a fleet-wide default is not the only lever available; the ignore mechanism already exists to make the fleet-wide choice cheaper to get wrong in either direction.
* repo-a's archive is structured around the assumption that it is never scanned; the corresponding "genuinely cannot be anchored" carve-out for those docs is the point of the archive tier existing as a separate thing at all, not an oversight to fix.
* Reconciling the two fleet defaults into one is a real decision with real tradeoffs on each side, and it is not the decision #635 asked this package to make.

## Considered options

* **`scanArchive: true` everywhere.** Rejected: this lands as a wave of new failures across repo-a's dated archive on the very PR meant to close #635, unrelated to anything that PR is actually about.
* **`scanArchive: false` everywhere.** Rejected: repo-c is already relying on scanning its archive by default with sparing file-level opt-outs, and turning that off on adoption silently stops catching drift it currently catches.
* **A per-repo config flag, seeded at adoption from that repo's own current behavior, changeable only by a separate PR on that repo.** Adopted.

## Decision outcome

Chosen option: `docs.config.scanArchive` is a required boolean in each repo's `house.json`, set at adoption to whatever that repo already did (`false` for repo-a, `true` for repo-c), and any later change to it is its own named follow-up PR on the adopting repo, never bundled into a house rollout.

### Consequences

* Good, because adopting house never silently expands or contracts a repo's drift-gate surface area; the adoption PR's diff is legible as "add house," not "add house, and also change what gets checked."
* Good, because repo-a's later flip to scanning its archive, if it ever happens, is auditable on its own as a small, purpose-built PR with its own reasoning, rather than buried in a larger change.
* Bad, because the fleet now carries two genuinely different defaults side by side indefinitely, unless a later decision reconciles them; there is no single answer to "does house scan the archive."
* Bad, because a brand-new repo with no prior behavior to inherit has no default to seed from, and needs a considered choice rather than a mechanical copy.

### Confirmation

`check.mjs`'s manifest check fails a `house.json` missing `docs.config.scanArchive` rather than resolving a silent default. Both pilot adoption PRs record the flag's value explicitly in their `house.json` diff. repo-a's flip to `true`, if it happens, is tracked as its own issue, separate from the #635 adoption PR.

## More information

repo-a's archive-exclusion convention and repo-b's scan-by-default-with-opt-out convention: `repo-a:.claude/rules/maintaining-docs.md §The mechanical gate` and `repo-b:.claude/rules/maintaining-docs.md §Archive tier`.
