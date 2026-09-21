<!-- house source rule file; vendored into consuming repos by /house-rules:sync -->
# LLM output

These rules cover any path where a model writes text or records that a person, a page, or a downstream system acts on.
Output that reads as finished is not output that has been checked.

## Quarantine model output until a human moves it

The harness floor is its approval prompt on a write, pre-approved under accept-edits and gone at session end, so the durable gate must be structural: generate into an untracked directory and let a person move each file into the tracked one; that move is the sign-off, and unlike a review, cannot be skipped.
The machine may not vouch for its own guess: a queued row stays pending until a person promotes it, a dry run may admit nobody, and a hand-edited review file is never overwritten.
Surface the real records for a person to direct, then execute the write and carry it through every downstream stage yourself: the decision is theirs, the bookkeeping is yours.
This governs an artifact heading for the tracked tree or published output, content a user or future session reads as finished; a status-tagged row scoped for auto-approval is a different surface below.
Anchor: hook. The pre-commit hook refuses to stage the gitignored drafts directory, so promotion happens only by a human's move.
Receipts: `docs/handbook/llm-output.md#quarantine-model-output-until-a-human-moves-it`

## Keep a deterministic backbone and let the model fill the slots

Put the process in data, the constants in config, the arithmetic in code, then let the model supply only judgment; anything re-derived from memory drifts between runs.
Prefer a fixed code path whenever steps are knowable in advance, and reserve the model for work whose steps you cannot predict.
Anchor a printed run on a supplied output schema where one applies, since the harness fails the run on an invalid schema and hands back a structured payload; a schema fixes shape, not footing.
Label which output parts were computed and which were judged, and carry review context inline with the row so a review step never has to resolve a path to know what it sees.
Anchor: test. The deterministic half carries unit tests under `npm test`; an untested figure is a judgment call and must say so in the output.
Receipts: `docs/handbook/llm-output.md#keep-a-deterministic-backbone-and-let-the-model-fill-the-slots`

## Report no finding rather than manufacture one

Hold a high bar for a finding: review surfaces treat a run reporting nothing as normal, and this extends that floor to every report, so a real finding is a named edit with exact text, shipped as a pull request, not accumulated.
Report an unmet requirement in a gap report instead of papering over it with the nearest substitute; that is the shape fabrication takes when a slot has to be filled.
Close every report with a limitations section naming what was not checked, so a thin pass never reads thorough.
Anchor: schema. The report schema accepts an empty findings list and rejects a missing limitations section: silence validates, a hollow finding does not.
Receipts: `docs/handbook/llm-output.md#report-no-finding-rather-than-manufacture-one`

## Refute with named lenses, drop by default, and log the drops

The hosted reviewer, where it runs, already fans out one agent per issue class and verifies candidates before reporting; run every draft claim past named lenses, one per failure class, so a reviewer names which lens caught what, not a general impression.
Tier the number of passes by stakes, drop anything a lens refutes, and log each drop with its reason so the loss stays visible, not silent.
Before attributing an oddity to a known failure mode, ask whether both readings could be true; a familiar bug is the cheapest wrong answer.
Anchor: validator. The validation step refuses to exit clean while a surviving claim lacks a lens verdict or a drop lacks a logged reason.
Receipts: `docs/handbook/llm-output.md#refute-with-named-lenses-drop-by-default-and-log-the-drops`

## Cite or stay silent

Attach evidence to every claim: a quote that does not match its source, a fact absent from the source bank and unconfirmed in session, or a principle attributed to someone who never said it, is a bug, not an answer.
Verify each citation mechanically before making it, reading the raw markup and heading tree rather than a fetched summary, and diff the whole block against what is published instead of trusting the extractor.
Respect an explicit authoring marker: an entry its source flags as unconfirmed never ships as settled, whatever the rest of the page implies.
Being the only candidate is not evidence: corroborate before treating a match as settled, round confidence down, let a weak match cap or forbid output classes, and turn a near miss into a question, not an insertion, unless mechanically checkable.
Repoint a dead source rather than delete it, and confirm the replacement carries the cited claim, not merely responds; verify an outcome before calling it a track record, and change a published number only against the primary filing.
Anchor: validator. The evidence gate rejects a claim with an empty evidence list, the quote checker string-matches every quotation against its source, and not in the corpus is an allowed answer.
Receipts: `docs/handbook/llm-output.md#cite-or-stay-silent`

