# Docs: the receipts

## Why this exists

Documentation drift is the failure class that renders fine, builds green, and is invisible to
review: a claim goes stale, a link stops resolving, a rule file grows past the point anyone
reads it to the end, and nothing fails until a person acts on the wrong information. The `docs`
module exists to make that failure mechanical instead of social: every claim anchors to
something a script can check, every rule file has a scope and a shape, and every document has a
declared role so a fact has exactly one home. The same writing standards apply recursively to
this handbook itself: report limits without performing contrition, and teach every term at
first use or cut it, rules `.claude/rules/build-record.md` states for the build-record narrative
and this chapter follows for its own prose.

## Anchor every claim to a grep-able token

repo-a's `.claude/rules/maintaining-docs.md` states the rule this section is built from:
prose describing UI, CLI, or code must anchor to something a reader can grep, a section id, a
class prefix, a file path, a component name, or an npm script, because "free-form UI prose
drifts silently when the UI changes, anchored prose fails the build." When a claim genuinely
cannot be anchored (editorial intent, future tense, an external resource), the rule is to
generalize the prose so it still reads true after the next refactor, not to force a fake anchor.
`npm run check:docs` enforces this in `prebuild`.

repo-c's copy of the same rule adds a worked Bad/Good example pair so the rule reads without
needing the linter to explain it, and a companion habit closes the loop on the other end:
verify a claimed technology transition against the codebase before writing the rule that
describes it, rather than trusting a stale mental model of what the stack does. repo-a's
own worked example pairs the vocabulary with its actual race-page section ids; that
pairing is the one part of the source rule this chapter does not carry forward; the ids name
that repo's own page structure and would read as a broken anchor everywhere else, so only the
generalized vocabulary above ports.

repo-a's own maintainer note, left as an HTML comment so it costs no context, names the
checker's failure mode precisely: the token classifier runs each backticked token through a
fixed, ordered sequence of anchor kinds (script name, path, component, section id, class
prefix, environment variable, and a bare-script fallback), and a token matching none of them is
silently skipped rather than flagged, "so unrecognized tokens won't trigger false positives, but
also won't be enforced." That caveat travels with the checker itself, not just its source repo:
an anchored-looking claim whose token shape the classifier does not recognize gates nothing,
which reads identically to a claim that was checked and passed, and is worth a maintainer
knowing on any repo running this gate, not only the one that first wrote it down.

No incident recorded for a false anchor slipping through; the rule came in on reasoning about
how UI prose drifts, corroborated by a second repo restating it independently.

## Run the docs gate before pushing and in the build

`.claude/rules/maintaining-docs.md` states the gate must run locally before pushing any branch
that touches documents, with the build wiring as the safety net rather than the loop anyone
develops in: "Run before pushing any PR that touches docs. The pre-build wire-up is the safety
net; local-first is the workflow." `check:docs` scans `CLAUDE.md`, `README.md`, and
`.claude/rules/*.md`, deliberately not `docs/**`, which is the archive tier, and is wired into
both `prebuild` and the pull-request workflow (`pr-checks.yml`).

No incident recorded; the reasoning is the round-trip cost. A gate only met through a red badge
after review costs a round trip per typo, and the round trip is what makes people stop running
it.

