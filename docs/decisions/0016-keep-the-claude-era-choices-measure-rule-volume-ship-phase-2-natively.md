---
status: accepted
date: 2026-09-30
---

# Keep the Claude-era choices, measure rule volume, and ship phase 2 as a Codex plugin and a Gemini extension

## Context and problem statement

Issue #100 reopened five choices made for a Claude-only world, now that Codex and Gemini CLI are
render targets ([ADR 0015](0015-other-agents-get-an-agents-md-block.md)): how much rule text
there is, where the vendored copy lives, what the `Anchor:` lines say, how heavy the guard is,
and how phase 2 of #56 delivers to the other agents. Each still works for Claude Code and each
costs something for the others. This record decides all five, with the reason and the event that
would reopen each.

## Decision drivers

* ADR 0015 found 82 to 120 KB of rule text against Codex's 32 KiB default cap, so volume is a
  real cost for another agent and not a hypothetical one.
* The 2026-09-29 survey in #100 (superpowers, spec-kit, agent-skills, OpenSpec, BMAD, wshobson,
  vercel-labs/skills) found no package that ships an always-loaded rules blob, and two delivery
  models: an installer rendering one source per agent, or committed per-host plugin manifests over
  a shared core.
* A change that touches every adopter needs a benefit an adopter can see; a speculative one does
  not qualify.
* A decision that rests on "which rules does a session get wrong without" needs a measurement,
  not an argument.

## Considered options

* **1. Rule volume.** Shrink the rule set by argument until every agent gets full text, or keep
  it and measure.
* **2. Rule location.** Move the canonical vendored copy to a neutral path such as
  `.house/rules/`, or keep `.claude/rules/house/`.
* **3. Anchor lines.** Move native-floor statements out of the rule body into the handbook or a
  per-target note, or keep them.
* **4. Guard weight.** Shrink the PreToolUse hook to floor-integrity checks and port that to
  Codex and Gemini, or leave it as it is.
* **5. Delivery model.** Render per-repo hook files for each agent, or ship a Codex plugin and a
  Gemini extension over the shared core.

## Decision outcome

**1. Rule volume: not shrunk by argument.** Codex and Gemini keep getting the heading index from
ADR 0015. A follow-up issue (#102) will measure which rules a session gets wrong without them, using the
eval tier under `plugins/house/evals/` with ablation pairs whose arms differ in one rule, and any
trim follows that evidence. Reason: a cut chosen by argument loses rules nobody has shown to be
idle, and the only ones cut would be the ones someone happened to doubt. Revisit trigger: the
measurement lands.

**2. Rule location: `.claude/rules/house/` stays the one vendored copy, and ADR 0001 holds.** A
neutral path buys nothing until another target reads path-scoped rule files, and a migration
touches every adopter for that nothing. Revisit trigger: a target that reads path-scoped files
natively is enabled.

**3. Anchor lines: kept, including the Claude-specific native-floor statements.** Other agents
reach a rule body only by following a pointer from the AGENTS.md index, and the handbook can carry
a per-target note. Reason: the statements are the audited record of what the harness already
guarantees, and a session that reads them is told where the rule's enforcement ends. Revisit
trigger: a Codex or Gemini session is observed acting on a Claude-only floor as if it were its
own.

**4. Guard weight: the PreToolUse hook is neither shrunk nor ported now.** Since ADR 0013 the
git-hook floor plus the GitHub ruleset hold the branch policy for any agent, and the text-scan
class is closed by decision (issue #58, PR #66). Reason: shrinking the hook reopens a class
already closed, and porting it multiplies a surface whose other agents are already covered by
the floor. Revisit trigger: phase 2 ships and a Codex or Gemini hook becomes the only thing
between a session and the floor.

**5. Delivery model: phase 2 of #56 (issue #103) ships a Codex plugin and a Gemini extension over the shared
core**, the superpowers pattern from the #100 survey, delivering floor arming and skills natively
instead of rendering hook files into each repo. Rules stay rules; ADR 0014 (skills with paths are
a declined delivery route) is not reopened. Reason: it is how the Claude side already delivers,
and it keeps the adopter's tree free of generated hook files. Revisit trigger: a target with no
plugin or extension mechanism is added.

### Consequences

* Good, because phase 2 (#103) is briefable: its shape (plugin and extension over the shared core, floor
  arming and skills) is fixed before anyone writes it.
* Good, because no adopter migrates: the vendored path, the rule text, and the guard stay where
  they are.
* Bad, because rule volume stays a Codex cost until the measurement (#102) lands; the heading index
  carries it and nothing makes the agent open a rule.
* Bad, because `Anchor:` lines naming Claude Code concepts read as foreign to another agent.

### Confirmation

Decisions 2 to 5 are confirmed by the absence of change: `node .house/check.mjs` and the
existing guard and render tests keep passing with the paths and hooks as they are. Decision 1 is
confirmed when the follow-up issue's ablation run is filed and this record is revisited.

## Pros and cons of the options

### 1. Shrink by argument

* Good, because every agent could get full text if the set fell under the cap.
* Bad, because no one has shown which rules are idle; the cut would rest on opinion.

### 2. Neutral vendored path

* Good, because the agents would be peers on disk.
* Bad, because it means a second copy or a migration of every adopter, for a benefit no target
  can use yet.

### 3. Move native-floor statements out

* Good, because the rule body would read neutrally to every agent.
* Bad, because it separates each rule from the evidence of where its enforcement ends.

### 4. Shrink and port the guard

* Good, because a smaller hook is cheaper to port.
* Bad, because the floor and the ruleset already hold the policy, and both Codex and Gemini hook
  systems fail open on timeout, so a port adds surface without adding a floor.

### 5. Render per-repo hook files

* Good, because it extends what render already does.
* Bad, because it writes generated hook files into every adopter's tree, where a plugin or
  extension delivers the same natively.

## More information

Receipts: issue #100 and its 2026-09-29 survey; ADR 0015's finding that 82 to 120 KB of rule text
exceeds Codex's 32 KiB cap. [ADR 0001](0001-vendor-rules-over-imports-symlinks-and-replay.md)
is the vendoring decision kept by 2,
[ADR 0013](0013-branch-policy-enforced-by-git-hooks-not-command-text.md) the floor behind 4, and
[ADR 0014](0014-plugin-skills-with-paths-are-a-declined-delivery-route.md) the route 5 leaves
closed.
