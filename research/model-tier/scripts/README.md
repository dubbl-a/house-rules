# Model-tier scripts

The scripts behind `../2026-10-20-haiku-fetch.md` and `../2026-10-21-builder-tier.md`. The first two read workflow transcripts under `~/.claude/projects/<project>/<session>/subagents/workflows/<run-id>/`. Neither changes them. `pairs.py` writes its two output files; nothing else is written.

| Script | What it does |
|---|---|
| `cost.mjs` | `node cost.mjs <run-dir> [<exclude-dir>]` prints tokens, list-price cost and agent wall time per phase and model. To price only the agents a resumed run added, pass a copy of the baseline run dir as `<exclude-dir>`. Haiku requests over 100K input tokens are priced at the 5x tier. |
| `pairs.py` | `python3 -I pairs.py <run-dir> <A.output> <B.output> <prefix>` pairs each URL that both arms fetched (Sonnet vs Haiku, read from each agent's `.meta.json`). It assigns X/Y at random, seeded by `<prefix>`. It adds both final reports, taken from the `result` field of the workflow `.output` files. It writes `<prefix>.judge.json` (blind) and `<prefix>.key.json` (the unblinding key and claim counts). |
| `builder_tier.py` | `PROJECT_GLOB='*' python3 -I builder_tier.py` reads every `house-rules:builder` and `house-rules:refuter` subagent transcript under `~/.claude/projects/$PROJECT_GLOB` and prints builder runs by model, majority effort and size band (deduplicated responses per build), with first-verdict REWORK rate and list-price cost, the refuter run cost, and what ran after a first REWORK. It pairs each refuter with the most recent earlier builder in the same session. Read-only; prices are dated 2026-10-21. |

Both arms of a question live in one run dir, because arm B is a `resumeFromRunId` of arm A. To get arm A's costs alone, snapshot the dir before the resume.
