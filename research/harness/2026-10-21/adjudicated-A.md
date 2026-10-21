# Adjudicated rewords, inventory A (Claude Code orchestration mechanisms)

Source tree: `survey-src/` (paths below are relative to it). Docs fetched 2026-10-21 from
code.claude.com (`.md` pages) into `scratchpad/adjA-docs/`; changelog is
`scratchpad/changelog/CHANGELOG.md`; CLI checked is 2.1.306. Every OLD below was matched
verbatim against the named file (multi-line OLDs as one substring).

Inventory has 26 items (main run 10, gap run 16). Merged passages: the hook rule's exit sentence
(main + gap), the idle-cache-hold hook (main + gap), and the model rule's workflow-variable
clause (gap model rule + gap deep-research fork + gap Model tier).

Verdict counts by inventory item: ACCEPT 0, AMEND 19, REJECT 7.

---

## Part 1. Rule files

### A1. `plugins/house/modules/claude-code/rules/claude-code.md`, "Give a domain rule a paths list, and never leave a rule file unscoped" (main)

Verdict: AMEND. The classifier is right that the confirm step names no native way to confirm.
The InstructionsLoaded clause is dropped: it reports loads, not their absence, and the house
plugin's own `instructions-loaded.mjs` logger already covers that side.

Evidence: memory.md: "To check which `CLAUDE.md` and rules files loaded at launch, run `/context`."
and "If the YAML between the markers doesn't parse, Claude Code ignores the frontmatter and loads
the rule as if it had no `paths`." (https://code.claude.com/docs/en/memory)

OLD:
```
Confirm the scoping defers loading before you count on it, and tell the reader to grep the rules directory when no matching file is open.
```
NEW:
```
Confirm the scoping defers loading before you count on it, by checking that `/context` does not list the rule at launch, since frontmatter that does not parse loads the rule as if it had no `paths:`; tell the reader to grep the rules directory when no matching file is open.
```

Receipt, `docs/handbook/claude-code.md`:

OLD:
```
loading before counting on it.
```
NEW:
```
loading before counting on it. The memory page now names the check and the failure it catches:
`/context` lists the rules files loaded at launch, and frontmatter whose YAML does not parse
loads the rule as if it had no `paths` (https://code.claude.com/docs/en/memory, fetched
2026-10-21).
```

### A2. same file, "Keep a skill body short, its references one level deep, and its name equal to its directory" (main)

Verdict: AMEND. Two inaccuracies: the 500-line figure is a tip, not a ceiling, and a
personal or project skill's `name` sets the command (open question 5, settled by the docs). The
name-equals-directory check itself stays.

Evidence: skills.md: "> Keep `SKILL.md` under 500 lines. Move detailed reference material to
separate files." and "In a personal or project skill directory, `name` sets the command that the
`/` menu shows and that you type, unless another command already uses that name. The directory
name also invokes the skill. In a plugin skill, `name` sets the last segment of the command and
the plugin prefix stays in place." (https://code.claude.com/docs/en/skills, "How a skill gets its
command name")

OLD:
```
Hold the body under 500 lines, Claude Code's documented ceiling, or a lower cap you configure,
```
NEW:
```
Hold the body under 500 lines, the length Claude Code's docs recommend, or a lower cap you configure,
```

OLD:
```
The harness treats a personal or project skill's name as a display label, invoking it by directory, while a plugin skill's name replaces the last segment of its namespaced command; a legal mismatch is an error in both here.
```
NEW:
```
In a personal or project skill the harness takes the command from `name` and lets the directory name invoke it too, while a plugin skill's name replaces the last segment of its namespaced command; a legal mismatch is an error in both here.
```

Receipt, `docs/handbook/claude-code.md`:

OLD:
```
budget, where a personal or project skill's `name` is a display label and the directory name is
what invokes it (https://code.claude.com/docs/en/skills).
```
NEW:
```
budget, where a personal or project skill's `name` sets the command and the directory name also
invokes it, and where the 500-line figure is a tip rather than a limit
(https://code.claude.com/docs/en/skills, re-read 2026-10-21).
```

### A3. same file, "Disable model invocation on a skill with side effects" (gap)

Verdict: AMEND. The classifier's `skillOverrides` advice is wrong for plugin skills, which
`skillOverrides` skips; the rest holds. The `/loop` clause is dropped (the rule already says a
model-initiated call is blocked; adding the scheduled case restates it).

