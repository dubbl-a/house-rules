# Addendum to the native-features audit (2026-09-02)

## 1. What changed

Five areas the first pass never researched (MCP configuration and permissioning, output styles, plan mode, headless mode, observability) plus one skipped docs rule have now been judged against the same 133-item surface. Nothing turned into a duplicate or a conflict; what the areas added is a set of native floors that eight rules should cite, and the skipped rule holds as unique.

## 2. Confirmed duplicates or conflicts

None. No item survived as DUPLICATE or CONFLICT, so no table. The two nearest misses were the invalid-settings dialog surfacing a skipped `mcp__` rule (config validation, not prose validation) and plan mode's approval gate (session scoped, not per artifact).

## 3. New complements worth a reword

Each is an added line, not a rewrite; the heading, anchor, and receipts lines stay.

**llm-output.md, "Treat silence as not approval"** (insert second): Plan mode is the harness floor here: it holds edits until a person picks an approve option, but the hold ends at approval, does not bind where bypass permissions are available, and never applies to a printed run, so ask for the yes yourself.

**claude-code.md, "Disable model invocation on a skill with side effects"**: Remember that a print-mode run expands a skill named in the prompt string before the turn starts, so the gate is the caller who wrote that string and not a person watching a prompt. Expect an automatic mode to route a production deploy through a classifier rather than through you.

**claude-code.md, "Set the model explicitly on every subagent and workflow agent"**: Expect a managed model list to be applied as given rather than merged with yours, so a named tier can be unavailable and the call has to fail loudly rather than quietly fall back. Give a scripted run the print-mode budget ceiling flag so a cost constraint is enforced rather than only stated.

**claude-code.md, "Make a must-hold rule a hook, fail it closed, and test it with real payloads"**: Know the floor under the hook: a deny rule is evaluated whatever the hook returns, and a session started bare, in safe mode, or in restricted mode never loads project hooks at all, so anything that must survive those needs a deny rule in managed settings beside it.

**claude-code.md, "Keep the committed settings narrow and the local settings local"**: Pin the servers the project enables by name, because a print-mode run loads them with no approval prompt at all. Reach for a deny rule when you want the blanket, since a deny can wildcard across every tool of every server while an allow has to name its server, and keep a parameter-scoped rule on a server tool out of a settings file, because the loader skips it and says so only in the doctor output. Prune on a cadence, because permission lists merge across every scope rather than override.

**engineering.md, "Search public prior art before building a tool"**: Run the search in the harness planning phase, where edits stay blocked until a plan is approved, and hold that posture yourself in a session where the block does not apply, because the plan is not the record.

**engineering.md, "Make a measuring instrument reproducible"**: When the instrument drives an agent, pin the bare non-interactive invocation that skips ambient discovery, and record the pricing basis beside any cost the harness reports, because that figure is computed locally and a configured rate or a residency multiplier moves it without moving the bill.

**hooks/no-direct-master.sh** (extend the fail-open comment block): Also fails open wherever this hook never runs or never sees the command, since bare and safe mode load no project hooks, restricted mode ignores project settings, and a shell command routed through a Cowork workspace tool or a git operation performed by an MCP server arrives as an MCP tool call. Where that matters, a deny rule naming the whole tool is the only floor that still binds.

## 4. The skipped docs rule

`plugins/house/modules/docs/rules/docs.md`, "Don't document a command that does not exist": UNIQUE, keep unchanged. Native validation covers settings and config files it is about to load, never prose, and CLAUDE.md and rules files are explicitly context rather than enforced configuration, so a document naming a command that does not exist loads with no warning.

## 5. Facts the main report's rewords should cite

- Hooks do fire headless by default; `--bare`, `--safe-mode`, and `--restricted` load none of them. (docs/en/headless; claude --help)
- MCP tool calls do reach PreToolUse, with `tool_name` as `mcp__server__tool`. (docs/en/hooks#match-mcp-tools)
- Deny and ask rules are evaluated whatever a hook returns; a hook's allow is advisory. (docs/en/permissions#extend-permissions-with-hooks)
- Output styles change how Claude responds, not what Claude knows; CLAUDE.md is a later user message, not the system prompt. (docs/en/output-styles)
- Plan mode blocks edits only where bypass permissions are unavailable, and a printed run sees no plan prompt. (docs/en/permission-modes)
- A `-p` run loads project `.mcp.json` servers with no approval prompt. (docs/en/mcp#project-server-approvals-and-workspace-trust)
- Permission lists merge across scopes rather than override. (docs/en/settings#combine-settings-across-scopes)
- Deny and ask accept `mcp__*`; an unanchored allow glob is skipped with a warning. (docs/en/permissions#tool-name-wildcards)
- A settings-file `mcp__` rule with parentheses is skipped. (docs/en/permissions#match-by-input-parameter)
- Cowork routes shell through `mcp__workspace__bash`; Bash deny rules carry over, allow rules do not. (docs/en/permissions#mcp)
- Telemetry is off until opted in and is never passed to subprocesses, hooks, or MCP servers. (docs/en/monitoring-usage)

## 6. Still unreachable or unverified

No page failed to fetch. Referenced but not independently opened: managed-mcp, settings-reference, managed-settings, sub-agents. Three open questions: whether a Cowork `mcp__workspace__bash` payload exposes a usable `.tool_input.command` to a hook; whether a JSON `permissionDecision: deny` is absolute in the way exit code 2 is; and the claude-code.md auto-memory cap heading, judged UNIQUE without the memory facts, which should be re-judged against them.