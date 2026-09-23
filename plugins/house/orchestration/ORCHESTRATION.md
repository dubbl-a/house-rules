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

- Enter a worktree before the first edit or branch: the harness's worktree tool, or
  `git worktree add -b <branch> <path> origin/<default>`. The main checkout is for reading,
  merging, and cleanup.
- Never `git checkout -b` or `git switch -c` in the main checkout, not even for one commit.
- A plan's first step is the worktree.

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

Loop: orchestrate, builder, refuter (when sent), orchestrate.

## Model tier

- The ladder, by capability and cost together: Fable, Opus, Sonnet, Haiku. Opus is the default
  session for most work; reach for Fable for demanding reasoning, long-horizon agentic work,
  or where Opus at higher effort still falls short.
- A subagent, teammate, or workflow agent runs below the session by default unless the call says
  otherwise. Roster agents are pinned; anything off-roster gets an explicit `model` and effort.
- Fable never runs on a subagent unless the user asks for it.
- Judgment runs on Opus even on an Opus session: the refuter, the debugger, and any adjudication
  or synthesis whose verdict decides, because the verdict is the product and Opus is moderately
  priced. A hard multi-file or agentic build may go to Opus through an explicit `model` on the
  builder call; routine and mechanical work stays on Sonnet or Haiku.
- Match the tier to the task: locations and receipt checks on Haiku, code and prose on Sonnet,
  judgment on Opus.
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
- Send a refuter when a wrong change would cost something the gates cannot catch: logic, a guard
  or hook, facts or numbers someone will act on, or text many repos follow. For a small text or
  mechanical change a gate covers, reading the diff yourself is usually enough. Judgment, not a
  category.
- Review until a round returns no must-fix. Each later round checks only the last round's fixes
  and what they touched. The verdict decides, not a count.
- Before a third round, tell the user what each round found, what the next checks, and why the
  rounds are converging. Hand it to the user when must-fixes land in the last round's own fixes or
  one defect class keeps returning. The user can stop or extend review at any point.
- Each agent gets its own source of truth. Two agents reading one file is one agent.
- Anything settleable by running it gets run.
- Never accept "done" or "tests pass". The refuter reruns them; when no refuter is sent, the
  session reruns them.
- Run `git status --short` before and after a refuter or debugger. If the output differs, the
  agent edited files. Discard its verdict.
- Say which findings came from an agent, which the session confirmed, and which nobody tested.
- Every launched agent must have a recorded result. An absent result is UNKNOWN, not failed and
  not finished.
