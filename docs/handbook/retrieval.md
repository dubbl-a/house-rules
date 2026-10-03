<!-- docs-drift-ignore-file: receipts chapter; dates, issue numbers, and outside paper ids are the point -->
# Retrieval

## Why this exists

A repo that answers questions from a corpus can fail at any stage between the corpus and the answer: the answer may not be in the corpus, may be in it but never surfaced, may be surfaced but never read, or may be read and then misused, and a score alone says only that the answer was wrong. This chapter is the evidence behind each rule in `plugins/house/modules/retrieval/rules/retrieval.md`. The rules are Part 2 of issue #111, domain rules a consuming repo earned on 2026-09-30 in its first agent-driven eval run, and the issue lists the primary sources behind its map of quality problems.

The module is opt-in: `house init` leaves it off, and a repo whose `house.json` predates it has no key for it, which render also reads as off, so a resync never adds it. A repo turns it on with `house enable retrieval`, which prints the paths the `retrievalRoots` and `retrievalGlobs` slots resolve to there before anything is written. The default roots are `retrieval/`, `rag/`, `corpus/`, `evals/`, and `eval/`; render drops any whose first segment does not exist in the repo, so a repo keeping its corpus elsewhere names that path in `retrievalGlobs`.

The issue states its own reservations, kept here: the evidence is one consuming repo, one day, and one model; the handbook's standard is that a new subsystem's rules start in the repo that needs them; Part 2 would be stronger after the consuming repo has acted on its findings and re-measured; and it only earns a module if another repo runs retrieval. Shipping the module default off is how this package answers them: no adopter inherits it until a repo that runs retrieval enables it.

Measuring the agent, from the answer key to the eval session, stays in `evals.md`. The quote rule is stated both here and in `llm-output.md`'s citation rule, because `llm-output` turns on by detection and enabling this module does not turn it on; the two state the same check for a repo that has one module and not the other.

## Diagnose a failed answer by stage before fixing anything

Issue #111 orders the check: was the answer in the corpus, was it surfaced, was it read, and only then did the model misuse it. Receipt: in the consuming repo's first run, almost every diagnosable failure was after the document had been read, which reversed the planned order of work.

## Label every failed run with its stage from the transcript, and keep an undetermined outcome

Issue #111 labels every failed run with its stage from the transcript, using what was surfaced, what was opened and what was cited, and keeps an explicit undetermined outcome. A final answer alone cannot tell "never found" from "found and ignored"; the transcript's record of what was surfaced, opened, and cited can. The issue's comment adds that a failure label in a log is a summary to be read behind and corrected (the evals chapter's section on splitting a score gap carries its receipt).

## Verify each quote word for word against the cited document

Issue #111 verifies quotes mechanically, word for word, against the cited document, and treats a quote stitched from two places as a failure. The same clause extends `llm-output.md`'s citation rule; it is stated here as its own rule because a retrieval adopter can have `llm-output` off.

## Keep a map of the classes of quality problem, and say how each is detected

Issue #111 asks for a map of the classes of quality problem, not only retrieval and generation: coverage and freshness, source parsing, passage boundaries, index integrity, the agent's own queries, ranking, context handling, the tool loop, use of evidence, abstention, attribution, evaluator and label faults, and ambiguous questions. For each, the map says whether it is detected from the transcript, from the source text, by a person, or by a separate test.

The issue lists the primary sources behind the map: Barnett et al. (arXiv 2401.05856), Joren et al. (2411.06037), Chen et al. (2309.01431), Liu et al. (2307.03172), Gao et al. (2305.14627), Shankar et al. (2404.12272), Cemri et al. (2503.13657), Zhang et al. (2412.02592), Yang et al. (2406.04744), Min et al. (2004.10645), Greshake et al. (2302.12173), and Anthropic's engineering posts on agent evals and tool design.

## Cite a primary source for every lesson, with the quote and where it was read

Issue #111: lessons and reference material cite primary sources only, with the quote and where it was read. The rule names the risk rather than the "only": a summary of a summary drifts from what was found, and a citation without a quote and a location cannot be checked.

## Sources

- Issue #111, Part 2 and its reservations, and the comment's item 6 on failure labels.
- The eleven arXiv papers and the Anthropic engineering posts the issue lists behind the quality-problem map; cited as the issue names them, not read for this chapter.
