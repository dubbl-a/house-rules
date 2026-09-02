---
status: accepted
date: 2026-09-01
---

# Ship a rule-content change as a minor, and reserve major for the named surface

## Context and problem statement

`docs/handbook/conventions.md` enumerates this package's public surface under "Versioning the package, and what a bump is promising": the rule headings a consuming repo cites by name, the hook contracts, and the `house.json` schema including its module config slots. What that paragraph never says is which bump a change to the prose *inside* a rule file earns. Rule bodies are the bulk of what a consumer vendors and every release so far has rewritten some of them, so a strict reading makes almost every release breaking, and a version number that says "breaking" every time says nothing. The package is about to be readable by strangers, who will answer this question from the changelog rather than from the person who wrote both sides of it.

## Decision drivers

* No rule byte reaches a consumer's checkout without a person running `/house-rules:sync` and approving what it prints, so rewritten prose cannot break a repo behind its owner's back.
* A scheme that classes everything as breaking and one that classes nothing as breaking fail identically: in both, the number stops being read.
* The surface a consumer's own files actually name (headings, config slots, the guard's deny set, the vendored layout) is narrow, enumerable, and already written down.
* The classes have to be checkable against a diff by a reviewer with no memory of the release, which rules out "breaking if it feels breaking."

## Considered options

* Treat every changed byte in a managed file as breaking, since every adopting checkout changes.
* Treat rule content as minor and enumerate the breaking classes.
* Version the checker and the schema only, and leave rule content outside the version contract.

## Decision outcome

Chosen option: rule content is minor and the breaking classes are enumerated, because the delivery path already puts a person between a rewritten rule and any repo that would receive it, and because the third option makes the version silent about the thing most releases change.

**Minor.** New rule prose, a new heading, a reworded or re-argued rule, a new module shipped default-off, a new optional schema key, a new check family that only warns, a new skill.

**Major.** Renaming or removing a rule heading. Removing or renaming a config slot. Tightening what the branch guard denies. Changing the layout of `house.json` or of the vendored `.house` directory. Raising the Node floor in `package.json`'s `engines`.

**Patch.** A fix that restores behavior the release already promised, changing nothing a consumer was entitled to rely on.

While the package sits below 1.0, a change in the major class is still announced as breaking in `CHANGELOG.md` and carried by the next minor, because SemVer puts major version zero outside the stability promise and there is no major slot to spend. What this record fixes is the class, not the digit.

### Consequences

* Good, because the common release, a sharpened rule, now has an unambiguous bump, and the reader of a minor knows the two questions to ask: did a heading I cite change name, and did the guard start denying something new.
* Good, because the classes are stated in terms a diff answers. A heading rename, a slot rename, and a floor raise are all visible in a diff without knowing the intent behind them.
* Bad, because the deny-surface clause is expensive on purpose: removing a bypass from the branch guard tightens what it denies, so a security fix falls in the breaking class. The release before this record, 0.4.1, removed a no-op-file disarm and shipped as a patch. This record classes that change as breaking and is stated forward from here rather than applied backward, on the same reasoning that keeps a released version from being edited in place.
* Bad, because "the rule heading a consumer cites" is a claim about other repos that this repo cannot see. A heading nobody cites can be renamed with no consequence at all, and the policy still calls it breaking, because the package has no way to prove the negative.
* Neutral, because a consumer that never syncs is unaffected by any of it. The version pin in its `house.json` is what it is running, and the checker's report of a newer release is a warning it can ignore for as long as it likes.

### Confirmation

The premise is pinned by tests. `plugins/house/skills/sync/SKILL.md` requires the plan to be printed before anything is written (step 2, "Plan (dry run)") and requires a locally modified managed file to be refused with its diff and three named exits (step 3, "Locally modified: three exits, never a silent choice"), which `docs/decisions/0001-vendor-rules-over-imports-symlinks-and-replay.md` records as exercised against a fixture. `checkBehind` in `plugins/house/payload/check.mjs` returns an empty findings list and at most one warning, so a newer installed plugin never fails a consumer's run; `tests/check/behind.test.mjs` holds that shape from both sides, including "behind: installed version newer than the pin is a warning (exit 0)".

Each breaking class has something that makes it visible in the same commit. A renamed rule heading cannot pass `npm run check:traceability`: `scripts/check-traceability.mjs` fails the inventory row naming the old slug and fails the new heading as an orphan with zero inbound port rows, so the rename arrives with its own paperwork. The deny set is pinned case by case in `tests/hooks/run.sh`, which drives the real hook and asserts the decision, so tightening it edits a test. `house.json`'s layout is pinned by `plugins/house/schema/house.schema.json` and by `tests/check/manifest.test.mjs`, whose "manifest: an unknown top-level key is a finding" case is exactly what an older vendored checker reports when a new top-level key ships ahead of a sync.

What is deliberately absent is a gate that reads a diff and prints the bump it earns. Classification stays a review step, and this record exists so that step has something to be checked against.

## More information

Receipts: `docs/handbook/conventions.md`, "Versioning the package, and what a bump is promising", which enumerates the public surface this record assigns bumps to and now points here; and `docs/decisions/0001-vendor-rules-over-imports-symlinks-and-replay.md`, which chose vendoring with a refusal over silent replay and is the reason a rule rewrite is a proposal to each repo rather than a delivery.
