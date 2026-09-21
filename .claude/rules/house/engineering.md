---
paths:
  - scripts/**
---
<!-- house-managed v0.13.0 module=engineering source=modules/engineering/rules/engineering.md body-sha256=c58bcbf9fe1bf89f2772df5183195277266c969708a120e64a87dc54cc3e65e3 DO NOT EDIT: propose upstream (see docs in dubbl-a/house-rules), record a deviation, or house render --force-managed <path> -->
<!-- house source rule file; vendored into consuming repos by /house-rules:sync -->
# Engineering

How this repo builds, checks, and reports what it found.

## Build the simplest thing that answers the question

Reach for the least machinery that answers the question, adding complexity only once it demonstrably improves the outcome.
Check whether the platform already measures the thing before modelling it, lift pure logic out of markup for testing, keep the offline path the default, and fold near-duplicate scripts into one.
Anchor: none (because "simplest" is a design call); the harness's own code review only flags reuse and simplification after the code exists, so reaching for least machinery up front is this repo's requirement
Receipts: `docs/handbook/engineering.md#build-the-simplest-thing-that-answers-the-question`

## Keep one implementation per computation, and let the gate and the report share it

Compute a value once and have every surface read it, because a gate and a report with separate copies will eventually disagree about what the rule means.
Generate every published figure and gate it verbatim in each surface, diagrams included, and gate a retired value as absent from all of them; derive types from the schema so column drift fails the typecheck; and when one input feeds two renderers, change both and their shared types together.
Anchor: the published-figure gate in `prebuild`, plus schema-derived types, so a duplicate computation fails the build
Receipts: `docs/handbook/engineering.md#keep-one-implementation-per-computation-and-let-the-gate-and-the-report-share-it`

## Prove a check can fail before trusting that it passed

Run a case with a known-independent answer before trusting a clean result, because zero findings is also what a broken check prints.
Ask what a totally broken version would have printed, run the positive control first, and keep a yardstick set you run before trusting a batch.
Turn a review finding into a mechanical check, make a real surfaced case the acceptance test, and paste the command with its output instead of asserting the result; a guard sharing the blind spot cannot falsify it.
Zero false positives is necessary but never sufficient: graduate a check only once it has caught a real case, and return a null rather than a false when it cannot evaluate.
Anchor: `node --test tests/`, requiring a positive and negative control per check, eval case `known-answer-control`; the harness's baseline arm only compares runs, never proving the check can fail, so the paired control is this repo's requirement.
Receipts: `docs/handbook/engineering.md#prove-a-check-can-fail-before-trusting-that-it-passed`

## Verify the served artifact, not the source

Read the bytes that ship, because source and render diverge, and an option's name is never the evidence.
Grep the built output for the literal after any value sweep, check an emitted asset's real format and shrink, prove no-visual-change with a computed-style diff across pages and widths, query the upstream rather than your cache, and test on the real client when a preview cannot reproduce the rendering.
Assert the new content present and the prior content absent, whitespace normalized on both sides, because a page count is not a render check.
Anchor: a `postbuild` check reading the emitted bytes, eval case `verify-served-artifact`
Receipts: `docs/handbook/engineering.md#verify-the-served-artifact-not-the-source`

## Validate the body before writing it, because a status code is not a content check

Validate the payload before anything touches disk, because a failing source often answers success with an error body.
On a rejection write neither the artifact nor its ledger row, since an orphan file is invisible either way, and read a structured column back after a scripted write to confirm its stored type before a consumer depends on it.
Anchor: a `validate()` call on the fetch path, exercised in `tests/` with a success-status error body
Receipts: `docs/handbook/engineering.md#validate-the-body-before-writing-it-because-a-status-code-is-not-a-content-check`

## Never let a gate mint the answer key it grades against

Keep the answer key independent of the thing graded, because labels from the tool under test measure drift, not accuracy.
Never hand-edit generated data to make its gate pass, pre-register a tuning sweep in the tool's own header first, audit the corpus assembly since a corpus missing its positives scores every candidate perfectly, treat a clean validation as the moment to check the key, and give no label source deference.
Anchor: every fixture row carries its label source, and the gate refuses a key written by the tool it grades (`node --test tests/`); the harness hides case definitions but never checks label provenance, so an independently sourced key is this repo's addition
Receipts: `docs/handbook/engineering.md#never-let-a-gate-mint-the-answer-key-it-grades-against`

## Report NOT EVALUABLE and NOT MEASURED rather than a fabricated zero

Give a gate a verdict for "could not evaluate" and never let it print an unearned pass, because an invented zero reads exactly like real data.
Zero samples is a failure; report a source gap as its own outcome; treat an errored verify phase as unverified rather than trusting its empty findings list; emit a null delta when a number was not measured; and warn rather than fail when the local copy is only a worksheet.
Anchor: a verdict set that includes NOT EVALUABLE and a null-delta sentinel, eval case `not-evaluable-verdict`; the harness marks a run partial on failure, so carrying that outcome in every verdict is this repo's addition
Receipts: `docs/handbook/engineering.md#report-not-evaluable-and-not-measured-rather-than-a-fabricated-zero`

## Show the ratio and the sample, because one number is never the accuracy

Publish a rate as a ratio with its sample size and its estimand attached, because the same share over a different denominator is a different claim.
Never average disagreeing estimands or quote one conditional against another, filter before publishing a count, print the true total under any capped list, label a dataset a floor when amendments will move it, keep the caveat attached, prefer a measured floor and ceiling to a modelled point, and measure recall rather than assume it.
Anchor: the measurement harness prints n beside every rate and refuses to combine two estimands (`node --test tests/`); published guidance alone lets one set of runs read as near certain or near impossible, so attaching sample and estimand to every rate is this repo's requirement
Receipts: `docs/handbook/engineering.md#show-the-ratio-and-the-sample-because-one-number-is-never-the-accuracy`

## Make a measuring instrument reproducible

Seed the sampling so two initializing runs are byte-identical, since an unreproducible baseline fingerprint means nothing.
Regenerate a fixture from its source under a seed instead of curating it, treat a holdout as spent once validated against, require a byte-identical parity diff when a formula changes, log every assumption behind a modelled number with its re-pull command, move the baseline in the change that moves the numbers with the why in the PR, and read growth in reviewer-corrected labels as decay of the key rather than improvement.
When the instrument drives an agent, pin the bare non-interactive invocation that skips ambient discovery, and record the pricing basis beside any reported cost, since a rate or residency multiplier can move that figure without moving the bill.
Anchor: seeded regeneration asserted byte-identical in `tests/`; the harness pins the model and prices at list but leaves sampling and pricing basis free to move, so seeding the fixture and recording the basis are this repo's addition
Receipts: `docs/handbook/engineering.md#make-a-measuring-instrument-reproducible`

## Assert an invariant where its state is created, with a why and a remedy

Write each invariant as key, severity, title, why, remedy, and check, and assert it where the state is created, since a violation never announces itself there.
Treat a cost constraint as an invariant too, not a habit, so a spend limit fails the run instead of relying on someone noticing.
Anchor: `npm run retro`, which refuses a check missing its why or remedy and exits non-zero on a hard violation; written guidance is context, not enforcement, so asserting the invariant in code where the state is created is this repo's requirement
Receipts: `docs/handbook/engineering.md#assert-an-invariant-where-its-state-is-created-with-a-why-and-a-remedy`

## Make every waiver print its reason, and give an integrity gate none

Require a reason on every escape hatch, print it, scope it to one run, and keep it deliberately awkward, since a silent override quietly becomes normal.
Give a gate that protects an integrity claim no waiver at all, and short-circuit it before the waiver is even read.
Anchor: reason-carrying environment escapes as a repo-wide convention, eval case `integrity-gate-no-waiver`; a PreToolUse denial holds even in bypass mode but demands no reason, so the printed reason and one-run scope are this repo's addition.
Receipts: `docs/handbook/engineering.md#make-every-waiver-print-its-reason-and-give-an-integrity-gate-none`

## Read a missing field as missing, because absence is not confidence

Report an explicit false and an absent value as different outcomes, since collapsing them turns a data hole into a finding.
Anchor: the reporting layer keeps false and missing distinct, covered by a missing-field case in `tests/`
Receipts: `docs/handbook/engineering.md#read-a-missing-field-as-missing-because-absence-is-not-confidence`

## Demote a gate that has been wrong before

Keep a checker's false-positive tally inside the checker and demote its verdict to advisory once wrong, since a gate with a known blind spot does not get to be certain.
Anchor: the tally lives in the checker's own header and its verdict prints as advisory, asserted in `tests/`; the harness's reviewer reports findings without blocking, and this rule adds a checker's false-positive record to its own verdict.
Receipts: `docs/handbook/engineering.md#demote-a-gate-that-has-been-wrong-before`

## Record a significant decision as a numbered, immutable record

Write every architecturally significant decision as a numbered record in the repo, on a short standard template so writing one stays normal.
Never edit a decided record: supersede it by number with a visible marker, keep a ruled value canonical and an unruled one blocked from output, and reserve records for decisions with measurable effect, since one per choice devalues the set.
Anchor: numbered files under `docs/decisions/`, and `node .house/check.mjs` fails an unresolved link; auto memory keeps notes machine-local and rewritable, so a decision with measurable effect belongs in a numbered repo record instead.
Receipts: `docs/handbook/engineering.md#record-a-significant-decision-as-a-numbered-immutable-record`

## Land a build-time guard with the code it protects

Ship a guard in the same change as the code it protects: guards exist for a failure class that renders fine, builds green, and is invisible to review.
Open each guard by naming the failure class it catches, list one line per guard in the root file, and order guards first, generators second, and the check needing that output last.
Anchor: `prebuild` and `postbuild` wiring landed in the same change as the guard
Receipts: `docs/handbook/engineering.md#land-a-build-time-guard-with-the-code-it-protects`

## Search public prior art before building a tool, and record what you did not adopt

Look for an existing tool before writing one, and record what you evaluated and did not adopt with the deciding case, since an unrecorded rejection gets re-litigated.
Judge a system against its own rules first, then against current external guidance with the sources listed.
Run the search in the harness planning phase, where edits stay blocked until a plan is approved, and hold that posture in a session where the block does not apply, since the plan is not the record.
Anchor: a `docs/decisions/` record naming the candidates, the deciding case, and the adopt call
Receipts: `docs/handbook/engineering.md#search-public-prior-art-before-building-a-tool-and-record-what-you-did-not-adopt`

## Pin a framework default your output depends on, with the reason beside it

Pin any framework or adapter default your output depends on and put the reason in the config file itself, because an unexplained value is unexplained to the agent too.
Justify a threshold constant with the range that makes it right, record a vendor quirk with its mitigation and removal cost, explain a non-obvious ignore rule in a comment, and give a temporary flag an expiry and removal condition.
Anchor: the reason sits beside the pinned value, and a `postbuild` check proves the pin's protected behavior still holds
Receipts: `docs/handbook/engineering.md#pin-a-framework-default-your-output-depends-on-with-the-reason-beside-it`

## Enumerate from the system of record, and fail hard on a missing member

Build a list by reading the thing that defines it rather than typing the members, and fail loudly on an unresolvable member, since a hand-kept list silently omits whatever nobody remembered.
Anchor: the enumerator reads the system of record at run time and exits non-zero on an unresolvable member, planted-missing-member case in `tests/`
Receipts: `docs/handbook/engineering.md#enumerate-from-the-system-of-record-and-fail-hard-on-a-missing-member`

## Normalize against fixed anchors, never against the live population

State a share on a denominator that could produce the numerator, and hold that denominator fixed, since a rate measured against a moving population is not comparable between runs.
Subtract the structurally ineligible, or say plainly you did not.
Anchor: none (because which pool is eligible is a domain judgment no checker can look up)
Receipts: `docs/handbook/engineering.md#normalize-against-fixed-anchors-never-against-the-live-population`

## Make an error message teach the fix

Write a refusal that teaches the fix rather than reporting the failure, since the reader is trying to get unstuck.
Print the working directory, the two states that disagree, and labelled remediations; fail fast on missing config, since a silent fallback ships stale content; and record the symptom beside the fix so the reader recognises it before diagnosing.
Anchor: every guard's refusal path is exercised in `tests/` and asserts its remediation text; the harness passes a hook's reason through verbatim without requiring usefulness, so what a guard prints is what the next reader and agent act on.
Receipts: `docs/handbook/engineering.md#make-an-error-message-teach-the-fix`

## Read config from the environment, and keep build, release, and run separate

Read all config from the environment, so the repo could go open source any moment without leaking a credential.
Avoid named config groups, which multiply combinations and make deploys brittle; keep build, release, and run strictly separate, give each release a unique id and never mutate one; keep the run stage simple, since a runtime failure happens unwatched; and resist different backing services between development and production, even behind an adapter.
Anchor: the config module throws at startup on a missing key, and `.env.example` lists every key; the sandbox treats reading a local env file as ordinary, so keeping every secret in the environment and out of the repo is this repo's requirement
Receipts: `docs/handbook/engineering.md#read-config-from-the-environment-and-keep-build-release-and-run-separate`

## Don't

Anchor: each prohibition is the negative of a rule above and inherits that rule's enforcement.
- Don't call a no-op run evidence a tool works.
