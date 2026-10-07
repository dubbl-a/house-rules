---
paths:
  - plugins/house/evals/**
---
<!-- house-managed v0.20.3 module=evals source=modules/evals/rules/evals.md body-sha256=88b6c7efec6a223a4dd0fd85bb14537b52d5128cf5cb064684f21bda4c82d5b6 DO NOT EDIT: propose upstream (see docs in dubbl-a/house-rules), record a deviation, or house render --force-managed <path> -->
<!-- house source rule file; vendored into consuming repos by /house-rules:sync -->
# Evals

How this repo measures: the eval tier and its graders, the answer key, the verdicts and numbers a measurement reports, and the session an instrument drives.

## Split deterministic tests from model-behavior evals, and give each its own budget and cadence

Keep the free, deterministic tests in the merge gate and run the paid, nondeterministic eval tier nightly or on demand under the runner's own cost ceiling and score threshold, on a cadence a person can pause, because a paid tier that can block a merge gets switched off the first week it is wrong; account-wide CI minutes are github.md's.
Anchor: `plugins/house/evals/`, whose cases run on demand under their own ceiling, beside `npm test` and `tests/hooks/run.sh`, which are the tiers the gate runs on every pull request.
Receipts: `docs/handbook/evals.md#split-deterministic-tests-from-model-behavior-evals-and-give-each-its-own-budget-and-cadence`

## Prove an eval can fail, then grade it with the cheapest grader that can

The runner already stands up the with and without arms and repeats each case, so the rule is not to arrange the comparison but to read the delta as the measurement and refuse the number when the arms do not diverge.
Write the cases from failures you actually watched happen, before the prose, then write only enough rule text to pass them; building a few evaluations before documenting a procedure is claude-code.md's rule.
Climb the grader ladder from the runner's deterministic grader types and reach for a model judge only for what none of them can settle, because a judge is noisiest on exactly the long artifacts you most want graded, and llm-output.md's deterministic backbone is the same rule one level up.
Grade the grader too: have it flag an assertion too easy to satisfy, and read the transcripts before you trust the number, because an assertion nobody has read is not evidence that the eval can discriminate at all.
Anchor: `plugins/house/evals/`, whose cases carry their own graders and thresholds, with the ablation pair at `plugins/house/evals/explicit-model-tier/` whose arms differ in one thing only.
Receipts: `docs/handbook/evals.md#prove-an-eval-can-fail-then-grade-it-with-the-cheapest-grader-that-can`

## Never let a gate mint the answer key it grades against

Keep the answer key independent of the thing graded, because labels from the tool under test measure drift, not accuracy.
Never hand-edit generated data to make its gate pass, pre-register a tuning sweep in the tool's own header first, audit the corpus assembly since a corpus missing its positives scores every candidate perfectly, treat a clean validation as the moment to check the key, and give no label source deference.
Score a task taken from real use mechanically, by grounding and attribution checks with no hand-written key, and record whose words the question is, since a key minted for a real question is the gate grading its own guess.
Anchor: every fixture row carries its label source, and the gate refuses a key written by the tool it grades (`node --test tests/`); the harness hides case definitions but never checks label provenance, so an independently sourced key is this repo's addition
Receipts: `docs/handbook/evals.md#never-let-a-gate-mint-the-answer-key-it-grades-against`

## Report NOT EVALUABLE and NOT MEASURED rather than a fabricated zero

Give a gate a verdict for "could not evaluate" and never let it print an unearned pass, because an invented zero reads exactly like real data.
Zero samples is a failure; report a source gap as its own outcome; treat an errored verify phase as unverified rather than trusting its empty findings list; emit a null delta when a number was not measured; and warn rather than fail when the local copy is only a worksheet.
Anchor: a verdict set that includes NOT EVALUABLE and a null-delta sentinel, eval case `not-evaluable-verdict`; the harness marks a run partial only when it stops early and omits a delta when its arms are not comparable, so carrying a could-not-evaluate outcome in every verdict is this repo's addition
Receipts: `docs/handbook/evals.md#report-not-evaluable-and-not-measured-rather-than-a-fabricated-zero`

## Show the ratio and the sample, because one number is never the accuracy

Publish a rate as a ratio with its sample size and its estimand attached, because the same share over a different denominator is a different claim.
Never average disagreeing estimands or quote one conditional against another, filter before publishing a count, print the true total under any capped list, label a dataset a floor when amendments will move it, keep the caveat attached, prefer a measured floor and ceiling to a modelled point, and measure recall rather than assume it.
Report an agent-driven eval as passes over runs, per model, from more than one run of each question, since a question that passes once and fails the next is an example, not a measurement.
Score a case read to write a fix as a fit check, reported apart from the held-out cases, since its pass shows the fix fits the case it was written from, not that it generalises; judge the change on the cases nobody read.
Anchor: the measurement harness prints n beside every rate and refuses to combine two estimands (`node --test tests/`); the harness's eval runner repeats each case and reports a mean score, but a mean alone lets one set of runs read as near certain or near impossible, so attaching the sample and estimand to every rate is this repo's requirement
Receipts: `docs/handbook/evals.md#show-the-ratio-and-the-sample-because-one-number-is-never-the-accuracy`

## Make a measuring instrument reproducible

Seed the sampling so two initializing runs are byte-identical, since an unreproducible baseline fingerprint means nothing.
Regenerate a sampled fixture from its source under a seed instead of curating it, and commit a hand-authored case set with a header saying how its cases were chosen and from what sources, since nothing in it is sampled and a generated key would grade the system against itself; treat a holdout as spent once validated against, require a byte-identical parity diff when a formula changes, log every assumption behind a modelled number with its re-pull command, move the baseline in the change that moves the numbers with the why in the PR, and read growth in reviewer-corrected labels as decay of the key rather than improvement.
When the instrument drives an agent, pin the bare non-interactive invocation that skips ambient discovery, or where bare mode cannot authenticate the leanest invocation the login allows (the strict server-config flag, project-only setting sources, an explicit tool list, and the deny-by-default permission mode with an allowlist), and record the pricing basis beside any reported cost, since a rate or residency multiplier can move that figure without moving the bill.
Anchor: seeded regeneration asserted byte-identical in `tests/`; the harness advises pinning the model, can replay mock answers copied into its replay directory, and reports cost at list price, but leaves fixture sampling and the pricing basis free to move, so seeding the fixture and recording the pricing basis are this repo's addition
Receipts: `docs/handbook/evals.md#make-a-measuring-instrument-reproducible`

## Evaluate the path a session actually takes

Score the path everyday sessions use, since a strong score on a tuned path nobody takes says little; when the instrument and daily use diverge, measure the one in use or move the tuning there.
Tell the eval session about its environment in a system note rather than by editing the skill under test, since an instruction that is right for a normal session can send the eval elsewhere, and an edited skill is no longer the one being measured.
Anchor: none (because which path is in use is read from session logs and habit, which no checker can look up); the harness's eval runner scores the case it is handed and never asks whether that case is the path in use.
Receipts: `docs/handbook/evals.md#evaluate-the-path-a-session-actually-takes`

## Deny the eval session what the project allows, and fail a run whose results contain the key

Pass every project allow the eval does not itself grant as a deny, since project settings reach a session that loads them and a broad allow written for daily work is an open door in a measurement.
Detect answer-key contamination from tool results, not only tool inputs: a search that names no path gets past every path deny, so a run whose tool output contains the key fails, closed.
Make it impossible for a test of the instrument to start a real session, by replacing the spawn with one that throws, since a test that takes the normal path by mistake spends money and leaves transcripts that read as measurements.
Keep every transcript and re-score from the saved ones when scoring changes, writing beside the original report and never over it, so a scoring fix costs no sessions and the earlier number stays comparable.
Anchor: the instrument's own tests replace the session spawn with a throwing stub, and its scorer fails a run on the key in any tool result; the harness denies by path and tool input only and keeps run output without a re-score path, so the result check and the re-score are this repo's addition
Receipts: `docs/handbook/evals.md#deny-the-eval-session-what-the-project-allows-and-fail-a-run-whose-results-contain-the-key`

## Count what the agent did, not only whether it passed

Print the tool-call mix per arm, such as searches, document opens, shell reads, and verification calls, beside the outcome measures, and read it before adopting a change, because a prompt change can alter behaviour nobody asked about while every outcome measure stays flat.
Anchor: a per-arm tool-call count printed from the saved transcripts beside the outcome measures, with a test asserting both arms carry it; this package ships no comparison report, so the count is this repo's addition, built into its own instrument.
Receipts: `docs/handbook/evals.md#count-what-the-agent-did-not-only-whether-it-passed`

## Split a score gap into its causes from the transcripts before building to close it

Read the failing transcripts and estimate how much of a gap each cause explains: the agent missed material a good answer needed, the label asks for more than a good answer needs, or the measure miscounted; only the first is the agent's to fix.
Treat a failure label in a log as a summary: read the transcripts behind it before designing the fix, and correct the label in the record when it understated what happened, since a few words can hide which kind of failure it was.
Anchor: none (because estimating causes from transcripts is reading, which no checker does); the record proposing a build names the transcripts read and the share of the gap each cause explains, and this repo writes that record.
Receipts: `docs/handbook/evals.md#split-a-score-gap-into-its-causes-from-the-transcripts-before-building-to-close-it`

## Fingerprint what two arms compare, and print every field that differs

Tell two corpora apart by a fingerprint of their content, never by a count, since an edit that keeps the count passes a count guard; where a side has no fingerprint, fall back and say a same-count change cannot be ruled out.
Record the harness version and a fingerprint of the labels in force with each report, compare both between arms, and print one line naming every compared field that differs, since one changed value among many on a long line is easy to miss.
When a label declares files interchangeable, count the group once in every measure that reads it.
Anchor: tests of this repo's own comparison code that feed it a same-count content edit, a changed label set, and a citation of two members of one group, and assert the first two are flagged and the group scores at most one; this package ships no comparison tool, so the guard and its tests are this repo's addition.
Receipts: `docs/handbook/evals.md#fingerprint-what-two-arms-compare-and-print-every-field-that-differs`

## Don't

- Don't gate a pull request on a tier that costs money and answers differently every run.
- Don't trust an eval that scores the same with the rule as without it.
- Don't reach for a model judge where a deterministic grader would settle it.
- Don't score a path nobody takes, and don't let a test of the instrument start a real session.
- Don't report a fix's pass on the case it was written from as a gain.
- Don't build to close a gap whose causes nobody has read from the transcripts.

Anchor: each prohibition is the negative of a rule above and inherits that rule's enforcement.
