# Which model each role runs on after Claude Code 2.1.332's third-party alias changes (2026-11-25)

Research note for the Claude Code 2.1.332 addendum in `docs/handbook/sources/harness-survey.md`.
The ladder paragraph "Third-party aliases, 2026-11-25" in `docs/handbook/claude-code.md` records
the facts; no role's model or effort changes.

## Short answer

No role moves. Claude Code 2.1.332 adds no model and changes no default model or effort on the
Anthropic API. It changes what the `sonnet` and `opus` aliases and the default model mean on
third-party providers, and the roster pins aliases, so on those providers the same pins now land
on different models. Anthropic's guidance for each role reads as it did on 2026-11-03, so every
role keeps its model and effort.

## What changed

From https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md, section 2.1.332,
fetched 2026-11-25:

- "Changed the `sonnet` model alias on Google Cloud's Agent Platform and Microsoft Foundry to
  Sonnet 5.5, and Foundry's `opus` alias to Opus 5.5; `sonnet` on Amazon Bedrock stays at Sonnet
  4.5"
- "Changed the default model on Microsoft Foundry to Sonnet 5.5: deploy `claude-sonnet-5-5`, or
  set `ANTHROPIC_DEFAULT_SONNET_MODEL` to a model you have deployed"
- "Fixed the `sonnet` alias on Bedrock Mantle resolving to Haiku 4.5: it now means Sonnet 5, not
  Sonnet 5.5, and an account without Sonnet 5 gets an error, so enable it first"
- "Changed `--model default` and a Default pick to move to an older model when that model isn't
  available, instead of stopping with an error; in auto mode, only to a model auto mode accepts"

