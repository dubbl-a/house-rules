---
status: accepted
date: 2026-08-31
---

# Gate managed prose in the package repo, not in every consumer

## Context and problem statement

A vendored rule file carries the package's own surface in its prose: a `Receipts:` line into `docs/handbook/`, an `Anchor:` naming a file under `tests/`, a pointer at `docs/decisions/`. Those tokens resolve here and resolve nowhere else, so every adopting repo inherits a pile of drift warnings about files it was never meant to have. Two adopters were each running about 119 of them per run, identical every time, and no edit inside those repos could retire one: the prose belongs to this package and is byte-for-byte reproduced by design.

## Decision drivers

* The warnings are unactionable in the repo that sees them and already actionable in the repo that can fix them.
* Volume is the harm: 119 lines of known noise is where a real finding goes to hide.
* Whatever is dropped must still be gated somewhere, or the rule files quietly rot.

## Considered options

* Leave the warnings and tell adopters which ones to ignore.
* Downgrade them further, below warning, and keep printing them.
* Render every `Receipts:` pointer as an absolute URL so the token resolves anywhere.
* Drop package-surface tokens silently, in managed files whose hash matches the lock, in consumer repos only.

## Decision outcome

Chosen option: drop them silently in lock-vouched managed files in consumer repos, because the file is verbatim package output there and the package repo is where the same token is still a hard finding.

A token whose path starts with `docs/handbook/`, `docs/decisions/`, `plugins/house/`, or `tests/` is dropped when the file it appears in is managed and its body matches `.house/lock.json`. A locally modified managed file is not vouched, so it gets no suppression. In this repo none of it applies and every one of those tokens is a finding as before.

### Consequences

* Good, because the two adopters go from 119 warnings a run to zero, and the gate that produced them still runs at full strength in the one repo that can act on it.
* Bad, because this suppression has no per-repo escape hatch and prints no trace, a deliberate exception to the package's rule that a check never goes quiet invisibly. It is affordable only because the dropped tokens are known in advance and constant.
* Bad, because the four prefixes are now part of the checker's contract: renaming `docs/handbook/` here would silently change what consumers suppress.
* Neutral, because `.github/` is deliberately not on the list. Those files are real render destinations in a consumer, so a broken pointer to one is a live defect there and must still be reported.

### Confirmation

The compensating control is this repo's own run, where the tokens are unsuppressed, plus a self-check that flags a prefix matching nothing tracked, so a rename cannot leave a dead prefix suppressing tokens forever. `tests/check/drift.test.mjs` holds both directions: the prefixes drop in a consumer fixture, and the same file in the package repo still reports them. The drop also requires the on-disk body to match the lock's recorded hash, so a locally modified managed file keeps its loud downgrade warnings instead of the silence.

## More information

Receipts: #32, which carries the per-repo counts from the two adopters, and the earlier decision the exception is measured against, `docs/decisions/0001-vendor-rules-over-imports-symlinks-and-replay.md`: rules are vendored byte-for-byte, which is exactly why their prose cannot be rewritten per consumer to make the tokens resolve.