## Gate output on status tags

Tag every fact with its status and let the tag decide what ships: verified is free to use, unverified needs one explicit confirmation, flagged is blocked until resolved.
Promote a fact by editing the source and recording the basis when confirmation arrives, so the next run starts from the new status.
Label each claim verified, inferred, or unknown throughout the body, and keep opinion under its own marked heading, so a reader sees a sentence's footing.
The harness decides which tool calls proceed through its own allow rules and classifier, neither seeing a row's confidence; auto-approve only the safe confidence band and action set, carry the rest forward instead of pausing for a click, and surface borderline rejections for a cheap override.
This governs a suggestion queue a human still adjudicates downstream, a row already scoped into a band and action set marked auto-approvable; that designation is the human's, made once, not per row. It never licenses waving through content headed for the tracked tree or published output, which stays quarantined above regardless of confidence.
Anchor: validator. A mechanical validation, including a sensitive-data scan, must exit clean before anything syncs, and fails on an untagged or flagged claim.
Receipts: `docs/handbook/llm-output.md#gate-output-on-status-tags`

## Reword a locked claim, never strengthen it

Rewording a claim to mirror the reader's vocabulary is allowed; changing the claim, metric, scope, or verb strength is not, and a number never rounds up.
The concise built-in style is the floor, since it compresses a response while keeping the full content of an error report, a security warning, and a destructive-action confirmation; every locked claim carries that same protection.
Freeze drafts by number, treat authored spans as immutable unless you show an itemized before and after, and check the decision ledger before publishing so a settled question stays settled.
Anchor: test. A diff check fails the run when a locked span changes without a matching ledger entry.
Receipts: `docs/handbook/llm-output.md#reword-a-locked-claim-never-strengthen-it`

## Treat silence as not approval

Where the harness gates a write, its permission prompt is the floor and an agent message never substitutes; elsewhere, show the diff and wait for an explicit yes before generating a file, since silence is not approval, nor is an unanswered question.
Plan mode is the harness floor here: it holds edits until approved, but the hold ends there, does not bind where bypass permissions apply, and covers edits, not every write. A printed run has nobody to answer, and where prompts are off it denies, so ask for the yes yourself.
The same reading applies to data: said nothing is not said yes; the full rule lives in engineering.md.
Anchor: none (because a script-grantable approval is not an approval; the gate is the person).
Receipts: `docs/handbook/llm-output.md#treat-silence-as-not-approval`

## Read agreement with a shown suggestion as anchored, not accurate

A hosted reviewer, where it runs, already collects agreement marks on the findings it shows and feeds them into its own tuning, an anchored measure, not a quality one.
When a reviewer sees the model's suggestion beside the evidence, their agreement measures anchoring, not accuracy, so that rate is never quotable as a quality number.
Enforce blinding in the file on disk, not the reviewer's instructions, since an instruction is not a control, and audit every field a review packet prints for provenance: a field the tested process wrote is not evidence about it.
Anchor: test. The packet builder strips model-authored fields before writing, and a test asserts a blinded packet on disk carries no verdict field.
Receipts: `docs/handbook/llm-output.md#read-agreement-with-a-shown-suggestion-as-anchored-not-accurate`

## Don't

- Don't let a model approve, promote, or merge its own output.
- Don't quote agreement with a shown suggestion as an accuracy number.
- Don't blind a review in its instructions and call it blinded.
- Don't treat silence, an unanswered question, or a missing field as approval.
- Don't make a person click a queue you could safely auto-approve.

Anchor: each line restates a rule above, enforced by that rule's own anchor.
