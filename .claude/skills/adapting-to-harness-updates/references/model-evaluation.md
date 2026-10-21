# Model evaluation

Run this when a release adds a model, changes a default model or effort, or changes Anthropic's
model guidance. It decides which model and effort each house role runs on. The standing policy is
fixed; the method below applies it and is not a place to reopen it.

## Contents

- Policy
- Steps 1 to 6
- Role table template
- Benchmarks: order, fallbacks, labeling
- Decision rule
- Cloud routine split

## Policy

- Model and effort choices follow Anthropic's published guidance unless the repo's own committed
  research (`research/`) gives a measured reason to depart. Each departure cites its note.
- Never trade output quality for small or moderate token savings.
- Fable never runs on a subagent unless the user asks.
- For model benchmarks prefer Humanity's Last Exam (HLE) and Humanity's Last Code Exam (HLCE,
  arXiv 2506.12713), falling back to labeled equivalents.
- Deep-research claim verification is decided before launch. Locally the session asks the user the
  verify setting (all claims or a cap) together with the depth. "All" means
  `budget.maxVerifyClaims: 500`. After the run, the `unverified` list must be empty and every
  extracted claim verified: `stats.claimsExtracted` equals `stats.claimsVerified` on a full run,
  and `stats.claims` equals `stats.verified` on a run that returned early.

## Steps 1 to 6

1. **Inventory every house model and effort assignment.** The roster agents' frontmatter under
   `plugins/house/agents/`, the Model tier section of `plugins/house/orchestration/ORCHESTRATION.md`,
   the deep-research fork's model and effort pins (built by
   `scripts/house/check-deep-research-upstream.mjs`), the price table in
   `plugins/house/scripts/cost-report.mjs`, and the model ladder in `docs/handbook/claude-code.md`.
2. **Gather Anthropic's guidance, role by role.** The roles are main session, code search, docs
   research, implementation, review, debugging, orchestration and planning, web search, extraction,
   claim verification, and synthesis. For each, quote the exact sentence with its URL, from:
   - platform.claude.com/docs/en/about-claude/models/choosing-a-model
   - platform.claude.com/docs/en/build-with-claude/effort (the per-model sections)
   - code.claude.com/docs/en/model-config (the effort table)
   - platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence
   - code.claude.com/docs/en/sub-agents
   - the model's launch post and system card

   The session re-reads every quote a decision rests on itself, in the fetched page, before it
   counts.
3. **Collect benchmarks** by the order and labeling rules below, from fetched pages only. Start
   from the fixed sources listed there and search only to find the new model's launch post, system
   card, or leaderboard entry. A figure not found in a fetched page is recorded as not found, never
   estimated.
4. **Gather local evidence** (local sessions only, because it reads `~/.claude` transcripts).
   `research/model-tier/scripts/builder_tier.py` reports rework rate by builder model, effort, and
   size band, cost per build, refuter cost, and escalation. The A/B method in
   `research/model-tier/scripts/` compares one stage's output on the same inputs: resume a
   deep-research run with `resumeFromRunId` so the earlier stages replay, vary the model or effort
   for that stage, and have blind Opus judges compare the outputs.
5. **Decide per role** with the decision rule below. Where a new model makes a departure's research
   stale (the note measured an older model), mark that departure for re-measurement and do not
   carry it over.
6. **Record and review.** Write a dated note under `research/model-tier/`, update the rule
   (`plugins/house/orchestration/ORCHESTRATION.md`), the handbook (`docs/handbook/claude-code.md`),
   and the CHANGELOG, then send a refuter that checks each decision against its quoted sentence.

## Role table template

One row per role. A row with no quote is not decided.

| Role | Current model and effort | Anthropic sentence and URL (fetch date) | Benchmarks (label, effort, cost) | Local evidence | Decision | Departure note or re-measure flag |
|---|---|---|---|---|---|---|

## Benchmarks: order, fallbacks, labeling

Order: HLE and HLCE first. Where they lack the model, use a labeled equivalent:

- For HLE: Anthropic's launch or system-card HLE (with and without tools), and Artificial
  Analysis's HLE and Intelligence Index (an independent harness, with per-effort results and cost).
- For HLCE: look for a contest-sourced coding benchmark that has the model (LiveCodeBench Pro,
  OJBench, Codeforces-rated evals). Re-check their coverage every run. When none has it, use
  FrontierCode, Terminal-Bench, and SWE-bench Pro, labeled as agentic-coding stand-ins.

Fixed sources, fetched every run:

- Anthropic's news index, https://www.anthropic.com/news, for the model's launch post and its
  system card link.
- Artificial Analysis, https://artificialanalysis.ai/evaluations/humanitys-last-exam and the
  model's page under https://artificialanalysis.ai/models.
- HLCE, https://arxiv.org/abs/2506.12713 and its code and data under
  https://github.com/Humanity-s-Last-Code-Exam.

Labeling rules:

- Mark each figure primary (the vendor's own) or secondary (independent).
- Never mix harnesses in one comparison: Anthropic with-tools against Artificial Analysis no-tools
  is not a comparison.
- Record the effort level and the cost per task whenever the source gives them.
- Note when max effort scores below a lower level; that is a reason against max for the role.

## Decision rule

For each role, take Anthropic's published guidance. Depart only when a committed note in
`research/` measured a reason to, on a model that is still current, and cite that note. A benchmark
alone is a reason to measure, not a reason to depart. A cost saving that lowers output quality is
not a reason, and a small or moderate saving never outweighs quality. Fable stays off subagents.

## Cloud routine split

The cloud routine cannot read local transcripts and cannot rely on the Workflow tool, so it runs
steps 1 to 3 and 5 with Agent researchers: a named model, two independent verifier agents per claim,
every claim verified, no claim cap. It proposes the rule changes in the PR. For each departure whose
research measured an older model, it opens (or comments on) an issue titled
`Re-measure: <research note>`, so a local session runs step 4 and the A/B. The routine's wording is
in [routine-prompt.md](routine-prompt.md).

