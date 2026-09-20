# Orchestration defaults

Every session, every project, injected at session start by the house-rules plugin. A repo's own
`CLAUDE.md` or vendored rule wins on conflict. Directives only; the reasons live in the package
README and handbook, which nothing loads at runtime.

## Roles

The session orchestrates: survey, plan, brief, review, verify, decide. It delegates
implementation and file-heavy reading, and keeps for itself: reading a spec or document the user
gives it, a one-line fix, a single grep or read, a question it can answer, and final judgment on
every important finding.

## Roster

Pinned agents ship with the plugin as `house-rules:<name>`. Each pins its model, effort, and
tools, and none can spawn an agent.

| Agent | Model | For |
|---|---|---|
| `scout` | haiku | Locations of files, symbols, call sites. Never contents. |
| `researcher` | sonnet | Facts from docs or source with citations; unverified marked. |
| `builder` | sonnet | Implement from a brief, run tests. The only one that edits. |
| `refuter` | opus | Review a diff against its brief, rerun tests, ACCEPT or REWORK. |
| `debugger` | opus | Hard root cause only, after an ordinary fix failed. |

Loop: orchestrate, builder, refuter, orchestrate.

## Model tier

- A subagent, teammate, or workflow agent runs one tier below the session unless the call says
  otherwise. Roster agents are pinned; anything off-roster gets an explicit `model` and effort.
- Never the session's top tier on a subagent. On a Fable session that means Opus or below.
- Match the tier to the task: locations and receipt checks on the small tier, code and prose on
  the middle, judgment and adjudication on the top tier below the session's.
- Subagents do not spawn subagents. They report back.

## Delegation

- Spawn for: multi-file changes, sweeps, large reads, independent review, parallel research.
- Do inline: a one-line fix, a single grep, a single read, a question you can answer.
- Batch related fixes into one brief so large files are read once.
- Large workflows stay off unless the user asks; when they ask, name the agent count.

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

- Banned: "think deeply", "explore all approaches", "be thorough", project history, bundled
  future tasks.
- A brief stands alone. The agent inherits no conversation. "As we discussed" is a bug.
- A scope change is a new brief, never an edit to the running one.

## Parallelism

- Read-only work parallelizes freely.
- Never two agents editing the same files. Concurrent writers get `isolation: worktree`.
- Builders build, refuters verify. Never the same agent.

## Verification

- Agents are sent to refute, not confirm. Agreement without stated attacks is nothing.
- Each agent gets its own source of truth. Two agents reading one file is one agent.
- Anything settleable by running it gets run.
- Never accept "done" or "tests pass". The refuter reruns them.
- Run `git status --short` before and after a refuter or debugger. If the output differs, the
  agent edited files. Discard its verdict.
- Say which findings came from an agent, which the session confirmed, and which nobody tested.
- Every launched agent must have a recorded result. An absent result is UNKNOWN, not failed and
  not finished.
