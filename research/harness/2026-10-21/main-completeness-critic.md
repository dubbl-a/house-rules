**Completeness critique**

**(1) Native areas not researched.** These could make a house rule redundant or conflicting:
- MCP: `/mcp`, `.mcp.json`, MCP scopes and tool-search deferral. This matters for tool and secret rules.
- Headless and SDK mode: `claude -p`, `--output-format`, `--permission-mode`, the Agent SDK. It matters for the evals and CI rules.
- The Workflow tool and bundled workflows: `/deep-research`, `/code-review`, `/security-review`, `/simplify`. The house `deep-research-pinned` fork and the review rules overlap with these.
- Scheduled and remote work: `/schedule` (routines), `/loop`, the Monitor tool, Claude Code on the web, remote control. The update-routine mechanism overlaps with these.
- Cost and context commands: `/context`, `/cost`, `/usage`, `/compact`, `/memory`, `/hooks`, `/agents`, `/permissions`. The token-cost hooks overlap with these.
- Model and effort config: `/model`, `/effort`, fast mode, extended thinking, `ANTHROPIC_MODEL` env vars. This bears on the builder-tier rule.
- Output styles, the statusline, keybindings, `/terminal-setup`, devcontainers and `/sandbox` network policy.
- OpenTelemetry monitoring and troubleshooting docs.
- The Claude Code changelog and release notes. This is the harness-update pipeline's main input, and the survey doesn't list it.

**(2) Skipped headings.** No classifier skipped headings in the 12 classified files. Each file's `## ` count minus its one `## Don't` heading matches the reported count, and 133 rules plus 32 mechanisms equals 165.

| File | Headings excluding "Don't" | Reported |
|---|---|---|
| claude-code | 16 | 16 |
| docs | 12 | 12 |
| engineering | 17 | 17 |
| github | 19 | 19 |
| testing | 11 | 11 |
| database | 8 | 8 |
| deployment | 7 | 7 |
| data-pipelines | 11 | 11 |
| llm-output | 9 | 9 |
| evals | 11 | 11 |
| security.md | 7 | 7 |
| retrieval | 5 | 5 |

One gap: `plugins/house/modules/security/rules/security-server.md` has 7 `## ` headings, 6 excluding "Don't". It was never in the classified list, so its 6 rules are unaudited.

**(3) Highest-impact follow-up.** Classify `security-server.md`, which is a certain gap. The follow-up that would most change conclusions is a diff of the Claude Code changelog and release notes from the version the last audit covered through 2.1.306. Check each house rule and hook against it for native features that now cover the same ground. In particular, check headless, MCP, and the review and workflow commands against the guard, evals and `deep-research-pinned` mechanisms. This is the most likely source of rules the survey wrongly marks as still needed.

Scratchpad path counted: `<repo>/plugins/house/modules/`