Evidence: skills.md: "To keep a personal or project skill but stop Claude from invoking it on its
own, set `disable-model-invocation: true` ... or `\"user-invocable-only\"` in `skillOverrides` when
you don't want to edit the file."; "Plugin skills are not affected by `skillOverrides`.";
"When a session starts with a skill named `verify` or `simplify` in place, Claude Code's commit
instructions tell Claude to run it right before each commit ... If you've stopped Claude from
invoking it, for example with `disable-model-invocation: true`, Claude doesn't get the
instruction." (https://code.claude.com/docs/en/skills)

OLD:
```
Set `disable-model-invocation: true` on any skill that writes, deploys, or spends; the harness then blocks a model-initiated call but cannot decide which effects count, and a print-mode run still expands a named skill, so the caller who wrote the string is the gate.
```
NEW:
```
Set `disable-model-invocation: true` on any skill that writes, deploys, or spends, or `user-invocable-only` in `skillOverrides` for one whose file you do not edit (a plugin skill ignores that setting); the harness then blocks a model-initiated call but cannot decide which effects count, and a print-mode run still expands a named skill, so the caller who wrote the string is the gate. Either one also drops a skill named verify or simplify from the run before each commit.
```

Receipt, `docs/handbook/claude-code.md`:

OLD:
```
permission mode, where a classifier reviews most actions instead of a person.
```
NEW:
```
permission mode, where a classifier reviews most actions instead of a person. The skills page
adds `skillOverrides` set to `user-invocable-only` for a skill whose file you do not edit, which
plugin skills ignore, and says a `verify` or `simplify` skill Claude cannot invoke no longer runs
before each commit (https://code.claude.com/docs/en/skills, fetched 2026-10-21).
```

### A4. same file, "Set the model explicitly on every subagent and workflow agent" (gap model rule; gap deep-research fork, line 68 and 74 parts)

Verdict: AMEND, six passages. Settled from the changelog: `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL`
is real (open question 3), so the classifier's "the docs do not describe it" and "the binary has
been seen to" wording is REJECTED; `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is documented and the rule
omits it (open question 4). The fork's proposed switch to running by saved name is REJECTED here
as a procedure change (PROPOSAL P3).

