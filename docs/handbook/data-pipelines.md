<!-- house source doc; receipts chapter for plugins/house/modules/data-pipelines/rules/data-pipelines.md -->

# Data pipelines: receipts

## Why this exists

A pipeline runs once, looks fine, and runs again next week against whatever state the last run left. The failures this module guards against do not announce themselves at the point they happen: an unmeasured metric reads as a metric that fell to zero, a truncated vendor push reports `ok: true`, an archived error page looks like a fetched agenda, and a merged duplicate person costs a cross-repo cleanup two systems downstream. Every rule below traces to a run that looked clean and was not.

## End every pipeline run with a retro of invariants, deltas, and proposals

repo-a's `scripts/lib/retro.mjs` is the reference implementation. Each domain module exports `{ domain, title, invariants: [{key, severity, title, why, remedy, check(ctx)}], counts(ctx), signals?, labeled?, skip?(ctx) }`, and `npm run retro` walks all nine domains (content, match, finance, classify, enrichment, publish, broadcast, schema, council) in that order, printing invariants first, then deltas against the previous run, then proposals, in descending loudness. A `severity: 'hard'` invariant exits non-zero, so a broken invariant cannot reach `publish:neon` or a deploy.

The framework ships two output surfaces on purpose: a timestamped markdown report (`writeReport`) and a terminal digest (`printDigest`) that shows the first three violations plus a `fix:` line per failure, because nobody opens the report file. `scripts/retro/cli.mjs` also provides an all-domains form, run when a per-orchestrator hook would rarely fire, as the at-a-glance health check for pipelines that run too rarely for their own hook to catch drift.

A dated incident set the bar for what "not measured" means. The retro's `diffCounts` once reported `chunks_embedded 218 -> 0` while all 218 embeddings were sitting in the table, because a metric present on one side and absent on the other silently coerced to zero. It read exactly like data loss. The fix was a `NOT_MEASURED` sentinel: report `(not measured)` with `delta: null` rather than invent a number nothing can act on. A related family of finding (project_retro_snapshot_branch_skew.md, project_retro_delta_branch_skew.md, memory corpus) generalizes this: while parallel sessions share one snapshot log but compute `counts()` per branch, a key only one branch computes reads as `N -> 0`, not as data loss, so a retro delta needs the same scepticism as a comparison of stored state against a live read mid-chain (project_matcher_standalone_degrades_db.md, memory corpus): both look exactly like the failure they are not.

`scripts/retro/domains/publish.mjs` states the design choice directly: a retro that cannot run is worse than one with a narrower scope, so a domain that lacks the state to check everything checks what it has rather than failing to run at all.

`.claude/rules/finance-pipeline.md` supplies the reason the rule file's retro section points to `engineering.md` for shared computation: two copies of a 5-tier donor cascade drift, and a drifted copy silently produces a different donor graph from the one the report shows. Where the retro and the pipeline compute the same thing, keep one implementation; the fuller rule about that lives in `rule:engineering.md#keep-one-implementation-per-computation-and-let-the-gate-and-the-report-share-it`.

## Make a pipeline idempotent and resumable, and log the idempotency rather than assume it

`.claude/rules/entity-resolution.md` states the pattern: matchers write to `public_site._partisan_run_log`, an unchanged input hash inside a 24-hour window is a no-op, and an explicit `--force` flag overrides. Idempotency here is a logged fact, not an assumed property of the code.

The same shape recurs across every fleet repo surveyed. repo-a's enrichment appliers mark applied rows so a re-run cannot double-apply, using a `(candidate_slug, source_fingerprint, task_type)` dedup at the seeder and `WHERE status='approved' AND applied_at IS NULL` at the applier. repo-b's `brain/corpus.md` makes the ingestion ledger itself the idempotency contract: a new content hash means re-ingest, an unchanged one does not. repo-c's Stripe sync is built idempotent and resumable by the same convention (cross-referenced to the entity-resolution pattern above rather than restated). repo-d's CLAUDE.md names the idempotency contract per lane rather than treating it as one rule: delta-only, append-only with a client-supplied key, conflict-do-nothing, or immutable once dispatched, because a sync lane and an ingest lane are not idempotent the same way. repo-e's `SKILL.md:29` versions every run by a paired `resume_content_*.json` and `requirements_*.json` plus a log line, so a run is auditable months later without re-reading the original job posting; each commit is a version, and `git log` and `git diff` are the history.

