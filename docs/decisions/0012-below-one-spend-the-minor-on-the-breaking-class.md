---
status: accepted
date: 2026-09-09
---

# Below 1.0, spend the minor on the breaking class

## Context and problem statement

`docs/decisions/0011-rule-content-changes-are-minor.md` (accepted 2026-09-01) enumerates three
change classes: minor for rule content, major for the named surface, and patch for a fix that
restores promised behavior. Below 1.0 there is no major slot to spend, so 0011's last paragraph
carries a major-class change into the next minor instead. That merges two different signals into
one digit: a minor bump now means only "something changed," not whether it was additive or
breaking. 0.6.0 (2026-09-02), 0.7.0, and 0.8.0 (both 2026-09-08) were all additive minors inside
one week, and nothing in the version number said so. A consumer who reads `^0.x` the way npm or
Cargo already read it expects the minor slot to mean breaking below 1.0; this package's own digit
does not yet agree.

## Decision drivers

* npm's caret range and Cargo's caret requirement both already read a 0.x minor bump as
  incompatible: `^0.2.3` resolves to `>=0.2.3 <0.3.0` in both, so a consumer pinned that way
  survives a patch and breaks on a minor.
* ADR 0011's three classes are stated in terms a diff can check. Nothing about the classes needs
  to change; only the digit each one earns does.
* Three releases in one week, 0.6.0, 0.7.0, and 0.8.0, shipped only additive content and each
  still spent the same slot a breaking change would have spent.
* The confirmation step has to stay something a reviewer checks against a diff, not a judgment
  call remade each release.

## Considered options

* Keep ADR 0011 as written: a major-class change is carried by the next minor, and a minor-class
  change also ships as a minor.
* Add a fourth class, a patch reserved for wording-only rewords, and still carry a major-class
  change on the minor.
* Adopt the 0.x convention npm and Cargo already use: below 1.0, the breaking class takes the
  minor and every other change takes the patch.

## Decision outcome

Chosen option: adopt the 0.x convention, because it is the mapping a `^0.x` consumer already
assumes, and it is the only option of the three that makes the minor slot mean one thing again.
ADR 0011's three classes stand; only the digit each one earns changes.

Below 1.0: the breaking class (renaming or removing a rule heading, removing or renaming a config
slot, tightening what the branch guard denies, changing the `house.json` or `.house/` layout,
raising the Node floor) takes the minor. Every other change, rule content and a fix alike, takes
the patch.

At 1.0: the mapping returns to what ADR 0011 already states. Major is the breaking class, minor is
rule content and other additive change, and patch is a fix.

### Consequences

* Good, because the minor slot below 1.0 now means one thing: a change in ADR 0011's breaking
  class. A reader who sees the minor digit move no longer has to open the changelog to learn
  whether the deny surface, a config slot, or a rule heading changed.
* Good, because a consumer already reading this package's version the way npm or Cargo taught them
  to read a 0.x dependency gets the semver they expect, without house explaining its own scheme
  first.
* Bad, because a security tightening of the branch guard is classed breaking by ADR 0011, so it
  now takes the minor slot below 1.0 exactly like a new feature would. The version number cannot
  say a guard fix was defensive rather than additive; that distinction still lives only in the
  changelog's summary sentence.
* Bad, because the version history before this record is not renumbered. 0.6.0, 0.7.0, and 0.8.0
  shipped as minors under ADR 0011's own carry-forward paragraph and keep that number, even though
  each would earn a patch under this record's mapping. Reading a pre-0012 version number alone
  still requires the changelog for that stretch.

### Confirmation

Each release heading's summary sentence in `CHANGELOG.md` names its class and the record it
follows. The reviewer of a release PR checks the version digit against that sentence: below 1.0, a
minor bump must point at a breaking-class change under ADR 0011, and any other class must point at
a patch.

## More information

Receipts: `docs/decisions/0011-rule-content-changes-are-minor.md`, whose classes stand unchanged;
the three releases this record answers, 0.6.0, 0.7.0, and 0.8.0 in `CHANGELOG.md`, all additive
minors in one week; and `docs/handbook/upstreams.md:43`, which already cites
[typescript-eslint's versioning policy](https://typescript-eslint.io/users/versioning/) as the
strict pole ADR 0011 weighed.

The 0.x convention itself: npm's caret range treats a version below 1.0.0 as patch-only
compatible, "allows patch updates for versions `0.x >=0.1.0`, and no updates for versions `0.0.x`"
([node-semver](https://github.com/npm/node-semver#caret-ranges-123-025-004)), so `^0.2.3` resolves
to `>=0.2.3 <0.3.0`. Cargo's caret requirement reads 0.x the same way: versions are compatible
"if their left-most non-zero major/minor/patch component is the same"
([Specifying Dependencies](https://doc.rust-lang.org/cargo/reference/specifying-dependencies.html#caret-requirements)),
so `0.2.3` resolves to `>=0.2.3, <0.3.0`. Both treat the 0.x minor digit as the same compatibility
boundary a major digit is at 1.0 and above, which is the mapping this record adopts.
