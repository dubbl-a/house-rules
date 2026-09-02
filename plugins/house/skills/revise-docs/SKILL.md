---
name: revise-docs
description: Routes a session's learning to the matching rule file and a dated incident to the repo's archive, never the root file; triggers on "revise the docs", "capture this learning", "where does this go".
---

# Revise docs

The official instruction-file management plugin ships a revise command that captures a session's
learning by appending it to the root instruction file. That is the exact behavior this skill
exists to replace. A root file that only grows stops getting read to the end, and a learning
bolted onto it is rarely the fact a future session needed at the moment it needed it. This skill
keeps the useful half of that plugin, auditing a claim against the codebase before writing it,
and drops the append half in favor of routing.

## Default path

1. Name the thing this session produced that is worth keeping: a correction, a decided
   convention, a bug and its fix, a measured result, a decision between two approaches.
2. Classify it as a **rule** or an **incident**.
   - A rule holds every time a matching situation recurs. State it once and it should still be
     true after the next refactor.
   - An incident happened once, on a date, with a name or a measured number attached. It is
     evidence for why a rule exists, not the rule itself.
3. Route a rule to its matching rule file.
   - Search existing rule files by scope and heading, not by filename alone. Open the one whose
     `paths:` already covers the surface the learning touches.
   - If one covers it, add a new heading or fold the point into an existing one. Follow the rule
     shape: an imperative heading that is itself the rule, one clause of why, an `Anchor:` line
     naming what enforces it, a `Receipts:` line pointing at the archive entry, and keep the file
     ending in `## Don't`.
   - Verify before writing. Check that every token in the `Anchor:` line, every path, every
     script name, actually resolves in the repo right now. This is the audit habit borrowed from
     the plugin above: never write a claim you have not checked.
   - If nothing covers it, say so and propose a new rule file or a wider scope for an existing
     one. Do not drop the point into the nearest file just because it is close.
4. Route an incident to the repo's archive tier.
   - The archive is whatever the repo calls its dated-evidence doc: a handbook chapter, a
     design-history file, a postmortem log. Write the date, the name, the measured number there,
     titled as a one-line lesson so the entry reads as a claim rather than a filename.
   - Point the rule file at the entry with its quoted heading. Do not restate the incident's
     specifics inside rule prose; a date or a number in a rule is history wearing a rule's
     clothes.
   - If the repo has no archive yet, say so and propose starting one. Do not fold the incident
     into a rule file or the root file for lack of a home.
5. Never touch the root instruction file. If neither a rule file nor the archive fits, that is a
   sign the fact is not durable enough to keep, not a reason to default it into the root file.
   Say that plainly and stop.
6. Show the edit before saving it. Print the heading and paragraph you propose, or a diff
   against the existing file, and wait for confirmation unless you were told plainly to just make
   the change.

## When the match is a managed house rule

If the file that already covers the topic is a vendored house rule (carries the managed-file
header, lives under `.claude/rules/house/**`), do not edit it in this repo. A local edit to a
managed file is silently overwritten by the next `/house-rules:sync` run, and that silent loss is
exactly what house exists to prevent.

Propose the change upstream instead. Draft the same heading and paragraph, then say to open it as
a change in the house repo rather than this one. If the point is genuinely specific to this repo
and not a fleet-wide rule, record it as a deviation in `house.json` instead of forking the
managed file. Either path keeps the managed file in sync; editing it in place does not.

## Escape hatches

- **The learning contradicts an existing rule.** Say so plainly, quote the existing heading, and
  ask which one wins before writing anything. Don't silently overwrite one rule with another.
- **The learning is a repo-specific one-off with no rule shape**, a workaround for a vendor bug,
  a note that only matters once. Route it to the archive as an incident instead of cluttering a
  rule file with something no future session needs to obey.
- **You are unsure whether something is a rule or an incident.** Bias toward the archive. A
  wrongly-archived rule is a heading someone can promote later; a wrongly-ruled incident becomes
  stale prose that nothing flags.
- **The repo has no rule files and no archive at all.** Say that plainly and stop rather than
  originating either one from inside this skill. That is `/house-rules:bootstrap`'s job, not this one's.

## Don't

- Don't append to the root instruction file. That is the exact behavior the official
  instruction-file plugin's revise command performs, and the reason this skill exists instead.
- Don't write a rule sentence whose anchor you have not checked against the codebase.
- Don't restate an incident's date, name, or number inside rule prose; point at the archive.
- Don't edit a vendored house rule file in place. Propose it upstream or record a deviation.
- Don't save an edit the person has not seen, unless they told you plainly to just make it.
- Don't invent a rule file or an archive when the repo has neither.