Three memory-corpus findings sharpen the same rule in repo-a's own operation. Checking a stale pending backlog against already-applied duplicates before treating it as new work (memory corpus) catches a queue that looks urgent but is already resolved. Suppressing an unwanted committee donor cluster durably means writing `approved` plus `no_action`, never `rejected`, because a `rejected` row re-surfaces on every refresh while the queue builder does not skip on it (project_suppress_committee_donor_clusters.md, memory corpus). And asking what actually changed before re-running a whole chain matters because a finished master edit usually needs the publish step alone: `publish:neon` without a fresh match run (feedback_publish_without_rematch.md, memory corpus).

## Write nothing when a record is unchanged

repo-b's `revops.md` states the rule for its Neon and Attio lead-scoring stack: a timestamp stamps only on substantive change, so an unchanged record writes nothing. The point is not cosmetic. A no-op write still churns the modified column, and a churned modified column floods every downstream change feed with rows that did not actually move, burying the one row that did.

The corollary shows up in repo-a's manual-update discipline: when a scoped hand write is genuinely unavoidable, it mirrors the pipeline's exact output fields, so the next full run of the pipeline is a no-op instead of a fight between the hand-written row and the script that wants to reconcile it (companion finding to feedback_manual_updates_claude_executes.md, memory corpus).

## Default to a dry run and require an explicit flag to write

repo-a's outbound, backfill, and prune scripts default to dry-run and require an explicit `--apply` to write: `rematch-contributions.mjs --cycle <slug> --apply`, `backfill-segments.ts` dry then `--apply`, `prune-reports.mjs` dry-run by default. `push-leads.mjs` rolls the pattern out in tiers rather than all at once, `--tier=0` before `--tier=1`, with a documented 50-lead test push (D5 primary-skippers only) as the literal first step.

Not every dry run is the safe half. `scripts/match/restore-reviewed-links.mjs` carries a do-not-run header because its own dry run would write 261 rows, mostly regressions, so the script that would normally be the safe preview is instead the one to leave alone.

repo-b's `revops.md` gates deletion behind one script, one call site, its own breadcrumb, and a dry-run default. repo-c's `sheets.md` pre-commits the same contract for a write path that does not exist yet: if a writeback to the sheet is ever added, it needs a dry-run diff a human reads first and an audit row per write, decided before the code exists rather than bolted on after.

The plan-validate-execute shape is external, widely-held guidance rather than a fleet-specific pattern: add `--dry-run` to every irreversible script and default a destructive prompt to `[y/N]`, with an explicit `--yes` for automation (see Sources), and for batch or destructive work emit a machine-verifiable plan, validate it with a script, then apply, so an intermediate artifact catches errors before anything is touched (see Sources).

