## Completeness critique

**1. Unresearched areas that could make a rule redundant or conflicting**
- The Claude Code **CHANGELOG.md**. The full re-survey path (unlike the delta-addendum path) never fetches it, so a doc page can be stale-but-published and read as current — the skill's own hazards say "doc pages carry no dates," yet nothing here cross-checks against dated release notes.
- **`claude mcp --help` / `claude config --help`** — MCP server and permission-config CLI, directly relevant to the "keep committed settings narrow" and hooks-permissions rules, but only doc *pages* were fetched, not this CLI surface.
- **Output styles** (`/output-style` docs) — a native mechanism for customizing response formatting that could bear on docs.md's prose rules (no em dashes), and it's in no area.
- The **Claude Agent SDK** docs — relevant to agents-models' claims about how subagents/workflows are defined; a distinct surface from the CLI/plugin docs researched.

**2. Heading-count check**
Grepping `^## ` minus the *exact* heading `## Don't` (not a prefix match) across the 9 module files: claude-code 15, docs 12, engineering 21, github 19, testing 13, database 8, deployment 7, data-pipelines 11, llm-output 9 — sum **115**.

The critic prompt itself never passes per-item counts, only the aggregate 148 and the item-name list — there is no per-item baseline to grep-check against; that's a gap in the audit pipeline, not just this run's output. Separately, a naive **prefix** match on `^## Don't` mis-fires on `docs.md`, which has a real rule "## Don't document a command that does not exist" beside its terminal "## Don't" section; prefix-counting drops docs.md to 11, undercounting by one. That's exactly the hazard the skill's own hazards section names ("a naive heading count skips a rule... count by exact match, not prefix"), so any classifier pass that heading-matched by prefix plausibly skipped that rule.

**3. Highest-leverage follow-up**
Fetch the CHANGELOG and reconcile every area's citations against it by date. It's structural — touches all 12 areas at once — and is the one gap the skill already names as known but unremediated in a full re-survey, so it's most likely to flip a COMPLEMENT/UNIQUE call into a CONFLICT.