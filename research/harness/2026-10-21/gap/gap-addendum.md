# Addendum: native-feature audit, 2026-10-21 (Claude Code 2.1.306)

## 1. What changed

This addendum covers the six areas the completeness critic named, plus security-server.md. It classified 63 more rule items: 41 complements, 22 uniques and 29 rewords, with no confirmed duplicates or conflicts. Most rewords fix floor claims that the rules overstate or leave out, mainly the subagent force variable, what print mode and cloud sessions load, and how far the sandbox reaches.

## 2. Confirmed duplicates or conflicts

None. One CONFLICT was proposed. A skeptic refuted it, so it is downgraded to a complement:

| Item | Heading | Native feature | Citation | Action | Resolution |
|---|---|---|---|---|---|
| claude-code.md lines 68, 74 | deep-research-pinned fork | Workflow readable-file rule; saved workflows in `~/.claude/workflows/`; `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` | workflows#how-a-workflow-runs; sub-agents#run-every-subagent-on-one-model | Reword (COMPLEMENT) | Keep the scratchpad copy step, because it is a safe subset of the readable-file rule. Add the force-variable caveat and name the saved-name route as an option. |

## 3. Complements worth a reword (wordings abbreviated)

- **claude-code.md model rule; ORCHESTRATION.md Model tier and Roster:** "never set the force variable for subagent models where a tiered run matters, since it discards every call-level and definition model". Mark the workflow model variable as undocumented but seen working in the binary. Add "the Workflow tool starts only a script the session can already read."
- **claude-code.md hook rule:** "among tool events only the pre-tool event reads a failing exit as a block". Add runs with all hooks disabled, and cloud sessions, to the list of sessions with no hooks. Add "match a server's tools with a pattern that ends in a wildcard."
- **claude-code.md committed settings:** the strict server-config flag "alone still loads" connectors. A print-mode run in an untrusted checkout ignores the committed allow list "while still running its hooks and servers". The sandbox enforces only "for shell commands where it is on and set to fail rather than run unsandboxed."
- **claude-code.md session rule; idle-cache-hold hook:** cite idle compaction as the floor. Name what it misses: print mode, the five-minute cache, and a machine that slept.
- **claude-code.md review rule:** "recover a stopped workflow by relaunching the same script in the same or a resumed session."
- **claude-code.md git-state and peer rules:** "Count a pull request with auto-fix on, and any scheduled cloud task, as a peer that pushes under your account." The docs give no label for a print-mode run in the listing, so the worker's name is the reliable tell.
- **security.md:** the sandbox "covers shell commands only and by default runs them unsandboxed when it cannot start". Deny credential paths "to the file tools and to sandboxed commands alike". Add "a scripted or SDK run loads them without the approval an interactive session asks for."
- **routine-prompt.md:** the Gmail send-only limit "is an instruction the prompt gives, not a control". The run gets no plugin hooks.
- **evals.md:** treat an error subtype, a turn or budget cap, or "a success with no structured output field" as NOT EVALUABLE. Turn auto memory off in the lean invocation. Deny project skill grants and project servers, because both reach an untrusted print-mode session.
- **github.md:** repin by SHA the workflow that `/install-github-app` opens, which names the action by a version tag. Pass `--max-turns` and set `timeout-minutes`. The branch rule "must be one that access cannot bypass." Hold cloud tokens as network secrets.
- **Also reworded:** cost-report should name the `/usage` cache-miss causes and say it ignores a contracted price table. ORCHESTRATION Delegation should say typing `ultracode` counts as asking. Verification should name `/code-review` as the floor for a diff with no brief. The model-invocation rule should add `skillOverrides`.

## 4. security-server.md (unclassified in the main audit)

- **COMPLEMENT (five rules):** injection, request-chosen fetches, authorization, crypto, and fail closed.
- **UNIQUE (two):** secure defaults, and Don't.
- **Native overlap:** only the opt-in, warn-only security-guidance plugin and the advisory `/security-review`.
- **Reword:** only the injection rule: both tools "flag this class after the code is written and neither blocks it, so the test is what holds the line."

## 5. Facts the main report's rewords should cite

- **Hooks in print mode:** without `--bare`, `-p` runs project settings hooks even in an untrusted folder. The docs do not say which events fire beyond SessionStart and Setup. (headless; permissions#what-runs-before-you-trust-a-folder)
- **MCP calls and PreToolUse:** MCP tool calls reach PreToolUse as `mcp__<server>__<tool>`. A matcher needs `.*`, and plugin servers carry a `plugin_` prefix. (hooks)
- **Hook decisions vs rules:** a hook allow does not override a deny or ask rule. Exit 2 blocks before the rules are checked. (permissions#extend-permissions-with-hooks)
- **MCP rules in settings:** settings files drop any `mcp__` rule with parentheses. Only `--disallowedTools` can match an MCP tool parameter. (permissions)
- **Output styles:** a style is instructions sent with every request, and nothing enforces them. It does not reach non-fork subagents or change the permission mode. (output-styles)
- **Sandbox:** it is off by default, covers shell commands only, and falls back silently to unsandboxed unless `failIfUnavailable` is set. `denyRead` does not stop Read, and `allowedDomains` does not limit WebFetch. (sandboxing)
- **Print-mode permissions:** since 2.1.302, `-p` starts in Manual mode when no mode is set. (headless; permission-modes)
- **Cloud sessions:** they run no user hooks and install no plugins the repo declares. (cloud-environments)
- **SessionStart size cap:** additionalContext over 10,000 characters goes to a file Claude is not told to read. ORCHESTRATION.md is about 8,450 characters. (hooks)
- **Subagent model variables:** `CLAUDE_CODE_SUBAGENT_MODEL` is only a default. The `_FORCE` variant voids both definition models and call-level models. (sub-agents)
- **Statusline:** display-only, runs outside the sandbox, and stays blank until the folder is trusted. (statusline)
- **Routines:** a routine's saved prompt is not consent, and every tool of an included connector runs without asking. (routines)

## 6. Still unreachable

- The hooks page after its first 100,000 characters: which events fire under `-p`, and the MCP `tool_input` shape.
- The Agent SDK TypeScript and Python option references: `maxBudgetUsd`, Workflow tool inputs, and `resumeFromRunId`.
- The `/security-review` page (returns 404) and the ultrareview page.
- The settings-reference entries for MCP approval keys, cache TTL and `maxEffortLevel`, and the managed-settings precedence page.
- Dedicated docs for the 2.1.304 resume warning and for `allowNestedUserNamespaces`. Both appear only in the changelog.
- `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL`: not in the docs at all, and backed only by a local note taken from the binary.
- The final parts of the monitoring-usage and agent-view pages.
