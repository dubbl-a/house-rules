# Haiku 5.5 for the deep-research fetch stage (2026-10-20)

Research note for #221. No rule, agent, workflow or plugin file changes with this note.

## Short answer

Keep the deep-research `fetch` stage on Sonnet. In this A/B, Haiku 5.5 at high effort cut the fetch stage's cost by about 94% (about $0.80 per light run, roughly a quarter of the run). But it extracted worse claims from the same pages, and two of its five final reports carried a material error that the Sonnet reports did not. That fails the owner's rule from #325: a cost lever that changes what an agent reads or outputs ships only with evidence that quality holds. This evidence shows quality dropping, in a stage whose output every later stage depends on.

`args.models.fetch: "haiku"` still works as a per-run override for a throwaway question, since the fork takes it with no code change. No default changes.

## What was run

- Five factual questions, at light depth, on the house deep-research fork (Claude Code 2.1.305). Topics: Anthropic 5.5 model prices, Claude Code settings precedence, `git worktree add` and a branch checked out elsewhere, `node --test` concurrency and isolation, and GitHub `mergeable`/`mergeable_state`.
- Arm A, the baseline: fork defaults (scope and synthesize on Opus, search, fetch and verify on Sonnet, fetch effort medium).
- Arm B: the same run resumed with `models.fetch: "haiku"` and `efforts.fetch: "high"`. High effort gives Haiku its best case. The resume replays the cached scope and search agents, so both arms work from the same angles and search results. Fetch, verify and synthesize run again.
- Judging: Opus agents at high effort, blind to which arm was which, with X/Y assigned at random per item.
  - For every URL both arms fetched where at least one extracted something (31 pairs), a judge fetched the page itself. It checked each claim's quote against the page, whether the page supports the claim, whether the claim is relevant, and what material facts each side missed.
  - Separately, a judge graded each pair of final reports against primary docs. The git judge also ran live `git worktree` tests.

Cost uses list prices per million tokens, read from the platform pricing page on 2026-10-20 and confirmed by the Q1 run itself. Haiku 5.5: $0.10 input, $0.50 output, $0.01 cache read up to 100K tokens, and 5x that above. Sonnet 5.5: $2 / $10 / $0.10. Opus 5.5: $4 / $20 / $0.20. No Haiku fetch request went over 100K tokens.

## Results

### Cost and time of the fetch stage

| Question | Sonnet fetch | Haiku fetch | Sonnet full run |
|---|---|---|---|
| Q1 prices | $0.89 | $0.05 | $3.26 |
| Q2 settings | $1.00 | $0.07 | $3.53 |
| Q3 git worktree | $0.80 | $0.05 | $2.71 |
| Q4 node:test | $0.76 | $0.05 | $2.73 |
| Q5 GitHub mergeable | $0.83 | $0.05 | $2.89 |

- Fetch was about 28% of a light run's cost on Sonnet. Haiku saves about $0.80 per light run. Scaled by fetch count, that is roughly $1.3 to $1.7 per standard run and $2.2 to $2.8 per deep run. These are estimates, not measured.
- Haiku at high effort was not faster. The slowest fetch agent per run took 26 to 41 s on Haiku and 23 to 29 s on Sonnet.

### Extraction quality, 31 pairs of the same page

| | Sonnet better | Haiku better | Tie |
|---|---|---|---|
| Q1 prices | 3 | 4 | 1 |
| Q2 settings | 6 | 0 | 2 |
| Q3 git worktree | 2 | 0 | 0 |
| Q4 node:test | 6 | 1 | 1 |
| Q5 GitHub mergeable | 3 | 0 | 2 |
| **Total** | **20** | **5** | **6** |

| Defect counted by the judges | Haiku | Sonnet |
|---|---|---|
| Unsupported claim (says more than the page) | 9 | 2 |
| Quote not on the page (paraphrase or extractor note given as a quote) | 20 | 17 |
| Irrelevant claim | 8 | 6 |

The unsupported claims are the failure that matters, because a verifier can only check a claim against its quote. Examples from Haiku:
- It said a UI view is the only trigger for GitHub's test merge, when the page lists REST get, create and edit too.
- It said subtest concurrency is `Infinity`, which contradicts the page's inherit-from-parent rule.
- It misread when `--force` must be given twice.
- It invented a contradiction in a pricing page.
- It said Haiku 5.5 was absent from a list it appears in.

Quote fidelity was poor in both arms. Sonnet's 13 bad quotes on the pricing question were table rows it rebuilt with extra text; the figures were right.

The 5 pages where Haiku won were all on the pricing question, mostly through Sonnet's rebuilt table quotes. Haiku won no page outside it except one that held nothing material.

### Final reports

| Question | Better report | Material errors in the report |
|---|---|---|
| Q1 prices | tie | none in either; every price correct |
| Q2 settings | Haiku arm | none in either |
| Q3 git worktree | Sonnet arm | Haiku arm: gave a stale error string from a 2020 forum post as git's message |
| Q4 node:test | Sonnet arm | Haiku arm: said `concurrency: true` runs cores - 1 tests; also said no source gives the `--test-concurrency` default, which the CLI docs state |
| Q5 GitHub mergeable | Haiku arm | none in either |

The report split (2-2-1) is noisier than the extraction result. The arms did not fetch the same URL set, and verify and synthesize ran again in both. On Q5, the Haiku arm happened to fetch a mirror of GitHub's OpenAPI text that the Sonnet arm never fetched. The two material errors both came from the Haiku arm.

## Limits

- Five questions, one run per arm, all factual lookups with primary docs available. This can show quality dropping. It could not have shown that quality holds, which would take many runs.
- Same-question URL sets differed between arms (5 to 10 shared URLs of about 10 per arm). The fork pipelines search results into fetches as each search completes, so the order and the budget cut depend on timing even when the search results are replayed from cache. Extraction was compared only on shared URLs for that reason.
- One judge per item, no second judge to measure judge noise.
- Haiku was tested at high effort only. Lower effort would be cheaper still, but it cannot be expected to extract better.
- The `search` stage and receipt checks, the issue's other candidates, were not tested. Search results feed every later stage, so the same objection applies. Receipt checks (does `file:line` say X) were not measured. Haiku's quote-fidelity rate here was about the same as Sonnet's, so this note gives no reason to change the rule text that puts receipt checks on Haiku, and no evidence for it either.

## Side findings

- The workflow harness relays the triggering user request into every workflow agent. A mid-turn message from the user ("update the effort as you see fit for haiku") reached the synthesizers, which noted it and correctly ignored it.
- Light runs here verified 8 of 33 to 47 extracted claims. That is the light preset working as designed, but most claims in a light report are never voted on.

## Reproduce

Scripts are in `scripts/`. `cost.mjs` prices one workflow run's agent transcripts by phase and model. `pairs.py` builds the blind judge input from a run's transcripts and the two `.output` files. The run IDs and raw outputs stayed local.
