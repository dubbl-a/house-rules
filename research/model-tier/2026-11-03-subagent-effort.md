# Which effort an unnamed subagent call runs at, after Claude Code 2.1.317 (2026-11-03)

Research note for the Claude Code 2.1.316 and 2.1.317 addendum in
`docs/handbook/sources/harness-survey.md`. The claude-code rule's effort line and its handbook
receipt change with this note; no role's model or effort changes.

## Short answer

No role moves. Every roster agent pins its effort, the `/deep-research` fork names one per stage,
and `plugins/house/orchestration/ORCHESTRATION.md` already asks every off-roster call to name an
effort, so the 2.1.317 change reaches only a call that breaks that rule. For such a call the
default is now the subagent's own model's saved level or its default (medium on Opus 5.5,
Sonnet 5.5, and Haiku 5.5), not the session's, which is why the per-model level in user settings
matters more than before.

## What changed

- Claude Code 2.1.316: "Added `CLAUDE_CODE_SUBAGENT_EFFORT` to set the effort level subagents run
  at when nothing else names one, instead of inheriting the session's".
- Claude Code 2.1.317: "Changed subagents and teammates on a different model from the main
  conversation to use that model's saved effort level or its default, instead of the session's
  effort level".

Both from https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md, fetched
2026-11-03. Read from the 2.1.317 binary, not observed in a run: the variable fills the
definition's `effort` when the definition has none, no turn effort is inherited, and the call is
not a fork; the session's level is dropped only when it is an explicit level and the subagent's
model differs from the one it was picked for. `CLAUDE_CODE_EFFORT_LEVEL` still beats everything.
The sub-agents and model-config pages fetched the same day name neither change.

## Method

The cloud split of `.claude/skills/adapting-to-harness-updates/references/model-evaluation.md`:
steps 1 to 3 and 5, no local transcripts and no Workflow tool. One Sonnet researcher gathered
Anthropic's guidance and one gathered benchmarks. Each claim list then went to two independent
verifiers, each of which fetched the pages fresh: guidance to a Sonnet and a Haiku verifier,
benchmarks to two Sonnet verifiers. The session re-read every quote a decision below rests on in
its own fetched copy. Every claim was verified; there was no claim cap.

## Role table

Pages, fetched 2026-11-03: CHOOSE is
https://platform.claude.com/docs/en/about-claude/models/choosing-a-model, EFFORT is
https://platform.claude.com/docs/en/build-with-claude/effort, MC is
https://code.claude.com/docs/en/model-config, COST is
https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence, and
SUB is https://code.claude.com/docs/en/sub-agents.

| Role | Current model and effort | Anthropic sentence and URL (fetch date) | Benchmarks (label, effort, cost) | Local evidence | Decision | Departure note or re-measure flag |
|---|---|---|---|---|---|---|
| Main session | Opus 5.5, user's choice | CHOOSE: "Most workloads start with Claude Opus 5.5." MC: Opus 5.5, Sonnet 5.5, and Haiku 5.5 "default to `medium`" | Opus 5.5 HLE with tools 67.7%, vendor, max | not run (cloud) | Keep | none |
| Code search (scout) | Haiku, low | CHOOSE: "The lowest latency and price" row, Haiku 5.5, "subagent tasks". EFFORT: `low` for "Simpler tasks that need the best speed and lowest costs, such as subagents" | Haiku 5.5 HLE no tools 45.9%, with tools 57.4%, vendor, effort not stated; Artificial Analysis HLE 0.444 at max, secondary | not run | Keep | none |
| Docs research, web search (researcher) | Sonnet, medium | No page gives a Sonnet or Haiku level for research; EFFORT's xhigh line for web search is in the Opus 4.7 section only | Sonnet 5.5 HLE with tools 64.5%, vendor; Artificial Analysis HLE 0.550 at max, secondary | not run | Keep | none |
| Implementation (builder) | Sonnet, medium; high where verification matters; Opus for complex agentic coding | EFFORT (Sonnet 5.5): "start with `medium` for well-specified tasks and move to `high` for harder or longer ones." MC: `high` for "Work where verification matters or edge cases are likely". CHOOSE: Opus 5.5 for "Complex agentic coding" | Sonnet 5.5 Terminal-Bench 4.0 70.6%, effort not stated; FrontierCode 1.1 52.1% xhigh, 46.2% max, vendor | `2026-10-21-builder-tier.md`, measured on Sonnet 5.5 and Opus 5.5 | Keep | none; the note measured current models |
| Review (refuter) | Opus, high | No review-specific sentence; nearest is MC's `high` row | Opus 5.5 Terminal-Bench 4.0 66.4% xhigh, vendor | not run | Keep (house posture: the verdict is the product) | none |
| Debugging (debugger) | Opus, high | MC: `high` for "fixing a bug in an existing codebase" | as review | not run | Keep | none |
| Orchestration and planning | session | COST orchestrator row: "Frontier model runs the loop, delegates the bulk work"; "Plans, dispatches, and synthesizes" | not applicable | not run | Keep | none |
| Extraction (fork fetch stage) | Sonnet, medium | EFFORT (Haiku 5.5): "For high-volume, latency-sensitive tasks such as classification, extraction, and routing". COST: "Claude Haiku 5.5 subagents on coding tasks: compare them with lower effort first." | Haiku 5.5 figures as code search | `2026-10-20-haiku-fetch.md`, measured on Haiku 5.5 and Sonnet 5.5 | Keep the departure | the note measured current models, so no re-measure |
| Claim verification (fork verify stage) | Sonnet, per-stage effort | No page gives guidance; COST's verifier row is about checkable outputs | not applicable | not run | Keep | none |
| Synthesis (fork synthesize stage) | Opus, per-stage effort | No separate sentence; COST's orchestrator row "synthesizes" | not applicable | not run | Keep | none |

