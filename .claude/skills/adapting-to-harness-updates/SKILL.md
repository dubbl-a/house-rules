---
name: adapting-to-harness-updates
description: Adapts house-rules to a newer Claude Code release or Claude model, so the package keeps complementing the harness instead of duplicating or contradicting it. Surveys what moved since the last dated survey, classifies every affected rule and mechanism, verifies each duplicate or conflict adversarially, applies the rewords, records a dated survey section, and ships a release. Use when the user says "adapt to the latest Claude updates", "a new Claude Code version is out", "a new model shipped", "re-survey the harness", or "is house-rules still current with Claude Code".
disable-model-invocation: true
---

# Adapting to harness updates

The package's standing test: complement and improve the harness, and never duplicate or conflict
with it unless that is declared on purpose, with the native floor named. A harness release can
break that test three ways. It can ship natively what a rule or mechanism does, so the rule becomes
a duplicate. It can change behavior a rule describes, so the rule becomes a conflict. Or it can add
a floor a rule should cite. A new model can also make a rule's prompting style dated even when
every fact in it still holds. This skill finds all four and fixes them.

## Default path

1. **Enter a worktree off `origin/main`** before anything else. The survey workflows read a clean
   checkout, so point them at a second worktree nobody edits.
2. **Find the baseline.** The last surveyed version and date are in the final dated section of
   `docs/handbook/sources/harness-survey.md`. The latest re-survey section there names the
   research bank directory. The model facts of record are in the "ladder" paragraphs of
   `docs/handbook/claude-code.md`. `npm run check:harness` prints that baseline and every
   changelog version since it, and the scheduled `harness-watch` Action files one
   `harness-update` issue when the list is not empty. When the `HARNESS_ROUTINE_URL` and
   `HARNESS_ROUTINE_TOKEN` secrets are set, the Action also fires a cloud routine. The routine runs
   the delta addendum path and opens a draft PR on `claude/harness-addendum-<version>`. When that
   PR exists, start from it rather than re-triaging. Compare against `claude --version` too.
3. **Run the gate under the new CLI** before reading anything: `npm run verify` on a clean
   checkout. The plugin validator runs with `--strict`, so a warning a release adds fails the
   gate, and a changelog triage can read that entry as noise.
4. **Collect the delta** into the scratchpad, one source per agent:
   - the Claude Code changelog sections since the baseline
     (https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md), the only source
     that dates a change;
   - the models overview and model-config pages, for new models, defaults, prices, and effort;
   - the harness's own prompt audit over this repo (`/doctor prompt-audit` in a session). It
     reports stale paths, dead commands, contradicting instructions, and prompting patterns
     written for older models.
5. **Choose the depth.** Use the judgment below. Say which one you picked and why.
6. **Triage and classify.** Every candidate gets one disposition: DUPLICATE, CONFLICT, COMPLEMENT,
   or UNIQUE (definitions in [references/dispositions.md](references/dispositions.md)). Grep the
   rule files, `plugins/house/orchestration/ORCHESTRATION.md`, the agents, the hooks, the skills,
   and the evals for any text that claims the old behavior.
7. **Verify.** A DUPLICATE or CONFLICT counts only after two skeptics fail to refute it. One reads
   for doc accuracy and one for enforcement reality, and each defaults to refuted when unsure. The
   session then reads the cited line and the rule text itself. Anything you can settle by running
   it (`--help`, a hook with a real payload, the checker), run.
8. **Act on the disposition.** Resolve a conflict in the rule or hook. Retire a duplicate, or keep
   it as a declared duplicate that names the native floor. Reword a complement only where the rule
   claims or implies a floor, and cite the fact. Record a unique and leave it. A prompt-audit
   finding changes wording, never a rule's claim, and it has to fit the rule shape the checker
   enforces.
9. **Record** in the three places described in
   [references/recording-and-release.md](references/recording-and-release.md). Then ship through
   the release flow there.

## Choosing the depth

**Delta addendum** (the default). Triage only the changelog sections and model changes since the
baseline, with one researcher per source. Classify the hits against the rule surface, then write a
dated `## Addendum` section. This fits a release or two of fixes and small features, and a model
change whose effect is on tiers and effort.

**Full re-survey.** Re-research every harness area from the docs, classify every rule heading and
mechanism, verify, synthesize, and run a completeness critic. Then run a gap pass over whatever
the critic names. Run the changelog triage from the delta path beside it: doc pages carry no dates,
so without the changelog a full run cannot tell a current page from a stale one. Signals that the
addendum is not enough:
- the delta touches several areas at once;
- a new model family or default arrives;
- the prompt audit flags patterns across many files;
- an addendum turns up a conflict in an area whose banked facts predate the change;
- the last re-survey's critic listed areas nobody has researched since.

The scripts are `scripts/house-vs-harness-audit.js` (main) and `scripts/house-vs-harness-gap-audit.js`
(gap). Each takes `args.repo` (an absolute path to the clean worktree) and `args.date`. The gap run
also takes `args.areas` and `args.targets` from the critic's findings. They run through the
Workflow tool, which needs the user's explicit opt-in. Before asking, state the agent count: the
main run is one researcher per area, one Opus classifier per module plus one for mechanisms, two
skeptics per duplicate-or-conflict claim, and two synthesis agents.

## Hazards

- **Most findings are attribution, not substance.** The largest re-survey so far found no
  duplicates and no conflicts, but did find 27 rewords where a rule claimed a native floor the docs
  do not state. Before any rule says the harness does something, the fact has to exist in the bank
  or on a fetched page.
- **Skeptics see only duplicates and conflicts.** A complement's proposed reword reaches the
  report without being verified, and it can overstate the harness as easily as the old text did.
  Send a refuter to check each reword against the banked facts before it ships.
- **A naive heading count skips a rule.** Every rule file ends in `## Don't`, and some real rules
  start with "Don't". Count headings by exact match, not by prefix.
- **Doc pages carry no dates.** Record the fetch date beside every citation. If the changelog and a
  page disagree, trust the changelog on when and the page on what.
- **Model settings live outside the repo.** The subagent floor and per-model effort are user
  settings. When a model change moves them, tell the user what to set; never edit their settings
  from here. A newly released model runs at its own default effort until a per-model level applies.
- **A prompt-audit finding can collide with house shape.** An audit flag on a prohibition list or
  a hard number is a style signal. The `## Don't` section and the length ceilings are checked shape
  and ratchets, so changing them is a package decision under the ADRs, not a reword.
- **The branch guard reads command text.** Write PR bodies and commit messages that mention git
  verbs near branch names with the Write tool, then pass them with `--body-file` or `-F`.
- **Subagents do not commit.** The session commits and pushes whatever an agent prepared.

## When an edit here takes effect

This skill is repo-local. An edit reaches the next session that invokes it by name, and nothing
ships to adopters. What reaches adopters is the rule and mechanism changes it produces, through a
release and each adopter's `render --apply`.
