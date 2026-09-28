---
status: accepted
date: 2026-09-28
---

# Decline plugin skills with `paths:` as a delivery route for rules

## Context and problem statement

[ADR 0001](0001-vendor-rules-over-imports-symlinks-and-replay.md) chose vendoring rule files over
`@path` imports, `.claude/rules/` symlinks, runtime resolution, and copier-style replay. It never
weighed a fifth route the harness offers: a skill shipped inside the plugin itself, carrying
`paths:` frontmatter so it loads only when the session touches a matching file. That route needs
no render step and no file in the consuming repo, and the 2026-09-28 re-survey deferred it rather
than deciding. This record decides it.

## Decision drivers

* A repo must be able to hold a version of a rule while house moves on, and to differ from house
  on one file with that difference recorded and surviving the next update (ADR 0001's second
  driver).
* A module's behavior in one repo is configured through that repo's `house.json` slot, not by
  whatever the installed plugin happens to say.
* A change to rule content is reviewed per repo, in a diff that repo's PR shows, before it
  changes what an agent in that repo is told.
* Scoped loading must hold: whatever carries a rule has to stay out of context until a matching
  file is read (ADR 0007).

## Considered options

* **A. Plugin skills with `paths:` frontmatter.** Ship each rule as a skill inside the plugin;
  the harness loads it when a session reads a file its `paths:` globs match.
* **B. Keep vendoring rule files with a lock entry, as ADR 0001 decided.**

## Decision outcome

Chosen option: "B: keep vendoring", because a plugin update reaches every repo that enables the
plugin at once, with no per-repo pin, no config slot, and no deviation record, and those three
are exactly what vendoring and `.house/lock.json` exist to give.

### Consequences

* Good, because every repo keeps the version it rendered until its own sync runs, and that sync
  lands as a diff in its own PR.
* Good, because a local fork of one rule stays a recorded deviation instead of being overwritten
  by the next plugin update with nothing in the repo to show it.
* Good, because ADR 0001's reasoning now covers the one harness route it had not named, so the
  question does not reopen each time the harness surveys come round.
* Bad, because the render step and the lock stay, with the friction ADR 0001 already accepted: an
  upstream fix is not live in a repo until that repo syncs.
* Bad, because if the harness later adds a per-repo pin or per-repo override for plugin skills,
  this record has to be revisited rather than read as settled for good.

This amends ADR 0001 by adding an option it did not weigh. It does not change 0001's decision,
its drivers, or its consequences.

### Confirmation

`check.mjs`'s tamper check and `.house/lock.json` stay the enforcement for rule content, as ADR
0001 records. A PR that adds a `skills/` entry under `plugins/house/` whose purpose is to carry
rule content rather than a procedure is reviewed against this record.

## Pros and cons of the options

### A. Plugin skills with `paths:` frontmatter

* Good, because there is nothing to render, vendor, or lock, and a fix is live the moment the
  plugin updates.
* Good, because scoped loading comes from the harness rather than from rendered frontmatter.
* Bad, because the same property is the problem: a plugin update changes what every enabled repo
  is told at once, unreviewed in any of them, the failure ADR 0001 names for symlinks.
* Bad, because there is no per-repo pin, no `house.json` config slot, and no deviation record, so
  a repo with a real reason to differ on one rule cannot.

### B. Keep vendoring rule files with a lock entry

* Good, because the pin, the config slot, and the deviation record already exist and are tested.
* Bad, because each repo carries its own copy of every rule and has to sync to pick up a fix.

## More information

Receipts: [ADR 0001](0001-vendor-rules-over-imports-symlinks-and-replay.md), whose option list this
record extends; [ADR 0007](0007-path-scoped-rules-load-on-read.md), the scoped-loading premise
both options would have to meet; the 2026-09-28 harness re-survey, which deferred this route.
