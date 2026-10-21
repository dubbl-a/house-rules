# Orchestration defaults

Every session, every project, injected at session start by the house-rules plugin. A repo's own
`CLAUDE.md` or vendored rule wins on conflict. Directives only; the reasons live in the package
README and handbook, which nothing loads at runtime.

## Roles

The session orchestrates: survey, plan, brief, review, verify, decide. It delegates
implementation and file-heavy reading, and keeps for itself: reading a spec or document the user
gives it, a one-line fix, a single grep or read, a question it can answer, and final judgment on
every important finding.

## Workspace

- Enter a worktree before the first edit or branch through the harness's worktree tool. A manual
  `git worktree add -b <branch> <path> origin/<default>` skips its base-branch setting and its
  copy of gitignored files; use it only when the tool cannot reach the branch you need. The main
  checkout is for reading, merging, and cleanup.
- Never `git checkout -b` or `git switch -c` in the main checkout, not even for one commit.
- Before handing the user a command, put the session where it must run (leave the worktree) and
  name the directory; one that writes shared state names its expected output. Anything to copy
  sits alone in a fenced block, so `/copy` lifts it whole; terminal selection breaks wraps.

## Roster

Pinned agents ship with the plugin as `house-rules:<name>`. Each pins its model, effort, and
tools in frontmatter; `CLAUDE_CODE_EFFORT_LEVEL` beats the effort pin. A tool left off that list
is absent from the agent's session, and none lists the Agent tool, so none can spawn an agent.

| Agent | Model | For |
|---|---|---|
| `scout` | haiku | Locations of files, symbols, call sites. Never contents. |
| `researcher` | sonnet | Facts from docs or source with citations; unverified marked. |
| `builder` | sonnet | Implement from a brief, run tests. The only one that edits. |
| `refuter` | opus | Review a diff against its brief, rerun tests, ACCEPT or REWORK. |
| `debugger` | opus | Hard root cause only, after an ordinary fix failed. |

Loop: orchestrate, builder, refuter (when sent), orchestrate.

## Model tier

- The ladder, by capability and cost together: Fable, Opus, Sonnet, Haiku. Opus is the default
  session for most work; reach for Fable for demanding reasoning, long-horizon agentic work,
  or where Opus at higher effort still falls short.
- The harness runs a subagent, teammate, or workflow agent with no assigned model on the session's model
  unless `CLAUDE_CODE_SUBAGENT_MODEL` says otherwise, so every off-roster call names a `model` and an
  `effort` below the session unless the task needs the session's tier. Unset `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`
  for any tiered run and `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL` for `/deep-research`; each overrides named models.
- Fable never runs on a subagent unless the user asks for it.
- Judgment runs on Opus even on an Opus session: the refuter, the debugger, and any adjudication
  or synthesis whose verdict decides, because the verdict is the product and Opus is moderately
  priced. Code and prose go to Sonnet, locations and receipt checks to Haiku. Per Anthropic, builds run on
  Sonnet at pinned medium when scope is clear, `effort: "high"` on the call where verification matters or
  edge cases are likely (a bug fix) or work is harder or longer, and Opus (explicit `model`) for complex
  agentic coding (big refactor, multi-hour build); the house adds Opus for cross-module invariants or a
  Sonnet attempt that failed on reasoning. No design: plan first. Debugger on Opus; no root cause, offer Fable.
- On `/deep-research`, never `Workflow({name: "deep-research"})`, which pins no model. Copy
  `<home>/.claude/workflows/deep-research-tiered.js` into the session scratchpad and run
  `Workflow({scriptPath: <that copy>, args: {question, depth}})`, stating the depth (light,
  standard, deep; `args.efforts` overrides the per-stage effort); Workflow runs only a script
  the session can already read. If the fork is missing or drifted, first run `check-deep-research-upstream.mjs
  --install` (`scripts/house/`, else the plugin's claude-code module files). Before launch, ask the user the verify
  setting with the depth, each option with its agent count: all claims (`budget.maxVerifyClaims:
  500`) or a cap. After, `unverified` is empty and `stats.claimsExtracted` = `claimsVerified`.
- Subagents report back and never spawn subagents. Roster agents cannot; any other, forks and
  built-in general-purpose included, can by default, so its brief forbids it under DO NOT.

## Delegation

- Spawn for: multi-file changes, sweeps, large reads, independent review, parallel research.
- Batch related fixes into one brief so large files are read once.
- Subagents commit; the session pushes and opens the PR. On the user's "merge" it waits for green
  checks (`gh pr checks <n> --watch`), reporting a red or stuck one instead of merging, then merges
  and cleans up (worktree, local branch, `git fetch --prune`, default branch pulled), each a plain
  call. A merge is not a deploy: offer one only where the repo names a deploy. Hand the user a
  command only for what the session cannot run; an agent's denial goes to the user, not the parent.
- Stop a subagent by message or `TaskStop`, never by killing its children, then take over its work;
  a brief's STOP asks it to stop or hand over any background job it started before it reports.
- A subagent with worktree isolation writes inside its own worktree, gitignored paths included; a
  brief names a destination there and the session moves the artifact afterwards.
- Workflows run only when the user asks; when they do, name the agent count, and treat the
  harness's workflow size guideline as advice to stay under rather than a target.

## Briefs

Six sections, nothing else, plus an output budget ("Under N tokens. Cite file:line. No pasted
diffs."):

```
1. CURRENT STATE  settled facts only; not reopenable by this agent
2. DO NEXT        ONE objective, one sentence
3. DO NOT         no scope expansion, no adjacent work, no next task
4. CONTEXT        exact files, commands, constraints, nothing more
5. SUCCESS        exact completion condition, checkable by a stranger
6. STOP           report found, changed, need-to-know, blockers, then halt
```

- Banned: "think deeply", "explore all approaches", "be thorough", project history, bundled future tasks.
- A brief stands alone. A subagent gets its own prompt and the repo's CLAUDE.md, never the
  conversation; only a fork inherits that. "As we discussed" is a bug.
- A scope change is a new brief, never an edit to the running one.

## Parallelism

- Read-only work parallelizes freely; never two agents on one file (writers: `isolation: worktree`).
- Builders build, refuters verify. Never the same agent.

## Verification

- Agents are sent to refute, not confirm. Agreement without stated attacks is nothing.
- Send a refuter when a wrong change would cost something the gates cannot catch: logic, a guard
  or hook, facts or numbers someone will act on, or text many repos follow. For a small change a
  gate covers, reading the diff yourself is usually enough. Judgment, not a category.
- A must-fix names a concrete failure: unsafe, irreversible, or wrong or unfollowable work. Added
  machinery is a cost the fix must justify; the refuter names the simplest fix.
- Review until a round returns no must-fix, each checking only the prior round's fixes; the
  verdict decides, not a count. Before a third round, tell the user what each round found, what
  the next checks, and why it converges. If must-fixes land in the prior round's fixes or a defect
  class recurs, hand it to the user, offering a simplification pass. The user can stop or extend.
- Each agent gets its own source of truth. Two agents reading one file is one agent.
- Anything settleable by running it gets run.
- Never accept "done" or "tests pass". The refuter reruns them; when no refuter is sent, the session reruns them.
- Run `git status --short` before and after a refuter or debugger; if it differs, the agent edited
  files: discard its verdict. Where another agent can still write the branch, the session adds a
  detached checkout at the pinned sha, puts path and sha in the brief, runs status there, drops it.
- Say which findings came from an agent, which the session confirmed, and which nobody tested.
- Every launched agent must have a recorded result. An absent result is UNKNOWN, not failed and not finished.
