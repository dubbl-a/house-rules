## Addendum to the native-feature audit, 2026-09-20

**1. What changed.** Five unresearched areas (MCP configuration and permissioning, output styles, plan mode, headless mode, observability) and one skipped docs rule were run against the package. Nothing there overturns the first pass: still zero confirmed duplicates and zero conflicts, with six rules gaining a native floor worth citing.

**2. Confirmed duplicates or conflicts.** None. Every candidate landed as UNIQUE or COMPLEMENT, and no skeptic refutation was needed to keep a claim off the table.

**3. New complements worth a reword.**

*llm-output, "Keep a deterministic backbone and let the model fill the slots"* (native floor: `--json-schema` with `--output-format json`):
> Anchor a printed run on a supplied output schema where one applies, since the harness fails the run on an invalid schema and hands back a structured payload, then remember a schema fixes shape and not footing: label which parts of an output were computed and which were judged, and carry review context inline with the row so a review step never has to resolve a path to know what it is looking at.

*llm-output, "Reword a locked claim, never strengthen it"* (native floor: the concise built-in style):
> Rewording a claim to mirror the reader's vocabulary is allowed; changing the claim, the metric, the scope, or the strength of the verb is not, and a number never rounds up. The concise built-in style is the floor to read from, since it compresses a response while keeping the complete content of an error report, a security warning, and a confirmation for a destructive action; treat every locked claim as carrying that same protection under any style.

*llm-output, "Treat silence as not approval"* (native floor: plan mode, plus print-mode permission modes):
> Plan mode is the harness floor here: it holds edits until a person picks an approve option, but the hold ends at approval, does not bind where bypass permissions are available, and covers edits rather than every write. A printed run has nobody to answer a prompt, and where prompts are switched off it denies instead of asking, so ask for the yes yourself.

*claude-code, "Set the model explicitly on every subagent and workflow agent"* (native floor: `--max-budget-usd`):
> State the tier a procedure requires and stop when the session is below it, and give a scripted run the print-mode budget ceiling flag so a cost constraint is enforced rather than only stated, remembering that the figure it enforces against is the session's own estimate of spend and not the bill.

*claude-code, "Make a must-hold rule a hook, fail it closed"* (native floor: PreToolUse versus PermissionRequest exit handling):
> Fail it closed: a crash, a missing helper, or an unreadable payload denies rather than passing quietly, because a silent exit reads as no decision and never as approval. Know where that exit stops binding: only the pre-tool event reads a failing exit as a block, while the permission-request event ignores it and runs on, so a guard there has to deny through its decision object instead.

*claude-code, "Keep the committed settings narrow and the local settings local"* (native floor: MCP rule matching and non-interactive server loading):
> Allow-list network fetches per domain rather than blanket, and pin the servers and services the project enables by name rather than inheriting whatever is installed, because a print-mode run loads the project's servers with no approval prompt at all. Pin them from the deny side too, since the disable list is the one that binds in every session type including a checkout nobody has trusted, and give a scripted run the strict server-config flag so it connects only the servers it was handed.

**4. The skipped docs rule.** "Don't document a command that does not exist" is UNIQUE, keep as written. No researched feature reads, validates, or rewrites document prose, and the bare and safe modes that skip instruction files argue for keeping the gate in the build rather than in session context.

**5. Facts the main report's rewords should cite.**

- A print run without bare mode loads the project's hooks and MCP servers with no trust dialog and no approval prompt (headless).
- MCP tool calls reach PreToolUse as ordinary tools; a server matcher needs a trailing `.*` (hooks).
- A settings-file `mcp__` rule with parentheses is skipped, so only a hook or `--disallowedTools` gates an MCP tool's arguments (permissions).
- PermissionRequest does not honor exit code 2; deny through the decision object (hooks).
- An output style changes how Claude responds, not what Claude knows, and drops the coding instructions unless `keep-coding-instructions` is set (output-styles).
- CLAUDE.md and rule files are context, not enforced configuration; use a PreToolUse hook to block (memory).
- Cost figures in JSON, `/usage`, and the statusline are client-side estimates (costs).

**6. Still unreachable.** Verbatim text of mcp.md and hooks.md (fetch refusals, quoted extracts only); the `requiresUserInteraction` section; the PermissionRequest decision-object schema; the managed-mcp page; whether plan mode is available in a print run; which non-edit tools plan mode gates (permission-modes page not fetched).