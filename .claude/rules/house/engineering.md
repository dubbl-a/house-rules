---
paths:
  - scripts/**
---
<!-- house-managed v0.5.0 module=engineering source=modules/engineering/rules/engineering.md body-sha256=c90dfda29576b21f4e47375388ad39bf3a884eb4749e2f0dc4a2311a60bfa446 DO NOT EDIT: propose upstream (see docs in dubbl-a/house-rules), record a deviation, or house render --force-managed <path> -->
<!-- house source rule file; vendored into consuming repos by /house-rules:sync -->
# Engineering

How this repo builds a thing, checks it, and reports what the check found.

## Build the simplest thing that answers the question

Reach for the least machinery that answers the question, and add complexity only when it demonstrably improves the outcome.
Check whether the platform already measures the thing before modelling it, lift pure logic out of markup so it can be tested, keep the offline path the default, and fold near-duplicate scripts into one.
Anchor: none (because "simplest" is a design call, caught by the reviewer on the pull request rather than by a gate)
Receipts: `docs/handbook/engineering.md#build-the-simplest-thing-that-answers-the-question`

## Keep one implementation per computation, and let the gate and the report share it

Compute a value once and have every surface read that one implementation, because a gate and a report that each carry their own copy will eventually disagree about what the rule means.
Generate every published figure and gate it verbatim in each surface that carries it, diagrams included, and gate a retired value as absent from every one of them; derive types from the schema so column drift fails the typecheck; and when one input feeds two renderers, change both and their shared types together.
Anchor: the published-figure gate in `prebuild`, plus schema-derived types, so a second copy of the same computation fails the build
Receipts: `docs/handbook/engineering.md#keep-one-implementation-per-computation-and-let-the-gate-and-the-report-share-it`

## Prove a check can fail before trusting that it passed

Run a case whose answer is known independently before believing a clean result, because zero findings is also exactly what a broken check prints.
Ask what a totally broken version would have printed, run the positive control first, and keep a yardstick set you run before trusting a batch.
Turn a review finding into a mechanical check, make a real surfaced case the acceptance test, and paste the command with its output instead of asserting the result; a guard that shares the change's blind spot cannot falsify it.
Zero false positives is necessary and never sufficient, so graduate a check only once it has been shown to catch a real case, and have it return a null rather than a false when it cannot evaluate at all.
Anchor: `node --test tests/`, which requires a positive and a negative control per check, with the eval case `known-answer-control`
Receipts: `docs/handbook/engineering.md#prove-a-check-can-fail-before-trusting-that-it-passed`

## Verify the served artifact, not the source

Read the bytes that ship, because what the source says and what renders diverge, and an option's name is never the evidence.
Grep the built output for the literal after any value sweep, check an emitted asset for both real format and real shrink, prove a no-visual-change claim with a computed-style diff across pages and widths, query the upstream rather than your cache of it, and test on the real client when a preview structurally cannot reproduce the rendering.
Assert the new content present and the prior content absent, with whitespace normalized on both sides before either assertion, because a page count is not a render check.
Anchor: a `postbuild` check that reads the emitted bytes, with the eval case `verify-served-artifact`
Receipts: `docs/handbook/engineering.md#verify-the-served-artifact-not-the-source`

## Validate the body before writing it, because a status code is not a content check

Validate the payload before anything touches disk, because a failing source often answers with a success status and an error body.
On a rejection write neither the artifact nor its ledger row, since an orphan file is invisible on both axes, and read a structured column back after a scripted write to confirm the stored type before a consumer depends on it.
Anchor: a `validate()` call on the fetch path, exercised in `tests/` with a success status carrying an error body
Receipts: `docs/handbook/engineering.md#validate-the-body-before-writing-it-because-a-status-code-is-not-a-content-check`

## Never let a gate mint the answer key it grades against

Keep the answer key independent of the thing being graded, because labels produced by the tool under test measure drift and not accuracy.
Never hand-edit generated data to make its gate pass, pre-register a tuning sweep in the tool's own header before running it, audit the corpus assembly first because a corpus missing its positives scores every candidate perfectly, treat a clean validation as the moment to check the key, and give no label source deference.
Anchor: every fixture row carries its label source, and the gate refuses a key written by the tool it grades (`node --test tests/`)
Receipts: `docs/handbook/engineering.md#never-let-a-gate-mint-the-answer-key-it-grades-against`

## Report NOT EVALUABLE and NOT MEASURED rather than a fabricated zero

Give a gate a verdict for "could not evaluate" and never let it print a pass it did not earn, because an invented zero reads exactly like real data.
Zero samples is a failure; report a gap in the source as its own outcome; treat a verify phase that errored as unverified rather than trusting its empty findings list; emit a null delta when a number was not measured; and warn rather than fail when the local copy is only a worksheet.
Anchor: a verdict set that includes NOT EVALUABLE and a null-delta sentinel, with the eval case `not-evaluable-verdict`
Receipts: `docs/handbook/engineering.md#report-not-evaluable-and-not-measured-rather-than-a-fabricated-zero`

## Show the ratio and the sample, because one number is never the accuracy

Publish a rate as a ratio with its sample size and its estimand attached, because the same share over a different denominator is a different claim.
Never average disagreeing estimands or quote one conditional's number against another's, filter before publishing a count, print the true total under any capped list, label a dataset a floor when later amendments will move it, keep the caveat attached to the number, prefer a measured floor and ceiling to a modelled point, and measure recall rather than assume it.
Anchor: the measurement harness prints n beside every rate and refuses to combine two estimands (`node --test tests/`)
Receipts: `docs/handbook/engineering.md#show-the-ratio-and-the-sample-because-one-number-is-never-the-accuracy`

## Make a measuring instrument reproducible

Seed the sampling so two initializing runs are byte-identical, because a baseline fingerprint nobody can reproduce means nothing.
Regenerate a fixture from its source under a seed instead of curating it, treat a holdout as spent once it has been validated against, require a byte-identical parity diff when a formula changes, log every assumption behind a modelled number with the command that re-pulls it, move the baseline in the change that moves the numbers with the why in the pull request, and read growth in reviewer-corrected labels as decay of the key rather than improvement.
Anchor: seeded regeneration asserted byte-identical in `tests/`
Receipts: `docs/handbook/engineering.md#make-a-measuring-instrument-reproducible`

## Assert an invariant where its state is created, with a why and a remedy

Write each invariant as key, severity, title, why, remedy, and check, and assert it where the state is created, because a violation never announces itself where it was made.
The why and the remedy are required, for the person reading the failure late at night; a hard violation exits non-zero so bad state cannot reach a publish or a deploy; and a cost constraint is an invariant, not a habit.
Anchor: `npm run retro`, which refuses a check missing its why or remedy and exits non-zero on a hard violation
Receipts: `docs/handbook/engineering.md#assert-an-invariant-where-its-state-is-created-with-a-why-and-a-remedy`

## Make every waiver print its reason, and give an integrity gate none

Require a reason on every escape hatch, print it, scope it to one run, and keep it deliberately awkward, because a silent override quietly becomes the normal path.
Give a gate that protects an integrity claim no waiver at all, and short-circuit it before the waiver is even read.
Anchor: reason-carrying environment escapes as a repo-wide convention, with the eval case `integrity-gate-no-waiver`
Receipts: `docs/handbook/engineering.md#make-every-waiver-print-its-reason-and-give-an-integrity-gate-none`

## Read a missing field as missing, because absence is not confidence

Report an explicit false and an absent value as different outcomes, because collapsing them turns a hole in the data into a finding.
Anchor: the reporting layer keeps false and missing distinct, covered by a missing-field case in `tests/`
Receipts: `docs/handbook/engineering.md#read-a-missing-field-as-missing-because-absence-is-not-confidence`

## Demote a gate that has been wrong before

Keep a checker's false-positive tally inside the checker and demote its verdict to advisory once it has been wrong, because a gate with a known blind spot does not get to be certain.
Anchor: the tally lives in the checker's own header and its verdict prints as advisory, asserted in `tests/`
Receipts: `docs/handbook/engineering.md#demote-a-gate-that-has-been-wrong-before`

## Record a significant decision as a numbered, immutable record

Write every architecturally significant decision as a numbered record in the repo, on a short standard template so writing one stays part of normal flow.
Never edit a decided record: supersede it by number with a visible marker, keep a ruled value canonical and an unruled one blocked from output, and reserve records for decisions with measurable architectural effect, because one per choice devalues the set.
Anchor: numbered files under `docs/decisions/`, and `node .house/check.mjs` fails a link into that directory that does not resolve
Receipts: `docs/handbook/engineering.md#record-a-significant-decision-as-a-numbered-immutable-record`

## Land a build-time guard with the code it protects

Ship a guard in the same change as the code it protects, because guards exist for a class of failure that renders fine, builds green, and is invisible to review.
Open each guard by naming the failure class it catches, list one line per guard in the root file, and order the lifecycle so guards run first, generators second, and the check that needs the output after the build.
Anchor: `prebuild` and `postbuild` wiring landed in the same change as the guard
Receipts: `docs/handbook/engineering.md#land-a-build-time-guard-with-the-code-it-protects`

## Search public prior art before building a tool, and record what you did not adopt

Look for an existing tool before writing one, and record what you evaluated and did not adopt with the case that decided it, because an unrecorded rejection gets re-litigated.
Judge a system against its own rules first, then against current external guidance with the sources listed.
Anchor: a record under `docs/decisions/` naming the candidates, the deciding case, and the adopt or not-adopt call
Receipts: `docs/handbook/engineering.md#search-public-prior-art-before-building-a-tool-and-record-what-you-did-not-adopt`

## Pin a framework default your output depends on, with the reason beside it

Pin any framework or adapter default your output depends on and put the reason in the config file itself, because an unexplained value is unexplained to the agent too.
Justify a threshold constant with the range that makes it right, record a vendor quirk with its mitigation and what removing the mitigation costs, explain a non-obvious ignore rule in a comment, and give a temporary flag an expiry and the condition that makes it removable.
Anchor: the reason sits beside the pinned value, and a `postbuild` check proves the behavior the pin protects still holds
Receipts: `docs/handbook/engineering.md#pin-a-framework-default-your-output-depends-on-with-the-reason-beside-it`

## Enumerate from the system of record, and fail hard on a missing member

Build a list by reading the thing that defines it rather than typing the members, and fail loudly on a member you cannot resolve, because a hand-kept list silently omits whatever nobody remembered.
When told to remove something, enumerate every surface in the source and in the built output, and remove them all in one pass with no carve-outs.
Anchor: the enumerator reads the system of record at run time and exits non-zero on an unresolvable member, with a planted-missing-member case in `tests/`
Receipts: `docs/handbook/engineering.md#enumerate-from-the-system-of-record-and-fail-hard-on-a-missing-member`

## Normalize against fixed anchors, never against the live population

State a share on a denominator that could have produced the numerator, and hold that denominator fixed, because a rate measured against a population that moves is not comparable between runs.
Subtract the structurally ineligible, or say plainly that you did not.
Anchor: none (because which pool is eligible is a domain judgment no checker can look up)
Receipts: `docs/handbook/engineering.md#normalize-against-fixed-anchors-never-against-the-live-population`

## Make an error message teach the fix

Write a refusal that teaches the fix rather than one that reports the failure, because the reader is trying to get unstuck.
Print the working directory, the two states that disagree, and labelled remediations; fail fast on missing config, since a silent fallback ships stale content; and record the symptom beside the fix so the next reader recognises the failure before diagnosing it.
Anchor: every guard's refusal path is exercised in `tests/` and asserts its remediation text
Receipts: `docs/handbook/engineering.md#make-an-error-message-teach-the-fix`

## Read config from the environment, and keep build, release, and run separate

Read all config from the environment, so the repo could be published open source at any moment without leaking a credential.
Avoid named config groups, which multiply combinations and make deploys brittle; keep build, release, and run strictly separate, give each release a unique id, and never mutate one; keep the run stage simple because a runtime failure happens when nobody is watching; and resist different backing services between development and production, even behind an adapter.
Anchor: the config module throws at startup on a missing key, and `.env.example` lists every key
Receipts: `docs/handbook/engineering.md#read-config-from-the-environment-and-keep-build-release-and-run-separate`

## Don't

Anchor: each prohibition is the negative of a rule above and inherits that rule's enforcement.

- Don't hand-edit generated data to make its gate pass.
- Don't call a no-op run evidence that a tool works.
- Don't trust an empty findings list from a verify phase that errored.
- Don't print a pass, or a zero, for a check that could not evaluate.
- Don't average two estimands, or quote one conditional's number against another's.
- Don't validate against a spent holdout, and don't curate a fixture by hand.
- Don't treat a success status as proof of a usable body.
- Don't leave an artifact on disk without its ledger row, or a ledger row without its artifact.
- Don't read a missing field as a false.
- Don't waive an integrity gate, and don't ship an escape hatch that carries no reason.
- Don't edit a decided record; supersede it.
- Don't leave a configuration constant unexplained.
- Don't run different backing services in development and production, and don't mutate a release.
