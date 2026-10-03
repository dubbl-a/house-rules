<!-- docs-drift-ignore-file: receipts chapter; dates, issue numbers, and outside paper ids are the point -->
# Retrieval

## Why this exists

A repo that answers questions from a corpus fails in more places than its two famous ones. The answer may not be in the corpus, may be in it but never surfaced, may be surfaced but never opened, or may be opened and then misused; a score says only that the answer was wrong. This chapter is the evidence behind each rule in `plugins/house/modules/retrieval/rules/retrieval.md`, drawn from one consuming repo's first agent-driven eval of a retrieval agent (issue #111, 2026-09-30) and the primary literature behind its map of quality problems.

The module is opt-in: `house init` leaves it off, and a repo whose `house.json` predates it has no key for it, which render also reads as off, so a resync never adds it. A repo turns it on with `house enable retrieval`, which prints the paths the `retrievalRoots` and `retrievalGlobs` slots resolve to there before anything is written. The default roots are `retrieval/`, `rag/`, `corpus/`, `evals/`, and `eval/`; render drops any whose first segment does not exist in the repo, so a repo keeping its corpus elsewhere names that path in `retrievalGlobs`.

The issue that proposed these rules carried its own reservation, kept here: the evidence is one consuming repo, one day, and one model, and the handbook's standard is that a subsystem's rules start in the repo that needs them. Shipping the module default off is the answer to that reservation: no adopter inherits it until a repo that runs retrieval asks for it, and each such repo's first measured cycle is the next receipt.

Measuring the agent, from the answer key to the eval session, stays in `evals.md`, and checking a quote word for word against the passage it cites, a stitched quote included, stays in `llm-output.md`'s citation rule.

## Diagnose a failed answer by stage before fixing anything

The consuming repo had planned its order of work before its first run. That run (issue #111, 2026-09-30) placed almost every failure it could diagnose after the document had been read, which reversed the planned order: work aimed at finding documents would have fixed little of what failed. The stages are the ones the rule names, checked in order: in the corpus, surfaced, read, used.

## Label every failed run with its stage from the transcript, and keep an undetermined outcome

The stage counts above came from labelling each failed run from its transcript: what the agent's searches surfaced, which documents it opened, and which it cited (issue #111). A final answer alone cannot separate "never found" from "found and ignored", and the transcript can. The rule keeps undetermined as an explicit outcome so a run the transcript cannot place is counted as such, and the share given to each stage is not inflated by guesses. A later reading in the same repo found a logged label that understated what happened (the evals chapter's section on splitting a score gap carries it), which is why the label comes from the transcript and is corrected there when it is wrong.

## Keep a map of the classes of quality problem, and say how each is detected

The map the consuming repo carries (issue #111) names thirteen classes: coverage and freshness, source parsing, passage boundaries, index integrity, the agent's own queries, ranking, context handling, the tool loop, use of evidence, abstention, attribution, evaluator and label faults, and ambiguous questions. Retrieval and generation, the two classes a first plan usually names, are two rows of it. The rule asks each class to say how it is detected, from the transcript, from the source text, by a person, or by a separate test, because a class with no detector is invisible to every score. The evaluator and label faults row is not hypothetical: the same repo's later reading found a gap partly made by a measure that miscounted and a test that demanded the wrong answer (the evals chapter's section on splitting a score gap).

The issue lists the primary sources behind the map by author and arXiv id: Barnett et al. (2401.05856), Joren et al. (2411.06037), Chen et al. (2309.01431), Liu et al. (2307.03172), Gao et al. (2305.14627), Shankar et al. (2404.12272), Cemri et al. (2503.13657), Zhang et al. (2412.02592), Yang et al. (2406.04744), Min et al. (2004.10645), and Greshake et al. (2302.12173), plus Anthropic's engineering posts on agent evals and tool design. Which class each one backs is recorded in the consuming repo's map, with the quote, as the next rule requires; this chapter does not restate that mapping unread.

## Cite a primary source for every lesson, with the quote and where it was read

The consuming repo's lessons and reference material cite the primary source for each claim, with the quoted passage and where it was read (issue #111), so a later reader can open the passage instead of trusting a paraphrase. The map above is the worked example: its sources are papers named by arXiv id, not write-ups of them. The rule's risk is the one llm-output's citation rule names for model output, applied to the repo's own notes: a summary of a summary drifts from what was found, and nothing checks it.

## Sources

- Issue #111, Part 2, the retrieval QA rules a consuming repo earned on its first agent-driven eval (2026-09-30), and the reservations its drafting session stated.
- The eleven arXiv papers and the Anthropic engineering posts listed in the quality-problem map section, as the issue names them; cited as the sources behind the map, not read for this chapter.
- Issue #111's comment, for the later reading that found a miscounting measure and a mislabelled task, carried in `docs/handbook/evals.md`.
