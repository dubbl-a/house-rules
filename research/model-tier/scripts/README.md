# Haiku fetch A/B scripts

The scripts behind `../2026-10-20-haiku-fetch.md`. Both read workflow transcripts under `~/.claude/projects/<project>/<session>/subagents/workflows/<run-id>/`. Neither changes them. `pairs.py` writes its two output files; nothing else is written.

| Script | What it does |
|---|---|
| `cost.mjs` | `node cost.mjs <run-dir> [<exclude-dir>]` prints tokens, list-price cost and agent wall time per phase and model. To price only the agents a resumed run added, pass a copy of the baseline run dir as `<exclude-dir>`. Haiku requests over 100K input tokens are priced at the 5x tier. |
| `pairs.py` | `python3 -I pairs.py <run-dir> <A.output> <B.output> <prefix>` pairs each URL that both arms fetched (Sonnet vs Haiku, read from each agent's `.meta.json`). It assigns X/Y at random, seeded by `<prefix>`. It adds both final reports, taken from the `result` field of the workflow `.output` files. It writes `<prefix>.judge.json` (blind) and `<prefix>.key.json` (the unblinding key and claim counts). |

Both arms of a question live in one run dir, because arm B is a `resumeFromRunId` of arm A. To get arm A's costs alone, snapshot the dir before the resume.
