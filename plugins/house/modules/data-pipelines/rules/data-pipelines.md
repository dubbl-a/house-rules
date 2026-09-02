<!-- house source rule file; vendored into consuming repos by /house-rules:sync -->

# Data pipelines

These rules govern any script that acquires, transforms, or publishes data on a schedule or on demand. Each one exists because a pipeline failed quietly and the failure surfaced somewhere else.

## End every pipeline run with a retro of invariants, deltas, and proposals

End a run with three answers in descending loudness: are this pipeline's invariants still coherent, what changed against the previous run, and what does labeled data propose. Print proposals; never adopt one automatically.
Ship a written report and a terminal digest that carries the fix line, because nobody opens the file. Keep an all-domains form for pipelines that run too rarely for a per-run hook to fire, and narrow a retro's scope rather than let it fail to run at all.
Trust an invariant line and read a delta sceptically while parallel sessions share one store: a mid-chain comparison of stored against live reads exactly like data loss, and an absent key is not a key that fell to zero. Where the retro and the pipeline compute the same thing, keep one implementation; the full rule lives in engineering.md.

Anchor: the retro runner this module ships, wired as a package script that exits non-zero on a hard invariant so bad state cannot reach a publish or a deploy.
Receipts: `docs/handbook/data-pipelines.md#end-every-pipeline-run-with-a-retro-of-invariants-deltas-and-proposals`

## Make a pipeline idempotent and resumable, and log the idempotency rather than assume it

Log idempotency rather than assume it. Write a run row per pipeline, treat an unchanged input hash inside the window as a no-op, let an explicit force flag override, and let a new content hash mean re-ingest.
Name the contract per lane, delta-only, append-only with a client-supplied key, conflict-do-nothing, or immutable once dispatched. Mark applied rows so a re-run cannot double-apply, and leave every run auditable through a paired input and output artifact plus a log line, so the run is reproducible without the original source.
Ask what actually changed before re-running a chain, because a finished edit at the end usually needs the publish step alone. Check a stale pending backlog for already-applied duplicates before treating it as work, and suppress durably through the status the queue builder actually skips on, since the intuitive status re-surfaces on the next refresh.

Anchor: the run log or ledger table, plus a retro invariant asserting every run has its row and every applied row its applied marker.
Receipts: `docs/handbook/data-pipelines.md#make-a-pipeline-idempotent-and-resumable-and-log-the-idempotency-rather-than-assume-it`

## Write nothing when a record is unchanged

Compare before writing and stamp a timestamp only on substantive change, because a no-op write churns the modified column, floods every downstream change feed, and buries the one row that really moved.
When a scoped hand write is unavoidable, mirror the pipeline's exact output fields, so the next full run is a no-op instead of a fight between the hand and the script.

Anchor: a unit test that runs the writer twice over unchanged input and asserts the second run reports zero writes.
Receipts: `docs/handbook/data-pipelines.md#write-nothing-when-a-record-is-unchanged`

## Default to a dry run and require an explicit flag to write

Make the dry run the default and `--apply` the opt-in, so the first run of a new script is a plan a human reads rather than a change nobody asked for.
Plan, validate, execute: emit a machine-verifiable diff, check it, then write, and leave an audit row per write. Gate deletion behind one script with one call site and its own breadcrumb.
Roll out in tiers with a small first push before the full one, and head a script whose dry run would itself surface regressions with a do-not-run note, because the dry half is not always the safe half.

Anchor: a unit test per write script asserting a default run issues no write call, plus this package's dry-run-default eval.
Receipts: `docs/handbook/data-pipelines.md#default-to-a-dry-run-and-require-an-explicit-flag-to-write`

## Brake a prune at a share of the table, and unit-test the brake

Refuse to delete more than a set share of a table in one run and require an explicit `--force` to override, because the run that empties the table looks exactly like the run that clears three stale rows until the count comes back.
Unit-test the brake rule itself at both sides of the share, since a brake nobody has watched trip is a comment.

Anchor: a unit test of the brake predicate just under and just over the share, run in CI.
Receipts: `docs/handbook/data-pipelines.md#brake-a-prune-at-a-share-of-the-table-and-unit-test-the-brake`

## Drive writes from a policy registry that fails closed on an unknown policy

