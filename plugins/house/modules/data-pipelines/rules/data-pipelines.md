<!-- house source rule file; vendored into consuming repos by /house-rules:sync -->

# Data pipelines

These rules govern any script that acquires, transforms, or publishes data on a schedule or on demand. Each exists because a pipeline failed quietly and the failure surfaced elsewhere.

## End every pipeline run with a retro of invariants, deltas, and proposals

End a run with three answers in descending loudness: are invariants coherent, what changed against the previous run, and what does labeled data propose. Print proposals; never adopt automatically.
Ship a written report and a terminal digest carrying the fix line, since nobody opens the file. Keep an all-domains form for pipelines too rare for a per-run hook, and narrow a retro's scope rather than skip the run.
Trust an invariant line and read a delta sceptically when parallel sessions share one store: a mid-chain comparison of stored against live reads like data loss, and an absent key isn't one that fell to zero. Where retro and pipeline compute the same thing, keep one implementation; full rule in engineering.md.

Anchor: the retro runner this module ships, wired as a package script that exits non-zero on a hard invariant, so bad state can't reach a publish or deploy.
Receipts: `docs/handbook/data-pipelines.md#end-every-pipeline-run-with-a-retro-of-invariants-deltas-and-proposals`

## Make a pipeline idempotent and resumable, and log the idempotency rather than assume it

Log idempotency rather than assume it: write a run row per pipeline, treat an unchanged input hash inside the window as a no-op, let an explicit force flag override, and a new content hash mean re-ingest.
Name the contract per lane: delta-only, append-only with a client-supplied key, conflict-do-nothing, or immutable once dispatched. Mark applied rows so a re-run can't double-apply, and leave every run auditable through a paired input/output artifact and a log line, reproducible without the original source.
Ask what actually changed before re-running a chain: a finished edit at the end usually needs only the publish step. Check a stale pending backlog for already-applied duplicates before treating it as work, and suppress durably through the status the queue builder skips on, since the intuitive status re-surfaces on refresh.

Anchor: the run log or ledger table, plus a retro invariant asserting every run has its row and every applied row its marker.
Receipts: `docs/handbook/data-pipelines.md#make-a-pipeline-idempotent-and-resumable-and-log-the-idempotency-rather-than-assume-it`

## Write nothing when a record is unchanged

Compare before writing and stamp a timestamp only on substantive change: a no-op write churns the modified column, floods every downstream change feed, and buries the one row that really moved.
When a scoped hand write is unavoidable, mirror the pipeline's exact output fields, so the next full run is a no-op, not a fight between hand and script.

Anchor: a unit test running the writer twice over unchanged input, asserting the second run reports zero writes.
Receipts: `docs/handbook/data-pipelines.md#write-nothing-when-a-record-is-unchanged`

## Default to a dry run and require an explicit flag to write

Make the dry run the default and `--apply` the opt-in: the harness gates file tools Claude calls directly but can't see what a script writes once running, so a new script's first run is a plan a human reads, not an unasked change.
Plan, validate, execute: emit a machine-verifiable diff, check it, then write, and leave an audit row per write. Gate deletion behind one script, one call site, its own breadcrumb.
Roll out in tiers, small push before full, and head a script whose dry run would itself surface regressions with a do-not-run note, since the dry half isn't always the safe half.

Anchor: a unit test per write script asserting a default run issues no write call, plus this package's dry-run-default eval.
Receipts: `docs/handbook/data-pipelines.md#default-to-a-dry-run-and-require-an-explicit-flag-to-write`

## Brake a prune at a share of the table, and unit-test the brake

Refuse to delete more than a set share of a table per run and require explicit `--force` to override: the harness prompts for a destructive filesystem command but never sees a script's row deletes, so a table-emptying run looks like one clearing a few stale rows until the count returns.
Unit-test the brake rule at both sides of the share; a brake nobody has watched trip is a comment.

Anchor: a unit test of the brake predicate just under and just over the share, run in CI.
Receipts: `docs/handbook/data-pipelines.md#brake-a-prune-at-a-share-of-the-table-and-unit-test-the-brake`

## Drive writes from a policy registry that fails closed on an unknown policy

Keep one config as the only writable field set, give each field a named policy, and fail closed on an unrecognized policy, so a field outside the registry is structurally unwritable, not merely undocumented.
Never edit a policy value to describe what the code does: the string is the instruction, not a comment on it, and a typo stops a lane silently while every other keeps running.

