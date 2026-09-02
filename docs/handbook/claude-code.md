<!-- house handbook chapter; receipts for plugins/house/modules/claude-code/rules/claude-code.md -->
# Claude Code conventions: receipts

## Why this exists

This module governs how the harness itself is configured and used: what belongs in
always-loaded context versus scoped or on-demand context, when automation needs a hard stop
instead of a soft instruction, and how sessions that share a git checkout, a laptop database, or
a shared document avoid colliding. Every rule below traces to a session doing the wrong thing for
a reason that was legible only after the fact: a hook that fails open, a model call that silently
inherits the wrong tier, a peer session's work getting yanked out from under it. Receipts are
drawn from five production repos (repo-a, repo-b, repo-c, repo-d, repo-e)
plus Anthropic's own published guidance.

## Put only what Claude would get wrong without it in the root file

repo-a's own `data-story` skill opens with a "read these first instead of assuming" list
and names `CLAUDE.md` as the tiebreaker: "It wins over anything here" (`.claude/skills/data-story/SKILL.md`,
323 lines). That is the practice this heading generalizes: name what to read first, name which
file wins a conflict, and leave the rest to auto-memory.

Anthropic's own best-practices guidance states the litmus test directly, and four of its clauses
map straight onto this heading: for every line, ask whether removing it would cause a mistake and
cut it if the answer is no; exclude anything derivable from the code (file layouts, dependency
lists, generic advice); include only what cannot be inferred (non-guessable commands, conventions
that differ from defaults, environment quirks); and treat context as a finite resource, letting
auto-memory hold learnings while the instruction file holds rules only (code.claude.com/docs/en/best-practices,
items 2, 3, 4, 10, 14).

The same official guidance names a tool for applying that litmus test to a file that already
exists rather than only to a line you are about to write: run `/doctor` against a checked-in
instruction file and read its proposed trims, which target derivable content while leaving
pitfalls and rationale alone (code.claude.com/docs/en/memory, item 13, EXT-013). It proposes;
the routing call in this module's rules still decides where a trimmed fact goes.

