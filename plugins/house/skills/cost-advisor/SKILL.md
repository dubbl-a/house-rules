---
name: cost-advisor
description: Explains the largest avoidable Claude Code cost pattern on this account and offers a fix that leaves the work unchanged; triggers on "/house-rules:cost-advisor" and on the house weekly cost notice or session cost line.
disable-model-invocation: true
---

# Cost advisor

Run one command and read only its summary. It never needs the transcripts opened.

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/cost-report.mjs --advise --since 30d
```

Drop `--since 30d` for the last 7 days, the window the weekly notice uses. Outside Claude Code run `house cost --advise --since 30d`.

The output always opens with a summary of recent usage (dollars by model and by main thread against subagents, context sizes, cache rebuilds). It then lists the patterns at or over the limit, the patterns below the limit (each marked as below), notes on workflows and subagents when they cost anything, the limit and its source, and the baseline for "unusual". Then:

1. Give the recent split in plain words: where the dollars went by model, main thread against subagents (workflow agents are part of the subagent figure), and the context sizes. The model figures are descriptive; they do not support model or effort advice.
2. Advise on the largest areas, saying which patterns are over the limit and which are below it. If nothing is over the limit, say so, still give the summary, and name the largest pattern below the limit as the one to watch. For workflows, point to `--workflow-estimate <agents>`, which prices a launch and recommends no setting; for subagents, say no fix that leaves the work unchanged is measured. Check the setting the top pattern depends on, and read it rather than assuming it:
   - `context-over-200k`: whether the session is on the 1M context model, and whether `/compact` or `/clear` is the habit.
   - `avoidable-rebuilds` and `short-ttl-rebuilds`: `promptCacheTtl` in the user settings.
   - `price-premiums`: whichever the row names (fast mode, US-only inference, or a pinned legacy model ID).
3. Ask which plan the user is on only when it changes the advice: a higher cache-write price matters to API-key billing in dollars, and to a plan only through its usage limits.
4. Offer one fix that leaves the work unchanged, the row's next step, and apply it only after the user confirms. Never suggest a cheaper model or a lower effort, or moving the main session off Opus. The one exception is the price-premium row's move of pinned model IDs to the current version of the same tier: that is the same tier, not a capability downgrade.
5. For a breakdown of where the tokens went, point to `/session-report`.

Say plainly that the dollars are list price, not a bill, and that how a plan's limits weight cache reads and writes is unknown, so a dollar saving here does not convert to a known share of a plan limit.

To change what the advisor flags, set `HOUSE_COST_ADVISOR_USD` (default 5) in the env block of settings; `HOUSE_COST_ADVISOR=off` silences the weekly notice and the session line.
