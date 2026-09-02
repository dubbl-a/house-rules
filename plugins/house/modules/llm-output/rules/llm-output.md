<!-- house source rule file; vendored into consuming repos by /house-rules:sync -->
# LLM output

These rules cover any path where a model writes text or records that a person, a page, or a downstream system will act on.
Output that reads as finished is not output that has been checked.

## Quarantine model output until a human moves it

Generate into an untracked directory and let a person move each file into the tracked one, because the move is the sign-off and a structural gate cannot be skipped the way a review can.
The machine may not vouch for its own guess: a queued row stays pending until a person promotes it, a first dry run is allowed to admit nobody, and a hand-edited review file is never overwritten.
Surface the real records for a person to direct, then execute the write and carry it through every downstream stage yourself, so the decision is theirs and only the bookkeeping is yours.
This governs an artifact heading for the tracked tree or published output, generated content a user or a future session will read as finished; a status-tagged suggestion row a person already scoped for auto-approval is a different surface, covered below, and does not quarantine here.
Anchor: hook. The pre-commit hook refuses to stage the drafts directory, which is also gitignored, so promotion happens only by a human moving the file.
Receipts: `docs/handbook/llm-output.md#quarantine-model-output-until-a-human-moves-it`

## Keep a deterministic backbone and let the model fill the slots

Put the process in data, the constants in config, and the arithmetic in code, then let the model supply only judgment, because anything re-derived from memory drifts between runs.
Prefer a fixed code path whenever the steps are knowable in advance, and reserve the model for work whose step count you cannot predict.
Label which parts of an output were computed and which were judged, and carry review context inline with the row so a review step never has to resolve a path to know what it is looking at.
Anchor: test. The deterministic half carries unit tests under `npm test`; a figure with no test behind it is a judgment call and has to say so in the output.
Receipts: `docs/handbook/llm-output.md#keep-a-deterministic-backbone-and-let-the-model-fill-the-slots`

## Report no finding rather than manufacture one

Hold a high bar for a finding: the review surfaces already treat a run that reports nothing as a normal outcome, and this repo extends that floor to every generated report, so a real finding becomes a named edit with exact replacement text shipped as a pull request rather than quietly accumulated.
Report an unmet requirement in a gap report instead of papering over it with the nearest plausible substitute, which is the shape fabrication takes when a slot has to be filled.
Close every report with a limitations section naming what was not checked, so a thin pass cannot read as a thorough one.
Anchor: schema. The report schema accepts an empty findings list and rejects a missing limitations section, so silence validates and a hollow finding does not.
Receipts: `docs/handbook/llm-output.md#report-no-finding-rather-than-manufacture-one`

## Refute with named lenses, drop by default, and log the drops

The hosted reviewer already fans out one agent per issue class and verifies candidates before reporting; on that floor, run every draft claim past named refutation lenses, one per failure class, so a reviewer can say which lens caught what instead of trusting a general impression of care.
Tier the number of passes by stakes, drop anything a lens refutes, and log each drop with its reason so the loss stays visible rather than silent.
Before attributing an oddity to a known failure mode, ask whether both readings could be true at once; a familiar bug is the cheapest wrong answer available.
Anchor: validator. The validation step refuses to exit clean while a surviving claim carries no lens verdict or a drop carries no logged reason.
Receipts: `docs/handbook/llm-output.md#refute-with-named-lenses-drop-by-default-and-log-the-drops`

## Cite or stay silent

Attach evidence to every claim: a quote that does not string-match its source, a fact absent from the source bank and unconfirmed in session, or a principle attributed to someone who never stated it, is a bug and not an answer.
Verify each citation mechanically before making it, reading the raw markup and the heading tree rather than a fetched summary, and diff the whole block against what is already published instead of trusting the extractor's hits.
Respect an explicit authoring marker: an entry its own source flags as unconfirmed never ships as settled, whatever the rest of the page implies.
Being the only candidate is not evidence, so corroborate before treating a single match as settled, round confidence down, let a weak identity match cap or forbid whole classes of output, and turn a near miss into a question rather than an insertion, or settle it outright when it is mechanically checkable.
Repoint a dead source rather than deleting it and confirm the replacement carries the cited claim rather than merely responding, verify an outcome before calling it a track record, and change a published number only against the primary filing.
Anchor: validator. The evidence gate rejects a claim with an empty evidence list, the quote checker string-matches every quotation against its stored source, and not in the corpus is an allowed answer.
Receipts: `docs/handbook/llm-output.md#cite-or-stay-silent`

