---
status: accepted
date: 2026-08-31
---

# Clear a warning the repo cannot act on with a recorded reason, never a flag

## Context and problem statement

Three checker warnings could not be cleared by a correctly configured repo. A repo whose branch guard comes from the plugin cannot satisfy `guard` without re-vendoring the very hook the plugin exists to retire. A `bareScriptAllowlist` token that names a key in a config file, rather than a script someone intends to write, warns on every run and always will. A living document excluded from scanning for structural reasons draws a nudge that only the point-in-time marker can silence, and that marker would file the document as history it is not. In each case the operator's only available move is to stop reading warnings.

## Decision drivers

* A warning nobody can act on trains people to skim past the ones they can.
* A suppression that leaves no trace is indistinguishable from a check that never ran.
* `house.json` already carries dated entries the `manifest` family validates, so a reason has somewhere to live and something to hold it to a shape.

## Considered options

* Leave the three warnings standing and let each repo learn which ones to ignore.
* Add blanket suppression flags, one switch per warning.
* Take a dated reason in `house.json`, validated by the `manifest` family.

## Decision outcome

Chosen option: a dated reason in the manifest, because a switch hides the story while a suppression that has to say why becomes a record a reviewer can disagree with.

Three shapes, one per warning. A top-level `"guard": {"by": "plugin", "decided": "YYYY-MM-DD", "why": "..."}`. An allowlist entry may be an object, `{"token", "kind", "why"}`, beside the plain strings that keep working. An exclude entry may be an object, `{"path", "why"}`, honored on the same terms for `archiveDirs`. Each is validated where it sits, and the reason is required in all three.

### Consequences

* Good, because a cleared warning now leaves behind a sentence naming what was decided and when, which is more than the warning itself carried.
* Good, because the object forms are additive: a string entry still works, so no adopter has to rewrite an allowlist in order to upgrade.
* Bad, because `guard` is a new top-level key, so a repo must sync its vendored checker before adding it; an older checker reports the key as unknown and the repo trades one finding for another.
* Bad, because the guard record is accepted by the checker and is deliberately never a stand-down signal for the plugin hook, which breaks the checker/hook equivalence a reader would otherwise assume.

### Confirmation

`tests/check/manifest.test.mjs` holds that a malformed record is a finding and clears nothing, so a suppression missing its `why` or its date buys silence nowhere. `tests/check/guard.test.mjs` holds the cleared warning, and a case under `tests/hooks/run.sh` pins the asymmetry directly: a repo carrying the guard record still denies a commit on a protected branch.

## More information

Receipts: the adopter reports on #32 and #33, where all three warnings were reported as noise rather than as findings, by operators who had already done everything the warning could ask of them.
