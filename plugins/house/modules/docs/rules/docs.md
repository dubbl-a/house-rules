<!-- house source rule file; vendored into consuming repos by /house-rules:sync -->
# Maintaining the docs

These rules govern the repo's own documents: the root file, the rule files, the README, the changelog, skills, commands, and the archive. Each rule names what enforces it and links its handbook chapter.

## Anchor every claim to a grep-able token

Write every claim about the code, interface, or a command so it names a token a reader can grep: a file path, a script, a component, a section id, or an env variable. Free-form prose drifts silently when renamed; an anchored claim fails the gate on that commit.
Name the page by the file that renders it and the section by its id, not what a reader would see. When a claim cannot be anchored (editorial intent, future tense, an external resource), generalize it to stay true after the next refactor.
Verify a claimed technology change against the code before writing the rule that describes it; a rule can be wrong on the day it is written.
Anchor: `npm run check:docs`, which resolves every backticked token in a scanned doc.
Receipts: `docs/handbook/docs.md#anchor-every-claim-to-a-grep-able-token`

## Run the docs gate before pushing and in the build

Run the docs gate locally before pushing any branch that touches documents, and wire it into the build and the pull-request check: local is the loop, the build and the check are the net.
A gate you only meet through a red badge after review costs a round trip per typo, and that round trip is what makes people stop running it.
Anchor: `npm run check:docs`, wired into the build's pre-build step and run as a step in the pull-request workflow.
Receipts: `docs/handbook/docs.md#run-the-docs-gate-before-pushing-and-in-the-build`

## Give every rule file a paths list whose first segment resolves

Give every rule file a `paths:` list, and make each glob's first segment resolve on disk. A glob resolving to nothing means the rule never loads, so it rots with no warning.
A rule file with no `paths:` is not unscoped, it is always-on at root-file priority: if it belongs in every session put it in the root file; if not, scope it.
Anchor: `npm run check:docs` validates each rule file's frontmatter and fails on a missing or unresolvable glob.
Receipts: `docs/handbook/docs.md#give-every-rule-file-a-paths-list-whose-first-segment-resolves`

## Put a fact where its litmus test says it belongs

