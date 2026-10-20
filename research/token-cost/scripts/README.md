# Transcript analysis scripts

The scripts behind the adopter evidence in `../2026-10-20.md`. Each one reads Claude Code transcripts under `~/.claude/projects/`. It only reads them and writes nothing.

Run any script with `PROJECT_GLOB` set to the project folder pattern:

    PROJECT_GLOB='-Users-<you>-code-<repo>*' python3 -I cost.py

| Script | What it measures |
|---|---|
| `cost.py` | List-price cost by model, main vs subagent, share of main cost above 200k and 500k context, cost by ISO week |
| `misses.py` | Cache-write cost by thread and TTL, and main-thread rebuilds (writes over 50k) by cause: idle over 1h, idle 5m to 1h, model switch, no gap |
| `bytype.py` | Subagent cost by agent type (from `*.meta.json`) and model |
| `baseline.py` | Context size of each session's and subagent's first request (startup load) |
| `servers.py` | MCP servers and skills actually called, with call counts and last use |
| `resumes.py` | Idle rebuilds split by whether a resume marker precedes them |
| `verdicts.py` | Refuter ACCEPT or REWORK verdicts linked to the preceding builder's model. **Known broken:** it found a verdict in 1 of about 101 refuter runs. M1 needs a machine-readable verdict line first. |

Caveats:
- Prices are hard-coded from https://platform.claude.com/docs/en/about-claude/pricing as of 2026-10-20. Every cost figure is a list-price estimate.
- Responses are deduplicated by `message.id` plus `requestId`, keeping the copy with the highest `output_tokens`. Per-step output can be a placeholder, so output may be undercounted.
- Images are counted, not priced. The transcript format is internal and may change.
