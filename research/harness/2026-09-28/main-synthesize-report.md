# House rules vs Claude Code harness: disposition report

Date: 2026-09-28
Scope: the nine rule modules under `plugins/house/modules/`, plus the package's own mechanisms (hooks, skills, checker families, orchestration defaults, agent roster, eval cases). That is 148 classified items in total.

## 1. Summary

| Outcome | Count |
|---|---|
| Confirmed duplicates | 0 |
| Confirmed conflicts | 0 |
| Complements | 96 (91 classified that way, plus 5 downgraded) |
| Uniques | 52 |
| Downgraded claims | 5 (2 duplicates and 3 conflicts, each refuted by at least one skeptic) |
| Complements with a recommended reword | 46 |

**Headline.** The audit found nothing in the package that duplicates or fights the harness. All five duplicate or conflict claims fell apart under the enforcement lens, because in each case the house text either reaches the model where the native guidance does not, or sets a stricter policy than the native default. The update the harness does call for is a citation pass: 46 rules and mechanisms describe their native floor loosely or not at all. A few claim more than the harness does, and a few claim less.

Themes that run across modules. These are the "larger update" worth doing as a set rather than one rule at a time.

- **Auto mode is now the built-in starting mode.** That thins several floors the rules assume:
  - broad allow rules are suspended in favor of the classifier
  - edits inside the working directory are auto-approved
  - destructive commands are judged by the classifier rather than prompted
  - pushes to the default branch are allowed

  The settings, quarantine, prune brake, staging, deploy, and branch-policy rules all need wording that names this.
- **`/doctor` prompt-audit and the CLAUDE.md trim check are the native advisory floor under most of the docs rules.** They run on request and only propose edits. The house gates should cite them the same way everywhere.
- **The harness's own worktree tool should be preferred over a manual `git worktree add`.** The manual route skips the base-branch setting, `.worktreeinclude`, and the cleanup sweep. `claude-code.md` and `ORCHESTRATION.md` both present the two routes as equal.
- **Several anchors overstate native behavior.** Examples: "the harness pins the model", "marks a run partial on failure", "the hosted reviewer feeds agreement marks into its tuning", "a background session opens a draft PR". A few understate it, for example "nothing local keeps a key from the chat", when opt-in deny, mask, and scrub layers exist.

## 2. Confirmed duplicates

None. Both duplicate claims were refuted by at least one skeptic and appear under section 6.

| Item | Heading | Native feature | Citation | Recommended action |
|---|---|---|---|---|
| none | | | | |

## 3. Confirmed conflicts

None. All three conflict claims were refuted by the enforcement skeptic, and one by both skeptics. See section 6.

| Item | Heading | Native feature | Citation | Recommended action | How to resolve |
|---|---|---|---|---|---|
| none | | | | | |

## 4. Complements worth rewording

Every change here is rule prose, an anchor line, a code comment, or a skill or agent body. No heading changes.

### modules/claude-code/rules/claude-code.md

1. **Put only what Claude would get wrong without it in the root file.** The native floor is a user-facing warning, not advice the model may ignore.
   > The harness advises this already but stops at advice and warnings: its checkup proposes cutting derivable content, and its length warning at startup and in status never blocks a long file.
2. **Keep the auto-memory index to hooks, and hold it under its cap.** The harness reminds and errors after a write, but does not shorten the file itself.
   > The harness reminds Claude to shorten the index after a write that nears its load ceiling and returns an error on one that passes it; treat that as the floor and add what it cannot see.
3. **Give a domain rule a paths list, and never leave a rule file unscoped.** The rule does not name the compaction trade-off.
   > Confirm the scoping defers loading before you count on it, and remember a scoped rule is summarized away at compaction and returns only when a matching file is read again, so a rule that must survive compaction belongs in the root file.
4. **Make a procedure a skill, not a rule.** The native docs point to skills as well as path-scoped rules, and a native eval runner exists.
   > The harness points a growing instruction file to a skill or a path-scoped rule and stops there; what it never says is what a skill then owes you. Write a few evaluations before the prose, with the native plugin eval runner or skill-creator's evals, to fix real gaps, not imagined ones.
5. **Set the model explicitly on every subagent and workflow agent.** An omitted model resolves through the subagent model variable before it falls back to the session's model.
   > Name the model on every agent call, because the harness resolves an omitted one through the subagent model variable and then to the session's model, so a wide fan-out otherwise runs at whatever tier you happened to be in.