Native floor, as of 2026-09-02: the permission system gates the Read, Edit, and Write tools directly while the sandbox isolates only Bash subprocesses, so nothing native sees what a running script writes (https://code.claude.com/docs/en/sandboxing).

## Brake a prune at a share of the table, and unit-test the brake

repo-b's `revops.md` refuses to delete more than 10% of a table in one run, with an explicit `--force` flag to override. repo-d's `publish-voters.mjs` carries the same brake as a percentage-threshold refusal on a destructive publish, with `--force`, `--dry-run`, and a unit test of the brake predicate itself, because a brake nobody has watched trip is only a comment in the code, not a control.

Native floor, as of 2026-09-02: the permission flow for a destructive filesystem command, which still prompts for an rm or rmdir against a critical path even in auto-allow sandbox mode, and which never sees a row delete a script issues (https://code.claude.com/docs/en/sandboxing).

## Drive writes from a policy registry that fails closed on an unknown policy

repo-b's `revops.md` names `config/attio-payload.json` as the only writable field set for its Neon and Attio lead-scoring stack, with four named policies (`sync`, `seed_once`, `fill_if_empty`, `human`) and a `human` policy that fails closed rather than writing. The write planner (`planWrites`) refuses any field the registry does not list, so a field outside the registry is structurally unwritable, not merely undocumented.

repo-d's `config/attio-payload.json` and its CLAUDE.md carry the corollary as a standing warning: do not edit a policy value to describe what the code currently does, prose only, because a typo in a policy string silently stops that lane while every other lane keeps running and nothing announces the gap.

## Make unmapped input loud

repo-c's `.claude/rules/finance.md` defines a bucket taxonomy for revenue and states that unmapped revenue must be loud: a planned `check:unmapped` build gate fails when revenue lands in no bucket above a threshold, rather than letting a new upstream category quietly vanish from every report while every page still renders and every total still appears to add up. The same rule file makes reconciliation against the books the correctness gate: the sync is not trusted until its figures tie out against checked-in prior-year fixtures.

repo-c's `.claude/rules/sheets.md` supplies the header-addressed half of the same rule: an exported tab is parsed by header, never by column position, so an inserted or reordered column in the source spreadsheet produces a loud mismatch instead of a column of dates silently read as amounts.

## Archive first, parse second, and write the ledger row in the same transaction

repo-a's `.claude/rules/council-acquisition.md` states the rule underneath everything else in that pipeline: a status code is not a content check. Every host in the council-meeting acquisition path answers a request it cannot serve with a valid-looking page under HTTP 200, and trusting the status archived 39 identical error pages before anything noticed. It is the same lesson `check:images` exists for elsewhere in the codebase: the name was not evidence, only the bytes were. The fix was `fetchAndArchive` taking a `validate(body)` that runs before anything is written, because archiving first and rejecting afterward had left those 39 error pages on disk with no ledger row, invisible on both axes since nothing looks for a file that no row claims. A rejection now writes neither the artifact nor the row, and three consecutive refusals for one kind abandon that kind for the run, so a wrong URL costs three requests rather than thirty-nine.

`.claude/rules/council-meetings.md` states the transactional half: every fetched byte is written to `meeting_archive/<clip_id>/<kind>/<sha256>.<ext>` with a ledger row in the same transaction as the parse, so a file and its provenance cannot diverge. Later stages read the archived path, never the network, which is why an offline re-parse works and why a better transcription model a year from now costs no bandwidth. The artifact is content-addressed, and a revised source supersedes rather than clobbers: a changed agenda becomes a new file with the prior row stamped `superseded_by`, because a revised source should be a visible diff, never a silent overwrite. The source URL is part of the artifact key, never the basename, because two different URLs can return identical bytes.

The same acquisition work runs under a stated politeness contract: an identified User-Agent, a 30-second timeout, a 10-second inter-request floor per host matching that host's own stated `Crawl-delay`, targeted fetches only (every URL derived from a known id, never spidering), media fetched once and checksummed rather than re-fetched, and a stated volume ceiling.

## Reconcile a vendor's success response against an independent count

repo-a's `.claude/rules/outbound.md` records the incident that produced this rule: Smartlead's plan tier silently truncates a push, and `add-leads` still returns `ok: true` past the plan's contact cap, with nothing in the response marking the truncation. The fix is a reconcile pass, `reconcile.mjs`, that pages through the vendor's own `listLeads()` after every push and compares that count against what was sent, never trusting the `add-leads` response by itself.

## Name, don't act, on ambiguous data

repo-a's matcher refuses an unrecognised type rather than guessing it, and treats a population statistic, such as address overlap across records, as something that orders a worklist and never decides a single row: an address-overlap withdrawal signal that looked clean at the population level died the first time it was checked against a real filing (feedback_signal_orders_not_decides.md, memory corpus). The matcher test suite generalizes the lesson: find the first real row that stresses a clean-looking mechanical rule before shipping it, rather than trusting the rule because it looked clean on the cases already in hand (companion finding, memory corpus).

repo-d's `intel-enrichment` skill states the cost asymmetry directly: holding an ambiguous match costs one review; minting a wrong one costs a merge that propagates through every system that copied it. No script in that pipeline is allowed to merge, delete, or archive a duplicate on its own; a nightly `attio:dupes` check names candidates for a human to merge and is wired into CI as a deliberately non-failing step, so a data-quality finding never turns the run red on its own. repo-c's CLAUDE.md states the same posture from the CI side: send an unresolved row to a review surface and never guess it.

Two further memory-corpus findings sharpen the "don't act" half specifically. When both surfaced candidate matches look wrong, the fix is to search the full source file rather than choose between the two options already on offer, because the right registrant is often outside the surfaced set entirely (feedback_adjudicate_broader_voter_file.md, memory corpus). And every graph edge in the pipeline, such as a person-to-organization leadership relationship, is derived by the pipeline itself and never hand-typed into NocoDB or Neon, with the relationship type left extensible rather than shipping a low-precision matcher to force a decision the data does not support yet (feedback_no_manual_relationship_entry.md, memory corpus).

## Sources

- https://nickjanetakis.com/blog/cli-tools-that-support-previews-dry-runs-or-non-destructive-actions (widely-held guidance on `--dry-run` as a default and an explicit `--yes` for automation)
- https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices (official guidance on plan-validate-execute for batch or destructive work)