Anchor: a schema test rejecting an unknown policy string, and a write planner refusing any unlisted field.
Receipts: `docs/handbook/data-pipelines.md#drive-writes-from-a-policy-registry-that-fails-closed-on-an-unknown-policy`

## Make unmapped input loud

Fail a gate when input lands in no bucket above a threshold: the silent version of this failure is a new upstream category vanishing from every report while every page renders and every total still adds up.
Parse an external tabular source by header, never position, so a reordered column is a loud mismatch, not dates quietly read as amounts.

Anchor: a build gate counting unbucketed input and failing above the threshold, plus a header-contract assertion at parse time.
Receipts: `docs/handbook/data-pipelines.md#make-unmapped-input-loud`

## Archive first, parse second, and write the ledger row in the same transaction

Write every fetched byte to the archive and its ledger row in one transaction, so a file and its provenance can't diverge, and let later stages read the archive, not the network: that's what makes an offline re-parse or a better model next year cost no bandwidth.
Content-address the artifact, key it on the source URL, never the basename, and supersede rather than clobber, since a revised source should be a visible diff and two URLs can return identical bytes.
Break the circuit after a few consecutive refusals for one kind, so a wrong URL costs a handful of requests, not a whole run.

Anchor: the archive write and ledger insert share one transaction, plus a retro invariant checking both directions: no archived file without a row, no row without its file.
Receipts: `docs/handbook/data-pipelines.md#archive-first-parse-second-and-write-the-ledger-row-in-the-same-transaction`

## Reconcile a vendor's success response against an independent count

Never treat a vendor's success response as proof past a plan cap: the API can answer ok while the tier silently truncates the batch and nothing in the response says so.
Reconcile after every push by paginating what the vendor actually holds, compare that count against what you sent, and fail on a mismatch.

Anchor: a reconcile pass listing the vendor's own records after each push, exiting non-zero when the counts disagree.
Receipts: `docs/handbook/data-pipelines.md#reconcile-a-vendors-success-response-against-an-independent-count`

## Name, don't act, on ambiguous data

Hold when identity is uncertain: report duplicates for a human to merge, refuse an unrecognised type rather than guess it, and write the cost asymmetry down: a hold costs one review, a wrong link costs a merge through every system that copied it.
A population statistic orders a worklist and never decides a row, either direction. When every surfaced candidate looks wrong, search the full source instead of choosing between the two on offer.
Derive every edge in the pipeline rather than by hand, leave a type extensible instead of shipping a low-precision matcher, and test a clean-looking mechanical rule against the first real row that stresses it.

Anchor: a review-queue status for held rows, plus a matcher test asserting an ambiguous fixture links and mints nothing.
Receipts: `docs/handbook/data-pipelines.md#name-dont-act-on-ambiguous-data`

## Key a projection on its source's whole grain, and prove that grain with a constraint

Key every published projection on the whole natural key of its source, and widen that key in the same change that widens the source: a projection keyed on yesterday's grain collapses two now-different rows into one.
Prove the grain with a unique constraint on the source rather than trusting the query that reads it: two rows that ought to differ are indistinguishable from one until something downstream writes both.
Treat an added column as a breaking change whenever it widens what makes a row unique: every schema-evolution tool classes an addition as safe, and none ask whether the grain moved.
Assert each projection's write key against that constraint as a run invariant: this failure passes the migration, passes the write, and first appears as an opaque error two systems away, naming nothing that caused it.
The constraint and its migration are database.md's.

Anchor: a retro invariant comparing every projection's write key against its source table's unique constraint, run by this module's retro runner before any publish.
Receipts: `docs/handbook/data-pipelines.md#key-a-projection-on-its-sources-whole-grain-and-prove-that-grain-with-a-constraint`

## Don't

Don't assume idempotency: if nothing logs the run, it's not idempotent.
Don't ship a write path whose default run writes.
Don't edit a policy value to describe what the code does.
Don't parse an external table by column position.
Don't re-fetch from the network when the archive already holds the bytes.
Don't count a vendor's success response as a count.
Don't hand-enter a relationship the pipeline should derive.
Don't loosen a guard to fix a hold.

Anchor: every prohibition here inverts a rule above and is enforced by that rule's anchor.