## Benchmarks

All primary figures are from the launch posts at https://www.anthropic.com/news/claude-opus-5-5,
https://www.anthropic.com/news/claude-sonnet-5-5, and https://www.anthropic.com/news/claude-haiku-5-5;
the secondary figures are from Artificial Analysis
(https://artificialanalysis.ai/evaluations/humanitys-last-exam, https://artificialanalysis.ai/models).
All were fetched 2026-11-03. Figures from the two harnesses are not compared.

- HLE, primary: Opus 5.5 67.7% with tools, at max effort, the post's stated default; no
  without-tools figure on the post. Sonnet 5.5 64.5% with tools; 56.9% without tools, from the
  Haiku post's comparison column, read by column order. Haiku 5.5 45.9% without tools and 57.4%
  with tools, effort not stated.
- HLE, secondary: Opus 5.5 61.4% at "Max, Default Fallback" on the HLE page; Intelligence Index
  58 at max and 57 at xhigh. The HLE page has no Sonnet 5.5 or Haiku 5.5 row, but the models
  page's embedded data carries both: "Claude Sonnet 5.5 (Max, Default Fallback)" with
  Intelligence Index 54.2 and HLE 0.550, and "Claude Haiku 5.5 (Max)" with 36.2 and 0.444. The
  researcher and one verifier missed these and the other verifier found them; the session read
  them in the raw page itself.
- HLCE: the arXiv abstract (https://arxiv.org/abs/2506.12713) names no Claude 5.5 model. The
  GitHub organization page returned HTTP 403 to both verifiers, so it was not checked. Not found.
  LiveCodeBench Pro, OJBench, and Codeforces-rated evals were not searched.
- Agentic-coding stand-ins, primary: Terminal-Bench 4.0, Opus 5.5 66.4% (xhigh), Sonnet 5.5
  70.6% and Haiku 5.5 39.2% (effort not stated). FrontierCode 1.1 (Main), Opus 5.5 54.4% in the
  table and 54.6% at medium in the text, Sonnet 5.5 52.1% at xhigh and 46.2% at max, Haiku 5.5
  46.4%. SWE-bench Pro is on none of the posts.
- Max below a lower level: Sonnet 5.5 on FrontierCode scores 46.2% at max against 52.1% at
  xhigh; the post's footnote ties it to runs that fanned out across many subagents. That is a
  reason against max for a Sonnet build, which no role uses.
- Cost per task: no numeric figure was found on any fetched page.

## Not decided here

The prices and the cost tables in `plugins/house/scripts/cost-report.mjs` do not move with an
effort default, so they were not reopened. Local step 4 (rework rate by effort) needs the
maintainer's transcripts and was not run; no departure measured an older model, so no
`Re-measure:` issue was opened.
