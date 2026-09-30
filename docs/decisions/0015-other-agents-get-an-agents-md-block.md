---
status: accepted
date: 2026-09-29
---

# Give Codex and Gemini CLI a house-managed block in AGENTS.md

## Context and problem statement

house renders its rules into `.claude/rules/house/`, where Claude Code loads each one when a
session reads a file its `paths:` globs match (ADR 0007). Codex and Gemini CLI never look there.
Codex reads `AGENTS.md` files from the repo root down to the working directory, up to a combined
32 KiB by default; Gemini CLI reads `GEMINI.md` unless its settings name another file. A repo
whose people also work in those agents gets none of the rules in them. This record decides how
house reaches them without giving up what the Claude Code path already has.

## Decision drivers

* The rule text stays in one place, the vendored files, so there is one copy to lock, check, and
  update.
* Whatever house writes for another agent has to fit that agent's read limit with room left for
  the repo's own instructions.
* An adopter's own `AGENTS.md` text is theirs: house must not overwrite it, and must not leave
  it somewhere the agent does not read.
* A hand edit to what house wrote shows up the way it does for every other managed file.

## Considered options

* **A. Copy every enabled rule's full text into `AGENTS.md`.**
* **B. Own `AGENTS.md` wholly, the way render owns `.claude/rules/house/`.**
* **C. Write a nested `AGENTS.md` into each directory a module's globs cover.**
* **D. Write a house-managed block inside the root `AGENTS.md`: a routing table naming each
  module's globs, its rule file, and its rule headings, with everything outside the markers left
  to the adopter.**

## Decision outcome

Chosen option: "D: a managed block of routing table and headings", because it is the only option
that fits Codex's default read cap, keeps one copy of the rule text, and leaves the adopter's own
`AGENTS.md` where Codex reads it.

A new `house.json` key, `targets`, lists the agents a repo renders for: `claude-code`, `codex`,
`gemini`. Absent means `["claude-code"]`, and `claude-code` must be present, because the package
itself is delivered as a Claude Code plugin. With `codex` or `gemini` listed, render writes the
block and locks its body; dropping both removes it. For `gemini`, render also scaffolds a
`GEMINI.md` importing `@AGENTS.md` unless Gemini CLI is already pointed at `AGENTS.md`.

### Consequences

* Good, because the block is a few KiB, against about 120 KB for the rule text of all nine
  modules (82 KB for the five this repo enables), so Codex reads all of it with room to spare.
* Good, because the adopter's text above and below the markers is preserved byte for byte and
  never hashed, so a shared `AGENTS.md` stays shared.
* Good, because tamper, `--force-managed`, and the refusal on a hand edit work for the block the
  way they work for a managed file.
* Bad, because another agent gets headings and a pointer, not the rule, and has to open the rule
  file itself. Nothing makes it do so.
* Bad, because the two marker lines are reserved: render does not parse Markdown to tell a
  quoted marker from a real one (three review rounds each found a new fence edge in that
  parser), so any marker line outside one well-formed block makes render refuse and name the
  line. An adopter cannot quote the markers in their own `AGENTS.md`.
* Bad, because load is unverifiable outside Claude Code: neither Codex nor Gemini CLI fires an
  event like InstructionsLoaded, so `house doctor` can only say `unverified` for them.
* Bad, because neither agent gets a session-time guard yet. The git-hook floor (ADR 0013) and a
  remote ruleset are what hold the branch policy for them.

### Confirmation

`node .house/check.mjs`: the manifest family validates `targets`; tamper reports a hand edit
inside the block, a missing block, or broken markers, and never reads outside them; the guard
family prints one verdict line per declared target and fails a missing block or an unwired
Gemini CLI; lengths warns when the root `AGENTS.md` passes Codex's default cap. The cases live
in `tests/cli-house.test.mjs` and `tests/check/`.

## Pros and cons of the options

### A. Copy the full rules

* Good, because another agent would read the rule itself, not a pointer to it.
* Bad, because the nine modules' rule text is about 120 KB, nearly four times Codex's 32 KiB
  default, and even this repo's five come to 82 KB, so most of it would be silently dropped.
* Bad, because the text would exist twice, and the second copy is one more thing to drift.

### B. Own AGENTS.md wholly

* Good, because tamper would work on the whole file with no marker parsing.
* Bad, because an adopter's shared instructions would have nowhere Codex reads: moving them out
  of `AGENTS.md` takes them out of Codex's sight.

### C. Nested AGENTS.md per directory

* Good, because Codex would load a module's pointer only in the directories it covers, close to
  what `paths:` does for Claude Code.
* Bad, because it scatters generated files through the adopter's source tree, one per covered
  directory, and a glob like `**/*.sql` has no single directory to hold it.

### D. A managed block in the root AGENTS.md

* Good, because it is small, reversible, and keeps one copy of the rule text.
* Bad, because the routing depends on the agent following an instruction to read a file.

## More information

Follow-ups, not decided here: phase 2 gives Codex and Gemini CLI native guard hooks where their
harnesses offer them; phase 3 rewords rule text that names Claude Code features so it reads
neutrally to another agent.

Receipts: https://agents.md for the format;
https://code.claude.com/docs/en/memory#agents-md for Claude Code, which reads `CLAUDE.md` and not
`AGENTS.md`; https://learn.chatgpt.com/docs/agent-configuration/agents-md for Codex's discovery
order and `project_doc_max_bytes`; https://geminicli.com/docs/cli/gemini-md/ for `GEMINI.md`,
`@file` imports, and `context.fileName`. [ADR 0007](0007-path-scoped-rules-load-on-read.md) is the
scoped-loading premise the block's "Applies to" lines mirror, and
[ADR 0013](0013-branch-policy-enforced-by-git-hooks-not-command-text.md) the floor the other
agents rely on.