6. **Make a must-hold rule a hook, fail it closed, and test it with real payloads.** A timed-out pre-tool hook also fails open.
   > Fail it closed: a crash, a missing helper, or an unreadable payload denies rather than passing quietly, since the harness reads any exit but the blocking one as no objection and lets a stalled pre-tool hook through on timeout.
7. **Treat git state as shared across sessions.** Prefer the native worktree tool.
   > Enter a worktree before the first edit or branch as the first step of every plan, preferring the harness's worktree tool, which applies its base-branch, include, and isolation defaults, over a manual `git worktree add -b <branch> <path> origin/<default>`, which skips them; the main checkout is what every peer and the user hold.
8. **Keep the committed settings narrow and the local settings local.** Auto mode suspends broad allow rules.
   > Say in the file that this is not a boundary, since a heredoc and a pipe still run under a broad allow, auto mode suspends a broad allow in favor of its classifier, and only the sandbox or a hook enforces independent of command text; never grow the deny list chasing completeness.

### modules/docs/rules/docs.md

1. **Anchor every claim to a grep-able token.**
   > The harness's prompt audit catches a reference to a missing file or command in instruction files, but only when someone runs it and only as a proposal; anchoring every claim to a token lets the gate catch that drift in every scanned doc on every commit.
2. **Give every rule file a paths list whose first segment resolves.**
   > The harness loads a rule with no `paths:` at launch at project-instruction priority, loads one whose frontmatter fails to parse as if it had none, and says nothing when a glob matches no file, so this check is the only signal. A rule that must hold in every session, or survive compaction, belongs in the root file; everything else gets scoped.
3. **Put a fact where its litmus test says it belongs.** The current text says the harness "routes" facts, which overstates advisory guidance.
   > The harness advises keeping only broad facts in the root file, moving procedures to a skill and path-bound facts to a path-scoped rule, and its checkup proposes cutting what the code already says. This rule carries that split to the README, the changelog, and the archive, where nothing native reaches: the README for a landing human, the archive for a dated observation.