Native floor, as of 2026-09-02: the harness's own checkup proposes trims to a checked-in
instruction file and the memory page states size guidance, both advisory
(https://code.claude.com/docs/en/memory). The `lengths` family is what turns that advice into a
gate.

## Keep the auto-memory index to hooks, and hold it under its cap

repo-b's own auto-memory index is the incident, measured 2026-08-29: 94 lines and 20.9 KB
against a ceiling of 200 lines or 25 KB, with 58 of its 75 entries running past 200 characters.
Several of those entries carried rulings that appeared nowhere in the topic file they pointed at,
so the index was the only copy and a straight trim would have destroyed the fact along with the
line. The order the fix had to run in is the rule: move the orphaned facts down into their topic
files first, then shorten each index line to the cue that says when to open one.

The official documentation states both the ceiling and the shape. On the ceiling: "The first 200
lines of MEMORY.md, or the first 25KB, whichever comes first, are loaded at the start of every
conversation" (code.claude.com/docs/en/memory). On the shape, from the same page: "keep one line
per entry, move detail into topic files, and merge or drop stale entries." Nothing in a session
reports that the tail was dropped, which is what makes the ceiling a cliff rather than a budget,
and why the checker warns while the index is still short enough to fix in one pass.

The index is machine-local state that no repo tracks and no CI checkout has, so the check that
watches it warns and never fails; ADR 0008 records that boundary and the two environment
variables it honors.

Native floor, as of 2026-09-02: the MEMORY.md index and its documented load limit, which the
harness asks Claude to shorten after a write and errors on once the index sits over the ceiling
(https://code.claude.com/docs/en/memory).

## Give a domain rule a paths list, and never leave a rule file unscoped

repo-a's own CLAUDE.md is the reference implementation: "Topic-specific rules live in
`.claude/rules/*.md` with `paths:` frontmatter. They load only when Claude reads files matching
the glob, so they don't burn context in sessions that don't touch the domain," with the fallback
"grep `.claude/rules/`" when no matching file is open. Its own domain-rules table lists 21 rows
across 20 rule files totalling 4,317 lines behind an 83-line always-loaded root file.

repo-b's `maintaining-docs.md` states the inverse just as plainly: a rule file with no
`paths:` is not unscoped, it is always-on at root-file priority; if a rule belongs in every
session, it belongs in the root file instead, not in an unscoped rule file.

repo-d is the fleet's negative case and the clearest argument for the heading. It has no
rule-file scoping mechanism at all: one unscoped root file, 479 lines and about 102 KB, which
every session pays in full whether or not it touches the domain the lines describe (SB-007). No
line of it is wrong; the cost is structural, and it is the cost this heading exists to avoid.

A related correction from the same official docs closes off the obvious cheaper fix (EXT-071).
Splitting a long root file into `@path` imports organizes it and does not economize it: the
memory docs state plainly that imported files still load and enter the context window at launch.
Only path-scoped rules and skills actually defer loading, so an import-based split of
repo-d's file would move the lines around without moving the cost.

The mechanism this heading relies on is not settled fact. Anthropic's own documentation says
`paths:`-scoped rules load only on matching reads, but an open bug report (anthropics/claude-code#16299)
claims they can load globally regardless: "do not assume the scoping works without checking
`/context`." That is the reason the heading's own text says to confirm the scoping really defers
loading before counting on it.

## Make a procedure a skill, not a rule

repo-a's six `.claude/commands/*.md` files are each a one-sentence `description:`
frontmatter naming the exact table and filter the pipeline walks (e.g. `bootstrap-candidate.md`,
258 lines), keeping the procedure itself out of a rule file.

repo-d's `merge-and-deploy/SKILL.md` (51 lines) carries a named "Hazards" section documenting
two dated multi-session failure modes from 2026-07-04 and 2026-07-05, the source for "give the
skill a hazards section naming what has actually gone wrong."
The same skill is also the fleet's worked shape for a ship procedure, and the shape is worth
naming as a sequence rather than only as the sum of its steps (SB-014): pre-flight, push and open
the PR, merge, fast-forward the main checkout, run the ordered deploy, clean up the worktree and
branches, and close by reporting what actually shipped. Several of those steps carry their own
rules elsewhere in this handbook (the ordered deploy is deployment.md's, the cleanup order is
github.md's), which is exactly why the sequence needs a home of its own: a reader who meets the
steps one at a time never learns they are one procedure.

repo-e's `CLAUDE.md` documents the hot-reload caveat plainly: "skill changes are picked up
on the next CLI start (no hot-reload)." Its `SKILL.md` states its own portability note out loud,
keeping "mechanics only" in the skill body while personal selection and voice rules live in
separate instruction files (`resume_instructions.md`, `tiering_instructions.md`), so the skill
itself stays copyable to another repo.

Anthropic's guidance backs the shape: move multi-step procedures and reference material into
skills, where only the description costs context every session (code.claude.com/docs/en/features-overview),
and build a few evaluations before writing extensive skill or rule documentation, "or you document
imagined problems instead of real gaps" (platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices,
item 11).

Native floor, as of 2026-09-02: the memory page already routes a multi-step procedure to a
skill rather than an instruction file (https://code.claude.com/docs/en/memory). What it does
not say is what the skill then owes its caller.

## Keep a skill body short, its references one level deep, and its name equal to its directory

repo-a's `.claude/skills/README.md` (about 40 lines) is the direct source of the cap:
skill body under 500 lines, "when it grows past that, move detail into `references/`, don't
append"; references exactly one level deep, "Claude partial-reads nested files and misses
content"; a default with an escape hatch rather than a menu, and "assume Claude is smart."

repo-c's skills README adds a clause repo-a's lacks: "reference files over 100 lines open
with a table of contents, so a partial read still shows scope." Its own README then demonstrates
the failure the rule guards against: it names `.claude/skills/data-story` as "the worked example
of the multi-file pattern below" and backtick-cites one of its reference files, and neither exists
in repo-c (`data-story` is a repo-a skill). This survived because repo-c's drift scanner
never scans `.claude/skills/`, even though `maintaining-docs.md` lists `.claude/skills/**` in its
own `paths:`.

Native floor, as of 2026-09-02: SKILL.md frontmatter fields and the skill listing context
budget, where a personal or project skill's `name` is a display label and the directory name is
what invokes it (https://code.claude.com/docs/en/skills).

## Disable model invocation on a skill with side effects

repo-a's `data-story` skill makes its own later phases explicit opt-in gates: a four-step
pipeline (Conceive, Explore, Bulletproof, Shape) where "Steps 3 and 4 are explicit opt-in gates,"
never an automatic continuation from exploration into a published finding.

repo-b's deployment rules document the automatic-mode interaction directly: an allow-listed
production deploy can still be classifier-blocked in an automatic mode, and the fix is explicit
intent, not a route around it (`.claude/rules/deployment.md`). repo-a shows the same
behavior in production: `npm run deploy` is soft_deny-blocked by design and needs explicit intent,
a `/permissions` retry, or an `autoMode.allow` rule before it will run.

Anthropic's guidance names the mechanism: set `disable-model-invocation: true` on any skill with
side effects, because "it saves context and guarantees only you fire it" (code.claude.com/docs/en/features-overview,
item 10).

Native floor, as of 2026-09-02: the `disable-model-invocation` frontmatter flag
(https://code.claude.com/docs/en/skills), print mode expanding a skill named in the prompt
string before the turn starts (https://code.claude.com/docs/en/headless), and the auto
permission mode, where a classifier reviews most actions instead of a person.

## Set the model explicitly on every subagent and workflow agent

repo-a's `bootstrap-candidate.md` states the requirement as a hard stop: "this command
requires Opus-class reasoning... If the session is on Sonnet or Haiku, stop and ask the user to
switch models before continuing, drafting these surfaces on a smaller model degrades the editorial
bright line and produces work that has to be redone." The same command pairs it with a cost
constraint stated as an invariant the procedure may not break: "this runs under the user's
existing Max subscription, not via the paid Anthropic API... Do not switch to the paid API."

The gap this rule closes was found empirically, not inherited from precedent. Across repo-b and
repo-c, model tiering does not appear anywhere in `.claude/`, `CLAUDE.md`, or `docs/`; the survey
states it outright: "No model tiering exists anywhere... If the unified package wants
model-tiering guidance, it will be written fresh, not harvested." The actual source is a
repo-a memory feedback item: an omitted model on a subagent or workflow-agent call
silently inherits the session's model, so a wide fan-out runs at whatever tier the session
happened to be in at the time.

Anchor named in the rule file: an eval pair at `plugins/house/evals/explicit-model-tier/`, whose
two arms differ only in whether each call sets a model explicitly.

Native floor, as of 2026-09-02: the print-mode `--max-budget-usd` ceiling (`claude --help`) and
the managed `availableModels` list, which is applied as given rather than merged with a
project's own (https://code.claude.com/docs/en/settings#combine-settings-across-scopes).

## Make a must-hold rule a hook, fail it closed, and test it with real payloads

repo-c's `.claude/settings.json` scopes its hook entry with a declarative `"if": "Bash(git *)"`
filter that repo-b's equivalent hook does not use. The survey flags it as unverified: "worth
verifying against the current Claude Code hook schema; if `if` is not a supported key it is
silently inert and the hook runs on every Bash call." That is the concrete incident behind "the
matcher stays broad because a matcher filter is best-effort, so the script decides."

A repo-a memory item records the corollary on the human side of the same rule: treat a
permission block citing review bypass as evidence of a wrong step earlier, not an obstacle to work
around.

Enforcement anchor in this repo: `tests/hooks/run.sh` drives real payloads through the real hook
wiring, with a denied case, an allowed case, and a planted internal failure, generalizing
repo-a's own `scripts/test-no-direct-master.sh` (`npm run test:hook`), which "deliberately
constructs the literal tokens `git push` and `git commit` via printf, so its own contents do not
trip the installed hook." The fail-closed half comes from repo-b's `no-direct-master.sh`, which
fails closed on a missing `jq` (emits a hand-written deny JSON rather than crashing into "no
decision"); repo-c's version of the same hook does not, and calls `jq` directly.

Anthropic's guidance covers the escalation ladder this heading names: give the agent a check it
can run before you walk away, "or you become the verification loop"; escalate the gate as autonomy
rises, from prompt to condition to hook to verification subagent; and make any rule that must hold
every time a hook, because the instruction file is advisory context
(code.claude.com/docs/en/best-practices, items 1 and 3; code.claude.com/docs/en/hooks, item 8).

Native floor, as of 2026-09-02: PreToolUse hook decision mechanics
(https://code.claude.com/docs/en/hooks), deny and ask rules evaluated whatever a hook returns
(https://code.claude.com/docs/en/permissions#extend-permissions-with-hooks), and the startup
shapes that load no project hooks at all (https://code.claude.com/docs/en/headless).

## Run adversarial review in a fresh subagent with a named lens

repo-e's `reviews/2026-07-24-writing-efficacy-review.md` states the hybrid protocol
directly: the system was judged first against its own rules, then calibrated against current
external guidance with sources listed, and "mechanical fixes apply directly in this commit;
everything judgment-level ships here as a proposal and lands only on the maintainer's approval."

A repo-a memory item covers the failure mode on the other side of an interrupt:
interrupting a turn kills in-flight workflow agents, so the correct recovery is to prefer inline
work and recover a killed fan-out's finished results from `subagents/workflows/wf_*/agent-*.jsonl`
rather than re-running it.

Anthropic's guidance backs both halves of the heading: run an adversarial review in a fresh
subagent context before calling work done, and tell it to flag only correctness and requirement
gaps, "a reviewer prompted to find gaps will always find some, and chasing them causes
over-engineering"; delegate file-heavy investigation to subagents the same way, since they run in
a separate window and return only a summary (code.claude.com/docs/en/best-practices, items 4 and
6).

Native floor, as of 2026-09-02: the bundled local review command, which already runs in its own
subagent over the branch diff and whose background runs apply fixes outside the session's
checkpoints (https://code.claude.com/docs/en/code-review#review-a-diff-locally).

## Plan when the approach is uncertain, and clear the context after two failed corrections

repo-e's `resume_instructions.md` carries the incident behind "re-read the source of a
ruling immediately before you act on it": a ruling landed mid-session and stale context shipped
the pre-ruling wording, which produced the amended rule to re-read the bank immediately before
selection, not once at session start.

Anthropic's guidance covers both halves directly: use plan mode when the approach is uncertain or
the change spans files, and skip it when you could describe the diff in one sentence, because
planning has real overhead; and `/clear` after two failed corrections on the same issue, because
"context polluted with failed approaches loses to a clean session with a better prompt"
(code.claude.com/docs/en/best-practices, items 5 and 7).

## Treat git state as shared across sessions

repo-b's CLAUDE.md states the rule almost verbatim: "Git state is SHARED across sessions here."
A `git checkout` elsewhere moves your branch mid-run and strands uncommitted work; the mitigation
is to ask first, prefer a worktree, and commit early.

A repo-a memory item dates the concrete failure that produced the read-before-every-commit
half of this rule: on 2026-06-05, a peer session moved the branch mid-run on a shared checkout,
which is why the rule reads "check the current branch immediately before every commit and push
instead of trusting what it was at session start."

A second repo-a memory item covers the deploy-time corollary: a deploy publishes whatever
is in the shared laptop database, not the state the merges imply, so the rule squash-merges
another session's branch rather than rebasing it, and never force-cleans a checkout it does not
own.

## Keep the committed settings narrow and the local settings local

repo-a's `.claude/settings.json` (1,062 bytes, 24 entries) allows only read-only or
explicitly-sanctioned commands, with no blanket `Bash(git *)` and no writes to master, while
`.claude/settings.local.json` (21,731 bytes, roughly 250 entries) is the accreted per-machine
allowlist carrying the broad grants (`Bash(node *)`, `Bash(curl *)`, `Bash(git push *)`).

repo-b's tracked settings allow the repo's own script surface plus a read-side `gh` allowlist;
repo-c's version additionally forward-declares pipeline scripts (`db:migrate*`, `sync:stripe*`)
before they exist, so their first run needs no prompt.

repo-d's tracked settings allow exactly the repo's own read and idempotent pipeline commands,
deliberately excluding deploy and PII-egress verbs (`sync.mjs`, `wrangler deploy`), which are
authorized through the skill instead. Its local settings show the accretion failure mode directly:
several entries still reference the pre-rename `~/Documents/repo-f/` path,
dead weight left over from a rename.

repo-e's local settings show the same failure in miniature: two frozen one-off approvals,
one of them hard-coding an expired scratchpad session UUID.

Native floor, as of 2026-09-02: permission lists merging across scopes rather than overriding
(https://code.claude.com/docs/en/settings#combine-settings-across-scopes), the allow and deny
wildcard asymmetry on MCP tool names
(https://code.claude.com/docs/en/permissions#tool-name-wildcards), and a print-mode run loading
project-scoped servers with no approval prompt
(https://code.claude.com/docs/en/mcp#project-server-approvals-and-workspace-trust).

## Read a resume file as a harness artifact, not a handoff

repo-a's `.claude/RESUME.md` is the direct example: an auto-written near-limit checkpoint
carrying a session id, an ISO timestamp, a trigger, a `refs/claude/checkpoint-<id>` snapshot ref,
the `claude --resume <id>` command, and a `/rewind` rollback note with its roughly two-week
retention, checked into the repo as a project artifact even though the harness generated it.

repo-b's survey states the boundary this rule draws in almost the same words the rule file
uses: "RESUME.md is machine-generated, not a hand-authored handoff convention... This is a harness
artifact, not an encoded practice; the unification should not mistake it for a handoff protocol."

## Hand off through a carryover issue

repo-a uses session-carryover issues as the reference implementation, chained one
supersession at a time: the carryover chain #605 to #617 to #638, each opening by naming the
issue it supersedes. Each issue opens with a staleness disclaimer, then states the exact master SHA and
working-tree cleanliness, the `npm run retro` exit code and hard-violation count, tables of live
counts, the PR numbers that shipped, the headline finding with its evidence, an ordered "next
cycle" list, and a "deferred by decision" section that explicitly separates "we chose not to" from
"we forgot."

repo-d and repo-e are the negative case for comparison: neither has a handoff artifact
at all. repo-d's carryover is scattered across `CHANGELOG.md`, `plan.md`, and dated CLAUDE.md
amendments; repo-e's is scattered across `applications_log.md` and `conflict_ledger.md`.
Neither survives a session boundary as legibly as one diffable issue that supersedes the last.

house-rules' own chain (#9, #24, #30) then supplied the correction, dated 2026-08-31: the
original form left every superseded issue open and carried gate exit codes and count tables, so
open carryovers accumulated faster than sessions closed them, and the copied numbers were stale
the moment the tree moved. The revised form closes the superseded issue on supersession and drops
anything re-derivable from the recorded SHA; what remains is exactly the state the next session
cannot reconstruct on its own.

Native floor, as of 2026-09-02: auto memory, the harness's own store for ongoing work, which is
machine-local and shared with nobody (https://code.claude.com/docs/en/memory).

## Check for a peer session before driving shared external state

repo-e's `resume_instructions.md` documents the incident that produced this rule, dated
2026-08-12: a pre-check step was added specifically because "the active document may belong to
another session... This failure had no human in it: a peer Claude session had its own task open."
The fix was listing running agents before touching the shared document.

repo-d's `merge-and-deploy/SKILL.md` "Multi-session reality" section is the deploy-side
version, dated 2026-07-04 and 2026-07-05: `gh pr merge --delete-branch` yanks the invoking
worktree onto master; when a merge succeeded remotely but the local state disagrees, the rule is
to verify the PR state before retrying rather than merging twice; and the section states the
guard directly: "NEVER checkout/pull/ship in MAIN when a parallel session occupies it, deploy from
the merged worktree instead."

## Sources

- code.claude.com/docs/en/best-practices
- code.claude.com/docs/en/hooks
- code.claude.com/docs/en/features-overview
- code.claude.com/docs/en/memory (the `/doctor` trim pass, imports load at launch, and the auto-memory index load ceiling)
- platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- anthropics/claude-code#16299 (open bug report on `paths:`-scoped rule loading)
- github.com/FlorianBruniaux/claude-code-ultimate-guide (CC BY-SA 4.0), read for its model-selection material; the tiering rule above is this package's own expression and adapts nothing from it
