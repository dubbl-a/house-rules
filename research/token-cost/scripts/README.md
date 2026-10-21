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
| `verdicts.py` | Refuter ACCEPT or REWORK verdicts linked to the most recent earlier builder's model in the same session: all pairs, then the first verdict per builder (the rework rate by builder model), plus builder runs and median responses. The verdict is the `## VERDICT` line of the refuter's `SubagentHandback` message, falling back to its last text block. A heuristic pairing, not a controlled comparison. |
| `idle_versions.py` | Live-session idle rebuilds split by Claude Code version (before or from 2.1.299) and context (under or over 200k). `--gaps` prints one JSON line (start, end, ctx_k) per rebuild from 2.1.299 at 200k or more, instead of the table |
| `idle_sleep.py` | Takes the `--gaps` output and a saved `pmset -g log` file, and reports whether the Mac was awake when idle compaction should have fired (54 min after the last response). Save the log with `pmset -g log > <file>`; it keeps only recent days, so older gaps read as unknown |
| `compactions.py` | Record types mentioning compaction in the transcripts (positive control for `idle_versions.py`) and the `idleCompaction` setting in user settings plus any settings paths passed as arguments |

Caveats:
- Prices are hard-coded from https://platform.claude.com/docs/en/about-claude/pricing as of 2026-10-20. Every cost figure is a list-price estimate.
- Responses are deduplicated by `message.id` plus `requestId`, keeping the copy with the highest `output_tokens`. Per-step output can be a placeholder, so output may be undercounted.
- Images are counted, not priced. The transcript format is internal and may change.