4. **State a rule as imperative, why, anchor, receipts.** This keeps the `## Don't` section from reading as a bare prohibition list to the prompt audit.
   > The why and the Anchor line are what the harness's prompt audit looks for when it judges a prohibition by its provenance and an instruction by whether anything enforces it; keep each `## Don't` line the negative of a rule above, so it inherits that rule's reason instead of reading as a bare ban.
5. **Move dates, names, and measured numbers out of rule prose.**
   > The harness's prompt audit flags volatile specifics and a one-session lesson written as a permanent rule, but only when run and only as a proposal; the shape check makes the same test a gate on every commit.
6. **Keep files under budget, and raise a ceiling only with a written reason.**
   > The harness warns at startup and in its status view when an instruction file passes its recommended length or the loaded set passes a combined limit, and skips only a file past its hard size cap; it never holds a file down, so hold every document to its own ceiling: root file, rule files, README, skill bodies, handbook chapters.
7. **Split a file only when splitting narrows what loads.**
   > The harness loads an `@` import and a rule with no `paths:` at launch, so splitting into either narrows nothing; only a path-scoped rule, a nested instruction file, or a skill defers what loads.
8. **Opt a point-in-time doc out with a file-level reason.** Comment stripping is documented for CLAUDE.md files only. See open questions.
   > Maintainer notes belong in block-level HTML comments, which the harness strips from an instruction file before context but keeps inside a code block and in any file opened with the Read tool, so write those for that reader.
9. **Don't document a command that does not exist.**
   > The harness's prompt audit flags a command or file that does not exist in instruction files when someone runs it; the gate carries that check to the README, the changelog, and every scanned doc, on every commit.

### modules/engineering/rules/engineering.md

1. **Report NOT EVALUABLE and NOT MEASURED rather than a fabricated zero.** The eval runner marks a run partial only when it stops early.
   > Anchor: a verdict set that includes NOT EVALUABLE and a null-delta sentinel, eval case `not-evaluable-verdict`; the harness marks a run partial only when it stops early and omits a delta when its arms are not comparable, so carrying a could-not-evaluate outcome in every verdict is this repo's addition.
2. **Show the ratio and the sample, because one number is never the accuracy.**
   > Anchor: the measurement harness prints n beside every rate and refuses to combine two estimands (`node --test tests/`); the harness's eval runner repeats each case and reports a mean score, but never states the sample or estimand beside it, so attaching both to every rate is this repo's requirement.
3. **Make a measuring instrument reproducible.** The harness advises pinning the model; it does not pin it.
   > Anchor: seeded regeneration asserted byte-identical in `tests/`; the harness advises pinning the model, replays recorded mock answers, and reports cost at list price unless a managed pricing table applies, but leaves fixture sampling unseeded, so seeding the fixture and recording the pricing basis are this repo's addition.

### modules/github/rules/github.md

1. **Open an issue instead of failing a scheduled run, and comment out a cron with its reason.**
   > Anchor: none (because a failure policy is a per-workflow editorial choice no checker can read). A scheduled agent run writes only to its run log unless its prompt directs it to post and its allowed tools include the issue command, so grant those before counting on the issue.
2. **Ship phased work as commits on one PR.** The current anchor's claim that the harness opens PRs per unit is unverified.
   > Anchor: none (because PR granularity is a judgment call; base-retarget confirmation is a look at the open PR list). A fan-out command such as /batch or a background session works each unit in its own worktree, so say which shape phased work takes before launching one.
3. **Stage explicit paths, never everything at once.**
   > Anchor: the `pre-commit` template refuses a staged secret, and auto mode's classifier blocks a secret-bearing commit by default; both backstop a wide add without licensing one, and neither catches a local-only file that holds no secret. A staging-broad permission rule allows sweep-everything too, so the prompt filters nothing.
4. **Keep credentials out of the repo, the commit, and the chat.** Name the opt-in native layers.
   > Anchor: push protection at the remote, backstopped by the `pre-commit` template's staged-secret refusal; remote is the guard, hook the backstop. By default credential files stay readable to a session and a subprocess inherits its environment; a Read deny rule, the sandbox's credential deny or mask, and the subprocess scrub variable narrow that, but none is on until configured.
5. **Enforce the branch policy where git resolves the ref, and let the text scan catch only the ways to disable it.**
   > Keep the PreToolUse hook's job to verifying the floor is intact and refusing its short disable/bypass list, never inferring a branch or tree from text, since the harness documents text-matched rules as no boundary, lets auto mode push to the default branch by default, and loads no project hooks in a bare or safe-mode session while git still runs its own.

### modules/testing/rules/testing.md

1. **Give the agent a check it can run before you walk away.**
   > The harness's own guidance already says to give the agent a check that produces a pass or fail; treat that as the floor and ship it as one command that answers "did this work" with nobody watching, because without it you are the verification loop and every change waits on your attention.
2. **Split deterministic tests from model-behavior evals, and give each its own budget and cadence.** "Aborts a run" overstates the cost ceiling.
   > Give the eval tier its own budget using the runner's own controls rather than a promise: set the cost ceiling, which stops new runs once spent and exits with partial results while in-flight runs finish, and the threshold that exits non-zero when a case scores below it, then keep that tier out of the merge gate and on a cadence a person can pause by hand.
3. **Feed a real payload through the real wiring, and never re-implement the logic under test.** A schema-failing JSON object is a non-blocking error.
   > Assert on the contract the harness itself reads: the documented event payload on stdin, the exit code whose blocking meaning the hooks reference fixes per event, and stdout that decides only when it parses as JSON passing the hook output schema, since a malformed decision is a non-blocking error that lets the action through.

### modules/database/rules/database.md

1. **Add the table registry line in the same PR as the migration.**
   > Anchor: a schema invariant that fails on an unregistered table and on a stale registry line, run before any publish or deploy, because the hosted review flags an outdated CLAUDE.md statement only as a non-blocking nit, reads a registry elsewhere only when a review instructions file asks it to, and is not available in every org.

### modules/deployment/rules/deployment.md

1. **Invoke a deploy only through its named script.** A Bash deny matches command text, not the program. The `## Don't` anchor makes the same overstatement and needs the same softening.
   > Anchor: the committed Claude Code settings permissions, which deny the raw platform CLI and allow only the named deploy script (`npm run deploy`); the harness evaluates that deny before any allow, hook, or mode, but it matches the command text Claude writes rather than the program, so a wrapper or an absolute path gets past it, and the script's own guards remain the real gate.

### modules/data-pipelines/rules/data-pipelines.md