The harness already routes always-true facts to the root file, procedures to a skill, and path-bound facts to a path-scoped rule. This rule carries that split to the README and the archive, where nothing native reaches: the README for a landing human, the archive for a dated observation. Working rules, a runbook, strategy, and reference are separate roles; give each its own document, and restate neither the code nor the manifest.
Keep the four documentation modes apart (tutorial, how-to, reference, explanation); a document trying to be all four serves none.
Index a set of reference docs with a start-here pointer instead of restating them, say outright when a method doc is meant to be copied, and keep its worked examples: moves transfer, tables do not.
Anchor: none (because routing is a judgment call: a gate can measure a file's length, not whether a fact is in the right file).
Receipts: `docs/handbook/docs.md#put-a-fact-where-its-litmus-test-says-it-belongs`

## State a rule as imperative, why, anchor, receipts

Write each rule as an imperative heading that is itself the rule, then a one-clause why, then the line naming what enforces it, then a pointer to its receipt. A reader who disagrees needs the why and the evidence in front of them, or the rule gets worked around, not revised.
Cite a receipt by its quoted heading so the pointer survives a reorder, and title each archive entry as a one-line lesson so it reads as a claim, not a filename.
Pitch each rule at the right altitude: specific enough to act on, general enough to leave judgment open. End every rule file with a `## Don't` section, and keep em dashes out of prose, naming the ban's surfaces in `modules.docs.config.emDash`.
Anchor: `npm run check:house` (shape) requires an imperative heading, an `Anchor:` line per rule, a `## Don't` section, and no em dash in any file `modules.docs.config.emDash` puts in scope.
Receipts: `docs/handbook/docs.md#state-a-rule-as-imperative-why-anchor-receipts`

## Move dates, names, and measured numbers out of rule prose

A rule that needs a date, a name, or a measured number to state itself is history wearing a rule's clothes. Move the evidence to the archive; leave the rule, the part that must survive the next change.
Keep tuned constants in code and reference them by name from the docs; a threshold copied into prose reads as a rule and goes stale with nothing to catch it.
A pinned figure is the one exception, not a stale one: its as-of date is part of the claim, so it travels with the figure, never the rule.
Anchor: `npm run check:house` (shape) fails a date-like or percent-like token in rule prose.
Receipts: `docs/handbook/docs.md#move-dates-names-and-measured-numbers-out-of-rule-prose`

## Keep files under budget, and raise a ceiling only with a written reason

The harness gives the root file a soft line target and skips only a file past its hard size cap, so hold every document to its own ceiling: root file, rule files, README, skill bodies, handbook chapters. Shorter files get better adherence.
The ceiling tightens on its own whenever a file shrinks, so the budget ratchets down with the work, not renegotiated.
Raising a ceiling takes an entry naming the path, the old and new limit, the reason, and the date decided, so it argues for itself in the diff, not as a quiet edit; it takes effect only with `--accept-lengths`.
Anchor: `npm run check:house` (lengths and ratchet), with each raise validated against the manifest schema.
Receipts: `docs/handbook/docs.md#keep-files-under-budget-and-raise-a-ceiling-only-with-a-written-reason`

## Cut, don't append, and trim on a fixed cadence

When you add to a document, trade something out; a file that only grows is one nobody reads to the end. Cut any paragraph that records something happened rather than changes what the next session does.
The harness proposes trims when asked and advises periodic review, but sets no cadence and lets a trimmed file grow back. Trim on a fixed cadence, delete at least one section each time, and let the ratchet hold the floor; finding no candidate is valid, since the prompt to look is what does the work.
Know the bloat smells: a script walkthrough, a versioned stack list, a file-conventions list, three-level nesting, and example code that is not a workaround.
Prune on evidence too: a rule that keeps getting ignored means the file is too long; a question the file already answers means the phrasing is ambiguous.
Anchor: `npm run check:house` (ratchet) tightens on every shrink, so a trimmed file cannot quietly grow back.
Receipts: `docs/handbook/docs.md#cut-dont-append-and-trim-on-a-fixed-cadence`

## Split a file only when splitting narrows what loads

Split a topic only when the split makes a session load less. Two files that always load together are worse than one: identical context, plus a second place a rule can hide.
Pick the escape valve by what is squeezing: too many rules split along a real axis (write-side, measurement, dated evidence), never size alone; too much history moves to the archive with one-hop links; a new subsystem starts as its own path-scoped file, not more of the root file.
When you do split, name the sibling and the structural blind spot it fills, then cross-reference it and say its rules are never restated here.
Resolve a co-load collision in order: narrow the colliding module's path slot in `house.json`, tighten this repo's own `paths:`, trim what loads together, and only then raise `maxCoLoadLines`, with a dated `coload-ceiling` deviation carrying the new number.
Anchor: `npm run check:house` (co-load) caps the summed budgets of every rule whose `paths:` match one file, reporting each colliding rule set once, and (manifest) refuses a raised ceiling with no deviation.
Receipts: `docs/handbook/docs.md#split-a-file-only-when-splitting-narrows-what-loads`

## Opt a point-in-time doc out with a file-level reason

Scan the archive tier by default: a repo's docs are checked for drift unless it says otherwise. Opt a point-in-time document out at file level with its reason in the marker: a day-captured survey, a superseded design doc, a spec with deliberate forward references. Stale names there are a record, not a bug; never fix one.
Set `scanArchive: false` in `house.json` to keep a repo's prior opt-in posture (an archive tier excluded wholesale, not marked file by file) instead of scan-by-default; this is a real difference in what gets caught, so say plainly which posture it runs.
Open such a file with its contract: read each entry as an observation from its date, and keep the rule it taught in the rule file. Head a superseded doc with a banner naming what happened instead of deleting it, and state the supersession inside the new doc.
Treat a closed cycle the same way: a new cycle is a sibling directory, never an in-place edit, and resolution fails closed on a missing set.
Say honestly when a repo has no archive yet; the first is created when a domain earns it. Maintainer notes belong in HTML comments, which the harness strips before context; a document only opened with the Read tool keeps comments visible, so write those for that reader.
Anchor: `npm run check:docs` honors the `scanArchive` flag and the file-level and per-line ignore markers, and the reason text after the colon runs to the closing marker.
Receipts: `docs/handbook/docs.md#opt-a-point-in-time-doc-out-with-a-file-level-reason`

## Don't document a command that does not exist

Never write a command, script, or environment variable into a document before it exists. A README telling you to run a missing command is worse than a short one; the reader spends trust before time.
Before opening a docs pull request, walk each documented command against the repo's script list and hooks, and fix any contradiction in the same pull request instead of filing it.
Mark a deliberately archival command inline with its reason, so a later reader reads it as history, not drift.
Anchor: `npm run check:docs` resolves each `npm run <name>` and each bare script token against the repo's script list.
Receipts: `docs/handbook/docs.md#dont-document-a-command-that-does-not-exist`

## Ship the docs and changelog edit in the same PR as the change

When a change adds or renames a script, an env variable, an endpoint behavior, or a maintenance step, its docs edit ships in the same pull request; one opened afterward drifts. Say in the body that you checked when no edit was needed, and ship every artifact produced, including ones the script's own instructions forget.
A hosted reviewer may flag a change that leaves a document outdated, but only as a non-blocking nit where it runs, so the template's binary is what holds it.
A standalone docs pull request is fine with no code change at all; skills follow the docs workflow, not a code deploy.
Log in the changelog only what the audience would notice, by hand, under an unreleased heading in reverse-chronological dated sections; refactors, infra, and silent fixes live in git history.
Open a change entry by saying plainly whether the substance moved, then what changed and what is open. When a no-op refactor turns up a real bug, split it out as a correction, not buried in the cleanup.
Anchor: the pull-request template's docs-check binary, plus `npm run check:docs` as a step in the pull-request workflow.
Receipts: `docs/handbook/docs.md#ship-the-docs-and-changelog-edit-in-the-same-pr-as-the-change`

## Don't

Don't leave a claim unanchored when a real token exists, and don't invent one; generalize instead.
Don't let a rule file become an incident log.
Don't split a topic that reads as one.
Don't use an em dash on a surface `modules.docs.config.emDash` covers, and don't widen its `exclude` list without stating the reason beside it.
Anchor: `npm run check:house` (shape) requires this section in every house rule file.
