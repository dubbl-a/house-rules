```markdown
# Disposition report: house-rules against Claude Code's native harness

Date: 2026-09-20
Scope: nine rule files in `plugins/house/modules/*/rules/` plus the package's own mechanisms (hook, skills, checker families, render and vendor step, lock file, ledger, eval cases).
Method: one disposition per rule heading, each with evidence and a citation. Every DUPLICATE or CONFLICT claim went to two skeptics, one reading for doc accuracy and one reading for enforcement. A claim counts as confirmed only when neither skeptic refuted it.

## 1. Summary

| Outcome | Count |
| --- | --- |
| Confirmed duplicates | 0 |
| Confirmed conflicts | 0 |
| Complements | 85 |
| Uniques | 51 |
| Downgraded claims | 1 |
| Items classified | 136 |
| Wording changes proposed | 27 |

Nothing in the package duplicates a native harness feature, and after skeptic review nothing conflicts with one either: the single CONFLICT claim, the branch guard's stand-down rule, was refuted by both lenses and downgraded to COMPLEMENT with a narrow bug to fix rather than a contradiction to resolve. The package earns its place, but 27 wording changes are owed, almost all of them attribution rather than substance, because several rules claim a native floor the docs do not state or state the gap more flatly than the docs support.

## 2. Confirmed duplicates

| Item | Heading | Native feature | Citation | Recommended action |
| --- | --- | --- | --- | --- |
| (none) | | | | |

No rule or mechanism restates a native feature without adding a gate, a scope decision, or a posture the harness leaves to the author. Two near-misses are worth naming so they stay visible:

- `lengths` family, auto-memory index warning. The harness already warns on write and errors past the index limit. The package's check is warning-only, silent when the file is absent, and carries a code comment naming the native floor. That is a declared duplicate, which is the shape the owner asked for, so it stays.
- `testing.md`, "Give the agent a check it can run before you walk away". The clause about naming the command in the root instruction file restates something `/init` writes unprompted. The rest of the rule (one command, non-zero exit, chaining suite plus guard tests plus checker) has no native counterpart, so the heading stays COMPLEMENT.

## 3. Confirmed conflicts

| Item | Heading | Native feature | Citation | Recommended action |
| --- | --- | --- | --- | --- |
| (none) | | | | |

One claim was filed as CONFLICT and did not survive review. See section 6.

## 4. Complements worth rewording

Twenty-six rewords carried an action of `reword-to-cite-native-floor`, plus one narrowing change inherited from the downgraded conflict. Grouped by file.

### `plugins/house/modules/claude-code/rules/claude-code.md` (3)

**Make a procedure a skill, not a rule.** The rule asserts the harness says a multi-step procedure belongs in a skill. No fact supports that; the memory docs point growing instructions at path-scoped rules.

> A skill costs only its listed description and trigger text each session, and the harness truncates even that listing, while an instruction file pays for its whole body every time it loads. What the harness does not say is what the skill then owes you.

**Keep a skill body short, its references one level deep, and its name equal to its directory.** A plugin skill's frontmatter name does set its final command segment, so an unscoped name check would fight the plugin path this package ships on.

> Anchor: check.mjs `lengths` caps the skill body, and `shape` fails a personal or project skill whose frontmatter name differs from its directory, leaving a plugin skill free to name its own command segment.

**Disable model invocation on a skill with side effects.**

> The harness offers this field for exactly this case, blocks a model-initiated call to a skill that sets it, and keeps a scheduled prompt from firing one, so treat that as the floor. What it cannot decide is which effects count as side effects, which is why writing, deploying, and spending are named here and why each later phase of a procedure is an explicit opt-in gate.

### `plugins/house/modules/docs/rules/docs.md` (1)

**Opt a point-in-time doc out with a file-level reason.** Classified UNIQUE, but its closing maintainer-notes line generalizes comment stripping past its documented scope.

> Maintainer notes belong in HTML comments, which the harness strips from an instruction file before it reaches context. A document that is only ever opened with the Read tool keeps its comments visible, so write those for the human who will read them there.

### `plugins/house/modules/engineering/rules/engineering.md` (7)

**Build the simplest thing that answers the question.**

> Anchor: none (because "simplest" is a design call); the harness floor is its own code review, which reports reuse and simplification cleanups after the code exists and never blocks a merge, so reaching for the least machinery up front is this repo's requirement.

**Never let a gate mint the answer key it grades against.**

> Anchor: every fixture row carries its label source, and the gate refuses a key written by the tool it grades (`node --test tests/`); the harness floor is an eval run that hides the case definition from the agent under test, which keeps a run from reading its criteria but never asks where the labels came from, so an independently sourced key is this repo's addition.

**Report NOT EVALUABLE and NOT MEASURED rather than a fabricated zero.**

> Anchor: a verdict set that includes NOT EVALUABLE and a null-delta sentinel, with the eval case `not-evaluable-verdict`; the harness floor is a run that marks itself partial when it could not finish and a review that reports an error instead of an empty findings list, so carrying that outcome in every verdict a gate prints is this repo's addition.

**Show the ratio and the sample, because one number is never the accuracy.**

> Anchor: the measurement harness prints n beside every rate and refuses to combine two estimands (`node --test tests/`); the harness floor is published guidance that one set of runs reads as near certain or near impossible depending on which pass statistic is meant, so attaching the sample and the estimand to every published rate is this repo's requirement.

**Make a measuring instrument reproducible.**

> Anchor: seeded regeneration asserted byte-identical in `tests/`; the harness floor is an isolated run with a pinned model and a cost figure computed locally at list price, which hold the agent steady but leave the sampling and the pricing basis to move underneath you, so seeding the fixture and recording the basis are this repo's addition.

**Assert an invariant where its state is created, with a why and a remedy.**

> Anchor: `npm run retro`, which refuses a check missing its why or remedy and exits non-zero on a hard violation; the harness floor is that written guidance is context rather than enforcement and only a blocking hook stops an action regardless of what the agent decides, so asserting the invariant in code where the state is created is this repo's requirement.

**Read config from the environment, and keep build, release, and run separate.**

> Anchor: the config module throws at startup on a missing key, and `.env.example` lists every key; the harness floor is a sandbox with no built-in credential deny list and an agent that treats reading a local env file as ordinary, so keeping every secret in the environment and out of the repo is this repo's requirement.

### `plugins/house/modules/github/rules/github.md` (2)

**Give a workflow read-only permissions and pin every action by SHA.**

> Anchor: the rendered `.github/workflows/pr-checks.yml` ships the read-only default and the SHA pins; copy it when you add a workflow. A workflow the agent platform's own setup command installs is a workflow in this repo too, so give it the same permissions block and the same SHA pins rather than merging it as shipped.

**Ship phased work as commits on one PR.**

> Anchor: none (because PR granularity is a judgment call, and the base-retarget confirmation is a look at the open PR list). A background session commits, pushes, and opens a draft pull request on its own, and the parallel-change command opens one per unit, so say which shape phased work takes before dispatching it that way.

### `plugins/house/modules/testing/rules/testing.md` (1)

**Test the guard itself, as its own CI step.** The flat claim that nothing native exercises a hook overstates the gap, since the eval runner loads a plugin's own hooks inside an isolated run.

> The harness makes a hook the thing that actually blocks, and the eval runner will load a plugin's own hooks inside an isolated run, yet nothing native asserts that a hook still returns its blocking decision, so the guard's own test is the only standing proof that it still fires.

### `plugins/house/modules/database/rules/database.md` (1)

**Write forward-only numbered idempotent migrations, each opening with what and why.**

> Take the next number from the ledger, the committed files, and every sibling checkout's uncommitted files, because the harness puts background sessions and worktree runs in their own checkouts under the repo's worktree directory, so a number claimed there appears in no commit this checkout can see. Its isolation keeps writes off the main checkout but coordinates nothing about a shared database, so the ledger plus a sweep of sibling checkouts is the control.

### `plugins/house/modules/deployment/rules/deployment.md` (3)

**Deploy manually after the merge, because a merge is not a production update.**

> Anchor: none (the harness only reviews a deploy command in auto mode and cannot observe that a merge was meant to ship; the named deploy script is the only path to production and the docs must say so out loud).

**Chain the deploy guards before building anything, and give them one named escape hatch.**

> Unchecked is not passing, so an empty list of check runs fails closed rather than reading as success, because GitHub starts no workflow run at all for a commit pushed with the default workflow token and leaves the tip genuinely unchecked.

**Migrate before deploying the code that reads the schema.**

> Anchor: the ordered ship script (`npm run ship`), which runs the migration step before the deploy step and exits at the first failure by name, because auto mode holds a production migration for review but has no notion of which step must come first.

### `plugins/house/modules/llm-output/rules/llm-output.md` (3)

**Quarantine model output until a human moves it.**

> The harness floor is its approval prompt on a write, which an accept-edits mode pre-approves and which lapses with the session, so the durable gate has to be structural: generate into an untracked directory and let a person move each file into the tracked one, because the move is the sign-off and a structural gate cannot be skipped the way a review can.

**Gate output on status tags.**

> The harness decides which tool calls proceed through its own allow rules and its auto mode classifier, neither of which can see a row's confidence; on that floor, auto-approve only the confidence band and action set that are safe to auto-approve, carry the rest forward instead of pausing for a click, and surface borderline rejections inline so an override is cheap.

**Read agreement with a shown suggestion as anchored, not accurate.**

> A hosted reviewer already collects agreement marks on the findings it shows and feeds them back into its own tuning, which is this anchored measure and not a quality one. When a reviewer sees the model's suggestion beside the evidence, their agreement measures anchoring rather than accuracy, so that rate is never quotable as a quality number.

### Package mechanisms (5, plus the downgraded guard)

**`drift` family.**

> The managed review service already flags a statement a change has made stale, by judgment, on pull requests, and only where that service is available. This family is the deterministic floor under it: every anchor token in every tracked doc resolves against the repo on every local run, or it is a finding.

**`shape` family.**

> The harness asks for specific, concise instructions and its checkup proposes trims, both by judgment and both advisory. This family is the mechanical half of that: a heading that is not itself the rule, or a claim with no anchor naming what enforces it, is a finding rather than a suggestion.

**`guard` family.**

> Count a settings file as this repo's guard only when one of its PreToolUse entries matches the Bash tool, mirroring what the hook itself defers to. Any other PreToolUse hook blocks something else, and certifying it reports protection this repo does not have.

**Render and vendor step.**

> A plugin cannot ship project rules, and the native alternative of symlinking a shared rules directory into a project loads only the rules without a paths field, and only once the project has approved external imports. Rendering real files into the repo is what keeps a path-scoped rule loading at all, which is why the vendored copy is the source of truth.

**Upstream-first sync.**

> The harness already refuses a write through a symlinked instruction file and sends the edit to the link's target instead. A vendored copy is the same situation with no link for the tool layer to follow, so the refusal has to name the package repo by hand, and the upstream pull request is the preferred exit for the same reason.

**PreToolUse branch guard (downgraded from CONFLICT, now a narrowing reword plus a bug fix).**

> Defer to a repo-local settings file only when one of its PreToolUse entries actually matches the Bash tool. A PreToolUse hook that matches other tools guards something else, so standing down for it gives up real enforcement and buys nothing.

## 5. Unique mechanisms

Fifty-one items have no native counterpart at all. This is the package's reason to exist.

**Doc and anchor integrity (3)**, from `docs.md`: anchor every claim to a grep-able token; opt a point-in-time doc out with a file-level reason; do not document a command that does not exist.

**Build, gates, and published figures (8)**, from `engineering.md`: one implementation per computation; verify the served artifact, not the source; validate the body before writing; read a missing field as missing; land a build-time guard with the code it protects; pin a framework default with the reason beside it; enumerate from the system of record; normalize against fixed anchors.

**Repository and supply posture (8)**, from `github.md`: open an issue instead of failing a scheduled run; push protection, head-branch deletion, and grouped dependency updates; closing keywords beside an issue number; a restricted key with exactly one writable scope; never log a vendor object; treat a preview URL as production; label a non-secret as a non-secret; ship the community files and keep issue intake as forms.

**Test discipline (8)**, from `testing.md`: scale the pyramid to the repo; positive and negative controls on every gate; read the snapshot diff before accepting it; quarantine a flaky test loudly; coverage as a search-light; mirror the module layout in the test tree; explain a runner config quirk with its incident; keep a demoted check running, reported, and counted.

**Data pipelines (9)**, from `data-pipelines.md`: the per-run retro; idempotent and resumable runs with a logged ledger; write nothing when a record is unchanged; a policy registry that fails closed; make unmapped input loud; archive first and parse second; reconcile a vendor's success against an independent count; name rather than act on ambiguous data; key a projection on its source's whole grain.

**Database domain (3)**, from `database.md`: provenance columns as behavior; row lifecycle deciding a new table; money as integer cents reconciled against the books.

**Deployment (3)**, from `deployment.md`: verify the deployed URL against the built file with the cache bypassed; repoint and deploy the consumer before dropping the producer's column; restore a backup before calling it a backup.

**Model output (3)**, from `llm-output.md`: a deterministic backbone with model-filled slots; cite or stay silent; reword a locked claim, never strengthen it.

**Package mechanisms (6)**: the `todo` family; the `tamper` family; the `manifest` family over `house.json`; the `minutes` family estimating cron against a monthly budget; the lock file recording provenance and body hashes; the deviations ledger and its one-way ratchets.

## 6. Downgraded claims

One claim, one downgrade.

**PreToolUse branch guard, CONFLICT to COMPLEMENT.** The claim was that the guard's stand-down on any non-empty `PreToolUse` array in the repo's settings file surrenders enforcement, because the harness runs every matching hook and keeps the most restrictive answer.

- The doc-accuracy skeptic refuted it on sourcing. The cited page does not contain the "most restrictive answer" combination rule; the repo's own survey sources that fact to a different page. The skeptic also found the repo's audit ledger already carries this item as COMPLEMENT with a reword action, and the guard script's own header comment already states the multi-hook merging behavior and calls the deferral a deliberate migration choice. Downgrade to COMPLEMENT.
- The enforcement skeptic refuted it on mechanism. The matcher-blind test is real and untested, but an Edit-scoped local hook never enters the matching pool for a Bash git command, so the native merge behavior is orthogonal to the gap rather than its cause. Everything else in the guard (protected-branch matching, worktree-aware target resolution, quote and flag stripping, carve-out globs, fail-closed on missing `jq`) is unique, and the package's own hook registration is correctly scoped to Bash. Downgrade to COMPLEMENT, with the matcher-blind stand-down treated as a targeted bug.

Both lenses agree, so the disposition is COMPLEMENT. The finding survives as a narrow defect: the stand-down should test the local entry's matcher, not just the array's emptiness, and the `guard` family should apply the same test before certifying protection.

## 7. PR plan

Every PR that touches `plugins/house/modules/*/rules/` also re-renders the vendored copies under `.claude/rules/house/` and updates the lock file, because this repo self-adopts. Run `npm run check:house` and `npm run verify` on each branch before pushing.

**PR 1: narrow the branch guard's stand-down to a Bash-matching hook.** Major. This changes the hook's contract.
Files: `plugins/house/hooks/no-direct-master.sh` (the deferral test at line 450), `plugins/house/payload/check.mjs` (`guard` family), `tests/hooks/run.sh`, `tests/check/guard.test.mjs`, the rendered guard copy and lock. Add a regression case for a repo whose only local `PreToolUse` entry matches `Edit|Write`. Do this first, since it is the only behavioral defect the audit found and the `guard` family reword depends on it.

**PR 2: engineering rule attribution rewords.** Minor under ADR 0011, rule prose only.
Files: `plugins/house/modules/engineering/rules/engineering.md` (seven headings), plus the render and lock. No heading, slot, or anchor identity changes; only Anchor lines and floor sentences.

**PR 3: remaining rule prose rewords.** Minor under ADR 0011.
Files: `plugins/house/modules/docs/rules/docs.md`, `plugins/house/modules/github/rules/github.md`, `plugins/house/modules/testing/rules/testing.md`, `plugins/house/modules/database/rules/database.md`, `plugins/house/modules/deployment/rules/deployment.md`, `plugins/house/modules/llm-output/rules/llm-output.md`, plus the render and lock. Eleven rewords, none touching a heading or a slot.

**PR 4: claude-code rule rewords, with the skill-name check scoped to personal and project skills.** Major if the checker changes; minor if verification shows `shape` already scopes correctly.
Files: `plugins/house/modules/claude-code/rules/claude-code.md` (three headings), `plugins/house/payload/check.mjs` (`shape` name check) only if it currently fails a plugin skill whose frontmatter name differs from its directory, plus `tests/check/` coverage for the plugin case, the render and lock. Verify the current `shape` behavior before writing the Anchor line, since the proposed wording states a scope the check must actually have.

**PR 5: mechanism and handbook attribution.** Minor, documentation prose.
Files: the `drift`, `shape`, `render and vendor`, and `upstream-first sync` descriptions wherever they are documented, and `docs/handbook/sources/harness-survey.md` to correct the citation for the multi-hook combination fact (it belongs to the hooks guide page, not the hooks reference page) and to record this audit's dispositions.

Optional follow-up, not required by a confirmed finding: a second reword on `deployment.md` "Invoke a deploy only through its named script", adding the caveat that a Bash deny rule matches command text and is not a security boundary around the program.

## 8. Open questions

These could not be settled from the gathered docs and should be checked against the live harness before the next release.

1. Does print mode have a cost or budget ceiling flag? The `claude-code` rule says to give a scripted run "the print-mode budget ceiling flag", but the only documented ceiling is `--max-cost-usd` on `claude plugin eval`. Check `claude --help`.
2. Does a print-mode run load a project's MCP servers with no approval prompt? The rule claims it does. The gathered facts say the opposite direction for workspace trust: a print-mode run skips the trust dialog, so project allow rules and additional directories are not used. The MCP loading claim is unverified either way.
3. What does the harness actually write on stop? No fact describes a file carrying a session id, a snapshot ref, and a resume command. Transcripts are JSONL under the project directory. The rule's posture holds regardless, but the artifact it names may not exist.
4. What are the real mode names for a session that does not load project hooks? The rule says "bare, safe mode, or restricted mode". The docs name `--restricted`, `allowManagedHooksOnly`, and `disableAllHooks`. "Safe mode" appears nowhere.
5. Is there a documented cap on a skill body? The rule says to hold the body under the documented cap. The only documented numbers are the description and trigger-text truncation and the compaction re-attachment budget.
6. Does `shape` currently fail a plugin skill whose frontmatter name differs from its directory? This decides whether PR 4 is major or minor.
7. What are the exact eval frontmatter key spellings? The package's cases use `max_turns`, `timeout_seconds`, `allowed_tools`, and `runs`. Only `runs` and `allowed_tools` were confirmed.
8. Does `.env.example` match the name-based credential exclusion when a repo is bundled to a cloud session? If it does, a file whose whole job is to list key names never uploads, which affects the "label a non-secret" rule.
9. Is a one-line-per-guard list in the root instruction file at risk from the trim checkup? The checkup keeps conventions that differ from tool defaults but cuts what it can derive from the codebase. Worth watching if the root file nears its ceiling.
10. The `database.md` "Don't" section claims every prohibition is caught by the anchor of the rule it inverts, which is untrue for the two prohibitions inverting "Back up before a destructive migration", whose anchor is explicitly none. Internal consistency, not a harness question, but it needs fixing.
11. Does the `branch-and-pr` eval's trace-shape grading generalize? It is defensible here because the behavior under test is the path taken, but published guidance warns that trace-shape grading is brittle. Set a standard before more cases copy the pattern.
```