1. **Default to a dry run and require an explicit flag to write.**
   > Make the dry run the default and `--apply` the opt-in: the harness gates the file tools Claude calls directly, and its sandbox bounds where a script may write, but neither judges what a running script writes to a store, and rewind cannot undo it. So a new script's first run is a plan a human reads, not an unasked change.
2. **Brake a prune at a share of the table, and unit-test the brake.**
   > Refuse to delete more than a set share of a table per run and require explicit `--force` to override: the harness's permission check and auto mode classifier judge the command line, never the rows a script deletes once running, so a table-emptying run looks like one clearing a few stale rows until the count returns.

### modules/llm-output/rules/llm-output.md

1. **Quarantine model output until a human moves it.**
   > The harness floor is its approval prompt on a write, which auto mode, now the built-in starting mode, and accept-edits both waive for edits inside the working directory, and which never outlives the session, so the durable gate must be structural: generate into an untracked directory and let a person move each file into the tracked one; that move is the sign-off, and unlike a review, cannot be skipped.
2. **Keep a deterministic backbone and let the model fill the slots.**
   > Anchor a printed run or a workflow agent on a supplied output schema where one applies, since the harness validates the payload against it, retries, and fails the call when the output cannot conform; a schema fixes shape, not footing.
3. **Treat silence as not approval.**
   > Where the harness gates a write, its permission prompt is the floor, and it already refuses an agent message as consent on a person's behalf; elsewhere, show the diff and wait for an explicit yes before generating a file, since silence is not approval, nor is an unanswered question. Plan mode holds edits until approved, but the hold ends there, does not bind where bypass permissions apply, covers edits rather than every write, and a teammate's plan is approved in the lead's session unread.
4. **Read agreement with a shown suggestion as anchored, not accurate.** The tuning claim about the hosted reviewer is unsupported.
   > The harness's skill comparator already judges two outputs without knowing which is which; extend that blinding to every human review, since a person's agreement mark on a finding shown to them is an anchored measure, not a quality one.

### Package mechanisms

1. **Skill: handoff** (`plugins/house/skills/handoff/SKILL.md`, opening):
   > The harness already resumes a session's full history with --continue or --resume and keeps machine-local auto memory, so the snapshot carries only what those cannot: next steps and decisions another machine or person has to find in the repo or its issues.
2. **Render and vendor step.** ADR 0001 never weighed plugin skills with `paths:` frontmatter.
   > Plugin skills with paths: frontmatter are the harness's own route for shipping scoped instructions in a plugin; they are declined here because every enabled repo takes an update the moment the plugin updates, with no per-repo pin, config, or deviation record.
3. **Ratchets:**
   > The harness warns at startup and in /status when an instruction file passes its recommended length or the loaded set passes a combined limit; the ratchet adds what that warning lacks, a per-file ceiling that only tightens and rises only with a recorded reason.
4. **Checker family: drift:**
   > Native floor: /doctor prompt-audit reports references to files or commands that do not exist when someone asks for it; drift makes that class a gate that runs on every check.
5. **Checker family: shape:**
   > Native floor: claude plugin validate checks a plugin's skill, agent, and command frontmatter; shape adds the house rule-file form, which no native validator reads, and keeps its SKILL.md check to what the validator is not documented to cover.
6. **Checker family: coload:**
   > Native floor: the harness warns when the files loaded at session start pass a combined length; coload adds the per-path sum of path-scoped rules that load together on a read, which that warning does not count.
7. **Pinned agent roster** (`plugins/house/agents/builder.md`, step 2):
   > The harness already loads the repo's CLAUDE.md and each path-scoped rule as you read a matching file, so take them as given; a repo rule wins over this file on conflict.
8. **Orchestration defaults: Workspace** (`ORCHESTRATION.md`):
   > Enter a worktree before the first edit or branch through the harness's worktree tool; a manual git worktree add skips the harness's base-branch setting and its copy of gitignored files, so use it only when the tool cannot reach the branch you need.
9. **Orchestration defaults: Parallelism and large workflows:**
   > Workflows run only when the user asks; when they do, name the agent count, and treat the harness's workflow size guideline as advice to stay under rather than a target.
10. **Eval cases.** `docs/handbook/testing.md` still says the runner has no docs page and runs outside an OS sandbox.
    > Native floor: claude plugin eval runs these cases against its no-plugin baseline arm; a case's allowed_tools cannot grant Bash or Write, so the suite passes them with --allow-tools, and a Bash grant runs under the harness's OS sandbox.

