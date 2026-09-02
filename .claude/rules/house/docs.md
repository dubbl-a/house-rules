---
paths:
  - CLAUDE.md
  - README.md
  - CHANGELOG.md
  - .claude/rules/**
  - .claude/skills/**
  - .claude/commands/**
  - docs/**
---
<!-- house-managed v0.5.0 module=docs source=modules/docs/rules/docs.md body-sha256=4daf6d437f20a7351d501cc38ae1476ddcff46899cdeae4ad5da83178ed6fd58 DO NOT EDIT: propose upstream (see docs in dubbl-a/house-rules), record a deviation, or house render --force-managed <path> -->
<!-- house source rule file; vendored into consuming repos by /house-rules:sync -->
# Maintaining the docs

These rules govern the repo's own documents: the root instruction file, the rule files, the README, the changelog, skills, commands, and the archive tier. Each rule names what enforces it and links its chapter in the handbook.

## Anchor every claim to a grep-able token

Write every claim about the code, the interface, or a command so it names a token a reader can grep: a file path, an npm script, a component name, a section id, a class prefix, or an environment variable. Free-form prose drifts silently when the thing it describes is renamed, while an anchored claim fails the gate on the commit that renames it.
Name the page by the file that renders it and the section by its id instead of describing what a reader would see. When a claim genuinely cannot be anchored (editorial intent, future tense, an external resource), generalize it so it still reads true after the next refactor.
Verify a claimed technology change against the code before writing the rule that describes it, because a rule can be wrong on the day it is written.
Anchor: `npm run check:docs`, which resolves every backticked token in a scanned doc.
Receipts: `docs/handbook/docs.md#anchor-every-claim-to-a-grep-able-token`

## Run the docs gate before pushing and in the build

Run the docs gate locally before pushing any branch that touches documents, and wire the same command into the build and into the pull-request check. A rule file is advisory context, so a run-it-before-pushing instruction holds only when a hook or a build step stands behind it. Keep the local run as the loop, and let the build step and the pull-request check be the net.
A gate you only meet through a red badge after review costs a round trip per typo, and the round trip is what makes people stop running it.
Anchor: `npm run check:docs`, wired into the build's pre-build step and run as a step in the pull-request workflow.
Receipts: `docs/handbook/docs.md#run-the-docs-gate-before-pushing-and-in-the-build`

## Give every rule file a paths list whose first segment resolves

Give every rule file a `paths:` list, and make each glob's first non-glob segment resolve on disk. A glob that resolves to nothing means the rule never loads, so it rots without one failure to warn you.
A rule file with no `paths:` at all is not unscoped, it is always-on at root-file priority. If it truly belongs in every session it belongs in the root file, and if it does not, it needs a scope.
Anchor: `npm run check:docs` validates each rule file's frontmatter and fails on a missing or unresolvable glob.
Receipts: `docs/handbook/docs.md#give-every-rule-file-a-paths-list-whose-first-segment-resolves`

## Put a fact where its litmus test says it belongs

The harness already routes always-true facts to the root file, procedures to a skill, and path-bound facts to a path-scoped rule, and it trims what it can derive from the code. This rule carries that split out to the README, the changelog, and the archive, where nothing native reaches: the README if a human landing on the repo needs it, the archive if it is a dated observation. Working rules, a human runbook, strategy, the changelog, deep reference, and orientation are separate roles, so give each its own document rather than another section, and restate neither the code nor the package manifest in any of them.
Keep the four documentation modes apart (tutorial, how-to, reference, explanation), because a document trying to be all four serves none of them.
Index a set of reference docs with a start-here pointer rather than restating them, say outright when a method doc is project-agnostic and meant to be copied, and keep its original worked examples when copying it, because the moves transfer and the tables do not.
Anchor: none (because routing is a judgment call: a gate can measure a file's length, not whether a fact is in the right file).
Receipts: `docs/handbook/docs.md#put-a-fact-where-its-litmus-test-says-it-belongs`

## State a rule as imperative, why, anchor, receipts

Write each rule as an imperative heading that is itself the rule, then a one-clause why, then the line naming what enforces it, then a pointer to the receipt that earned it. A reader who disagrees with a rule needs the why and the evidence in front of them, or the rule gets worked around instead of revised.
Cite a receipt by its quoted heading so the pointer survives a reorder, and title each archive entry as a one-line lesson so the pointer reads as a claim rather than a filename.
Pitch each rule at the right altitude: specific enough to act on, general enough to leave the judgment calls open. End every rule file with a `## Don't` section, and keep em dashes out of rule and body prose, naming the surfaces the ban covers in `modules.docs.config.emDash` rather than leaving each exception to memory.
Anchor: `npm run check:house` (shape) requires an imperative heading, an `Anchor:` line per rule, a `## Don't` section, and no em dash in any file `modules.docs.config.emDash` puts in scope.
Receipts: `docs/handbook/docs.md#state-a-rule-as-imperative-why-anchor-receipts`

## Move dates, names, and measured numbers out of rule prose

A rule that needs a date, a person's name, or a measured number to state itself is history wearing a rule's clothes. Move the evidence to the archive and leave the rule, which is the part that has to survive the next change.
Keep tuned constants in code and reference them by name from the docs, because a threshold copied into prose reads as a rule and goes stale with nothing to catch it.
A pinned figure is the one exception and it is not a stale figure: its as-of date is part of the claim, so it travels with the figure and never with the rule.
Anchor: `npm run check:house` (shape) fails a date-like or percent-like token in rule prose.
Receipts: `docs/handbook/docs.md#move-dates-names-and-measured-numbers-out-of-rule-prose`

## Keep files under budget, and raise a ceiling only with a written reason

The harness gives the root instruction file a soft line target and skips only a file past its hard size cap, so hold every document to its configured ceiling instead: the root instruction file, each rule file, the README, each skill body, each handbook chapter. Shorter files get better adherence, and an over-budget file is where a rule goes to hide.
The ceiling tightens on its own whenever a file shrinks, so the budget ratchets down with the work instead of being renegotiated.
Raising a ceiling takes an entry naming the path, the old and new limit, the reason, and the date it was decided, so the raise argues for itself in the diff rather than landing as a quiet edit.
Anchor: `npm run check:house` (lengths and ratchet), with each raise validated against the manifest schema.
Receipts: `docs/handbook/docs.md#keep-files-under-budget-and-raise-a-ceiling-only-with-a-written-reason`

## Cut, don't append, and trim on a fixed cadence

When you add to a document, trade something out; a file that only grows is a file nobody reads to the end of. Cut any paragraph that exists to record that something happened rather than to change what the next session does.
The harness proposes trims when asked and advises a periodic review, but it sets no cadence and lets a trimmed file grow back. Trim on a fixed cadence, delete at least one section across the root file and the rule files each time, and let the ratchet hold the floor. Finding no candidate is a valid outcome, because the prompt to look is what does the work.
Know the bloat smells: a walkthrough of what a script does, a stack list with versions, a file-conventions list, nesting three levels deep, and example code that is not a workaround.
Prune on evidence too: a rule that keeps getting ignored means the file is too long, and a question the file already answers means the phrasing is ambiguous.
Anchor: `npm run check:house` (ratchet) tightens on every shrink, so a trimmed file cannot quietly grow back.
Receipts: `docs/handbook/docs.md#cut-dont-append-and-trim-on-a-fixed-cadence`

## Split a file only when splitting narrows what loads

Split a topic only when the split makes a session load less. Two files that always load together are strictly worse than one: identical context, plus a second place a rule can hide.
Pick the escape valve by what is squeezing. Too many rules split into a path-scoped directory along a real axis (write-side rules, measurement rules, dated evidence), never along size alone; too much history moves to the archive with one-hop links. A new subsystem starts as its own path-scoped file rather than as more of the root file.
When you do split, name the sibling and the structural blind spot it fills, then cross-reference it and say out loud that its rules are never restated here.
Resolve a co-load collision in order: narrow the colliding module's path slot in `house.json`, tighten this repo's own rule `paths:`, trim what loads together, and only then raise `maxCoLoadLines`, with a dated `coload-ceiling` deviation carrying the new number as `ceiling`.
Anchor: `npm run check:house` (co-load) caps the summed budgets of every rule whose `paths:` match one file, reporting each colliding rule set once, and (manifest) refuses a raised ceiling with no deviation.
Receipts: `docs/handbook/docs.md#split-a-file-only-when-splitting-narrows-what-loads`

## Opt a point-in-time doc out with a file-level reason

Scan the archive tier by default: an adopting repo's docs get checked for drift unless it says otherwise. Opt a genuinely point-in-time document out at file level with its reason stated in the marker: a survey captured on a day, a superseded design doc, a spec whose paths are deliberate forward references. Its stale names are a record, not a bug, so never fix one.
Set `scanArchive: false` in `house.json` to keep a repo's prior opt-in posture (an archive tier excluded wholesale rather than marked file by file) instead of adopting the scan-by-default behavior. This is a real difference in what gets caught, not a restatement of the same rule in different words, so say plainly in the repo's own docs which posture it runs.
Open such a file with its contract: read each entry as an observation from its date, and keep the rule it taught in the rule file. Head a superseded doc with a banner naming what the implementation did instead rather than deleting it, and state the supersession inside the doc that supersedes.
Treat a closed cycle the same way: a new cycle is a sibling directory, never an in-place edit, and resolution fails closed on a missing set.
Say honestly when a repo has no archive yet; the first one is created when a domain earns it. Maintainer notes belong in HTML comments, which are stripped before context injection and cost nothing.
Anchor: `npm run check:docs` honors the `scanArchive` flag and the file-level and per-line ignore markers, and the reason text after the colon runs to the closing marker.
Receipts: `docs/handbook/docs.md#opt-a-point-in-time-doc-out-with-a-file-level-reason`

## Don't document a command that does not exist

Never write a command, script, or environment variable into a document before it exists. A README that tells you to run a missing command is worse than a short one, because the reader spends their trust before they spend their time.
Before opening a docs pull request, walk each documented command against the repo's script list and its hooks, and fix any contradiction in the same pull request instead of filing it.
Mark a deliberately archival command inline with its reason, so a later reader reads it as history rather than drift.
Anchor: `npm run check:docs` resolves each `npm run <name>` and each bare script token against the repo's script list.
Receipts: `docs/handbook/docs.md#dont-document-a-command-that-does-not-exist`

## Ship the docs and changelog edit in the same PR as the change

When a change adds or renames a script, an environment variable, an endpoint behavior, or a maintenance step, its docs edit ships in the same pull request. A docs pull request opened afterward is an afterthought and drifts. Say in the body that you checked when no edit was needed, and ship every artifact a run produced in the same pass, including the ones the script's own instructions forget to name.
A hosted reviewer may flag a change that leaves a document outdated, but only as a non-blocking nit and only where it runs, so the template's binary is what holds it.
A standalone docs pull request is fine when there is no code change at all, and skills follow the docs workflow rather than a code deploy.
Log in the changelog only what the repo's audience would notice, by hand, under an unreleased heading in reverse-chronological dated sections; refactors, infra, and silent fixes live in git history.
Open a change entry by saying plainly whether the substance moved, then what changed and what is still open. When a no-op refactor turns up a real bug, split it out and describe it as a correction rather than burying it in the cleanup.
Anchor: the pull-request template's docs-check binary, plus `npm run check:docs` as a step in the pull-request workflow.
Receipts: `docs/handbook/docs.md#ship-the-docs-and-changelog-edit-in-the-same-pr-as-the-change`

## Don't

Don't leave a claim unanchored when a real token exists, and don't invent one; generalize the prose instead.
Don't let a rule file become an incident log.
Don't put a date, a person's name, or a measured number in rule prose.
Don't copy a tuned constant out of the code and into prose.
Don't fix a stale name inside a point-in-time document.
Don't delete a superseded design doc; head it with a banner naming what happened instead.
Don't split a topic that reads as one thing.
Don't restate a sibling file's rules; point at them.
Don't mix tutorial, how-to, reference, and explanation modes in one document.
Don't let a document grow monotonically, and don't raise a ceiling without a written reason.
Don't document a command, script, or path that does not exist yet.
Don't split a code change from its docs edit across two pull requests.
Don't log a refactor, an infra change, or a silent fix in the changelog.
Don't use an em dash on a surface `modules.docs.config.emDash` covers, and don't widen that slot's `exclude` list without stating the reason beside it.
Anchor: `npm run check:house` (shape) requires this section in every house rule file.
