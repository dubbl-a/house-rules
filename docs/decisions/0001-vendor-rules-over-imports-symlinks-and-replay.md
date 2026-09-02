---
status: accepted
date: 2026-08-24
---

# Vendor rules over imports, symlinks, and replay

## Context and problem statement

house has to get rule content into eight repos and keep it current without turning every repo into a fork. Three delivery mechanisms already exist on the platform or in public tooling: `@path` imports, native `.claude/rules/` symlinks, and copier-style regenerate-diff-replay. Each one is free. None of them gives a per-repo deviation record, and the package needs a decision that survives the pull of "just symlink it."

## Decision drivers

* A rule file must carry `paths:` frontmatter so it stays scoped, and `@` imports load at launch regardless of scoping, which defeats the whole context-economy premise (measured in ADR 0007).
* A repo must be able to genuinely differ from house on one file without that difference vanishing on the next update, or house is unusable in any repo with a real local reason to diverge.
* A hosted or runtime-resolved rule source is a dependency on someone else staying in business. Continue.dev Hub, the strongest public rule registry surveyed, went dark in June 2026: repo read-only, `hub.continue.dev` no longer resolving. That is not a hypothetical risk.
* An agent reading a rule file must never see a half-merged file. Conflict markers left in prose get followed as instructions, not flagged as a merge problem.

## Considered options

* **`@path` imports.** Rejected: they load at launch unconditionally, so they cost exactly the context budget the package exists to avoid.
* **Native `.claude/rules/` symlinks.** This is the real incumbent, not a strawman: it is documented, zero-effort, and already how a solo developer would share rules across repos. It fails on four counts at once: no version pin, no per-repo config, no deviation record, and an upstream edit propagates into every linked repo the instant it lands, unreviewed.
* **Runtime resolution from a hosted service.** Rejected outright. The strongest public analogue died from under its adopters with no warning.
* **Copier-style replay:** regenerate the pinned old version, diff it against the working tree to extract the local edit, replay that edit onto the new version, and emit `<<<<<<<` conflict markers on a real collision. This is the closest real alternative to what shipped.
* **Vendoring with refuse-on-local-edit:** write the rendered file with a provenance header and a lock entry; on sync, a clean file is overwritten, a locally modified file is refused with three explicit exits, never auto-merged.

## Decision outcome

Chosen option: vendoring with refuse-on-local-edit, because a silently carried local edit is exactly what the deviations ledger exists to make explicit, and replay's conflict-marker path would hand an agent a rule file it cannot read as one instruction.

Every rendered file carries a managed-header HTML comment naming its module, version, and body hash. That header is a note to whoever opens the file in an editor, not a control Claude sees: block-level HTML comments are stripped before context injection, so it costs nothing in a session and buys nothing there either. The actual enforcement is `.house/lock.json` and `check.mjs`'s tamper check, not the comment.

### Consequences

* Good, because a repo can deliberately fork one file and have that fork survive every future sync, recorded and visible, rather than silently reappearing as "drift."
* Good, because no part of the pipeline ever writes a conflict marker into a file an agent might read as instructions.
* Bad, because a locally modified managed file blocks automatic sync until a human resolves it through one of the three named exits, which is more friction than replay's silent merge.
* Bad, because each repo carries its own copy of every vendored file rather than one shared source, so an upstream fix is not live everywhere until each repo's `sync` runs.

### Confirmation

`check.mjs`'s tamper check compares managed bodies against the installed plugin's source (or the lock, as a fallback warning). `render` refuses to write any file under `.claude/rules/` without `paths:` frontmatter, checked by both a test and a build assertion. `/house-rules:sync`'s refusal path is exercised against a fixture with a locally edited managed file and must print the diff and all three exits, never merge silently.

## More information

Full candidate table and the "nothing does versioned cross-repo distribution of `paths:`-scoped rules with drift detection" finding: `docs/handbook/sources/prior-art.md` §§0-1, §(b). Continue.dev Hub's shutdown and the argument it makes: same file, §1 and §(c).