## 5. Unique mechanisms

These 52 items have no native counterpart. They are the package's reason to exist, and all are kept as written.

**Package machinery (10)**
- SessionStart floor arming (`core.hooksPath`)
- conventions skill (index lookup without loading rule bodies)
- upstream-first sync with refuse-on-local-edit
- lock file (`.house/lock.json`)
- deviations ledger
- checker families: todo, tamper, behind, manifest, minutes

**Gates on shipped bytes and deploys (8)**
- deployment: deploy manually after the merge
- deployment: verify the deployed URL against the built file
- deployment: repoint the consumer before dropping a column
- deployment: restore a backup before calling it one
- engineering: verify the served artifact
- engineering: land a build-time guard with its code
- engineering: pin a framework default with its reason
- docs: run the docs gate before pushing and in the build

**Data correctness (17)**
- data-pipelines: end-of-run retro
- data-pipelines: idempotent and resumable runs with a logged ledger
- data-pipelines: write nothing when a record is unchanged
- data-pipelines: fail-closed policy registry
- data-pipelines: loud unmapped input
- data-pipelines: archive first, ledger in the same transaction
- data-pipelines: reconcile a vendor's success against an independent count
- data-pipelines: name, don't act, on ambiguous data
- data-pipelines: key a projection on the source's grain
- database: provenance columns as behavior
- database: row lifecycle decides a new table
- database: money as integer cents, reconciled
- engineering: one implementation per computation
- engineering: validate the body before writing
- engineering: read a missing field as missing
- engineering: enumerate from the system of record
- engineering: normalize against fixed anchors

**Testing discipline (8)**
- scale the pyramid to the repo
- positive and negative control on every gate
- read the snapshot diff
- quarantine a flaky test loudly
- coverage as a search-light
- mirror module layout in the test tree
- explain a runner config quirk in the config
- keep a demoted check running and counted

**Repository and secrets hygiene (7)**
- push protection, head-branch deletion, grouped dependency updates
- no stray closing keywords
- one writable scope per restricted key
- never log a vendor object
- preview URL treated as production
- label a non-secret
- community files and issue forms

**Model output honesty (2)**
- cite or stay silent
- reword a locked claim, never strengthen it

## 6. Downgraded claims

1. **"Plan when the approach is uncertain, and clear the context after two failed corrections" (claude-code.md). DUPLICATE, now COMPLEMENT.**
   - The doc-accuracy skeptic upheld the overlap: the best-practices page carries both thresholds almost word for word.
   - The enforcement skeptic refuted it. That page is written for the user and never enters the model's context, while the vendored rule loads every session. The re-read clause is also new: no citation advises re-reading a ruling's source before acting, and none covers sources outside CLAUDE.md.
   - Recommendation: keep the rule. Optionally add a clause citing the best-practices page as the user-facing floor, and fold in the mid-session reload fact from the classifier's proposed second sentence. Drop the "intentional duplicate" framing.
2. **"Cut, don't append, and trim on a fixed cadence" (docs.md). CONFLICT, now COMPLEMENT.**
   - Doc-accuracy upheld the literal tension between "delete at least one section each time" and "finding no candidate is valid".
   - Enforcement refuted the conflict. The native audit is advisory, on demand, and sets no cadence. The count reads as a target for a whole pass rather than a per-file quota. The ratchet is the only mechanical gate. The rule and the native "empty diff beats a manufactured one" stance agree.
   - Recommendation: no conflict to resolve. The classifier's reword is still worth taking as an optional minor edit, because a count reads as a quota, which the owner's judgment-over-hard-rules posture warns against.
3. **Checker family: lengths (check.mjs header). CONFLICT, now COMPLEMENT.**
   - Both skeptics refuted it. "Cut with no notice" describes the truncation at session start, which really gives no notice. The write-time reminder and error are a separate event that fires only when Claude writes the file. The header already cites that write-time floor one paragraph earlier.
   - Recommendation: keep as is.