Native floor, as of 2026-09-02: none for the running of it. Instruction and rule files are
delivered as context rather than enforced configuration
(https://code.claude.com/docs/en/memory), so a hook or a build step is what makes a
run-it-before-pushing instruction hold (https://code.claude.com/docs/en/hooks).

## Give every rule file a paths list whose first segment resolves

The mechanical gate validates every rule file's `paths:` frontmatter: "every glob's first
non-glob segment must resolve, otherwise the rule silently never loads and the file rots without
warning." A rule file with no `paths:` at all is not unscoped, it is always-on at root-file
priority, so if it truly belongs in every session it belongs in the root file, and if it does
not, it needs a scope.

No incident recorded; the failure mode (a rule that silently never loads) is a reasoned
prediction from how the frontmatter is consumed, not an observed break.

## Put a fact where its litmus test says it belongs

repo-a routes a fact by litmus test across four tiers: the root `CLAUDE.md` for facts a
session would go wrong without every time, `.claude/rules/*.md` for domain rules loaded on
demand via `paths:`, `README.md` for a human landing on the repo, and the archive tier
(`docs/<domain>/design-history.md`) for dated incidents, measurements, and decision evidence
that are never loaded into context. repo-d independently arrived at the same split, naming
each role explicitly rather than folding them into one file: `CLAUDE.md` as working rules,
`GUIDE.md` as the human runbook, `plan.md` as strategy, `CHANGELOG.md` as the user-noticeable
log, and `docs/*.md` as deep reference. The external brief backs the same instinct from the
other direction: never mix tutorial, how-to, reference, and explanation modes in one document,
because each serves a different reader need and mixing them degrades all four.

Two repo-a reference docs put the pattern to work. `docs/data-dictionary.md` indexes the
data-dictionary tables and says "start here, then follow the link" rather than restating them
inline, and `docs/finance-data-dictionary.md` traces every published finance number back to the
source field it came from, so a reference doc's job is to point at ground truth, not to
duplicate it. `docs/postmortems/2026-06-02-results-blackout.md` gives a fourth role a fixed
section spine that ends in a runbook, so a postmortem is read once and then reused as the
procedure for the next occurrence. repo-c's `docs/GLOSSARY.md` plays the same role for
vocabulary: model code is gated on reading it, "so nobody reverse-engineers the vocabulary from
a notes column."

`docs/impact-brief-writing-guide.md` is the sharpest example of a fifth role: a method doc that
says outright it is project-agnostic and meant to be copied, the way repo-c's
`docs/exploration-playbook.md` does. Both name the same discipline in different words: lead with
impact, cut model-sounding prose, teach a term at first use or cut it, and make a limitations
section mandatory. When such a doc is ported into a new repo, the rule is to keep its original
worked examples rather than genericize them, because the moves transfer and the tables do not.

No incident recorded for a fact landing in the wrong tier and causing a visible failure; the
routing rule is a judgment call by design; a gate can measure a file's length, not whether a
fact is in the right file.

Native floor, as of 2026-09-02: the memory page's own routing of always-true facts to the root
file, procedures to a skill, and path-bound facts to a path-scoped rule, plus the checkup's
trim of what is derivable from the code (https://code.claude.com/docs/en/memory).

## State a rule as imperative, why, anchor, receipts

The canonical rule shape: an imperative heading that is itself the rule, a one-clause why, the
enforcement anchor, and a `Receipts:` pointer to the design-history entry by quoted heading, "so
the pointer survives a reorder." repo-c states the heading-style half of this independently:
every rule heading is written as an imperative whose text is the rule. repo-d's variant
bakes the receipt directly into the bullet instead of a separate pointer, one line carrying the
claim, the mechanism, the why, and the hazard it prevents, and the external brief backs the same
instinct about altitude: write instructions specific enough to guide, general enough to leave
heuristics, rather than brittle if-else logic or vague high-level guidance. The house shape adds
one requirement neither source states: every rule file ends with a `## Don't` section, and rule
and body prose never carries an em dash.

Which surfaces that em-dash ban covers is a per-repo call, so it is a config slot rather than a
constant in the checker: `modules.docs.config.emDash` takes a `mode` of `public` (the default:
`README.md`, `CHANGELOG.md`, and `docs/**/*.md`), `all` (those plus every rule file), or `off`,
with `paths` and `exclude` lists matched the way every other docs path slot is. The default is
public prose rather than rule files because the reader who notices the tell is the one who landed
on the repo, and the rule files are already gated for a different reason. An `exclude` entry takes
the `{path, why}` form, so an exemption carries its justification in the same line that grants it.
This package runs `all`, and holds out `docs/handbook/sources/**`: those are point-in-time research
notes quoted from other repositories, and rewriting a quotation to satisfy a house rule would make
the receipt worth less than the rule it supports.

The receipts pointer itself needs a reason to be checked, not just written. repo-a's
sibling gate for in-page anchors states it plainly: "a missing fragment does not 404," so nothing
surfaces a dead in-page link without a script that resolves it against the real heading set,
which is exactly the mechanism this chapter is written to satisfy for its own `Receipts:` lines.

No incident recorded for a rule shipped without its why and later worked around; the shape is
reasoning about what a disagreeing reader needs in front of them before they route around the
rule instead of revising it.

## Move dates, names, and measured numbers out of rule prose

"A rule that needs a date, a person's name, or a measured number to state itself is history
wearing a rule's clothes." The remedy is to move the evidence to the archive and leave the rule,
which is the part that has to survive the next change; tuned constants stay in code and are
referenced by name from the docs, because a threshold copied into prose reads as a rule and goes
stale with nothing to catch it. A pinned figure is the one exception and it is not a stale
figure: its as-of date is part of the claim, so it travels with the figure and never with the
rule.

repo-d took the opposite bet on purpose, and the contrast is worth keeping: nearly every
hazard line in its `CLAUDE.md` names the date or the outage that produced it, which is what its
survey calls the thing that "makes a 100 KB `CLAUDE.md` survivable, you can tell which rules are
load-bearing." That approach trades file length for provenance-in-place; the house rule trades
the other way, betting that a shorter always-loaded file plus a linked archive beats a longer
file that is self-explanatory. Both are defensible; the module picked one.

The incident that motivated the house rule over the repo-d alternative: rule files must
never become incident logs, "that is how `entity-resolution.md` once reached 1,512 lines."

## Keep files under budget, and raise a ceiling only with a written reason

repo-a's stated targets: `CLAUDE.md` at most 100 lines, each rule file at most 200,
`README.md` at most 110, cited to the reasoning that shorter files get better adherence. As
surveyed on 2026-08-23, the targets were documented but not machine-enforced: `CLAUDE.md` measured
83 lines and `README.md` measured 107, both passing, but 11 of the repo's 21 rule files exceeded
the 200-line target, including `election-results.md` at 444 lines, `database.md` at 398,
`cloud-publish.md` at 349, and `entity-resolution.md` at 338 even after its earlier split. A
documented-but-unenforced ceiling is what a ratchet is for: `npm run check:house`'s lengths and
ratchet family holds every document, root file, rule file, README, skill body, and handbook
chapter, to its configured ceiling, and the ceiling tightens on its own whenever a file shrinks,
so a raise takes a written entry naming the path, the old and new limit, the reason, and the date
decided, validated against the manifest schema, rather than landing as a quiet edit.

Native floor, as of 2026-09-02: the root instruction file's soft size guidance and the hard
file-size cap past which the harness skips the file entirely
(https://code.claude.com/docs/en/memory). No other document in a repo has a native budget.

## Cut, don't append, and trim on a fixed cadence

"Files should not grow monotonically." repo-a names a trim cadence, quarterly or at each
major release, and treats finding no candidate as a valid outcome, because the prompt to look is
what does the work: "if nothing is a candidate, that's fine, the prompt to look forces the
discipline." repo-b's `learning.md` states the same size discipline for a living document in
its own words, additions displace rather than accumulate, a sibling formulation to "cut, don't
append." The external brief backs the cadence from the other side: prune on evidence, not
schedule, because a repeatedly ignored rule means the file is too long, and a question the file
already answers means the phrasing is ambiguous.

The bloat smells named so a reviewer can spot them: a "what this does" walkthrough, a stack list
with versions, a file-conventions list, nesting three layers deep, example code that is not a
workaround, and any paragraph that exists to record that something happened rather than to
change what the next session does.

The clearest applied incident is a rejection: the `claude-md-management` plugin was assessed in
2026-08 and not adopted, because its audit only discovers files literally named `CLAUDE.md` and
its default habit, appending session learnings to `CLAUDE.md`, is the exact append-per-incident
failure mode this rule exists to prevent. The decision was recorded rather than silently
declined: "revisit only with a routing convention: learnings go to the matching rule file,
incidents to the domain's design-history doc."

Native floor, as of 2026-09-02: the checkup's trim proposal and the memory page's advice to
review instructions periodically, neither of which sets a cadence or stops a trimmed file
growing back (https://code.claude.com/docs/en/memory).

## Split a file only when splitting narrows what loads

"Two files that always load together are strictly worse than one: identical context, plus a
second place a rule can hide." repo-b's independent statement of the same principle: never
split a topic that reads as one thing. Pick the escape valve by what is squeezing, too many
rules split into a path-scoped directory along a real axis, too much history moves to the
archive with one-hop links, never split along size alone; a new subsystem starts as its own
path-scoped file rather than as more of the root file, the framing repo-b's `CLAUDE.md` states
directly: "Future work, new projects get their own path-scoped `.claude/rules/*.md`, not more of
this file." When a file is split, the rule is to name the sibling and the structural blind spot
it fills, then cross-reference it and say out loud that its rules are never restated there.

repo-a's issue #638 records the pattern as a precedent worth generalizing, not just
a one-off cleanup: during the matcher work, `entity-resolution.md` went from 1,512 lines to 332
durable lines,
split along a real axis, write-side rules stayed in `entity-resolution.md`, measurement and
evaluation rules moved to a new `match-measurement.md`, and dated evidence moved to
`docs/match/design-history.md`. The split is cross-referenced rather
than duplicated: `match-measurement.md`'s header states plainly, "Write-side rules live in
`entity-resolution.md`; methodology detail in `scripts/match/test/README.md`; dated incidents in
`docs/match/design-history.md`. Never restate them here." The same discipline applies to tuned
constants: `entity-resolution.md` states that weights, floors, and similarity thresholds live in
`scripts/lib/match-score.mjs`'s header and are never restated in prose, "since a stale threshold
in prose reads as a rule."

The co-load ceiling is the mechanical end of this rule, and house-rules issue #19 is the receipt
for how it gets resolved. When the v0.1.2 checker began counting a repo's own `.claude/rules/*.md`
beside the vendored house rules, three adopters found one path each over the 400-line budget:
repo-c's `src/lib/db/README.md` at 543 (house `engineering` loading on a README because the
default `codeRoots` is `src/**`), repo-b's `brain/cmd/ask.mjs` at 606 (two local `brain/`
rules plus engineering and llm-output), repo-a's `src/pages/api/results-call.ts` at 978
(a 435-line local rule plus a design rule scoped to all of `src/pages/**`). Each raised the
ceiling as a recorded deviation, which is the "green by omission" pattern in mild form: on the
record, but defeating the budget. The order that actually resolves one is: narrow the colliding
house module's path slot in `house.json` (every module's literal paths sit behind a slot since
v0.2.1: `codeRoots`, `docFiles`, `githubGlobs`, `claudeGlobs`, `dbGlobs`, `testRoots`, and the
per-module glob slots), tighten the repo's own rule `paths:` (a design rule has no business on a
`.ts` API route), trim what still loads together, and only then raise `maxCoLoadLines`, with a
`coload-ceiling` deviation whose integer `ceiling` equals it. The checker reports each colliding
rule set once with how many paths share it, so lowering a ceiling is one run, not a loop of
fix-one-discover-the-next, and the manifest family refuses a raised ceiling with no entry.

## Opt a point-in-time doc out with a file-level reason

House scans the archive tier by default, and a genuinely point-in-time document opts out at
file level with its reason stated in the marker. That default is not what every source repo did
before house existed, and adoption does not quietly change a repo's answer to "does the drift
gate touch my archive": `docs.config.scanArchive` is a required per-repo flag, seeded at
adoption from what the repo already did and changed only by its own dated follow-up PR, per
[ADR 0004](../decisions/0004-archive-tier-scanned-by-per-repo-flag.md). repo-a is the
`scanArchive: false` case: its archive tier, `docs/match/design-history.md` and its siblings, is
excluded from the gate wholesale rather than opted out file by file, because the whole tier is
dated evidence by design and marking each entry would be the exception standing in for the
rule. repo-c and repo-b are the `scanArchive: true` case, catching drift in their archive by
default and opting a document out one at a time, which is the behavior this section documents.

The file-level marker itself is the mechanism both postures share once a document is in scope,
whichever way it got there. repo-a's `docs/match/design-history.md`, 1,285 lines, opens
with an explicit contract: "Every entry
below is an incident, a measurement, or a decision, with the ids, names, figures, counts, dates
and PR numbers that produced it... Anchors here are point-in-time and deliberately not
drift-gated... so a name that was accurate on the day of the incident stays written as it was,
even after the code moved or the script was deleted. Read an entry as a dated observation, not as
a description of today's codebase. Where an entry implies a rule, the rule lives in the rule
files; the entry ends by pointing there rather than restating it." Its index table titles each
entry as a one-line lesson, dated, so the pointer from a rule's `Receipts:` line reads as a claim
rather than a filename. The escape hatch that makes this possible carries its parsing quirk
inline: only the closing `-->` terminates the reason text, so the reason itself may contain
hyphens and most punctuation. Maintainer notes live in the same HTML-comment mechanism, since
Anthropic strips block comments before context injection, so they cost no context and are
excluded from the gate.

Two repo-a documents show the opt-out is not only for finished history. repo-b's
`okrs/README.md` treats a closed OKR cycle the same way: a new cycle is a sibling directory,
never an in-place edit, and the lookup that resolves the current cycle fails closed on a missing
set rather than silently falling back to an old one. repo-b's `docs/secondarrow-site.md`, a
1,127-line rebrand spec, opens with a file-level opt-out stating its reason directly: "a spec for
the unbuilt rebrand. Its backticked paths are forward references to pages and routes that
deliberately do not exist yet," the reference example for a forward-looking spec whose paths are
deliberate rather than stale. repo-d's `docs/cloud-native-architecture.md` shows the fourth
variant, a design doc kept rather than deleted and headed with a dated banner, "Partially
superseded (July 2026)", naming exactly which parts the implementation diverged from. repo-c
states the honest baseline for a repo with none of this yet: its archive tier is empty until a
domain earns one, and that absence is stated plainly rather than stubbed out.

## Don't document a command that does not exist

"A README that tells you to run a command that doesn't exist is worse than a short one, because
the reader spends their trust before they spend their time," repo-c's `README.md` states,
independently of repo-a's own version of the rule. The check that catches it resolves
each documented `npm run <name>` and each bare script token against the repo's actual script
list.

The habit that keeps the gate from being the last line of defense: before opening a docs pull
request, walk each documented command against the repo's script list and its hooks by hand, and
fix any contradiction in the same pull request rather than filing it as a follow-up. A
deliberately archival command gets marked inline with its reason, so a later reader reads it as
history rather than as drift the gate should have caught.

## Ship the docs and changelog edit in the same PR as the change

When a change adds or renames a script, an environment variable, an endpoint behavior, or a
maintenance step, its docs edit ships in the same pull request; a docs pull request opened
afterward is an afterthought and drifts. repo-a also gates the resident-facing half of
the same idea: `CHANGELOG.md` logs only what the repo's audience would notice by hand, refactors,
infra, CI, schema, and silent fixes stay out and live in git history instead. repo-c allows a
narrower carve-out repo-a does not state explicitly, a standalone docs pull request is
fine when there is no code change at all, and extends the same workflow to skills: "Skills follow
the docs workflow (branch + PR, `npm run check:docs`), not a code deploy." repo-b's own
change-log discipline for its OKR archive shows the pattern applied to a non-code artifact: each
amendment entry opens by stating plainly whether "no goal moved" or "a goal moved," then lists
what changed and what is still open, with the same shape the changelog rule asks for; whether a
changelog belongs in every repo, or only one with users to notice it, was left as an open
question rather than settled.

Two incidents sharpen the rule past its own statement. First, a no-op refactor that turns up a
real bug should be split out and described as a correction, not buried inside the cleanup entry
that found it. Second, a run's own instructions can forget to name every artifact it produced;
the fix is to ship every artifact the run actually produced in the same hygiene pull request,
including the ones the script's own documentation left out.

Native floor, as of 2026-09-02: hosted Code Review, whose findings arrive as severity-graded
comments on a check run that never blocks a merge, and only where that Team and Enterprise
preview runs (https://code.claude.com/docs/en/code-review.md#check-run-output).

## Sources

- https://diataxis.fr/ (never mix tutorial, how-to, reference, and explanation modes in one document)
- https://code.claude.com/docs/en/best-practices (prune on evidence: a repeatedly ignored rule means the file is too long, an answered question means the phrasing is ambiguous)
- https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents (write at the right altitude: specific enough to guide, general enough to leave heuristics)
- https://keepachangelog.com/en/1.1.0/ (maintain a changelog by hand under an unreleased heading, in reverse-chronological dated sections)
