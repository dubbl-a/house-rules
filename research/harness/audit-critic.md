## 1. Unresearched native areas that could make a house rule redundant or conflicting

- **MCP (Model Context Protocol)** — server config (`.mcp.json`), tool permissioning, enterprise-managed MCP settings — absent from the entire research list despite bearing directly on "permissions" and the PreToolUse branch guard.
- **Output styles** (`/output-style`) — could already enforce or fight the llm-output.md formatting rules (e.g. no em dash).
- **Headless mode / Claude Code SDK** (`-p`, programmatic hooks) — the closest native analog to the eval suite and checker scripts, unaddressed.
- **Plan mode** (shift+tab) — overlaps engineering.md's "build the simplest thing" / writing-plans guidance.
- **`/cost`, statusline, telemetry (OTel)** — minor, but unaddressed observability surface.

## 2. Did the classifier skip a heading?

`grep -c '^## '` minus the exact `^## Don't$` catch-all section, per file:

claude-code 15, data-pipelines 10, database 8, deployment 7, docs **12**, engineering 21, github 17, llm-output 9, testing 13 → **sum = 112**.

The overlap-audit's own enumerated mechanisms (branch guard 1 + five skills 5 + ten checker families 10 + render/vendor 1 + lock file 1 + deviations-and-ratchets 1 + upstream-first sync 1 + carryover handoff 1 + eval suite 1) = **22**.

112 + 22 = 134, not the stated 133. The stated total only reconciles (111 + 22 = 133) if `docs.md`'s heading `## Don't document a command that does not exist` (line 88) is dropped — a fully-formed rule with its own body, Anchor, and Receipts, structurally identical to every other rule, that merely starts with the word "Don't." The classifier appears to have prefix-matched "Don't" instead of matching the exact boilerplate heading, **undercounting docs.md by one real rule**.

## 3. Highest-leverage follow-up

Research **MCP server configuration and tool permissioning** (`.mcp.json`, per-server allow/deny, enterprise-managed MCP policy). It's the one major native surface never touched, it sits directly under "permissions" and the branch-guard hook the audit already scoped, and it's the most likely place a custom enforcement mechanism turns out to duplicate — or conflict with — something Claude Code already does natively.