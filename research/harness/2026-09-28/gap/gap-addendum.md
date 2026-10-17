# Addendum: gap survey on the critic's areas (2026-09-28)

## 1. What changed

The follow-up survey covered MCP configuration and permissioning, output styles, and the Agent SDK for headless runs. It re-judged four rule files against those areas. It confirmed no duplicates or conflicts, so the first audit's headline stands. It did find ten complements that should name their native floor, and it caught one proposed reword that would have put a wrong claim into a rule.

## 2. Confirmed duplicates or conflicts

None. Two CONFLICT calls did not hold up with the skeptics and were downgraded to COMPLEMENT:

| Item | Heading | Native feature | Citation | Action | Resolution |
|---|---|---|---|---|---|
| claude-code.md | Make a must-hold rule a hook, fail it closed... | Hook timeouts | https://code.claude.com/docs/en/hooks | Reword the floor sentence only | Both skeptics refuted it. A timed-out command hook does not block the call. Only an SDK callback hook blocks on timeout. The rule's timeout clause is correct as written and stays. |
| llm-output.md | Treat silence as not approval | Proactive output style | https://code.claude.com/docs/en/output-styles | Optional declaration | One skeptic refuted it. CLAUDE.md is introduced as overriding default behavior, and a style is only advisory. If the owner wants the precedence stated, add: "A selected proactive style tells Claude to proceed on routine decisions without asking; that is the person's standing choice about pace, not a yes to a file this rule gates, so the wait holds under every style." |

## 3. Complements worth a reword

- **Set the model explicitly...**: "...give a scripted run its budget ceiling, the print-mode flag or the SDK budget option, which counts subagent spend and refuses further spawns at the cap; that figure is a spend estimate, not the bill."
- **Make a must-hold rule a hook...** (floor sentence only; keep the fail-closed sentence): "Know the floor under the hook: a deny rule is evaluated whatever the hook returns, and a bare, safe-mode, or restricted session, or an SDK run whose setting sources leave out the project, never loads project hooks, so anything that must survive needs a deny rule in managed settings too."
- **Run adversarial review in a fresh subagent...**: "Send any other reviewer as an ordinary subagent, never a fork, since a fork inherits the whole conversation the reviewer is meant not to see."
- **Keep the committed settings narrow...**: replace "silently skips" with "the loader drops it with only a startup notice and a doctor line; pass it as the one-session disallowed-tools flag when a scripted run needs it."
- **Roster**: "A tool left off that list is absent from the agent's session, and none lists the Agent tool, so none can spawn an agent."
- **Model tier**: "Roster agents cannot, since none lists the Agent tool. An off-roster agent can, because the spawn-depth cap allows nesting by default, so its brief forbids it under DO NOT."
- **Briefs**: "A subagent gets its own prompt and the repo's CLAUDE.md, never the conversation; only a fork inherits that."
- **Keep a deterministic backbone...**: "a schema fixes shape, not footing, and not every keyword: a format annotation passes unenforced, and a run reported as a success with no structured result is a failure to handle, not an answer."
- **Report no finding...**: "never require a non-empty findings list, since the harness re-prompts a schema-bound run until it conforms and would press a finding out of nothing."
- **Reword a locked claim...**: "The concise built-in style is the nearest native counterpart where a session selects it... but it is advisory, absent from the default style, and never reaches a subagent that runs its own prompt; every locked claim carries that same protection in every style and every agent."

## 4. Skipped docs rule

The skipped rule was re-judged with the rest of docs.md against output styles. It is UNIQUE, so keep it. Output styles shape replies in the main conversation and in forks. They are advisory and never govern file contents. "Put a fact where its litmus test says it belongs" is a COMPLEMENT and stays unchanged.

## 5. Facts the main report's rewords should cite

- A timed-out command hook does not block the call, but an SDK callback hook does: https://code.claude.com/docs/en/hooks
- Deny and ask rules apply whatever a PreToolUse hook returns: https://code.claude.com/docs/en/permissions
- SDK runs load settings-file hooks, CLAUDE.md and permission rules only when setting sources include project or user. Both are on by default: https://code.claude.com/docs/en/agent-sdk/hooks
- A settings rule cannot match MCP tool parameters. A parenthesized mcp__ rule is dropped, and `--disallowedTools` is the only supported route: https://code.claude.com/docs/en/permissions#match-by-input-parameter
- An allow glob needs a literal server prefix, while a deny rule can use "mcp__*": https://code.claude.com/docs/en/permissions#mcp
- Headless runs connect .mcp.json servers without approval. disabledMcpjsonServers rejects a server in every session type: https://code.claude.com/docs/en/mcp#project-server-approvals-and-workspace-trust
- Committed allow rules wait for workspace trust and deny rules do not. The trust dialog never appears in `-p`: https://code.claude.com/docs/en/permissions#project-allow-rules-and-workspace-trust
- A custom output style drops the coding instructions unless keep-coding-instructions is true. Styles never reach non-fork subagents, and a mismatched name silently falls back to Default: https://code.claude.com/docs/en/output-styles
- A tool left off an agent's allowlist is absent from its session. Restriction works per tool, so Bash can still write: https://code.claude.com/docs/en/agent-sdk/subagents
- Structured outputs do not enforce `format`, and a result can report success with no structured output: https://code.claude.com/docs/en/agent-sdk/structured-outputs
- There is no `claude config` command in v2.1.283. `/config` and the settings files are the only routes: https://code.claude.com/docs/en/cli-reference

## 6. Still unreachable

- **Plan mode and observability, two of the five areas the critic named:** the survey gathered no facts on either beyond a one-line description of the `plan` permission mode and the audit-only InstructionsLoaded hook.
- **Whether PreToolUse fires on MCP tool calls:** the docs imply it but never state it.
- **Not fetched:** the subagent model-order page, and the settings-reference, memory and sub-agents pages.
- **Open questions:** whether `claude -p` and workflow schemas share the SDK validator's gaps; whether a disable-model-invocation skill can be preloaded through AgentDefinition.skills; whether the spawn-depth cap counts the main session as a layer; whether plugin agents honor `permissionMode`.