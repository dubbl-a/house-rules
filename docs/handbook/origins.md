<!-- docs-drift-ignore-file: point-in-time record of the 2026-08 build; anchors record what was true then -->
# Origins

How `house` came to exist, what it was built from, and where the receipts live.
Written for an experienced full-stack engineer, so it defaults to naming the
sources rather than re-explaining them. The same operator note carries a second
half that governs the calls this package makes rather than its register
(MEM-097): on anything editorial, take the more conservative option and state
the trade-off, rather than deciding it silently and moving on. Every deliberate
drop in `inventory.md` carries its reason for that reason, and the deviations
ledger exists so a repo's declines are visible rather than quiet.

## The trigger

A repo-a pull request (merged 2026-08-23) split `.claude/rules/entity-resolution.md`
from 1,512 lines (7.5x the repo's own 200-line rule-file target) into three
files, each fact given exactly one home: the durable write contract stayed in
`entity-resolution.md`, how a matcher number gets produced moved to a new
`match-measurement.md`, and every dated incident, id, and measured number
moved to a new `docs/match/design-history.md`. That PR is also where the rule
shape this package now enforces first got written down in full: imperative,
one-clause why, enforcement anchor, pointer to the receipt. In its follow-up
list, the PR named the file it had just fixed a pattern already living in at
least three other repos and filed a repo-a issue to unify it.

That issue ("Unify documentation rules across repos as an inheritable
package") asked for one common, versioned rule set that repo-a and several
sibling repos could all install, inherit, and receive updates from,
replacing per-repo copies that had already drifted. It named the mechanism
up front: a personal Claude Code plugin in its own marketplace repo, because
a native plugin is installable per-repo and updates propagate from one
place, and pointed at the entity-resolution split as the reference
implementation. It listed the open questions rather than answering them:
what stays repo-specific versus common, how repos pin and upgrade a version,
and whether the anchor-drift gate can be made config-driven enough to run
unchanged everywhere. This handbook, `plugins/house/`, and the ADRs under
`docs/decisions/` are the answers. The general form of the trigger
generalizes past this one issue: promote a setup to a plugin the moment a
second repository needs it (EXT-036): by the time the issue was filed, at
least four repos already needed it.

## The five-repo survey (2026-08-23)

Before writing a line of rule text, five repos were surveyed in parallel by
three survey agents, producing three survey documents that are now held in
the maintainer's private archive rather than shipped in this repo. Each
catalogs every doc-maintenance, git/CI, and engineering practice found, tagged
GENERIC or SPECIFIC, with its enforcement mechanism named or marked
unenforced. What each repo contributed:

**repo-a** is the origin repo and the deepest source: `maintaining-docs.md`
(anchor-every-claim, the four-tier what-belongs-where routing, line targets,
cut-don't-append, the archive-tier split, and the rule shape from the PR
above) supplied the package's spine, and `check-docs-drift.mjs` supplied the
anchor-checking algorithm the package's `check.mjs` generalizes. Its
strongest named practices: the retro framework (`{key, severity, title, why,
remedy, check()}`, `why` and `remedy` required, a `NOT_MEASURED` sentinel
instead of a fabricated zero); `no-direct-master.sh` shipped with its own
regression test and honest about being fail-fast UX rather than real branch
protection; the Tier 1 / Tier 2 worktree rubric paired with a guard that
turns a missed `git checkout master` into a loud error the next session
instead of a silent stale deploy; and the measurement-discipline set from
`match-measurement.md` (a third gate verdict, NOT EVALUABLE; seeded sampling
so a baseline fingerprint means something; "one number is never the
accuracy").

**repo-b** is a multi-project marketing launchpad repo whose
`maintaining-docs.md` added the piece repo-a's lacked: a named section on
when a topic outgrows one file, with two escape valves chosen by what is
squeezing and the anti-rule "two files that always load together are
strictly worse than one." Its strongest named practices: the drift scanner
built over `git ls-files` rather than a hardcoded doc list, so a new tracked
doc is covered automatically; a composable deploy-guard chain (clean branch
at origin, account pinned, CI green with zero-runs-fails-closed, PR
provenance) that runs before any build starts; a two-layer secret
containment (scrub the env and hide the secrets file from disk, since the
adapter reads it directly) proven by a CI canary step that writes fake
credentials and checks the scanner still catches them; and the explicit
warning that git state is shared across sessions, so a checkout elsewhere can
strand another session's uncommitted work.

**repo-c** is a Phase 0/1 finance-and-operations repo for a small member-run
nonprofit, mostly doc kit and domain model with little code yet, and it
supplied the operationalized version of two things repo-b only sketched: the
exact Tier 1 / Tier 2 worktree commands with a slash-to-dash naming
convention and a dev-server port ladder, and a PR template with a forced
Docs-check binary rather than an aspiration. Its strongest named practices:
"unmapped revenue is loud" as the general form of fail-loud-on-unmapped-input;
provenance columns treated as load-bearing, never silently overwritten by a
sync; forward-only migrations with no down-migrations, on the reasoning that
the fix for a bad migration is the next migration; and a stated CI wall-time
budget as a design constraint rather than an accident.

**repo-d** is a campaign-side monorepo holding two local political-tech
initiatives (a council-influence console and a school-board-race campaign
tracker) under one set of repo rules, and it contributed the fleet's deepest
accuracy-and-verification layer, built for output a human campaign relies
on. Its strongest named practices: adversarial refutation as a tiered gate,
with two independent refuter passes under named lenses and a default-drop on
anything refuted; the name-collision HOLD, where an ambiguous match holds
rather than guesses, because holding costs nothing and a wrongly minted
duplicate costs a cross-repo merge; a prune brake that refuses to delete
more than a set share of a table without an explicit force flag,
unit-tested; and "naming, not acting, on data quality," wired into CI as a
deliberately non-failing step so a data finding never turns the build red.

**repo-e** is a single-user skill repo, small and narrow, and it contributed
the fleet's clearest example of a structural (not policy) approval gate:
generated content lands only in a gitignored drafts directory, and the only
way anything reaches the tracked bank is a human moving it there. Its
strongest named practices: claims locked to their source ("repositioned"
never becomes "built," numbers never round up); a dated, append-only
conflict ledger where superseding an old ruling is written out explicitly
rather than silently overwritten; and the honest three-week bug write-up of
a foreign repo's branch-guard hook silently reaching into this repo through
`cd`, fixed by an exempt-repos allowlist, which became this package's own
cross-repo hook scoping decision.

## External guidance and prior art

Two more sweeps ran alongside the five-repo survey: an external-guidance
pass against Anthropic's own docs and widely-held practice
(`docs/handbook/sources/external-guidance.md`), and a prior-art pass across
public vendoring, linting, hook, skill, and decision-record tooling
(`docs/handbook/sources/prior-art.md`). One correction from the guidance pass
shaped the whole design before any rule was written: `plugin-mechanics.md`'s
research confirmed against the official plugin-reference and memory docs
that a plugin cannot ship a `rules/` directory at all, so `house` vendors
rule files into each repo's own `.claude/rules/house/` rather than shipping
them as plugin content, a choice recorded as ADR 0001. The destination is
not a workaround, and the same pass confirmed why (PA-001): `.claude/rules/*.md`
with `paths:` frontmatter is a first-class native feature that lazy-loads on a
matching read, so vendoring into it is writing to a supported slot rather than
wedging content somewhere it does not belong. Those two facts are what make the
design legitimate rather than clever: the plugin route is closed, the vendoring
route is the platform's own.

What got reused, borrowed, and rejected across both sweeps, and the full
pinned list of upstreams with what was consulted, its license, and how to
re-check it for drift, lives in `docs/handbook/upstreams.md` and is not
restated here. In short: MADR's decision-record template was borrowed
verbatim for `docs/decisions/`; a branch-guard hook design was borrowed from
a public git-safety project, adapted for worktree awareness and per-repo
carve-outs it lacked; the official `claude-md-management` plugin's audit half
was borrowed for a `/house-rules:revise-docs` skill while its append-to-CLAUDE.md
default was rejected outright, as the exact failure mode that produced the
1,512-line file the opening PR fixed; and Copier's update-replay sync model
was evaluated and rejected on purpose, because a silently carried local edit
is exactly what this package's deviations ledger exists to make explicit
instead. Three candidate linters (`ctxlint`, `agents-lint`, `agnix`) were
evaluated against the real trees rather than by reputation, with the verdict
recorded in ADR 0006 rather than assumed from the sweep. The sweep's load-bearing
conclusion is the negative one, and it is what justifies building this at all
(PA-034): no single candidate covers versioned cross-repo distribution of
path-scoped rules with drift detection and a recorded deviations ledger. Each
near miss fails on a different axis. `ai-rulez` has remote includes and a verify
command but no pinning, no lock, and never emits `paths:`-scoped rules. Packmind
has versioning, drift detection, and glob scoping, and is an org-scale server
with approval workflows. Native symlinks are free and instant and give up the
pin, the per-repo config, and the deviation record all at once. The gap is the
combination, not any one feature, which is why adopting any of them wholesale
would have left the reason for the package unmet.

The sweeps also surfaced what public guidance disagrees on and what it does
not cover at all, and both matter to how this package is scoped. Contested:
feature branches versus direct-to-trunk for a single developer, where an
agent producing the diff turns out to be the strongest argument for keeping
the PR gate anyway. Uncovered by any authoritative source: manual versus
automatic deploy for a solo project, and how to version a behavioral
conventions package like this one at all, and both had to be decided in-house
rather than looked up, and both decisions are recorded as ADRs.

## The path-scoped-loading measurement

The whole design assumes a `paths:`-scoped rule file costs no context until
Claude reads a matching file. That assumption is disputed upstream, so it was
measured on the actual build before any rule content was written, rather
than assumed from the docs. The probe, the two-repo result, and the
co-load ceiling it produced are recorded in full in
`docs/decisions/0007-path-scoped-rules-load-on-read.md` and are not restated
here.

## The inventory and manifest method

The counts in this section are as of the 2026-08 build that produced this method; run `npm run check:traceability` for the current ones.

Every practice the five-repo survey, the memory corpus, and the two external
sweeps turned up was reduced to one row each in `docs/handbook/inventory.md`:
591 rows total, one per distinct practice, each carrying its exact source
citation, a one-line imperative restatement, a disposition, and a single
destination. Eight ID prefixes mark where a row came from: `TW-` (195 rows,
repo-a), `AG-` (64, repo-b), `AS-` (48, repo-c), `SB-` (49, repo-d), `RT-`
(27, repo-e), `MEM-` (98, the memory corpus at
`~/.claude/projects/<repo-a>/memory/`), `EXT-` (76, the external-guidance
sweep), and `PA-` (34, the prior-art sweep).

Six dispositions decide what happens to a row. `port` becomes a rule
heading outright; `generalize` becomes one too, with the repo-specific
detail stripped; `fold` is absorbed into an existing heading's text without
a heading of its own; `cross-ref` means a different file already covers it
and this row just points there; `handbook-only` means the row is context or
a receipt, not a rule (the nine rows this chapter owns, cited by ID
throughout the sections above, are handbook-only); and `drop` carries its
reason in the Practice cell, right beside the practice it declined, so the
decision not to port something is as visible as the ones that were ported.
Counted across all 591: 140 port, 23 generalize, 304 fold, 57 cross-ref, 49
handbook-only, 18 drop.

The method's organizing constraint is one `port` (or `generalize`) row per
surviving rule heading: that row supplies the heading's title and the text
the enforcement gate points at, and every other row bound for that heading
(by `fold`, or by `cross-ref` from a sibling file) merges into the same
prose rather than adding a second heading that says almost the same thing.
That is what keeps eight rule files holding 591 rows of separately-sourced
practice without duplicating any one idea under two names.

That one-port-per-heading constraint is machine-checked, not just described:
`node scripts/check-traceability.mjs` fails on any rule heading with zero port
rows or with more than one. Partway through the build it was still catching a
real gap: 94 of the 98 rule headings across the eight rule files carried
exactly one seed row, 2 carried zero, and 2 carried two. The reconciliation
has since landed, two headings each had a `fold` row promoted to `port` to
fill the gap, and two headings had their competing rows reworded down to one,
with no heading dropped and no practice lost in the merge. `node
scripts/check-traceability.mjs --no-chapters` now reports all 98 rule
headings holding exactly one port row, clean.

`docs/handbook/manifest.json` is the row-to-file compiler input built on top
of the inventory: 65 destination artifacts (8 rule files, 12 templates, 12
scripts, 11 evals, 10 handbook chapters including this one, 6 ADRs, 5
skills, 1 schema), each entry listing exactly which row IDs it `owns` and
which it only `crossRefs`. The inventory and the manifest are the source of
truth every later build agent works from; this chapter is the narrative
around them, not a substitute for reading them.
