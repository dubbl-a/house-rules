# Which tier and effort a build should run on (2026-10-21)

Research note for #324 and #344. It supersedes the break-even and the cost arithmetic in the R3 addendum of `../token-cost/2026-10-20.md`. The orchestration text and handbook change with this note.

## Short answer

Follow Anthropic's published split. A build with a clear scope goes to Sonnet 5.5 at the builder's pinned medium. A call names `effort: "high"` where verification matters or edge cases are likely, or the build is harder or longer. Opus 5.5 is for complex agentic coding. The debugger stays on Opus, and when it finds no root cause the user is offered Fable.

The local data does not overturn this and cannot test the effort half: 3 Sonnet 5.5 builds ran at high effort. It shows Sonnet 5.5 builds drew a REWORK more often than Opus 5.5 builds, most clearly in the mid-size band, at 2.4 to 6 times lower cost per build.

## Anthropic guidance (fetched 2026-10-21)

- Effort page, Sonnet 5.5 (https://platform.claude.com/docs/en/build-with-claude/effort): "For agentic coding and multistep tool use, start with `medium` for well-specified tasks and move to `high` for harder or longer ones."
- Model-config page, effort table (https://code.claude.com/docs/en/model-config): `medium` "fits day-to-day engineering work with a clear scope, such as implementing a new feature"; `high` is for "Work where verification matters or edge cases are likely, such as fixing a bug in an existing codebase."
- Same page, Fable: "Hand it ambiguous problems: root-cause investigations, outage debugging, and architecture decisions are where the extra investigation and verification pay off."
- Choosing-a-model matrix (https://platform.claude.com/docs/en/about-claude/models/choosing-a-model): Opus 5.5 for "Complex agentic coding" (multihour autonomous coding agents, large-scale refactoring, complex systems engineering); Sonnet 5.5 for "everyday coding" (code generation, agentic tool use); Haiku 5.5 includes "sub-agent tasks".

## Local measurement

Maintainer machine, all projects, 325 builder runs, run on 2026-10-21 with `scripts/builder_tier.py` (`PROJECT_GLOB='*' python3 -I builder_tier.py`). Each refuter run is paired with the most recent earlier builder launch in the same session, and the first verdict per builder counts. Effort is the top-level `effort` field on assistant records. Size is the number of deduplicated responses per build, a proxy for difficulty. Costs are list price.

| Builder | Effort | Builds | Refuted | First verdict REWORK | Rate | Median $/build |
|---|---|---|---|---|---|---|
| Opus 5.5 | medium | 63 | 37 | 18 | 49% | 2.23 |
| Sonnet 5.5 | medium | 207 | 56 | 38 | 68% | 0.19 |
| Sonnet 5.5 | high | 3 | 1 | 0 | n/a | 0.10 |
| Sonnet 5 | medium | 52 | 5 | 3 | 60% | 0.09 |

By size band (Sonnet 5.5 includes its 3 high-effort builds, all under 30):

| Band | Builder | Builds | Refuted | REWORK rate | Median $/build |
|---|---|---|---|---|---|
| under 30 | Opus 5.5 | 16 | 8 | 62% | 0.83 |
| under 30 | Sonnet 5.5 | 163 | 39 | 62% | 0.13 |
| 30 to 80 | Opus 5.5 | 24 | 17 | 41% | 1.96 |
| 30 to 80 | Sonnet 5.5 | 42 | 18 | 78% | 0.83 |
| over 80 | Opus 5.5 | 23 | 12 | 50% | 7.40 |
| over 80 | Sonnet 5.5 | 5 | 0 | n/a | 2.99 |

- Matched by band, Opus costs about 5.9 times Sonnet 5.5 under 30 responses, 2.4 times from 30 to 80, and 2.5 times over 80 (n=5 for Sonnet).
- A refuter run costs a mean $0.63 (median $0.51) over 280 runs.
- After a Sonnet 5.5 first REWORK, the next builder in the session was Sonnet 5.5 in 27 cases, Opus 5.5 in 3, and none in 8.
- The old figures were wrong or confounded. The earlier note's 45% Opus rate differs from this script's 49% (the earlier table came from `research/token-cost/scripts/verdicts.py`). The "30 to 40 point break-even" was arithmetic, not a measurement. The "$3.08 against $3.59" figures compared a seven-day mean cost per agent, not per build, across builds of very different size.

## External check, light deep-research run (secondary, low confidence)

A light run on the house fork looked for Anthropic per-effort benchmarks for Sonnet 5.5 against Opus 5.5 and found none. Second-hand relays of Artificial Analysis put Opus at about 1.5 to 2.8 times Sonnet's cost per task from low to high effort. The relays were not checked against the source, and the figure is not used in any rule.

## Conclusion

The rule uses Anthropic's split because nothing local gives a reason to depart from it. The mid-size gap (Sonnet 78% against Opus 41%) is consistent with Opus being the better pick for complex work, which is what Anthropic's matrix says. Under 30 responses the rates are equal at 62%, so Opus is not buying fewer REWORKs on small builds. Effort was not tested.

## Caveats

- The pairing is a heuristic; 80 refuter verdicts had no earlier builder in the session.
- Not controlled: nobody assigned model to task at random. the earlier note observed that Opus got the harder builds, and response count is only a proxy for difficulty.
- Small cells: Sonnet 5.5 over 80 responses has 5 builds, none refuted; Sonnet 5.5 at high effort has 3.
- A REWORK is a refuter's judgment, so the rate measures what the review catches, not defects shipped.
- One machine, one maintainer's briefs. Opus and Sonnet may be briefed differently.
- Cost is list price from the script's table, not billing.

## Reproduce

`scripts/builder_tier.py` reads local transcripts under `~/.claude/projects/`, so a rerun on another machine gives its own numbers.