Evidence:
- sub-agents.md: "To apply one model to every subagent, teammate, and workflow agent, also set
  `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` to `1`." and "While `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is on,
  Claude Code ignores the `model` field in subagent definitions, and Claude can't pass a model";
  "Setting `CLAUDE_CODE_SUBAGENT_MODEL` by itself doesn't change the model the built-in Explore and
  Plan subagents run on." (https://code.claude.com/docs/en/sub-agents)
- CHANGELOG 2.1.296: "Added `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL` to run every workflow agent on
  one model while other subagents keep theirs"; 2.1.257: "Added `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`
  to apply `CLAUDE_CODE_SUBAGENT_MODEL` (or the main model) to every subagent, ignoring per-spawn
  and agent-definition model overrides".
- sub-agents.md: the `effort` field "Overrides the session effort level, but not the
  `CLAUDE_CODE_EFFORT_LEVEL` environment variable" and "The `CLAUDE_CODE_EFFORT_LEVEL` environment
  variable takes precedence over both."
- sub-agents.md: "When the blocked value is a family alias such as `opus`, Claude Code runs the
  subagent on the newest version of that family the allowlist permits" / "For any other blocked
  value ... Claude Code runs the subagent on the inherited model instead." / "In interactive
  sessions, Claude Code shows a warning naming the requested model and the model the subagent runs
  on".
- cli-reference.md (`--max-budget-usd`): "Spend can pass the cap, so leave headroom."
- workflows.md: "Claude can start a workflow only from a script file the session is already allowed
  to read. To run a script kept outside your working directory, add its directory with `/add-dir`
  or a Read allow rule first."
- workflows.md: "The first agent whose prompt differs from the previous run ... runs again, and so
  does every agent after it"; "Before v2.1.305, completed agents could also run again when you
  relaunched an unedited script whose `pipeline()` items or `parallel()` tasks ran more than one
  agent each."; "a session you resume with `claude --resume` can replay them ... In a session you
  start fresh, Claude has no earlier run to relaunch and starts the workflow over as a new run."

OLD (line 68 clause):
```
so set the subagent model variable in user settings to the tier below the session's as the floor; an explicit call-level model still wins, except that the workflow model variable, once set, replaces every workflow agent's model, the `/deep-research` fork's per-stage models included, so leave it unset where a tiered fork runs, and Fable never runs on a subagent unless the user asks for it.
```
NEW:
```
so set the subagent model variable in user settings to the tier below the session's as the floor, knowing it leaves the built-in Explore and Plan agents on their own models; an explicit call-level model still wins, except that the subagent force variable, once set, discards every call-level and definition model, and the workflow model variable replaces every workflow agent's model, the `/deep-research` fork's per-stage models included, so leave both unset where a tiered run matters, and Fable never runs on a subagent unless the user asks for it.
```

OLD (line 70 tail):
```
so also set one per model in user settings as the floor.
```
NEW:
```
so also set one per model in user settings as the floor, never the effort environment variable, which beats every pinned and per-call effort.
```

OLD (line 72):
```
Expect the harness to substitute and warn rather than fail, stepping a blocked call down to the newest allowed model in its family: the checker and the fork's model map make that step-down visible.
```
NEW:
```
Expect the harness to substitute rather than fail: a blocked family alias steps down to the newest allowed model in that family, any other blocked name falls back to the inherited model, and the warning shows only in an interactive session, so the checker and the fork's model map are what make the substitution visible.
```

OLD (line 73 tail):
```
that figure is a spend estimate, not the bill.
```
NEW:
```
that figure is a spend estimate, not the bill, and spend can pass it, so leave headroom.
```

OLD (line 74 clause):
```
since the Workflow tool only runs a script inside the working directory, an added directory, or the scratchpad)
```
NEW:
```
since the Workflow tool starts only a script the session can already read)
```

OLD (line 76 tail):
```
and do not start it on your own: from Claude Code 2.1.305 the extension reuses every call already made, while an older CLI re-runs its finished `pipeline()` and `parallel()` agents and so spends nearly the whole run again, and the spend is the user's to approve.
```
NEW:
```
and do not start it on your own: the extension replays finished agents only in the same session or one resumed with `claude --resume`, from Claude Code 2.1.305 it reuses each finished call up to the first whose prompt changed, while an older CLI re-runs finished `pipeline()` and `parallel()` items that ran more than one agent and so spends nearly the whole run again, and the spend is the user's to approve.
```

Receipts, `docs/handbook/claude-code.md` (the FORCE paragraph misstates where forced agents land,
and the substitution and script-location paragraphs need the narrowed facts):

OLD:
```
every one of them to inherit the session model regardless of what a script or an `Agent` call pins
```
NEW:
```
every one of them onto `CLAUDE_CODE_SUBAGENT_MODEL`, or the session model when that is unset,
regardless of what a script or an `Agent` call pins
```

OLD:
```
fork's explicit model map as what makes that request visible again.
```
NEW:
```
fork's explicit model map as what makes that request visible again. The sub-agents page,
re-read 2026-10-21, narrows the step-down: only a blocked family alias goes to the newest allowed
model in its family, any other blocked value falls back to the inherited model, and the warning
shows in interactive sessions only (https://code.claude.com/docs/en/sub-agents).
```

OLD:
```
say to copy the fork into the scratchpad and run the copy. The same run spent all 15 standard
```
NEW:
```
say to copy the fork into the scratchpad and run the copy. The workflows page, fetched
2026-10-21, states the rule as a readable file: a script outside the working directory needs its
directory added with `/add-dir` or a Read allow rule
(https://code.claude.com/docs/en/workflows). The same run spent all 15 standard
```

### A5. same file, "Make a must-hold rule a hook, fail it closed, and test it with real payloads" (main + gap, merged)

Verdict: AMEND for the floor and exit sentences. REJECT for the gap run's added MCP-matcher
sentence: it is a new directive, not a correction (the docs line is real; see PROPOSAL P5).

Evidence:
- hooks.md exit-code table: "`PreToolUse` | Yes | Blocks the tool call"; "`PermissionRequest` | No |
  Exit code 2 isn't honored for this event"; and "Yes" also for `UserPromptSubmit`, `Stop`,
  `SubagentStop`, `PostToolBatch` ("Stops the agentic loop before the next model call"),
  `PreCompact`, `PreModelSwitch`, and others. (https://code.claude.com/docs/en/hooks)
- hooks.md: "To turn hooks off for one run whatever the project's settings say, pass
  `--settings '{\"disableAllHooks\": true}'`, which takes precedence over project and local
  settings."
- cloud-environments.md: "Plugins and marketplaces declared in your repo's `.claude/settings.json` |
  No | A cloud session doesn't install the plugins a repository turns on" and "Plugins enabled only
  in your user settings | No". (https://code.claude.com/docs/en/cloud-environments)

OLD:
```
Know the floor under the hook: a deny rule is evaluated whatever the hook returns, and a bare, safe-mode, or restricted session, or an SDK run whose setting sources leave out the project, never loads project hooks, so anything that must survive needs a deny rule in managed settings too.
```
NEW:
```
Know the floor under the hook: a deny rule is evaluated whatever the hook returns, a bare, safe-mode, or restricted session, a run started with all hooks disabled, or an SDK run whose setting sources leave out the project never loads project hooks, and a cloud session loads no plugin from repo or user settings, so anything that must survive needs a deny rule in managed settings too.
```

OLD:
```
Know where that exit stops binding: only the pre-tool event reads a failing exit as a block, while the permission-request event ignores it and runs on, so a guard there has to deny through its decision object instead.
```
NEW:
```
Know where that exit stops binding: of the events around a tool call, only the pre-tool event blocks the call on a failing exit, while the permission-request event ignores it and runs on, so a guard there has to deny through its decision object instead.
```

Receipt: no handbook text quotes either sentence; no receipt edit needed.

### A6. same file, "Run adversarial review in a fresh subagent with a named lens" (gap)

Verdict: AMEND for the interrupt sentence; REJECT for the proposed opening, which restates line 95
("The harness ships a review that already runs in its own subagent over the branch diff; start
there..."). The receipt shows the original incident was a killed workflow
(`subagents/workflows/wf_*`), which native resume now covers.

Evidence: workflows.md: "For a run you stopped, ask Claude to relaunch the workflow with the same
script."; "**Completed**: returns its saved result."; "a session you resume with `claude --resume`
can replay them when you ask Claude to relaunch the workflow."
(https://code.claude.com/docs/en/workflows#resume-after-a-pause)

OLD:
```
After an interrupt, work inline, and recover a killed fan-out's finished results from its transcripts rather than re-running it.
```
NEW:
```
After an interrupt, work inline; relaunch a killed workflow with the same script in the same or a resumed session, which returns its finished agents' saved results, and recover a killed fan-out of plain agent calls from its transcripts rather than re-running it.
```

Receipt, `docs/handbook/claude-code.md`:

OLD:
```
rather than re-running it.
```
NEW:
```
rather than re-running it. The workflows page now documents the native path for a workflow:
relaunching the same script in the same or a resumed session returns completed agents' saved
results (https://code.claude.com/docs/en/workflows#resume-after-a-pause, fetched 2026-10-21).
```
(Builder note: `rather than re-running it.` occurs once in the handbook, at line 555; confirm
before applying.)

### A7. same file, "Plan when the approach is uncertain, and clear the context after two failed corrections" (main)

Verdict: REJECT. The rule's two lines already match best-practices.md ("If you could describe the
diff in one sentence, skip the plan."; "After two failed corrections, `/clear` and write a better
initial prompt"), and the receipt already cites that page. The reword only restates. Whether to
cut the duplicated lines is PROPOSAL P6.

### A8. same file, "Keep a session to one task, and start fresh rather than resume a large idle one" (gap)

Verdict: REJECT. Idle compaction is real (CHANGELOG 2.1.299: "a 200K+ token conversation left idle
for about 54 minutes is compacted before its one-hour prompt cache expires"; settings-reference.md
lists its five conditions), but the receipt already names it and records that it "prevented none
of the 12 it was eligible for in the following six days (issue #321)". Calling it the floor in the
rule would overstate it against the repo's own measurement.

### A9. same file, "Treat git state as shared across sessions" (gap)

Verdict: AMEND. Auto-fix pushes to the PR branch, which is the rule's exact hazard, and the guard
is a plugin hook that a cloud session never loads.

Evidence: claude-code-on-the-web.md: "**Clear fixes**: if Claude is confident in a fix ... Claude
makes the change, pushes it"; routines.md: "To control which branches a run can push to, use
branch protection rules or rulesets on GitHub."; cloud-environments.md plugin rows quoted in A5.

OLD:
```
Assume another checkout can move your branch mid-run and strand uncommitted work; ask before switching and commit early.
```
NEW:
```
Assume another checkout, or a cloud session such as auto-fix on the pull request, can move your branch mid-run and strand uncommitted work; ask before switching and commit early.
```

OLD:
```
If the worktree feels costly, the levers are a `.worktreeinclude` file, `worktree.baseRef`, and a `WorktreeCreate` hook recipe, in the receipt.
```
NEW:
```
If the worktree feels costly, the levers are a `.worktreeinclude` file, `worktree.baseRef`, and a `WorktreeCreate` hook recipe, in the receipt. A cloud session loads no plugin from repo or user settings, so the guard does not run there and branch protection or rulesets on the host are the floor.
```

### A10. same file, "Keep the committed settings narrow and the local settings local" (gap)

Verdict: AMEND, three passages. REJECT the strict-flag change: the SDK page says
`strictMcpConfig: true` suppresses claude.ai connectors, so "connects only what it was handed"
stands and the classifier's "the flag alone still loads them" is unsupported.

Evidence:
- permissions.md, "What runs before you trust a folder": "`permissions.allow` rules and
  `additionalDirectories` in `.claude/settings.json` | ... | Not used." in the `claude -p` or SDK,
  never-trusted column.
- sandboxing.md: "By default, if the sandbox can't start because a dependency is missing or the
  platform is unsupported, Claude Code runs commands without sandboxing. To make Claude Code exit at
  startup instead, set `sandbox.failIfUnavailable` to `true`."; "The sandbox covers shell commands
  only."; "A `denyRead` entry doesn't stop the Read tool".
- agent-sdk/claude-code-features.md (connectors row): "Set `strictMcpConfig: true`,
  `disableClaudeAiConnectors: true` in settings, o[r] ..." (the reason for the strict-flag REJECT).

OLD:
```
since a print-mode run loads them with no approval prompt.
```
NEW:
```
since a print-mode run loads them with no approval prompt, while the same run in a checkout nobody trusted ignores the committed allow list.
```

OLD:
```
only the sandbox or a hook enforces independent of command text;
```
NEW:
```
only a hook, or the sandbox where it is on and set to fail rather than run unsandboxed, enforces independent of command text;
```

OLD:
```
keep a path out of a search with a hook or the sandbox, and read tool results for it as the fallback.
```
NEW:
```
keep a path out of a built-in search with a hook and out of a shell search with a sandbox read deny, and read tool results for it as the fallback.
```

Receipt, `docs/handbook/claude-code.md`:

OLD:
```
a path out of a search with a PreToolUse hook or the sandbox, which act independent of the
command text, and treat inspecting tool results for the path as the fallback detection.
```
NEW:
```
a path out of a built-in search with a PreToolUse hook and out of a shell search with a sandbox
read deny, which act independent of the command text, since the sandbox covers shell commands only
and "A `denyRead` entry doesn't stop the Read tool" (https://code.claude.com/docs/en/sandboxing,
fetched 2026-10-21), and treat inspecting tool results for the path as the fallback detection.
```

### A11. same file, "Hand off through the repo, not a standing issue" (main)

Verdict: AMEND. "never shared" is wrong: one repo's worktrees and sessions on one machine share it.

Evidence: memory.md: "Auto memory is machine-local. All worktrees and subdirectories within the
same git repository share one auto memory directory. Files are not shared across machines or cloud
environments." and "The main conversation's auto memory isn't loaded into subagents; the exception
is a fork".

OLD:
```
Auto memory is the harness's own place for ongoing work, but it is machine-local and never shared, so it cannot be the channel the next session reads.
```
NEW:
```
Auto memory is the harness's own place for ongoing work, but it is machine-local and never reaches another machine, a cloud session, or a subagent, so it cannot be the channel the next session reads.
```

Receipts, `docs/handbook/claude-code.md`:

OLD:
```
machine-local and shared with nobody (https://code.claude.com/docs/en/memory).
```
NEW:
```
machine-local, shared by one repository's worktrees on one machine and by no other machine,
cloud session, or subagent (https://code.claude.com/docs/en/memory, re-read 2026-10-21).
```

OLD:
```
stays machine-local and unshared, so it still is not the channel (as of 2026-09-02, above).
```
NEW:
```
stays machine-local and out of cloud sessions and subagents, so it still is not the channel (as
of 2026-09-02, above).
```

### A12. same file, "Check for a peer session before driving shared external state" (gap)

Verdict: REJECT. The docs neither confirm nor contradict how a print-mode run is labeled or
whether bare mode keeps it out of the listing (agent-view.md describes only interactive and
background rows), so the reword trades one unverified claim for another; this stays open question
10. The added auto-fix and cloud-task peer sentence is folded into A9, where the hazard (a peer
moving the branch) lives.

### A13. `plugins/house/modules/testing/rules/testing.md`, "Test the guard itself, as its own CI step" (main)

Verdict: AMEND. One native test runner exists, for mods.

Evidence: `claude plugin test --help` on 2.1.306: "Runs every *.test.ts and *.test.tsx under dir,
each file in a child of this binary, in an environment like the one the mod's hooks run in."
CHANGELOG entries (for example "Changed `claude plugin test`: a failed `expect` inside a hook the
test registered ... now fails the test").

OLD:
```
yet nothing native asserts that a hook still returns its blocking decision, so the guard's own test is the only standing proof that it still fires.
```
NEW:
```
yet the only native test runner covers a mod's hooks module, so for a command hook or guard script the guard's own test is the only standing proof that it still fires.
```

Receipt, `docs/handbook/testing.md`:

OLD:
```
proves nothing about whether a guard still fires (https://code.claude.com/docs/en/hooks-guide.md).
```
NEW:
```
proves nothing about whether a guard still fires (https://code.claude.com/docs/en/hooks-guide.md). The CLI's `claude plugin test` runs a mod's own tests "in an environment like the one the mod's hooks run in" (`claude plugin test --help`, Claude Code 2.1.306), which covers a mod's hooks module, not a command hook.
```

---

## Part 2. ORCHESTRATION.md (8,450 characters before; 8,436 after B1 to B4a, measured by applying them)

All rule edits in Part 1 replace text in place: claude-code.md stays at 186 lines.
The SDK note that the coordinator relayed (strict server config and connectors) is the reason
A10 rejects the strict-flag change.

### B1. `plugins/house/orchestration/ORCHESTRATION.md`, "Roster" (gap)

Verdict: AMEND. Keep only the effort override here; the model override (FORCE) goes in B2 so it is
said once. REJECT the Workflow-tool clause: "none can spawn" already holds without it.

Evidence: sub-agents.md effort lines quoted in A4.

OLD:
```
Pinned agents ship with the plugin as `house-rules:<name>`. Each pins its model, effort, and
tools in frontmatter. A tool left off that list is absent from the agent's session, and none
lists the Agent tool, so none can spawn an agent.
```
NEW:
```
Pinned agents ship with the plugin as `house-rules:<name>`. Each pins its model, effort, and
tools in frontmatter; `CLAUDE_CODE_EFFORT_LEVEL` beats the effort pin. A tool left off that list
is absent from the agent's session, and none lists the Agent tool, so none can spawn an agent.
```

### B2. same file, "Model tier", second bullet (gap; settles open questions 3 and 4)

Verdict: AMEND. Add FORCE; keep the workflow variable, which the changelog documents (REJECT the
proposed "the docs do not list it" wording). REJECT the resolution-order rewrite: the existing
sentence is already correct.

Evidence: A4's FORCE and 2.1.296 changelog quotes.

OLD:
```
  and an `effort` (the Agent tool takes both) below the session unless the task needs the session's
  tier. Unset `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL` for `/deep-research`; it overrides named models.
```
NEW:
```
  and an `effort` below the session unless the task needs the session's tier. Unset
  `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` for any tiered run and `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL`
  for `/deep-research`; each overrides named models.
```
(The dropped "(the Agent tool takes both)" is an offset cut; claude-code.md's model rule keeps
the fact.)

### B3. same file, "Model tier", `/deep-research` bullet (gap)

Verdict: AMEND. Narrower claim is wrong; the shorter correct one also funds B1 and B2.

Evidence: workflows.md script-location line quoted in A4.

OLD:
```
  standard, deep; `args.efforts` overrides the per-stage effort); Workflow runs only scripts in
  the working directory, an added directory, or the scratchpad. If the fork is missing or drifted, first run `check-deep-research-upstream.mjs
```
NEW:
```
  standard, deep; `args.efforts` overrides the per-stage effort); Workflow runs only a script
  the session can already read. If the fork is missing or drifted, first run `check-deep-research-upstream.mjs
```

### B4. same file, "Model tier", last bullet (main, session-start item)

Verdict: AMEND. "built-in agents cannot by default" is wrong: nesting is on to three layers and
general-purpose has every tool.

Evidence: sub-agents.md: "By default, a subagent can spawn subagents of its own, up to three
layers below the main conversation."; General-purpose "**Tools**: every tool available to
subagents"; "Set `1` to turn nesting off." (https://code.claude.com/docs/en/sub-agents)

OLD:
```
- Subagents report back and never spawn subagents. Roster and built-in agents cannot by default; a
  fork or an off-roster agent with unrestricted tools can, so its brief forbids it under DO NOT.
```
NEW:
```
- Subagents report back and never spawn subagents. Roster agents cannot; any other, forks and
  built-in general-purpose included, can by default, so its brief forbids it under DO NOT.
```

### B4a. same file, "Model tier", `/deep-research` bullet, offset cut (no inventory item)

Verdict: OFFSET for B1 and B2, which add text. The pre-2.1.305 cost note is stale on current
clients and stays in full in claude-code.md's model rule (A4), so the injected file can drop it.

OLD:
```
  it costs the extra agents, or nearly the whole run before Claude Code 2.1.305); never start it unasked.
```
NEW:
```
  it costs the extra agents); never start it unasked.
```

### B5. same file, "Delegation", last bullet (gap)

Verdict: REJECT. Whether `ultracode` or `/effort ultracode` counts as the user asking, and whether
the launch prompt does not, is a policy call, not a correction (PROPOSAL P4). The added
"large-workflow warning" restates the guideline clause.

### B6. same file, "Verification" (gap)

Verdict: REJECT. A new bullet on `/code-review` and `/security-review` is new orchestration
content, and claude-code.md's review rule already starts from the bundled review. Net characters
would also grow with no offset.

---

## Part 3. Hooks, checker, scripts, skill reference

### C1. `plugins/house/hooks/no-direct-master.sh`, header (main, "PreToolUse branch guard")

Verdict: AMEND, as a comment-only edit. The classifier's "this hook adds a deny that holds in
every permission mode" is dropped: no docs line I read says a PreToolUse deny holds in bypass
mode. The header's own list of where it never runs misses the cloud case.

Evidence: worktrees.md: "While a session is isolated in a worktree, Claude Code blocks the tool
calls the checks below define." (git redirects into the main checkout among them);
permission-modes.md protected paths include `.git`, `.config/git` and `.gitconfig`, with
"`bypassPermissions` | Allowed" and "`auto` | Routed to the classifier"; cloud-environments.md
plugin rows quoted in A5.

OLD:
```
# it never runs at all, which a bare, safe or restricted session and Cowork
# do. That gap is why the floor exists.
```
NEW:
```
# it never runs at all, which a bare, safe or restricted session, Cowork, and
# a cloud session (which loads no plugin from repo or user settings) do. That
# gap is why the floor exists. Native floor beside it: the protected-path
# check prompts on a write under .git or to .gitconfig in default mode, sends
# it to the classifier in auto mode and allows it in bypass mode, and
# worktree isolation refuses git aimed at the main checkout only while the
# session is isolated; .githooks is on neither list.
```

### C2. `plugins/house/hooks/idle-cache-hold.mjs`, header (main + gap, merged)

Verdict: REJECT. Same reason as A8: the receipt names idle compaction and records it preventing
none of 12 eligible rebuilds, so a header calling it "the floor" overstates it. The hook's silence
after a compaction is already coded (`compactedAfter`); whether that fires after an idle
compaction is open question 12, untested.

### C3. `plugins/house/payload/check.mjs`, agent-config entry (main)

Verdict: AMEND, message text only (no change to what fails). The stated why is false on current
clients. The vendored copy `.house/check.mjs` carries the same line; render or sync it.

Evidence: settings.md: "`permissions.defaultMode` values `auto` and `bypassPermissions` don't take
effect from project or local settings ... Before v2.1.257, `bypassPermissions` took effect from any
file." (https://code.claude.com/docs/en/settings)

OLD:
```
why: 'opens every session in this repo with no permission prompt' },
```
NEW:
```
why: 'opens every session in this repo with no permission prompt on a Claude Code older than 2.1.257; newer clients ignore it from project settings' },
```
(Whether to keep failing on it at all is PROPOSAL P1.)

### C4. `plugins/house/scripts/cost-report.mjs`, header (gap)

Verdict: AMEND. `/usage` now names the likely cause of the current session's last cache miss,
the nearest native overlap. REJECT the contracted-price sentence: line 2 already says list price.

Evidence: prompt-caching.md: "The `Prompt cache (main)` line also names the likely cause of the
last miss when Claude Code can identify one". (https://code.claude.com/docs/en/prompt-caching)

OLD:
```
// `npx -y @rixtay/mcp-usage` for MCP servers never called, /usage for plan use.
```
NEW:
```
// `npx -y @rixtay/mcp-usage` for MCP servers never called, /usage for plan use
// and the current session's last cache miss with its likely cause.
```

### C5. `.claude/skills/adapting-to-harness-updates/references/routine-prompt.md`, opening paragraph (gap)

Verdict: AMEND in part. Add the hook fact, which is sourced. REJECT the Gmail clause: routines.md
says "Claude can use every tool from an included connector, including writes, without asking",
but mcp.md documents per-tool connector controls (`blocked`), so whether the "send tool" limit is
a real control depends on the claude.ai connector settings, which I cannot read (open question).

Evidence: cloud-environments.md plugin rows quoted in A5; routines.md branch-protection line quoted
in A9.

OLD:
```
routine and this file together.
```
NEW:
```
routine and this file together. The run loads no house plugin hooks, since a cloud session loads
no plugin from repo or user settings, so GitHub branch protection is the fence on what it pushes.
```

---

## PROPOSALS (behavior or procedure; not for a reword pass)

- P1. agent-config family: `permissions.defaultMode: bypassPermissions` in project settings is a
  no-op from Claude Code 2.1.257. Decide whether the entry keeps failing (older clients), drops to
  a warning, or goes; `auto` is ignored from project settings the same way and is not checked.
- P2. `check-deep-research-upstream.mjs` `RUN_HINT` (both `plugins/house/modules/claude-code/files/`
  and `scripts/house/` copies, line 263) repeats "the Workflow tool only runs a script inside the
  working directory, an added directory, or the scratchpad"; it feeds the fork's emitted
  description. Change it with the fork, under its tests.
- P3. Run the fork by its saved name from `~/.claude/workflows/` instead of copying to the
  scratchpad (workflows.md: saved workflows run "as `/<name>`"). Untested with `args`; the
  2026-10-04 receipt records a refusal on that path by `scriptPath`.
- P4. Decide whether `ultracode` (keyword or effort level) counts as the user asking for a
  workflow under ORCHESTRATION's "Workflows run only when the user asks".
- P5. A hook-matcher line for MCP tools: hooks.md says "a matcher like `mcp__memory` ... matches
  no tool" and plugin servers are `mcp__plugin_<plugin>_<server>__<tool>`. The guard already
  matches every `mcp__*` tool, so this is guidance for adopters' own hooks, if wanted.
- P6. Cut claude-code.md lines 110 and 111 (planning and the two-corrections clear) as duplicates
  of best-practices, keeping the re-read line; it would free two lines of the 200-line cap.

## Open questions

Settled:
- Q3 `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL`: real, CHANGELOG 2.1.296; absent from the docs pages.
- Q4 `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`: documented; added to claude-code.md (A4) and
  ORCHESTRATION (B2). With the subagent model variable also set, forced agents land on that model,
  not the session's, so the handbook FORCE paragraph is corrected (A4 receipt).
- Q5 skill name: the docs say `name` sets the command; corrected (A2).
- Q6 native resume warning: real, CHANGELOG 2.1.304; already cited.

Not settled:
- Q10 print-mode label in the agent listing and bare-mode exclusion: undocumented; needs a probe.
- Q12 whether idle-cache-hold stays silent after an idle compaction: coded, not tested.
- Whether the routine's Gmail connector has its non-send tools `blocked` in claude.ai.
- Whether a PreToolUse deny holds in bypassPermissions mode: no docs line found; C1 omits it.
