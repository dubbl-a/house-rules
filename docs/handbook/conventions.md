# Conventions: the receipts

## Why this exists

This chapter is not a domain module like `docs` or `engineering`; it documents the package's
own documentation conventions, the shape every consuming repo's rule files, decision records,
deviation ledgers, and handoff issues take once house is adopted. It is the receipts tier for
those shapes the same way `docs/handbook/docs.md` is the receipts tier for the docs module's
rules: dates, names, and PR numbers included, because unlike a rule file this one is never
loaded into a session and has nothing to lose by carrying them.

## The two tiers: rule and receipt

A vendored rule file lives at `plugins/house/modules/<module>/rules/<file>.md`, opens with the
comment "house source rule file; vendored into consuming repos by `/house-rules:sync`", and lands in a
consuming repo's `.claude/rules/`, where Claude Code's native `paths:` frontmatter mechanism
loads it into context on a matching file read. It may hold an imperative claim, a one-clause
why, an `Anchor:` line, and a `Receipts:` pointer, and nothing else: `check:house`'s `shape`
family fails a rule file on sight of a date-like token or a percent-like token anywhere in its
prose.

Native floor, as of 2026-09-02: a plugin has no native component that ships rule files or
instruction content as project context (https://code.claude.com/docs/en/plugins-reference), so
house renders its rules into the project rules directory, where the harness loads them like any
other project rule and scopes them by their paths frontmatter.

A handbook chapter lives at `docs/handbook/<module>.md`, is never vendored and never loaded into
any consuming repo's context, and stays in this repo only. It carries what a rule file cannot:
the dates, names, PR numbers, and measured figures the rule's claim was built from, quoted
precedent from the source repos, and an honest "No incident recorded" where reasoning stands in
for one.

The reason dates live here and nowhere else: a rule that needs a date, a person's name, or a
measured number to state itself is history wearing a rule's clothes, so the evidence moves to
the chapter and the rule keeps only the part that has to survive the next change. Official
guidance backs the same instinct from the outside: "ban time-sensitive statements from docs; put
superseded guidance in an 'Old patterns' section," because dated conditionals silently become
wrong (platform.claude.com's skill best-practices doc). The one exception travels with the
figure, not the rule: a pinned figure carries its own as-of date because "its as-of date is part
of the claim," never generalized away.

## The rule shape

Every rule states its claim, mechanism, why, and receipt, in that order: an imperative heading
that is itself the rule, a one-clause why beneath it, an `Anchor:` line naming what enforces the
rule (a check, a hook, a wired script, or `none (because ...)`, capped at three bare `none`s per
file), and a `Receipts:` line pointing at this handbook's matching heading, cited by its quoted
text rather than a line number so the pointer survives a reorder. repo-d's independent
formulation bakes the same four parts into one bullet instead of a separate pointer: claim,
mechanism, why, and the hazard it prevents. Every rule file closes with a `## Don't` section
restating its rules as prohibitions. `check:house`'s `shape` family enforces the imperative
heading, the `Anchor:` line, the `## Don't` section, and the ban on an em dash anywhere in rule
or body prose.

## The superseded-banner form

Two kinds of point-in-time document get superseded rather than deleted, and each has its own
banner.

A decision record under `docs/decisions/` follows the MADR 4.0.0 template with zero-padded
numbers and bidirectional links. Superseding one never edits its text; it gains a banner at the
top instead, quoted verbatim from the template: "Superseded by [0NNN](...) on YYYY-MM-DD.
Retained because the reasoning still explains why the earlier shape was chosen." The record's
own frontmatter status line carries the same fact as `superseded by [0NNN](0NNN-title.md)`.

A design doc gets the same treatment on a looser template. The precedent named is repo-d's
`docs/cloud-native-architecture.md` (310 lines), headed with a dated banner, quoted verbatim:
"Partially superseded (July 2026)," naming exactly which parts the implementation diverged from
rather than the whole document. Both forms answer to one rule, stated once by external guidance
and shared by both: "never edit a decided ADR; supersede it with a new one and mark the old
`superseded`" (adr.github.io, widely-held).

## The deviations-ledger form

`house.json`'s `deviations` array is the ledger of record: one entry per declination, each
carrying `kind` (`disabled-module`, `branch-policy`, `carve-out`, `unmanaged-file`,
`coload-ceiling`, or `other`), an optional `module`, `what`, `why`, and `decided` (a plain
`YYYY-MM-DD`). Enabling a default-off module is configuration and needs no entry; disabling a
default-on module, choosing a `branchPolicy` other than `pr`, adding a `carveOuts` glob, or
raising `maxCoLoadLines` above the checker's default each require one, per the schema's own
description. The `coload-ceiling` entry carries the configured number as an integer `ceiling`,
compared exactly and never read out of prose, so a later silent bump invalidates the old entry
the way a `ratchetRaises` row pins its `to`.

The ledger is mirrored, never restated independently, in the consuming repo's own `CLAUDE.md`
under a `## Deviations from house` section. The skeleton ships the exact prose a fresh adoption
starts from: "None yet. When this repo declines a house default (a disabled module, a non-`pr`
branch policy, a carve-out, a raised co-load ceiling), record it here and in `house.json`'s
`deviations` array, dated, with why. This section mirrors that ledger; `house.json` is the
source of truth." The precedent
this form generalizes from is repo-e's own "Deliberate deviations from repo-a"
section, a dated, per-repo record of what it declines from its upstream and why, named in the
prior-art survey as the mechanism that makes a common package survivable.

## The session-carryover issue form

The `handoff` skill writes a fixed-shape GitHub issue at the end of a session, titled `Session
carryover <date>: <one-line state>`. Its body, in order: a staleness disclaimer that also
supersedes the previous carryover issue by number ("Supersedes #<N>. Verify anything here before
relying on it, this is a snapshot and the repo moves"), the tree state (exact SHA, working-tree
cleanliness, worktree count, open PR count), every PR that shipped since the previous issue,
one headline finding with its evidence, an ordered next-cycle list with the reasoning for each
item, and two lists that are never merged into one: deferred by decision (skipped on purpose,
with the reason) and simply not done (ran out of time or scope, no reason beyond that). Gate
verdicts and count tables are deliberately NOT in the form: both re-run in seconds against the
recorded SHA, a re-run number cannot be fabricated the way a copied one can, and the issues that
carried them went stale on those very sections. Opening the new issue closes the superseded one
with a "superseded by" comment, so exactly one carryover is open at any time; the chain stays
walkable through the supersession pointers in both directions. This revision (v0.3.1) replaced
the earlier leave-both-open form after house-rules' own chain accumulated open issues faster
than sessions closed them.

This shape generalizes repo-a's own carryover chain, issues #605 through #638, where the
fixed shape is what let each session diff state against the last one instead of re-deriving it
from a changelog.

Native floor, as of 2026-09-02: session resume and the harness's own memory carry state on one
machine only (https://code.claude.com/docs/en/sessions), so the carryover issue is the shared
tier. It records what a resumed session and a memory file cannot hand to another machine or
another person, and nothing a re-run can regenerate.

## Retiring a memory entry once its rule ships

Auto-memory (`MEMORY.md` and its per-topic files, under a project's `.claude/projects/*/memory/`
directory) is Claude-written, per-repo, and outside house's version pin: nothing about adopting
or updating house touches it. That is exactly the hazard. When a practice a memory entry
documents ships as a vendored house rule, the memory entry and the rule become two independent
statements of the same thing, and only one of them is kept current by a version bump.

The retirement rule: once a practice ships as a rule, the memory entry that carried it is cut
down to a one-line pointer at the rule (file and heading), never left as standing prose that
restates the practice in its own words. A pointer cannot drift from what it points at; prose can,
silently, the exact failure the docs module's own anchor rule exists to catch everywhere else.

The mechanism already has a name in this repo's own harvest: `docs/handbook/inventory.md`
dispositions a row `cross-ref` when "another file points at its canonical home," rather than
restating the practice's text a second time. Of the 98 rows harvested from the repo-a
memory corpus (the `MEM-` prefix), 13 are dispositioned `cross-ref`: `MEM-001`
(`feedback_no_op_is_not_evidence.md`) points at the rule now carrying its practice in
`engineering.md` (`TW-103`); `MEM-033` (`feedback_branch_pr_workflow.md`) points at the CLAUDE.md
skeleton (`TW-045`); `MEM-093` (`feedback_no_new_libs.md`) does the same (`TW-138`). Each is a
memory entry whose practice now has a canonical home elsewhere, standing in for the one-line
pointer the source file itself should carry once this package reaches it.

No check enforces this yet; nothing in `check:house`'s families reads a consuming repo's
`MEMORY.md`. It is an editorial discipline stated here so a future gate has a rule to enforce,
not a retrofit invented after the drift it prevents has already happened once.

## Versioning the package, and what a bump is promising

The package carries a SemVer string in `plugins/house/.claude-plugin/plugin.json`, the schema
pins it to `x.y.z`, and a consuming repo records the version it is on in its own `house.json`.
That machinery is only worth having if the thing being versioned has a stated public surface,
which is the half a version number cannot supply on its own (EXT-043): a bump means something
only once the reader knows what it promised not to break. This package's public surface is
three things and not the files that implement them: the rule headings a consuming repo's docs
and skills cite by name, the hook contracts (what the branch guard denies, and on what payload),
and the `house.json` schema, including the names of its module config slots. Renaming a rule
heading, tightening what the hook denies, or removing a config slot is a breaking change to a
consumer even when no consumer's file changed; reordering prose inside a rule, adding a new
module default-off, or adding an optional schema key is not. A released version is never
modified in place, on the same reasoning that a decided record is never edited: the way to
change a released version is the next one. Which bump each class of change earns, minor for
rule content and major for the surface above, is decided in
`docs/decisions/0011-rule-content-changes-are-minor.md`.

The honest limit on all of this is that SemVer was written for libraries, where the surface is
an API and a compiler can tell you when it moved. Here the surface is behavioral, nothing
compiles against it, and no authoritative source covers how to version a conventions package at
all. That gap was named in the external sweep and had to be decided in-house rather than looked
up, which is why the surface is enumerated above rather than left implied.

The related gap sits one step further out (EXT-076). Anthropic's own guidance prescribes
evaluations for skills and then says plainly there is not currently a built-in way to run them,
and no standard harness exists anywhere for asserting that a rule actually changed an agent's
behavior. A rule file is not testable the way a function is: it either moved the model or it did
not, and nothing off the shelf answers that. `plugins/house/evals/` is this package's answer to
that specific gap, which is why its cases are built as paired arms (the same prompt with the rule
loaded and without it) rather than as pass/fail assertions about a single run. Reading a green
eval as proof the rule works is the failure that framing exists to prevent: what a case measures
is the delta between the arms, and a case that scores the same in both arms is measuring the
model, not the rule.

## Don't

- Don't put a date, a name, or a measured number in a rule file's prose; it belongs in this
  chapter instead.
- Don't edit a superseded decision record or design doc in place; head it with the banner and
  leave the text.
- Don't let a `house.json` deviation exist without its mirror in `CLAUDE.md`, or the reverse.
- Don't record a gate verdict or a counts table in a carryover issue at all; re-run them from the
  recorded SHA, and don't merge deferred-by-decision with not-done into one list.
- Don't leave a memory entry as full prose once its practice ships as a house rule; cut it to a
  pointer.