The model-config page fetched the same day (https://code.claude.com/docs/en/model-config) still
gives the older alias table (Foundry `opus` Opus 4.6, `sonnet` Sonnet 4.5, "Microsoft Foundry:
defaults to Sonnet 4.5"), so the page trails the changelog; the changelog is trusted on what
changed and when.

## Method

The cloud split of `.claude/skills/adapting-to-harness-updates/references/model-evaluation.md`:
steps 1 to 3 and 5, no local transcripts and no Workflow tool. One Sonnet researcher gathered
Anthropic's guidance from nine pages and one Sonnet researcher gathered benchmarks. Both claim
lists, and the four changelog facts above, then went to two independent Sonnet verifiers, each of
which fetched every page fresh. Each verifier checked 54 items and found 50 verified, 0 wrong, and 4
unverified. Both left unverified the claims that no sentence exists for review, claim verification,
synthesis, or web search, which a grep cannot prove; the first also left open whether the Foundry
page names a `sonnet` version and whether the Artificial Analysis HLE page, cut short in its fetch,
has only Fable rows, and the second the HLCE GitHub page, which returned 403 to it. No decision
below rests on an unverified claim. The session re-read every quote a decision below rests on in its
own fetched copy. Every claim went to both verifiers; there was no claim cap.

## Role table

Pages, fetched 2026-11-25: CHOOSE is
https://platform.claude.com/docs/en/about-claude/models/choosing-a-model, EFFORT is
https://platform.claude.com/docs/en/build-with-claude/effort, MC is
https://code.claude.com/docs/en/model-config, COST is
https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence, and
SUB is https://code.claude.com/docs/en/sub-agents.

| Role | Current model and effort | Anthropic sentence and URL (fetch date) | Benchmarks (label, effort, cost) | Local evidence | Decision | Departure note or re-measure flag |
|---|---|---|---|---|---|---|
| Main session | Opus 5.5, user's choice | CHOOSE: "Most workloads start with Claude Opus 5.5." MC: "Fable 5.2, Opus 5.5, Sonnet 5.5, and Haiku 5.5 default to `medium`" | unchanged from `2026-11-09-fable-5-2.md` | not run (cloud) | Keep | none |
| Code search (scout) | Haiku, low | CHOOSE: Haiku 5.5 row, "subagent tasks". EFFORT: `low` for "Simpler tasks that need the best speed and lowest costs, such as subagents". SUB: the built-in Explore runs on "the parent conversation's model", and "define one with `model: haiku`" for a lower-cost one | unchanged | not run | Keep; the scout is that definition | none |
| Docs research, web search (researcher) | Sonnet, medium | No page gives a Sonnet or Haiku level for research; CHOOSE's Fable row names "multistep deep research", a session-model sentence, not a subagent one | Sonnet 5.5 HLE with tools 64.5% against Sonnet 5 54.9%, vendor, effort not stated (https://www.anthropic.com/news/claude-sonnet-5-5) | not run | Keep | none |
| Implementation (builder) | Sonnet, medium; high where verification matters; Opus for complex agentic coding | EFFORT (Sonnet 5.5): "start with `medium` for well-specified tasks and move to `high` for harder or longer ones." MC `medium` row: "On Opus 5.5 and Sonnet 5.5, it fits day-to-day engineering work with a clear scope, such as implementing a new feature." CHOOSE: Opus 5.5 for "Complex agentic coding" | Sonnet 5.5 Terminal-Bench 4.0 70.6% against Sonnet 5 10.3%, vendor, effort not stated | `2026-10-21-builder-tier.md`, measured on Sonnet 5.5 and Opus 5.5 | Keep | none; the note measured current models |
| Review (refuter) | Opus, high | No review-specific sentence; nearest is MC's `high` row, "Work where verification matters or edge cases are likely" | unchanged | not run | Keep (house posture: the verdict is the product) | none |
| Debugging (debugger) | Opus, high | MC `high` row: "such as fixing a bug in an existing codebase" | unchanged | not run | Keep | none |
| Orchestration and planning | session | COST orchestrator row: "Plans, dispatches, and synthesizes" | not applicable | not run | Keep | none |
| Extraction (fork fetch stage) | Sonnet, medium | EFFORT (Haiku 5.5): "For high-volume, latency-sensitive tasks such as classification, extraction, and routing" | unchanged | `2026-10-20-haiku-fetch.md`, measured on Haiku 5.5 and Sonnet 5.5 | Keep the departure | the note measured current models, so no re-measure |
| Claim verification (fork verify stage) | Sonnet, per-stage effort | No page gives guidance | not applicable | not run | Keep | none |
| Synthesis (fork synthesize stage) | Opus, per-stage effort | No separate sentence; COST's orchestrator row "synthesizes" | not applicable | not run | Keep | none |

## Provider effect

The roster pins `sonnet` (researcher, builder), `opus` (refuter, debugger), and `haiku` (scout).
After 2.1.332 the Sonnet roles run on Sonnet 5.5 on the Anthropic API, Agent Platform, and Foundry,
on Sonnet 5 on Bedrock Mantle, and on Sonnet 4.5 on Bedrock; the Opus roles run on Opus 5.5 on
Foundry as on the API. Anthropic's Sonnet 5.5 launch post calls it "a clear upgrade over Claude
Sonnet 5" (https://www.anthropic.com/news/claude-sonnet-5-5, fetched 2026-11-25, vendor figures),
so on Mantle and Bedrock the Sonnet roles run below the model the guidance names. That is a
provider setting, not a role decision: the roster keeps its aliases, and an adopter on those
providers points the alias at a newer deployed model in user settings.

## Benchmarks

No model is new: https://www.anthropic.com/news, fetched 2026-11-25, lists none after Fable 5.2.
Artificial Analysis's HLE page (secondary) lists Fable 5.2 at 74.3% (max), 68.9% (xhigh), and
66.2% (high), as the 2026-11-09 note has them; its pages returned no Opus, Sonnet, or Haiku 5.5
figure this time, recorded as not found. HLCE (https://arxiv.org/abs/2506.12713 and
https://github.com/Humanity-s-Last-Code-Exam) still lists no Claude model. Benchmarks decide
nothing here.

## Re-measure

None. The two departures with measured research, `2026-10-20-haiku-fetch.md` and
`2026-10-21-builder-tier.md`, measured models that are still current, so no `Re-measure:` issue
is opened.
