# Completeness critic rerun, house-rules audit (2026-09-20)

## 1. Unresearched native-feature areas

Checked code.claude.com/docs/llms.txt against the eleven researched areas. Five got no dedicated research:

- **Settings/admin config** (settings.md, settings-reference.md, managed-settings.md, auto-mode-config.md): precedence and enterprise lockout unchecked; house.json's own precedence claims could conflict with the native merge chain.
- **Security/data handling** (security.md, claude-security.md, security-guidance.md, data-usage.md, zero-data-retention.md): could touch database.md and deployment.md rules on secrets, vendor objects, and backups.
- **Checkpointing** (checkpointing.md, agent-sdk/file-checkpointing.md): native auto-rewind of file edits could make claude-code.md or engineering.md rollback/branch-discipline guidance partly redundant.
- **Best practices/common workflows** (best-practices.md, common-workflows.md): Anthropic's own canonical usage guide, likely to already say officially what several modules independently prescribe.
- **Tools reference, context window, prompt caching** (tools-reference.md, context-window.md, prompt-caching.md): bears on docs.md's "keep files under budget" rule and any rule assuming specific tool behavior.

## 2. Did any classifier skip headings

Counted "## " headings per rule file with grep, excluding only the trailing catch-all "## Don't" section every file ends with, not headings like "## Don't document a command that does not exist," which is a real rule with its own Anchor/Receipts. Every module's heading count matches its classification's `rules` array length. No gaps:

claude-code 15/15, data-pipelines 11/11, database 8/8, deployment 7/7, docs 12/12, engineering 21/21, github 18/18, llm-output 9/9, testing 13/13.

Caution: a naive `grep -c "^## Don't"` (prefix, not exact) miscounts docs.md, stripping the real "Don't document a command..." rule too, giving 11 expected vs 12 classified. Confirmed against main-classify-docs.json: all 12 docs headings, including that one, are separate rule entries. Nothing skipped anywhere.

## 3. Highest-leverage follow-up

Fetch the full, non-refused verbatim text of hooks.md and hooks-guide.md: the PermissionRequest decision-object schema and the multi-hook combination/matching rule. Both are flagged "still unreachable" in gap-addendum.md (quoted extracts only), yet they underlie the report's one downgraded CONFLICT, the PreToolUse branch guard in section 6, plus several gap-run rewords (fail-closed hooks, MCP-no-approval loading). That downgrade already rests partly on a citation the doc-accuracy skeptic could not confirm on the cited page. Reading the source firsthand is the one check that could solidify "zero confirmed conflicts," or move it off zero.
