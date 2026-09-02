---
paths:
  - tests/**
  - .github/workflows/**
---
<!-- house-managed v0.6.0 module=testing source=modules/testing/rules/testing.md body-sha256=e9a43b710d0ee66fd55fd4b6e8bca4c591997df6fe2357154e7fc704f46f42b0 DO NOT EDIT: propose upstream (see docs in dubbl-a/house-rules), record a deviation, or house render --force-managed <path> -->
<!-- house source rule file; vendored into consuming repos by /house-rules:sync -->
# Testing

These rules cover the checks a repo runs on itself: the suite, the gates that guard the workflow, the snapshots that catch drift, the evals that measure a rule's effect, and the controls that prove any of it still works. Each rule names what enforces it, or says plainly that nothing does.

## Give the agent a check it can run before you walk away

Ship one command that answers "did this work" with nobody watching, because without it you are the verification loop and every change waits on your attention.
Make it exit non-zero on failure, and chain the suite, the guard tests, and the repo checker behind it.
Name it in the root instruction file, which the harness loads at the start of every session as advisory context and nothing stronger, so an agent finds the command without being told; escalating it from advice to something the harness enforces is a hook, and that ladder is claude-code.md's.
Anchor: a single `verify` script that runs the suite, the hook harness, and the checker in one pass, so one command covers the tree.
Receipts: `docs/handbook/testing.md#give-the-agent-a-check-it-can-run-before-you-walk-away`

## Scale the pyramid to the repo you have, and route what the PR gate cannot afford

Keep many fast unit tests, fewer integration tests, and very few end-to-end tests, because the slow tier is where a suite quietly stops being run at all.
Route what the gate cannot afford, the tests wanting a database, a network, or a secret, to a scheduled run or to a pipeline retro, so the slow tier still runs somewhere on a stated cadence. What the gate itself may hold, and what it must name as ungated, is github.md's rule.
Keep the pre-commit hook faster still and push everything else to CI, because a slow hook gets bypassed and then disabled.
Anchor: the pr-checks template at `plugins/house/templates/pr-checks.yml`, whose steps need no credential and whose header names what is deliberately left ungated.
Receipts: `docs/handbook/testing.md#scale-the-pyramid-to-the-repo-you-have-and-route-what-the-pr-gate-cannot-afford`

## Split deterministic tests from model-behavior evals, and give each its own budget and cadence

Run two tiers and never merge them: the deterministic harness tests, which are free, fast, and identical every run, and the model-behavior evals, which cost money and answer differently each time you ask.
Keep the deterministic tier in the gate and run the eval tier nightly or on demand, because a paid, nondeterministic tier that can block a merge gets switched off the first week it is wrong for a reason nobody can reproduce.
Give the eval tier its own budget using the runner's own controls rather than a promise: set the hard cost ceiling that aborts a run and reports partial results, and the per-case threshold that exits non-zero, then keep that tier out of the merge gate and on a cadence a person can pause by hand. Writing that ceiling as an invariant is engineering.md's rule, and account-wide CI minutes are github.md's.
Anchor: `plugins/house/evals/`, whose cases run on demand under their own ceiling, beside `npm test` and `tests/hooks/run.sh`, which are the tiers the gate runs on every pull request.
Receipts: `docs/handbook/testing.md#split-deterministic-tests-from-model-behavior-evals-and-give-each-its-own-budget-and-cadence`

## Test the guard itself, as its own CI step

Test the hook, the gate, and the guard script that protect the workflow, because code that decides whether a change is allowed to land deserves a test more than the code it guards.
The harness makes a hook the thing that actually blocks, yet offers only after-the-fact inspection of one, the transcript view and a debug log, so nothing native proves a guard still fires.
Run the guard's own test as its own named step rather than folding it into the main suite, so a guard failure reads as a guard failure and not as an unrelated red; the gate's step list is github.md's.
Ship a guard with its own test in the change that introduces it, and build the guard's literal trigger tokens inside the test instead of writing them out, so the test cannot trip the guard it is exercising.
Anchor: `tests/hooks/run.sh`, wired as its own step beside the suite in the pr-checks template, plus the main-module guard that ships with its own test.
Receipts: `docs/handbook/testing.md#test-the-guard-itself-as-its-own-ci-step`

## Feed a real payload through the real wiring, and never re-implement the logic under test

Drive the test through the real entry point with a real payload, never through a helper that restates the rule, because two copies of one rule pass together whenever both are wrong.
Assert on the contract the harness itself reads: the documented event payload on stdin, the exit code whose blocking meaning is fixed per event, and stdout that counts as a decision only when it is a bare JSON object. A test that reaches past the entry point proves only that the internals agree with themselves.
Never assert against a value the test computed the way the code computes it, and run a shipped script as a subprocess rather than importing its internals when the shipped script is what you mean to test. Authoring the hook this drives, and failing it closed, are claude-code.md's.
Anchor: `tests/hooks/run.sh`, which pipes a real event payload into the real script and asserts its stdout and exit code without restating any of its matching logic.
Receipts: `docs/handbook/testing.md#feed-a-real-payload-through-the-real-wiring-and-never-re-implement-the-logic-under-test`

## Ship every gate with a positive control and a negative control

Commit the case the gate must fail beside the case it must pass, and run both in the same job, because a suite of passing cases cannot tell a working check from one that always passes.
Plant the violation the gate is meant to catch instead of describing it, and have the run clean up after itself, so the proof lives in the suite rather than in a memory of having once tried it.
Proving a check can fail before trusting that it passed is the general form, and it lives in engineering.md; this rule is the suite-level obligation to carry both controls as committed cases.
Anchor: `node --test tests/`, where each checker family pairs a well-formed fixture with a planted-violation fixture, plus the canary self-test github.md names for the secret scanner, with the eval case `positive-and-negative-control`.
Receipts: `docs/handbook/testing.md#ship-every-gate-with-a-positive-control-and-a-negative-control`

## Prove an eval can fail, then grade it with the cheapest grader that can

The runner already stands up the with and without arms and repeats each case, so the rule is not to arrange the comparison but to read the delta as the measurement and refuse the number when the arms do not diverge.
Write the cases from failures you actually watched happen, before the prose, then write only enough rule text to pass them; building a few evaluations before documenting a procedure is claude-code.md's rule.
Climb the grader ladder from the runner's deterministic grader types and reach for a model judge only for what none of them can settle, because a judge is noisiest on exactly the long artifacts you most want graded, and llm-output.md's deterministic backbone is the same rule one level up.
Report the spread with the ratio and its sample the way engineering.md requires.
Grade the grader too: have it flag an assertion too easy to satisfy, and read the transcripts before you trust the number, because an assertion nobody has read is not evidence that the eval can discriminate at all.
Anchor: `plugins/house/evals/`, whose cases carry their own graders and thresholds, with the ablation pair at `plugins/house/evals/explicit-model-tier/` whose arms differ in one thing only.
Receipts: `docs/handbook/testing.md#prove-an-eval-can-fail-then-grade-it-with-the-cheapest-grader-that-can`

## Read the snapshot diff before accepting it, because a snapshot is a drift gate

Read the diff a snapshot gate prints and say what changed before accepting the new snapshot, because accepting it unread turns a drift gate into a rubber stamp.
Keep each snapshot small enough that a reader can hold its diff in mind, since a snapshot nobody can read is accepted rather than reviewed.
Take both captures from the same checkout, confirm the working tree actually changed between them, suppress only provably identical deltas, and key a snapshot on a stable identity rather than on a generated class name that moves every build.
Commit the rendered artifact and let the gate re-render and diff it, so drift fails in the pull request instead of on whichever machine happened to run the generator.
Anchor: a re-render-and-diff step in the pr-checks template at `plugins/house/templates/pr-checks.yml`, run against the rendered artifact committed in the repo.
Receipts: `docs/handbook/testing.md#read-the-snapshot-diff-before-accepting-it-because-a-snapshot-is-a-drift-gate`

## Quarantine a flaky test loudly, and never retry it into silence

Move a flaky test into a named quarantine list that the run reports, with an owner and the condition for taking it back out, because a retry wrapper converts an intermittent defect into silence and a deletion converts it into nothing.
Pin a check that depends on a live upstream to a recorded fixture inside the gate and run the live version on its own cadence, because a red that turns on someone else's uptime teaches the reader to ignore red; what a scheduled run does when it fails is github.md's.
Anchor: none (because quarantine membership and its removal condition are editorial calls no checker can look up; the list printed by the run is the control)
Receipts: `docs/handbook/testing.md#quarantine-a-flaky-test-loudly-and-never-retry-it-into-silence`

## Treat coverage as a search-light, never as a target

Use coverage to find code that nothing exercises, and never set it as a target, because a number set as a goal is met by tests written for the number rather than for the behavior.
Read the uncovered branches rather than the summary figure, and take a coverage threshold back out of the gate once it starts producing assertion-free tests.
Anchor: none (because coverage here is read as a report and not gated; the control is the uncovered-branch list plus the absence of any threshold in the gate config)
Receipts: `docs/handbook/testing.md#treat-coverage-as-a-search-light-never-as-a-target`

## Mirror the module layout in the test tree, and keep each fixture beside its test

Name each test file after the module it mirrors and keep the tree flat enough to scan, because a reader who cannot find the test for a file assumes there is none and writes a second one.
Keep each fixture beside the test that consumes it, and let a test build its own throwaway workspace instead of sharing one, so a case cannot inherit state from the case before it.
Regenerate a fixture from its source under a seed rather than curating it by hand; the rule for making a measuring instrument reproducible lives in engineering.md.
Anchor: `tests/` mirroring the checker one file per family, with the shared sandbox helper beside them and every case building its own throwaway repo.
Receipts: `docs/handbook/testing.md#mirror-the-module-layout-in-the-test-tree-and-keep-each-fixture-beside-its-test`

## Explain a test-runner config quirk in the config, with the incident that produced it

Write the reason for a non-obvious test-runner setting into the config file beside the setting, naming the failure that produced it, because an unexplained value reads as noise and the next reader deletes it.
Say what breaks without it in concrete terms, so the comment is falsifiable rather than decorative. Pinning a framework default with its reason beside it is the general rule, and it lives in engineering.md.
Anchor: `tests/check/helpers.mjs`, whose header records why the shipped checker runs as a subprocess instead of being imported, which is exactly the choice a later reader would otherwise simplify away.
Receipts: `docs/handbook/testing.md#explain-a-test-runner-config-quirk-in-the-config-with-the-incident-that-produced-it`

## Keep a demoted check running, reported, and counted

Keep a check that has been demoted inside the suite rather than deleting it, and print its false-positive tally in the run output, because a red that is usually wrong trains the reader to skip every red, the true ones included.
Count advisory results separately from failures in the run summary, so a growing advisory tier stays visible instead of quietly ignored.
When a check earns demotion, how a checker carries its own tally, and why the gate and the report must read one implementation of it are all engineering.md's; this rule is only the obligation to keep the demoted check running and counted.
Anchor: the run summary, which counts findings and warnings separately, so an advisory check still prints and still counts without failing the run.
Receipts: `docs/handbook/testing.md#keep-a-demoted-check-running-reported-and-counted`

## Don't

- Don't hand a change back for review with no command the reviewer can run.
- Don't put a test needing a credential, a database, or a network in the pull-request gate.
- Don't gate a pull request on a tier that costs money and answers differently every run.
- Don't leave the guard that protects the workflow as the one thing with no test.
- Don't assert against a value the test computed the way the code computes it.
- Don't reach past the entry point and call the result an integration test.
- Don't call a suite of passing cases proof that a check can still fail.
- Don't trust an eval that scores the same with the rule as without it.
- Don't reach for a model judge where a deterministic grader would settle it.
- Don't accept a snapshot whose diff you have not read.
- Don't wrap a flaky test in a retry, and don't delete it quietly.
- Don't set a coverage number as a target, and don't read the summary figure instead of the branches.
- Don't share one fixture workspace across cases.
- Don't leave a test-runner setting unexplained.
- Don't delete a check that has been wrong; demote it and count it.

Anchor: each prohibition is the negative of a rule above and inherits that rule's enforcement.
