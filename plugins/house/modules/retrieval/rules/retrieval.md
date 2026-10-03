<!-- house source rule file; vendored into consuming repos by /house-rules:sync -->
# Retrieval

How a repo that answers questions from a corpus finds out why an answer failed, and what its own lessons rest on.
Measuring the agent that answers, from the answer key to the eval session, is evals.md's; checking a quote word for word against its cited document, a stitched quote included, is llm-output.md's. Neither is restated here.

## Diagnose a failed answer by stage before fixing anything

Check the stages in order: was the answer in the corpus, was it surfaced, was it read, and only then did the model misuse it, because a fix aimed at the wrong stage changes nothing and the planned order of work is often the reverse of where failures sit.
Count failures per stage before choosing what to build, and build for the stage the count points at.
Anchor: the failure report groups failed runs by stage, in that order, before any fix is proposed; the harness keeps transcripts but assigns no stage, so the ordered diagnosis is this repo's addition.
Receipts: `docs/handbook/retrieval.md#diagnose-a-failed-answer-by-stage-before-fixing-anything`

## Label every failed run with its stage from the transcript, and keep an undetermined outcome

Assign the stage from what the transcript shows was surfaced, what was opened, and what was cited, never from the final answer alone, since an answer that names no source looks the same whether the source was never found or found and ignored.
Keep undetermined as an explicit label, so a run the transcript cannot place is counted as such rather than forced into the nearest stage.
Anchor: the scorer writes one stage label per failed run from the transcript's tool calls, with undetermined in the label set, and refuses a failed run with no label.
Receipts: `docs/handbook/retrieval.md#label-every-failed-run-with-its-stage-from-the-transcript-and-keep-an-undetermined-outcome`

## Keep a map of the classes of quality problem, and say how each is detected

Map every class, not only retrieval and generation: coverage and freshness, source parsing, passage boundaries, index integrity, the agent's own queries, ranking, context handling, the tool loop, use of evidence, abstention, attribution, evaluator and label faults, and ambiguous questions.
For each class, say whether it is detected from the transcript, from the source text, by a person, or by a separate test, since a class with no detector is a blind spot that every score reads past.
Anchor: none (because whether the map is complete is a judgment against the literature, which no checker reads); the map lives in one file, and a new failure is checked against it before a new class is added.
Receipts: `docs/handbook/retrieval.md#keep-a-map-of-the-classes-of-quality-problem-and-say-how-each-is-detected`

## Cite a primary source for every lesson, with the quote and where it was read

Back each lesson and each line of reference material with the primary source that states it, quoting the passage and naming where it was read, because a summary of a summary drifts from what was found and cannot be checked.
Treat a secondary write-up as a pointer to the primary source, not a substitute for it.
Anchor: none (because whether a source is primary is a judgment no checker reads); each lesson's citation carries a quote and a location a reviewer can open.
Receipts: `docs/handbook/retrieval.md#cite-a-primary-source-for-every-lesson-with-the-quote-and-where-it-was-read`

## Don't

- Don't fix a failure before you know which stage it sits in.
- Don't label a failed run from its final answer alone, or force an unplaceable run into a stage.
- Don't treat retrieval and generation as the only classes, or leave a mapped class with no way to see it.
- Don't cite a lesson to a summary when the source it summarizes can be read.

Anchor: each prohibition is the negative of a rule above and inherits that rule's enforcement.
