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

The output lists the patterns at or over the limit, the limit and its source, and the baseline for "unusual". Then:

1. Say what the top pattern is and what its dollars mean, in plain words. If no pattern qualifies, say so and stop.
2. Check the setting the top pattern depends on, and read it rather than assuming it:
   - `context-over-200k`: whether the session is on the 1M context model, and whether `/compact` or `/clear` is the habit.
   - `avoidable-rebuilds` and `short-ttl-rebuilds`: `promptCacheTtl` in the user settings.
   - `price-premiums`: whichever the row names (fast mode, US-only inference, or a pinned legacy model ID).
3. Ask which plan the user is on only when it changes the advice: a higher cache-write price matters to API-key billing in dollars, and to a plan only through its usage limits.
4. Offer one fix that leaves the work unchanged, the row's next step, and apply it only after the user confirms. Never suggest a cheaper model or a lower effort.
5. For a breakdown of where the tokens went, point to `/session-report`.

Say plainly that the dollars are list price, not a bill, and that how a plan's limits weight cache reads and writes is unknown, so a dollar saving here does not convert to a known share of a plan limit.

To change what the advisor flags, set `HOUSE_COST_ADVISOR_USD` (default 5) in the env block of settings; `HOUSE_COST_ADVISOR=off` silences the weekly notice and the session line.