## Gate output on status tags

Tag every fact with its status and let the tag decide what may ship: verified is free to use, unverified needs one explicit confirmation, and flagged is blocked until it is resolved.
Promote a fact by editing the source and recording the basis when the confirmation arrives, so the next run starts from the new status instead of asking the same question again.
Label each claim verified, inferred, or unknown throughout the body and keep opinion under its own marked heading, so a reader can see the footing of a sentence without leaving it.
Auto-approve only the confidence band and action set that are safe to auto-approve, carry the rest forward instead of pausing for a click, and surface borderline rejections inline so an override is cheap.
This governs a suggestion queue a human still adjudicates downstream, a row a person already scoped into a band and an action set they designated auto-approvable in advance; the designation is the human decision, made once, not at each row. It does not license a model to wave through content headed for the tracked tree or published output, which stays quarantined above regardless of confidence.
Anchor: validator. A mechanical validation, including a sensitive-data pattern scan, must exit clean before anything syncs, and it fails on an untagged or flagged claim.
Receipts: `docs/handbook/llm-output.md#gate-output-on-status-tags`

## Reword a locked claim, never strengthen it

Rewording a claim to mirror the reader's vocabulary is allowed; changing the claim, the metric, the scope, or the strength of the verb is not, and a number never rounds up.
Freeze drafts by number, treat a person's authored spans as immutable unless you show an itemized before and after, and check the decision ledger before publishing so a settled question is not silently reopened.
Anchor: test. A diff check fails the run when a locked span changes without a matching itemized entry in the ledger.
Receipts: `docs/handbook/llm-output.md#reword-a-locked-claim-never-strengthen-it`

## Treat silence as not approval

Where the harness gates a write, its permission prompt is the floor and an agent message never substitutes for it; everywhere else, show the diff and wait for an explicit yes before generating a file, because silence is not approval and neither is a question left unanswered.
Plan mode is the harness floor here: it holds edits until a person picks an approve option, but the hold ends at approval, does not bind where bypass permissions are available, and never applies to a printed run, so ask for the yes yourself.
The same reading applies to data: said nothing is not said yes, and the full rule lives in engineering.md.
Anchor: none (because an approval a script could grant is not an approval; the gate is the person).
Receipts: `docs/handbook/llm-output.md#treat-silence-as-not-approval`

## Read agreement with a shown suggestion as anchored, not accurate

When a reviewer sees the model's suggestion beside the evidence, their agreement measures anchoring rather than accuracy, so that rate is never quotable as a quality number.
Enforce blinding in the file on disk instead of in the reviewer's instructions, because an instruction is not a control, and audit every field a review packet prints for provenance: a field the process under test wrote is not evidence about that process.
Read unanimity as a reason to audit the instrument, and score a proposal by whether it would have killed something a person approved, not by its hit rate on the rejections.
Anchor: test. The packet builder strips model-authored fields before writing, and a test asserts that a blinded packet on disk carries no verdict field.
Receipts: `docs/handbook/llm-output.md#read-agreement-with-a-shown-suggestion-as-anchored-not-accurate`

## Don't

- Don't let a model approve, promote, or merge its own output.
- Don't overwrite a hand-edited human review file.
- Don't ship a claim whose evidence list is empty.
- Don't round a confidence, a metric, or a number up.
- Don't delete a dead source; repoint it and confirm the replacement carries the claim.
- Don't insert a near miss; ask about it.
- Don't strengthen a locked claim, its metric, its scope, or its verb.
- Don't paper over an unmet requirement, and don't invent a finding to fill a slot.
- Don't drop a refuted claim silently.
- Don't quote a reviewer's agreement with a shown suggestion as an accuracy number.
- Don't blind a review in its instructions and call it blinded.
- Don't treat silence, an unanswered question, or a missing field as approval.
- Don't make a person click through a queue you could have auto-approved safely.

Anchor: each line restates a rule above and is enforced by that rule's own anchor.