Keep one config that is the only writable field set, give each field a named policy, and fail closed on a policy the writer does not recognize, so a field outside the registry is structurally unwritable rather than merely undocumented.
Never edit a policy value to describe what the code currently does. The string is the instruction, not a comment about it, and a typo in one stops a lane silently while every other lane keeps running.

Anchor: a schema test over the registry that rejects an unknown policy string, and a write planner that refuses any field the registry does not list.
Receipts: `docs/handbook/data-pipelines.md#drive-writes-from-a-policy-registry-that-fails-closed-on-an-unknown-policy`

## Make unmapped input loud

Fail a gate when input lands in no bucket above a threshold, because the silent version of this failure is a new upstream category vanishing from every report while every page still renders and every total still adds up.
Parse an external tabular source by header, never by position, so an inserted or reordered column is a loud mismatch instead of a column of dates quietly read as amounts.

Anchor: a build gate that counts unbucketed input and fails above the threshold, plus a header-contract assertion at parse time.
Receipts: `docs/handbook/data-pipelines.md#make-unmapped-input-loud`

## Archive first, parse second, and write the ledger row in the same transaction

Write every fetched byte to the archive and its ledger row in one transaction, so a file and its provenance cannot diverge, and let later stages read the archive rather than the network. That is what makes an offline re-parse and a better model a year from now cost no bandwidth.
Content-address the artifact, key it on the source URL and never the basename, and supersede rather than clobber, because a revised source should be a visible diff and two URLs can return identical bytes.
Break the circuit after a few consecutive refusals for one kind, so a wrong URL costs a handful of requests rather than a whole run of them.

Anchor: the archive write and the ledger insert share one transaction, plus a retro invariant checking both directions, no archived file without a row and no row without its file.
Receipts: `docs/handbook/data-pipelines.md#archive-first-parse-second-and-write-the-ledger-row-in-the-same-transaction`

## Reconcile a vendor's success response against an independent count

Never treat a vendor's success response as proof past a plan cap, because the API can answer ok while the tier silently truncates the batch and nothing in the response says so.
Reconcile after every push by paginating what the vendor actually holds, compare that count against what you sent, and fail the run on a mismatch.

Anchor: a reconcile pass that lists the vendor's own records after each push and exits non-zero when the counts disagree.
Receipts: `docs/handbook/data-pipelines.md#reconcile-a-vendors-success-response-against-an-independent-count`

## Name, don't act, on ambiguous data

Hold when identity is uncertain. Report the duplicates for a human to merge, refuse an unrecognised type rather than guess it, and write the cost asymmetry down, because a hold costs one review while a wrong link costs a merge through every system that copied it.
A population statistic orders a worklist and never decides a row, in either direction. When every surfaced candidate looks wrong, search the full source instead of choosing between the two on offer.
Derive every edge in the pipeline rather than by hand, leave a type extensible instead of shipping a low-precision matcher, and test a clean-looking mechanical rule against the first real row that stresses it before shipping it.

Anchor: a review-queue status for held rows, plus a matcher test asserting an ambiguous fixture links nothing and mints nothing.
Receipts: `docs/handbook/data-pipelines.md#name-dont-act-on-ambiguous-data`

## Don't

Don't adopt a retro proposal automatically; print it and let a human decide.
Don't quote a delta measured mid-chain, and don't read an absent key as a fall to zero.
Don't assume idempotency: if nothing logs the run, the pipeline is not idempotent.
Don't re-run a whole chain when only the last step's input changed.
Don't clear a queue through a status the queue builder does not skip on.
Don't stamp a timestamp on a record whose substance did not change.
Don't hand-write a row in fields the pipeline does not also write.
Don't ship a write path whose default run writes.
Don't give deletion a second call site.
Don't delete past the brake to avoid typing the force flag.
Don't edit a policy value to describe what the code currently does.
Don't write a field the registry does not list.
Don't parse an external table by column position.
Don't drop input that matches no bucket.
Don't clobber an archived artifact, and don't key one on its basename.
Don't re-fetch from the network when the archive already holds the bytes.
Don't count a vendor's success response as a count.
Don't guess an unrecognised type, and don't let a population statistic decide a row.
Don't hand-enter a relationship the pipeline should derive.
Don't loosen a guard to fix a hold.

Anchor: every prohibition here inverts a rule above and is enforced by that rule's anchor.