4. **Orchestration defaults: Model tier (ORCHESTRATION.md). CONFLICT, now COMPLEMENT.**
   - Doc-accuracy confirmed the native fact: with no model set and no `CLAUDE_CODE_SUBAGENT_MODEL`, an agent runs on the session's model.
   - Enforcement refuted the conflict. The line is a directive to the orchestrating session, not a claim about the harness. The roster pins model and effort in frontmatter regardless of the variable, and the claude-code rule tells adopters to set the variable as a floor.
   - Recommendation: not a conflict. The sentence "runs below the session by default" still reads like a harness fact on a machine without the variable. Adopt the classifier's clarifying wording as a minor edit, in the same PR as claude-code.md reword 5, so the two texts agree:
     > The harness runs a subagent, teammate, or workflow agent with no assigned model on the session's model unless CLAUDE_CODE_SUBAGENT_MODEL says otherwise, so every off-roster call names a model and effort below the session unless the task needs the session's tier.
5. **Orchestration defaults: Subagents do not spawn subagents. DUPLICATE with a delete action, now COMPLEMENT.**
   - Both skeptics refuted it, because the classifier's evidence was wrong. By default a subagent can spawn up to three layers deep. The Agent tool is withheld only at the depth limit, and the built-in general-purpose agent keeps it.
   - The bullet is therefore a stricter session-wide policy than the native default. It matters most for off-roster and general-purpose agents.
   - Recommendation: keep it and do not delete it. Optionally name the native lever (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`) for an adopter who wants the policy enforced rather than directed.

## 7. PR plan

Classification under ADR 0011:
- Nothing below renames or removes a heading, touches a config slot, changes a hook contract, or tightens the branch guard's deny set. All three PRs are rule prose or documentation, so they are minor.
- The one major-class candidate is listed separately at the end, and only goes ahead on the owner's decision.

Every PR:
- runs `npm run verify`, which includes `check:traceability` and `check:house`
- re-renders the vendored copies under `.claude/rules/house/` for any module this repo adopts
- adds a CHANGELOG entry

Adopters pick the changes up through `/house-rules:sync` after the release.

**PR 1: harness-core prose (minor)**
- `plugins/house/modules/claude-code/rules/claude-code.md`: rewords 1 to 8.
- `plugins/house/modules/docs/rules/docs.md`: rewords 1 to 9. Optionally, the "Cut, don't append" wording from section 6.
- `plugins/house/orchestration/ORCHESTRATION.md`: Workspace, Parallelism, and the Model tier clarification. These go in this PR so the worktree and model-tier facts match claude-code.md in the same release.
- `plugins/house/agents/builder.md`: step 2 wording.
- Vendored `.claude/rules/house/claude-code.md` and `.claude/rules/house/docs.md`. Receipts in `docs/handbook/claude-code.md` and `docs/handbook/docs.md` where they restate an old claim.

**PR 2: domain module prose (minor)**
- `plugins/house/modules/engineering/rules/engineering.md`: 3 anchors.
- `plugins/house/modules/github/rules/github.md`: 5 rewords.
- `plugins/house/modules/testing/rules/testing.md`: 3 rewords.
- `plugins/house/modules/database/rules/database.md`: 1 anchor.
- `plugins/house/modules/deployment/rules/deployment.md`: 1 anchor, plus the matching `## Don't` anchor.
- `plugins/house/modules/data-pipelines/rules/data-pipelines.md`: 2 rewords.
- `plugins/house/modules/llm-output/rules/llm-output.md`: 4 rewords.
- Vendored `.claude/rules/house/{engineering,github,testing}.md` and the matching handbook chapters.

**PR 3: mechanism documentation (minor, no public surface)**
- `plugins/house/payload/check.mjs`: native-floor comments for drift, shape, and coload, plus the ratchet's native-floor sentence. The ratchet sentence also goes in `docs/handbook/conventions.md`. It does not go in ADR 0003, because decision records are immutable.
- `plugins/house/skills/handoff/SKILL.md`: opening paragraph.
- `docs/handbook/testing.md` line 30: the runner now has a docs page and runs Bash grants under the OS sandbox. Record the `--allow-tools` requirement wherever the eval command is defined.
  - Leave `docs/handbook/sources/testing-sweep.md` as a dated source, or give it a superseded banner.
- New `docs/decisions/0014-...md`: records plugin skills with `paths:` as a considered and declined delivery route. Add an "Amended by 0014" banner to ADR 0001, following the 0011/0012 pattern.

**Separate, only on decision (major class)**
- Add NotebookEdit to the branch guard matcher in `plugins/house/hooks/hooks.json`, and drop the stale MultiEdit name.
- Adding a tool to the matcher tightens what the guard denies. Under ADR 0011 that is breaking. Below 1.0 it is announced as breaking in the changelog and carried by the next minor under ADR 0012.
- It would edit `tests/hooks/run.sh` in the same PR.

## 8. Open questions the audit could not settle from the docs

**claude-code.md**
- Resume file rule: the docs never describe a harness checkpoint file carrying a session id, snapshot ref, and resume command. It is unclear whether the rule is COMPLEMENT or UNIQUE.
- Committed settings rule:
  - Writing each deny in "both the leading and the interior form" may partly duplicate native subcommand matching, including inside `$()` and subshells.
  - "The loader silently skips" a malformed entry holds only in `-p` runs. Interactive sessions show a Settings Warning.
- Model tier rule:
  - The docs do not cover the print-mode budget ceiling flag or the native deep-research fan-out size.
  - The "step down" claim is only partly true: a blocked family alias steps down within its family, but any other blocked value falls back to the inherited model.
  - `workflowSizeGuideline` may be the floor to cite for fork depth.
- Hook rule:
  - Exit 2 also blocks on UserPromptSubmit, Stop, TaskCreated, and TaskCompleted, so "only a pre-tool hook stops the action" is narrower than the harness.
  - Its escalation ladder (prompt, check, hook, subagent) omits the native `/goal` step and does not name the Stop hook. The testing module defers to the same ladder.
- Skill body and procedure rules: the third-person description advice, the "name is a display label" claim, and "description truncated by the harness" are all unverified.

**docs.md**
- Is block-level HTML comment stripping applied to `.claude/rules/*.md` files, or only to CLAUDE.md? Check with `/context` before finalizing reword 8.
- "Give every rule file a paths list" overlaps claude-code.md's "Give a domain rule a paths list". That is duplication inside the package, not with the harness. Keep one and cross-reference it, or declare the overlap.

**engineering.md**
- "Land a build-time guard" asks for one root-file line per guard. If the guard list can be derived from `package.json` scripts, the /doctor trim check would propose cutting those lines.

**github.md**
- Does a background session open a draft PR on its own, and does /batch open one PR per unit? The current anchor says so, and the facts do not confirm it.
- Does a session-run `house render --apply` that writes `core.hooksPath` into `.git/config` prompt under protected-path rules in auto or manual mode?

**testing.md**
- The llm judge sees only the first and last 12 trace messages. That supports "weakest on long artifacts", not "noisiest".
- That the eval runner loads a plugin's own hooks is inferred, not stated in the docs.

**deployment.md**
- `plugins/house/modules/deployment/files/deploy-guards.mjs` (around line 123) requires every check run on the checked SHA to conclude `success`. Managed Code Review always concludes `neutral`, so a repo with it enabled would be refused if a Code Review run lands on that SHA. Whether it does depends on the merge strategy. If it does, the guard needs to accept `neutral` for that check. That fix would be a patch.
- Under auto mode, a narrow `Bash(npm run deploy)` allow does not stop the classifier from reviewing a production deploy. The rule could say so.

**llm-output.md**
- The "concise built-in output style" that preserves error reports, security warnings, and destructive-action confirmations is not in the gathered docs. Check it against the current output-styles page before the next release.
- The print-mode output schema flag is unconfirmed. Schema validation is documented only for workflow `agent()` calls.
- If the owner has a source for Code Review tuning on agreement marks, keep the original anchor and cite that source instead.

**database.md (optional extra floors)**
- Auto mode already routes a production migration through the classifier.
- Sandbox credential deny could partly enforce "no dotfile on the write path".
- `.worktreeinclude` copies `.env` into new worktrees, which spreads the hazard.

**Mechanisms**
- lengths: the harness keys the memory directory to the git repository, which worktrees share. The checker keys it to the current checkout's top level, so a run from a linked worktree may look for MEMORY.md in the wrong place. Unverified.
- shape: does `claude plugin validate` check that a SKILL.md name matches its directory?
- The branch guard's PreToolUse timeout is 5 seconds, and a timed-out PreToolUse hook does not block. On a slow run only the git-hook floor holds.
- The eval runner disables repository git hooks through `GIT_CONFIG_COUNT`. The `branch-and-pr` eval therefore measures only the PreToolUse layer, never the floor.
- `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`, if set, overrides every pinned roster model. It is already noted in `docs/handbook/claude-code.md` but not in the roster or ORCHESTRATION.md.