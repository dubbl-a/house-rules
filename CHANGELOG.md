# Changelog

All notable changes to this package. Format: Keep a Changelog. Versioning: semver in `plugins/house/.claude-plugin/plugin.json` only.

Issue and PR numbers in sections below 0.5.0 refer to this package's predecessor repository and do not resolve here.

## [Unreleased]

## [0.13.2] - 2026-09-21

Review stops on a verdict instead of a round count, flags the owner before a third round, and lets the owner stop or extend it at any point. Patch under ADR 0012: rule content changes with no heading renamed and no change to the guard's deny set.

### Changed
- **The review round cap is replaced by a stopping condition.** 0.13.0 held a change to one review round, a second only for a non-mechanical must-fix, and anything further to the owner. A count is arbitrary: it either stops before real defects or runs past a clean verdict. Review now continues while a round returns a must-fix and stops at the first round that returns none, with each later round scoped to the previous round's fixes and what they touched. Before a third round the session tells the owner what each round found, what the next will check, and why the rounds are converging; it hands the change to the owner when must-fixes land inside the previous round's fixes or one defect class keeps returning. The owner can stop or extend review at any point. `ORCHESTRATION.md` and the rule "Run adversarial review in a fresh subagent with a named lens" carry it; the handbook records the evidence.

## [0.13.1] - 2026-09-21

Six vendored rule files lose 16 to 19 percent of their words and 7 to 9 percent of their lines with every heading and every directive kept, so adopters co-load less rule text; and adopters now git-ignore tool scratch. Patch under ADR 0012: rule content changes with no heading renamed and no change to the guard's deny set.

### Changed
- **The claude-code, docs, llm-output, engineering, github and data-pipelines rules are shorter.** Restated reasons, long asides, and `## Don't` items that only repeated their own rule's body are cut; one sentence stays on one line, so the lower line count is real text removed, not lines joined. Every `## ` heading is byte-identical, and two adversarial review rounds checked each removed line for a lost directive (the first found 20, all restored). In aaron-gtm, the worst co-loaded path drops from 409 lines to about 380, under the 400 default, so its `coload-ceiling` override can go.
- **The sync and bootstrap skills ensure `.claude/worktrees/` and `.superpowers/` are in an adopter's `.gitignore`**, appending whichever is missing, because tool scratch that shows in `git status` is one `git add -A` from being committed. This repo's own `.gitignore` gains both lines.

## [0.13.0] - 2026-09-21

The handoff stops filing a standing carryover issue, review becomes proportionate with one round per change by default, and the hook dispatchers refuse an untracked or git-ignored `.d` hook instead of skipping it. Minor under ADR 0012: the floor's deny set tightens (a skipped hook now refuses), which ADR 0011 classes as breaking, and below 1.0 that class takes the minor. PRs #76 and #77; closes #75.

### Changed
- **The handoff practice retires the standing carryover issue.** The rule "Hand off through a carryover issue" is now "Hand off through the repo, not a standing issue": an issue is opened only for work someone will do, a next-cycle item becomes its own issue after checking an open one does not already cover it, and a thing deferred by decision is recorded with its reason where the decision already lives (the CHANGELOG, a decision record, the code comment), and becomes an issue closed as not planned only when no such place exists, since that reason is the one line the next session cannot reconstruct on its own. Everything else (the SHA, what shipped, what is open) is re-derivable from the default branch, merged PRs, and release notes, so the `handoff` skill now prints its snapshot in the session and files nothing for the snapshot itself. This package's own carryover chain (#2 through #75) left one issue permanently open with nothing to act on, which is the incident that reversed the earlier form; the handbook records it dated 2026-09-21.
- **The dispatchers refuse an untracked or git-ignored `.d` hook instead of skipping it.** `pre-commit`, `pre-push` and `reference-transaction` used to print a warning and continue when a file in the `.d` directory was not tracked in this repo or was excluded by `.gitignore`, so the commit or push still went through with a scan silently missing (#73 showed the cost of a hook that silently does not run). Each dispatcher now reports every such file, then exits non-zero before running any hook at all, including a tracked one that would otherwise mark success beside a refused one. This is a behavior change in the guard's deny set: an untracked or ignored file in a `.d` directory that used to pass now blocks the commit, push, or ref transaction until it is committed or removed. A dot-file and a file ending in `~`, `.disabled` or `.sample` are unaffected and stay silent skips; the managed branch guard stays exempt from the tracked check. The tracked and ignored lookups now read paths unquoted, so a tracked hook with a non-ASCII name no longer reads as untracked, which would otherwise have refused every commit with advice that could not fix it.
- **Review is proportionate.** The orchestration text and the rule "Run adversarial review in a fresh subagent with a named lens" now send a refuter only when a change carries logic, a guard or hook, or facts and numbers someone will act on; a text-only or mechanical change a gate already covers gets the session's own diff read instead. Review runs one round per change, a second only when the first round returned a must-fix whose fix was more than mechanical, and any further round is the user's call. The handbook records the evidence: four REWORK verdicts with real defects in the last fourteen days argue for keeping review, and uncapped rounds on the 0.10.0 guard and on PR #66 argue for the cap.

## [0.12.0] - 2026-09-21

The worktree rule becomes unconditional and the guard enforces it; the hook dispatchers run every tracked `.d` hook from a linked worktree, where the secrets scan had been silently skipped; the guard stops refusing read-only inspection of the floor it protects; and the memory-index check finds the main checkout's index from a worktree. Minor under ADR 0012: the guard's deny set changes shape (a new refusal, three narrowed ones), which ADR 0011 classes as breaking, and below 1.0 that class takes the minor. Resolves #68, #69 and #70 (PRs #71, #72, #73).

### Added
- **The guard refuses a branch created in a main checkout.** In an adopted repo, after the policy and deference gates, `git checkout -b`, `-B`, `--orphan` and `git switch -c`, `-C`, `--create`, `--force-create`, `--orphan` are refused when the target is the main checkout, in every short-flag spelling including glued (`-bnewb`) and clustered (`-qb`), armed or unarmed. A linked worktree, a `branchPolicy: direct` repo, a repo deferring to a local guard, and a non-adopted repo are unaffected; `git checkout <branch>`, `checkout -- <file>`, `git branch <name>` and `git worktree add -b` pass. The deny names `git worktree add -b`. PR #73.
- **A Workspace section in the orchestration defaults.** The text injected at session start now says: enter a worktree before the first edit or branch, with the harness's worktree tool or `git worktree add -b <branch> <path> origin/<default>`; never `git checkout -b` or `git switch -c` in the main checkout, not even for one commit; a plan's first step is the worktree. A test pins the line. PR #71.

### Changed
- **The rule "Treat git state as shared across sessions" is unconditional.** The exception that let a session branch in the main checkout for a single-commit change when the agent list and the worktree list showed nobody in flight is gone: on 2026-09-20 three sessions in one adopter each ran `git checkout -b` in the shared checkout right after plan approval, one with two peer worktrees listed, one committing five times until the user intervened. The rule now names the two commands, puts the worktree step first in every plan, reserves the main checkout for reading, merging, and cleanup, and anchors on the guard refusal above. The handbook records the evidence. PR #71.
- **The guard reads the floor's config key and merged stderr without refusing.** The hooks config key, `include.path` and `includeIf` are refused only in a clause that holds a git token or where the key is assigned (an `=` in the token or as the next token, so the INI spelling in a `~/.gitconfig` append stays refused); `git config --get`, `--get-all` and `--get-regexp` with no write flag and no assignment pass; a grep pattern, an issue title or a heredoc line that merely mentions the key passes unless the clause also spells `git`. Next to `.githooks`, `.git/config` or `.git/hooks` the exact tokens `2>&1`, `1>&2`, `>&1` and `>&2` pass while every path-bearing redirection and `2>/dev/null` are still refused; the clause splitter protects `>&` from the bare-`&` split and restores it with `tr`, because bash 5.2 reads a bare `&` in a substitution's replacement as the matched text. Accepted false denies 1 and 4 are rewritten to match. 278 guard cases. PR #73, resolves #69.

### Fixed
- **The dispatchers run tracked `.d` hooks from a linked worktree.** `pre-commit`, `pre-push` and `reference-transaction` asked `git -C <hooks dir> ls-files` with the environment git exports into hooks, so from a linked worktree the child git stayed bound to the committing worktree while its cwd sat in the main checkout, and every tracked `.d` hook except the managed guard read as untracked and was skipped. The secrets scan therefore never ran for a worktree commit. The `ls-files` and `check-ignore` questions now run with that environment cleared, identically in all three; two real-git cases cover a worktree commit running a tracked hook and an untracked plant still skipped. PR #73, resolves #68.
- **The memory-index length check finds the index from a worktree.** `check.mjs` named the harness project directory from the worktree's toplevel, where the harness files memory under the main checkout, so from a worktree the check reported nothing. The name now comes from the parent of `git rev-parse --git-common-dir`, and every non-alphanumeric character becomes a dash, which is the harness's rule (a worktree under the harness's worktrees directory shows with a doubled dash where the dot was, and underscores become dashes). Two tests failed against the old code. PR #72, resolves #70.

## [0.11.0] - 2026-09-20

The branch policy moves off command text: a git-hook floor that reads the resolved branch, the pushed refs, and the policy at HEAD; a GitHub ruleset as the ceiling where the plan allows one; and a PreToolUse hook that verifies the floor is intact and refuses only the ways to disable it. Minor under ADR 0012: the guard's deny set changes shape, which ADR 0011 classes as breaking, and below 1.0 that class takes the minor. Resolves #58 (PR #66, ADR 0013).

### Added
- **The git-hook floor.** The github module vendors `.githooks/pre-commit`, `.githooks/pre-push` and `.githooks/reference-transaction` as dispatchers over a `.d` directory, with `.githooks/house-lib.sh` and one `10-house-branch` guard per hook. They read the branch with `git symbolic-ref HEAD` or the refs git hands them on stdin, and the policy from the committed `house.json` at HEAD (the remote's own commit for a push), passing `--no-replace-objects`, so no command text is parsed and a working-tree edit of the policy counts only once a PR has landed it. The reference-transaction hook (git 2.28 or newer) closes merge, rebase, cherry-pick, amend, reset and update-ref, skips a no-op update, honours `carveOuts`, and passes a fast-forward the remote already has. The dispatchers run the managed guard first and every other tracked `.d` file after it; an untracked or ignored file is named and skipped. `tests/githooks/run.sh` runs real commits and pushes against a bare remote on every git, with visible skips below 2.28.
- **Arming, and the report that goes with it.** `plugins/house/hooks/arm-git-hooks.sh` sets `core.hooksPath` from `house render --apply` and from a `SessionStart` hook, restores a lost execute bit, never overwrites a foreign hooks path, refuses when `.git/hooks` already holds executable hooks, retries a `config.lock` race instead of printing a false "not armed", and in a linked worktree names the main-checkout command instead of writing the shared config. `house doctor` reads the same script's probe and prints a `git-hook floor:` block, including what `--no-verify` means below git 2.28. The bootstrap wiring block gains the arming line.
- **A floor verdict in the checker's guard family, read from the index only.** All seven floor files absent warns (a repo rendered before the floor); some absent, a file tracked without its execute bit, or a stub body is a finding. `core.hooksPath` is machine state the checker never reads (ADR 0008). One test pins the seven-path list across the hook, the arming script, the checker and the module manifest.
- **ADR 0013 and the github rule "Enforce the branch policy where git resolves the ref, and let the text scan catch only the ways to disable it."** The handbook section carries the two ruleset API answers (free on a public repo, Pro-gated on a private one), the ten pre-push spellings, and the three adversarial rounds with what stays open by decision. The README states the git 2.28 prerequisite.

### Changed
- **The PreToolUse hook reads "armed" as "intact" and parses far less.** A repo counts as armed only when `core.hooksPath` resolves to the floor through git's own config reader (which honours `include.path`), every vendored file is byte-identical to the plugin's copy and executable, the hooks directory on disk equals the tree at HEAD, and git is 2.28 or newer. Armed, it refuses a commit on a protected branch, `send-pack` (git runs no hook for it), and the disable list: `--no-verify` and its abbreviations, `-n` on a commit, `hooksPath` or `include.path` in any form, the `GIT_CONFIG_*` family, `--exec-path`, `git replace` and any replace-ref write, a mutation of `.githooks/` or the git directory through Bash or Edit/Write/MultiEdit, ref plumbing on a protected name, a repository named by `GIT_DIR` or `--git-dir` rather than entered, and a shell alias; an alias body is scanned one level deep. Those scans run before the policy gate, so a branch that committed `branchPolicy: direct` cannot stand them down. Unarmed (a fresh clone, a stale render, a tampered floor, old git), it refuses every verb it cannot read as a literal git command, reads pushes by a literal refspec grammar (a tag push and a feature push from `main` pass, a refspec-less push passes only when `push.default` and the upstream are provably safe), and ends every deny with the arming command. The clause walker, alias resolution, the tag-only grammar, and the computed-target heuristics from 0.10.0 are gone; the suite drops those rounds and pins the disable list, the integrity fixtures, and the release-flow allows (250 cases across a new-git and an old-git fixture). The matcher widens to `Bash|Edit|Write|MultiEdit`.
- **The secrets backstop is a scaffold in the dispatcher's directory.** `templates/pre-commit` moves to `templates/pre-commit.d/20-secrets`, offered once as `.githooks/pre-commit.d/20-secrets`. Render moves an adopter's unmanaged copy of the old template there (or their own hook to `15-local`), chmods every `.githooks/` destination, and leaves a file that is already the managed dispatcher alone.

### Fixed
- **Two SessionStart hooks share one array.** The 0.10.1 orchestration hook and the arming hook are two entries under one key; a merge had produced two keys, of which JSON keeps only the last.

## [0.10.1] - 2026-09-20

The plugin ships a pinned subagent roster and injects orchestration defaults at session start, so a session never has to be told to keep its fan-out off the top tier; the `/deep-research` fork scales its fan-out to the question instead of spending the same hundred agents on every one; and the model rule names the user-settings floor an omitted model lands on. Patch under ADR 0012: new agents, a new hook, new rule prose, and a checker, none of which renames or removes a named surface.

### Added
- **A pinned subagent roster, and the orchestration defaults every session now starts with.** Five agents under `plugins/house/agents/` (scout on Haiku, researcher and builder on Sonnet, refuter and debugger on Opus) pin model, effort, and tools in frontmatter the harness enforces; none lists the Agent tool, so none can spawn, and only the builder can edit. They load as `house-rules:<name>` at the lowest priority, so a project or user agent of the same name wins. A `SessionStart` hook injects `plugins/house/orchestration/ORCHESTRATION.md` (roles, roster, model tier, delegation, the six-section brief, parallelism, verification) under `hookSpecificOutput.additionalContext` on startup, clear, and compact; a missing file emits nothing and exits 0, and a test holds the text under 120 lines and 9KB because every session pays for it. Both are adapted from SirRuggie's claude-code-orchestration-kit (MIT, commit 4416994 of 2026-09-13), minus its task-bucket system and `/task` command, which #64 holds for consideration; `scripts/check-orchestration-kit-upstream.mjs` (`npm run check:kit`) pins that commit and exits 1 when the upstream branch moves, with `--diff` for the stat of the ported paths, outside `verify` because it needs network. Thirteen tests cover the roster's tiers and tool lists, the hook's two paths, the hooks.json entry, and the checker against a local bare repo. NOTICE, the upstream ledger, and the README carry the provenance. PR #62; #63 is the scheduled watch over every upstream.

### Changed
- **The `/deep-research` fork scales its fan-out to the question.** Twelve run records showed the native workflow spends the same 100 to 111 agents whatever is asked: three votes on the top 25 claims is 75 verifiers, and its fetch cap of 15 only binds medium and low relevance, so high-relevance hits overshoot it in every run. The 2026-09-18 run was 111 agents and 6.37M tokens with the model pins working, 70 percent of it the verifiers. The checker's `--rebuild` now replaces the four fan-out constants with a depth preset (`args.depth`: light about 35 agents, standard about 70, deep about 130; any field via `args.budget`), validates the budget, bounds the fetch bypass by a `fetchOverflow` allowance, and logs the ceiling before the run starts; the anchors follow the same exactly-once contract as the model pins. Three tests: the rebuilt fork carries the presets and no native constant, a body missing the constants refuses with no partial file, and the budget block run as a function body resolves each depth, an override, an unknown depth, a prototype key, and three bad budgets. PR #61.
- **The model rule names the tier floor and the roster.** "Set the model explicitly on every subagent and workflow agent" now says a subagent, teammate, or workflow agent runs one tier below the session unless the call says otherwise, via the subagent model variable in user settings (third in the documented resolution order, so an explicit model on a call still wins), points at the plugin's roster before a bare agent call, and gives the fork a depth rubric. The handbook carries the run data, the variable by name, and the port's receipts. PRs #61 and #62.

## [0.10.0] - 2026-09-20

The branch guard closes the four seams #34 left open, reads a command clause by clause the way the shell runs it, and defers only to a local hook that can see Bash; the whole package is re-audited against Claude Code 2.1.278 and twenty-five rules now cite a corrected native floor; the `/deep-research` checker's edges are fixed; the InstructionsLoaded logger sweeps a stale temp file and proves the direction its trim can fail in; and the worktree becomes the default for parallel sessions. Minor under ADR 0012: the guard's deny set tightens, which ADR 0011 classes as breaking, and below 1.0 that class takes the minor; every other change here is patch-class or rule prose.

### Changed
<!-- docs-drift-ignore: the environment names here are the 0.10.0 text scan's, which ADR 0013 retired for the git-hook floor; this entry records that release, not this tree -->
- **The branch guard closes the four seams #34 left open, and reads every target a command names.** An environment prefix (`GIT_DIR=`, `GIT_WORK_TREE=`) or a `--git-dir`/`--work-tree` option now redirects the check the way it redirects git; a `cd` inside an interpreter's `-c` body is a target; a push whose arguments arrive through xargs or GNU parallel is refused as unreadable; a git alias is read as the verb it expands to, a shell alias is refused from every branch, a verb git neither lists nor resolves is refused (which is what closes an alias defined and used in one call), and a push that names no refspec is refused when the repo's config carries `push.default=matching` or a `remote.<name>.push`. Config passed through the environment (`GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT`, `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, `HOME`) and a `-c alias.*` on the command line are refused outright. Under the hood, target resolution and the policy read move into one function and the scans into another, and a per-clause walk gives every git command the directory it will actually run in: a `cd` or `pushd` moves every later clause, successive `-C` compose, an `export` persists, and a git command that names nothing runs in the session's cwd, which is therefore checked whenever any clause is bare. The whole command is decided once per candidate and any candidate that refuses, refuses the call; the cost is a false deny when a chain names a protected checkout beside a guarded verb meant for another directory. Five adversarial rounds and three regression rounds ran before merge, each round against the previous round's fix, and every bypass was executed for real in a throwaway repo before it was closed: the flat candidate walk (a harmless `git -C <elsewhere>` clause dropped the cwd from the check, `-C a -C b`, `pushd`, a newline-separated `cd`, hex-escaped shell aliases); computed targets (`cd -`, `$OLDPWD`, `$(pwd)`, a variable or function from the same command, an xargs placeholder, `CDPATH`, a glob), which now refuse a commit or push outright; a same-call state change (`git checkout master && git commit`, `git switch`, `git symbolic-ref`, a config write to a push, upstream, or alias key before a push, `git worktree add <dir> master && cd <dir> && git commit`, `git clone`), refused because the branch and config are read once before any clause runs; a verb hidden in a message substitution, a subshell's `cd` read as persisting, quoted values behind a launcher; and the directory model diverging from bash in seven more forms (`cd -P`, `declare -x`, a lone `GIT_DIR`, typed marker words, a quoted paren, a process substitution, a nested substitution). The regression rounds caught the false denies each fix produced, including the documented release flow itself, `git -C "path with spaces"`, `-c "user.name=Jane Q Public"`, the toplevel idiom `git -C "$(git rev-parse --show-toplevel)"`, and `git checkout -b x && git commit` from a protected branch, which the refusal itself recommends and which now stands the block down. The suite grows from 211 to 352 cases, each deny shown allowed against the previous hook first. The cost is latency: a plain `git status` call takes roughly twice as long as before and a six-clause command about three times, from one policy read and one alias lookup per distinct target. The rounds stopped by decision, not because a round came back empty: five rounds in one day each found a new class in the same place, the text scan inferring runtime state, and the architecture that removes the class rather than the instances is its own issue. Seam 5, a git verb inside quoted prose, stays open by decision; the header now also names the structural limit, a git command inside a file the command runs, which belongs to the sandbox and the remote ruleset. Closes #34.
- **The guard defers only to a local hook that can see Bash.** The 2026-09-20 audit filed one conflict claim against the package, the guard's stand-down on any non-empty `PreToolUse` array in the repo's settings file, and both skeptics refuted it down to a narrow bug: an entry whose matcher names other tools (`Edit|Write`) never sees a git command, so deferring to it gave up enforcement for nothing while the checker's `guard` family certified the same file. Both now read the matcher; an entry counts only when its hooks array is non-empty and its matcher is absent, empty, `*`, or a regex that matches `Bash`. A matcher neither jq nor RegExp can read fails the test in both, which leaves the plugin hook armed and the family warning. Shown failing first against the previous hook and checker.
- **The worktree is the default for parallel sessions, not the preference.** "Treat git state as shared across sessions" reserved the worktree for judgment, and a rubric that lets each session decide whether anyone else is in flight is one every session answers in its own favor, so parallel sessions kept colliding on branches made in the main checkout. The rule now makes the worktree the default and reserves a main-checkout branch for a single-commit change when the agent list and `git worktree list` both show no peer; the guard's commit refusal leads with the worktree command and names the same two lists.
- **Twenty-five rules cite the native floor a re-audit against Claude Code 2.1.278 confirmed, and one drops the floor it never had.** Two multi-agent workflows re-ran the 2026-09-02 audit: 136 rules and mechanisms, 0 confirmed duplicates, 0 confirmed conflicts, 85 complements, 51 uniques, 1 downgraded claim (the guard item above). Almost every reword is attribution rather than substance: an Anchor or floor sentence that claimed something the docs do not say, or stated a gap more flatly than they support. Six open questions were settled against the live harness, one of them in the rule's favour (`--bare`, `--safe-mode` and `--restricted` all exist; the report was wrong). The `database.md` Don't section's anchor claim is corrected. The raw facts, classifications, skeptic votes, report, and both workflow scripts are banked outside the repo; `docs/handbook/sources/harness-survey.md` gains a dated section with the counts, the answers, and the corrected citation for the multi-hook combination fact. Rule prose, minor under ADR 0011. Issue #51 items 1 and 4, and PR #55.
- **The model rule states the substitute-and-warn floor.** "Set the model explicitly on every subagent and workflow agent" said a blocked tier had to fail loudly rather than quietly fall back; on 2.1.278 the harness steps a call outside the allowed list down to the newest allowed model in its family and warns only in the run's own view, so a pinned tier is a request the run can silently step down from, and the checker plus the fork's explicit model map are what make the request visible. The handbook drops two stale claims (the subagent-model environment variable is no longer the only session-wide default, since a force variant now exists, and per-call model and effort options are now in the public workflows doc), and the rule and handbook name what each of the checker's four exit codes means. PR #54.
- **The rule-load positive control names the rules it has not seen.** `house doctor` reported `<n> of <m> vendored rules seen` and stopped, which announces a problem without saying which file to open, so the reader greps the log by hand for something the probe already knew. The line now continues `; not seen in this log: <names>` whenever the count is short, and `--json` carries the same list as `ruleLoadProbe.vendoredUnseen`. The wording is deliberate: the log self-trims at its cap, so absence from it is evidence about the log and not proof a rule is dead, and the line fails toward under-claiming rather than calling a healthy rule broken. A positive control plants one unseen rule beside one seen rule and asserts the seen one is not named; the negative control asserts the suffix is absent entirely when every rule is accounted for. Both were shown failing against the previous line. Found in this repo, where the control read `4 of 5` for days: the unnamed rule was `github.md`, which never loaded here despite a `paths:` list whose globs match tracked files. That defect was reported upstream as anthropics/claude-code#93435 and no longer reproduces on 2.1.278, where the same file loads on the first matching read; the upstream issue is closed with the evidence. PR #50, issue #51 item 1.

### Fixed
- **The `/deep-research` checker's edges.** A repo path with a space crashed it with ENOENT, which a caller reading the exit contract misread as drift (`fileURLToPath` now). An explicit `--binary` that was not a readable file fell through to the installed binary and reported "unchanged" for the wrong one; it now exits 3 naming the path. Both sunset triggers were over-broad: `model:` anywhere in the native body, including a prompt string, and object args alone, which the Workflow tool already accepts; the first is scoped to the five agent-option regions the pin anchors locate and the second requires an actual model-map read, with a prose `model:` and object-only args as negative controls. `--rebuild` refuses an existing target unless `--force` is passed and creates the parent directory. The usage header says the binary locator is POSIX-only. Every fix shown failing first. Found by an Opus review of the feature against the installed 2.1.278, which also confirmed the native script still names no model, the fork's five pins still match exactly once, and the verdict today is correct. PR #54.
- **The InstructionsLoaded logger sweeps a stale temp file, and its trim path has the test it lacked.** A hook killed between writing its trimmed copy and renaming it left `.<key>.jsonl.<pid>.tmp` beside the log forever; the trim now removes a sibling temp file whose pid is not live or whose mtime is older than five minutes, best effort, and never a live trimmer's own file. A direction-only test seeds a log just under the cap, fires sixteen real hook processes at once, and asserts only what the code promises: every process exits 0 with empty stdout, every surviving line parses, every surviving path is one the seed or the burst wrote, and no count, because the count is exactly what the trim window cannot promise. Issues #45 and #46, PR #53.

### Added
- **A checker that keeps the `/deep-research` model fork honest, and retires it.** The bundled workflow names no model on any agent call and takes only a question string, so a wide research fan-out runs at whatever tier the session is in; the claude-code module now vendors `scripts/house/check-deep-research-upstream.mjs`, which reads the native script out of the installed Claude Code binary, rebuilds a fork with a model on each of its five stages and an `args.models` map, and reports one of three verdicts: unchanged, drifted (rebuild and record the new hash), or sunset (exit 2, the native workflow now sets its own models and the fork is deleted). The script text is never committed, since it is Anthropic's and this repo is public. Seven tests plant a fake binary and cover both controls, both sunset triggers, a refused rebuild, and a binary without the script. The rule "Set the model explicitly on every subagent and workflow agent" gains the sentence that points at it. PR #52.

## [0.9.1] - 2026-09-09

The InstructionsLoaded logger stops losing lines when rules load together, so doctor's count can be trusted; `house init` stops freezing slot defaults into the adopter's manifest; a public repo can mark its Actions minutes unmetered; and the github module gains a rule for the community files the platform looks for. Patch under ADR 0012: a hook fix, an init change, rule content, and a widened slot value, none of which removes or renames a named surface.

### Fixed
- **The InstructionsLoaded logger appends instead of rewriting.** The hook shipped in 0.9.0 read the whole log, added a line in memory, and wrote the file back, so two hook processes firing in the same instant lost whichever line landed first, and one file read that matched two rule globs was enough to make `house doctor` report a rule as never loaded. The hook now appends with one small O_APPEND write per event and trims only when the file is over its cap, writing the trimmed copy beside the log and renaming it into place. The one window left is stated beside the code: an append that lands inside a trim is lost, confined to a cap crossing and undercount-only, never a phantom load. Doctor's `last load` is the newest timestamp rather than the last line in file order. A concurrency test fires sixteen real hook processes at once and was shown failing against the 0.9.0 hook. Doctor also ignores a `ts` that is not a real timestamp, so a garbage value that sorts above every real one cannot pin `last load` for the life of the log. Issue #37.

### Changed
- **`house init` writes intent, not defaults.** A fresh `house init --apply` now writes `config: {}` for every module instead of copying every declared slot default into `house.json`, so an adopter follows a future default instead of pinning the one that was current at init. The docs module is the one exception, and it now writes what the probe found rather than nothing at all: `haystackDirs` for each conventional directory present, and `roots` only for a directory that actually holds a markdown file. Because the probe had never run, a fresh manifest carried empty lists for both before this release, so a new adopter gets the docs-root coverage assertion and the haystack scan for the first time, while an existing manifest is untouched. Render already fills an absent slot from the module's declared default and the vendored checker carries its own fallback per slot, so nothing changes for an existing manifest; a parity test proves `{}` and a fully seeded manifest render and check identically. Two things surfaced on the way: the docs probe had been dead code since it sat under a `detect` branch while docs defaults to `on`, and the sync skill and schema said the version pin is bumped by hand when `house render --apply` has written it since 0.5.0; both now tell the truth. Next-cycle item 2 of #36.
- **`actionsBudgetMinutes: null` means unmetered.** A public repo's Actions minutes are free, so the minutes family now suppresses its budget warning under an explicit `null` and prints an advisory saying why, rather than going silent. An absent slot still means the default budget. The rule "Budget Actions minutes as account-wide money" says when to set it. Backlog item 6 of #2.

### Added
- **A github rule for the community files the platform looks for.** "Ship the community files the platform looks for, and keep issue intake as forms": the code of conduct, a security policy with a reporting route, the contributing guide, YAML issue forms with blank issues disabled, and the pull-request template. Nothing local enforces it; the Anchor names the platform's community-profile endpoint as the check at adoption, and the handbook section carries the relaunch observation that the endpoint's `issue_template: null` is how it reports a form directory rather than a missing template, which is why the endpoint is confirmed by hand instead of read on faith. Backlog item 6 of #2; the "command-name idiom" slot from the same item is dropped, since no record says what it meant. Re-syncing vendors ten more lines of `github.md`, 161 to 171, and two more lines of `.house/INDEX.md`, so a repo holding `.claude/rules/house/*.md` under a 171-line limit, or sitting within ten lines of its `maxCoLoadLines` ceiling on `.github/**`, clears that first.

## [0.9.0] - 2026-09-09

The branch guard reads a command by walking its tokens instead of matching adjacency, which closes a dozen bypasses and lets a tag-only publish through; the InstructionsLoaded positive control ships with the plugin; two refusals learn to name their remedy. Minor under ADR 0012: the guard change tightens what is denied, which ADR 0011 classes as breaking, and below 1.0 that class takes the minor; every other change here is patch-class.

### Changed
- **Breaking: the branch guard denies more, and reads more.** Every reader of the command now works from one token walker that finds the `git` token, skips global options, and lands on the verb, so a global option between them (`git --no-pager commit`, `-p push`, `--exec-path=`) no longer defeats every rule; a clause holding a second git command inside an argument (`-m "$(git push …)"`) is walked too. Every clause is read, not just the first, so a push hidden behind `&&`, `;`, `&`, `||`, `|`, a newline, a subshell, a backslash, `2>&1`, `$IFS`, or `${x:-…}` is refused like the one in front of it. Backslashes are read the shell's way before anything else (a continuation joins, an escaped quote vanishes whole, any other escaped character stays), so `gi\t commit` and `mas\ter` are what they spell. A message value that would expand is left in view for the verb scans; `-c` values and target resolution use a blind strip of one whole shell word, which also closes the quoted `-c` seam the hook had carried as open. From any branch a push is refused when it carries `--all`, `--branches`, `--mirror`, `--prune` (or any prefix git accepts), a wildcard or computed refspec (`refs/heads/*`, `m?ster`, `$b`, `{a,b}`), a `heads/master` destination, or a `-c push.*` / `remote.<name>.push=` key, and a computed verb in command position (`git pu${x}sh`) is refused outright. Each closed form was confirmed against the 0.8.0 hook first and is pinned in `tests/hooks/run.sh`, whose case count goes from 87 to 203. The visible cost: `git push origin $BRANCH` and other computed refs now refuse with a message that says to spell the name. Recorded as breaking per ADR 0011; the digit follows ADR 0012. Issue #1.
- **A lengths refusal names the second step.** When a file is over its ceiling and a matching, shape-valid `ratchetRaises` entry is on record, the finding now ends `; a ratchetRaises entry to <n> is on record, re-run with --accept-lengths to apply it`, the footer's third remedy names the flag, and the docs rule, its handbook chapter, README, and CONTRIBUTING name it in their raise sentence. The tighten stays gated on the flag, per ADR 0003. Issue #27.
- **`house render` warns only on a dropped glob the adopter wrote.** A dropped path that appears in the module's declared default list is a known alternative convention (`tests/**` beside `test/**`) and prints nothing in text mode; `--json` lists it under `droppedDefaults`. A dropped path from `house.json` keeps the warning, same wording. The drop itself is unchanged. Issue #25.
- **A guard refusal whose verb sits only inside a quoted string says so** and names the file route (`--body-file`, `-F`). The decision is unchanged; only the words are.

### Added
- **A tag-only push is allowed from a protected branch.** `git push origin v1.2.3`, `git push origin refs/tags/v1.2.3`, `git push origin tag v1.2.3`, and `git push --tags origin` pass a positive grammar: exactly `--tags` as the only flag, a remote git knows, tags that exist and are not also branch names, no colon, no leading plus, the tag push as the only git command in the call, decided over every clause. Anything else, including git's `--tag` abbreviation, `--follow-tags`, `--delete`, a force flag, or another git command chained with it, is refused, and the refusal names the allowed forms. The documented release step is runnable as written again. Issue #1.
- **The `InstructionsLoaded` positive control ships with the plugin.** `hooks/hooks.json` now declares `hooks/instructions-loaded.mjs` beside the branch guard. On every instruction-file load it appends one JSON line (timestamp, file path, load reason, session) to a machine-local log under the Claude config directory, keyed by checkout the way the memory-index check derives its path (ADR 0008). It never blocks a session and never touches the repo. `house doctor` reads that log and reports evidence rather than a declaration: `rule-load positive control: plugin hook; log <path>: last load <ts>, <n> of <m> vendored rules seen`, or the no-log-yet form, or `repo (.claude/settings.json)`, or `none wired`. The old probe was a substring search over two settings files that could not see a plugin-supplied hook and counted the git-ignored local file; `repo` now means a parsed, non-empty `hooks.InstructionsLoaded` array in the committed settings file, mirroring the guard predicate. Issue #26.
- **A github config slot for the worktree cleanup kill-list.** `modules.github.config.worktreeKillProcesses`, default `["node", "npm"]`, replaces the four hardcoded names in `cleanup-worktree.sh`, two of which were one project's static-site leftovers. Only an array of strings is honoured; a non-array value falls back to the default and says so on stderr; an explicit `[]` means kill nothing. Backlog item 6 of #2.
- **ADR 0012: below 1.0, the breaking class spends the minor.** ADR 0011's three classes stand; only the digit mapping changes. Below 1.0 the breaking class takes the minor and every other change takes the patch, the mapping npm caret ranges and Cargo assume for 0.x; at 1.0 it becomes major, minor, patch. 0.6.0, 0.7.0, and 0.8.0 were all additive and would have been patches under this record. README, CONTRIBUTING, and the handbook's versioning section follow, and each release heading's summary sentence now names its class and the record it follows.

## [0.8.0] - 2026-09-08

Two rules earned by failures this cycle: one for a publisher whose key stopped spanning its source's grain, one for the text a guard rewrites before it decides (minor under ADR 0011: rule content only, no config slot, hook contract, or layout moved).

### Added
- **New `data-pipelines` rule: "Key a projection on its source's whole grain, and prove that grain
  with a constraint".** A migration widened what makes a row unique in a source table; the
  publisher projecting that table kept the old key, so two rows that now differ collapsed onto one
  key and the batch died with a cardinality violation two systems downstream. The rule says to key
  a published projection on the whole natural key of its source and widen it in the same change,
  to prove the grain with a unique constraint on the source rather than trusting the query that
  reads it, to treat a column addition as breaking whenever it widens what makes a row unique, and
  to assert the projection's write key against that constraint as a run invariant. It complements
  rather than restates the surrounding tooling: every schema-evolution tool classes an addition as
  the safe case and none of them ask whether the grain moved, and the closest neighbour warns only
  that an incremental model's key is not itself tested. The handbook chapter carries the incident
  and the sources.

### Changed
- **"Make a must-hold rule a hook" now covers the guard's text handling, not just its exit paths.**
  Failing closed was stated for a crash, a missing helper, and an unreadable payload, but not for
  the rewriting a guard does to a command before matching it. The rule now says to err toward
  rewriting less than intended, because text left in can only add denials while text wrongly
  removed hides the verb and is a bypass, and to pin both directions in the tests, since the
  tidier-looking pattern is usually the one that removes too much. The handbook chapter carries the
  case that earned it: the fix for the 0.7.0 flag-stripper defect had an obvious companion change
  that would have turned a false refusal into a real bypass on protected branches.

## [0.7.0] - 2026-09-08

The settings rule gains the shape that stops a permission list accreting, and the settings template ships a deny list naming each tool's escape hatches. The branch guard stops refusing a commit because of the directory's name (minor under ADR 0011: rule content and a template, no heading, config slot, hook contract, or layout moved).

### Changed
- **The settings rule now names the shape that stops a permission list accreting, and the
  settings template ships a deny list.** "Keep the committed settings narrow and the local
  settings local" already said to prune on a cadence; it did not say why the list grows or what
  shape stops it. The harness writes an allow rule from the verbatim command text, so the list
  grows one exact invocation at a time and never converges. The rule now says to allow a tool
  broadly and deny its escape hatches, to write each deny in both the leading and the interior
  form, to run a pattern against both the invocation it must block and the innocent one it might
  catch, and to say in the file that this is a shape rather than a boundary. It also records that
  an agent can tighten a settings file but cannot grant itself a permission in one, which decides
  who makes each half of the edit. `plugins/house/templates/settings.json` now carries a
  `permissions.deny` block naming the inline-code flags on `node` and `python3`, `-c` and
  `--exec-path` on `git`, and the `psql` shell escape. The template is a reference exemplar and
  is not scaffolded into a repo by `house render`, so no existing adopter's settings change; copy
  the block by hand if you want it. The matching handbook chapter carries the evidence.

### Fixed
- **The branch guard no longer refuses a commit because of the directory's name.** The flag
  stripper in `plugins/house/hooks/no-direct-master.sh` matched its `-m`/`--message`/`-F`/
  `--file`/`-c` alternation anywhere in the command, including inside a word, so a worktree or
  clone whose path held a segment beginning `-c`, `-m`, or `-F` had the rest of that segment
  eaten as if it were a flag value. Target resolution then parsed out a path that does not
  exist, fell back to the session checkout, and refused a commit made from a perfectly good
  feature branch. The flag must now start a token. A boundary on the other side of the flag was
  tried and rejected because it leaves git's own attached form unstripped and hides the verb
  from the deny patterns, which would turn a false deny into a bypass; both directions are now
  pinned in `tests/hooks/run.sh`. Reported as issue 17, and the addendum to issue 1.

## [0.6.0] - 2026-09-02

Rule prose names the native Claude Code feature each rule builds on, after an audit found no duplicates or conflicts with the harness; no heading, config slot, hook contract, or layout changed (minor under ADR 0011).

### Changed
- **The package's own mechanisms now name the native Claude Code feature they build on.** The
  bootstrap and revise-docs skills say what the harness's own init command and machine-local
  memory notes already do before they say what they add. The conventions chapter records that a
  plugin has no native component that ships rule files or instruction content as project context,
  which is why house renders and vendors, and that session resume and harness memory carry state
  on one machine only, which is why the carryover issue is the shared tier. The github chapter
  states that every matching PreToolUse hook still runs and the most restrictive decision wins, so
  the branch guard's deference to a repo-local guard is a deliberate migration choice rather than
  something the harness requires, and that the guard family reports what is recorded, not what is
  enforced. The checker's drift and lengths family comments name the hosted reviewer and the
  harness's own auto-memory measurement as their floors, and the branch guard hook's fail-open
  block now lists the sessions and tool routes where it never sees the command at all. Skill
  prose, handbook prose, and comments only: no behavior change.
- **The `claude-code` and `docs` rules now name the native Claude Code feature each one builds
  on.** Eleven rewords across the two rule files, with the matching handbook chapters gaining a
  `Native floor` line per section that names the harness feature and cites its documentation, so
  a reader arriving from the Claude Code docs sees an extension rather than a restatement.
  Substance is unchanged: no heading, config slot, hook contract, or file layout moved.
- **Accuracy fix in `claude-code.md`, "Make a must-hold rule a hook".** The rule said a hook's
  matcher is best-effort, which is what the documentation says about a hook's fine-grained `if`
  filter, not about the event matcher; it now says to keep the decision in the script rather than
  in that filter. The same rule now also names the floor under a hook: a deny rule is evaluated
  whatever the hook returns, and a session started bare, in safe mode, or in restricted mode loads
  no project hooks at all.
- The `engineering`, `github`, and `testing` rules now name the native Claude Code feature each
  one builds on, so a reader arriving from the harness docs sees an extension rather than a
  restatement. Twenty headings gained a clause naming their floor: the eval runner's no-plugin
  baseline arm, a PreToolUse denial, hosted review's non-blocking check run, auto memory, a
  blocking hook's verbatim stderr, plan mode, `--bare` and the locally computed cost figure, the
  Action's opt-in cost levers, Bash permission-rule matching, worktree cleanup and the worktree
  sweep, deny rules on Read, the sandbox's Bash-only scope, CLAUDE.md as context rather than
  enforcement, the runner's cost ceiling and grader types, and hook debugging. The matching
  handbook chapters gained a dated `Native floor` line per heading with its citation. No heading,
  config slot, hook contract, or file layout changed.
- The `database`, `deployment`, `data-pipelines`, and `llm-output` rules now name the native Claude
  Code feature each one builds on, so a reader arriving from the Claude Code docs sees an extension
  rather than a restatement, and the matching handbook chapters cite that floor with its source.
  One of these is an accuracy fix: the named-deploy-script rule's anchor claimed a settings
  allowlist that omits the platform CLI is what refuses it, when an allow entry only skips a prompt
  and a deny rule is the layer that blocks.

## [0.5.0] - 2026-09-02

First public release. Everything below shipped in this version; earlier sections describe the private predecessor.

### Changed
- **The em-dash check is now a config slot, `modules.docs.config.emDash`, and its default surface
  changes.** It used to scan rule files and nothing else. The default is now `{"mode": "public",
  "paths": ["README.md", "CHANGELOG.md", "docs/**/*.md"], "exclude": []}`: public prose, where an
  em dash is a tell a reader actually sees, rather than the rule files, which ADR 0010 already
  gates upstream at authoring time.

  **Adopters on the default lose rule-file em-dash coverage and gain README, CHANGELOG, and docs
  coverage.** Sync does not propose new slots, so an adopter that never sets the slot moves to the
  new surface silently. Two paste-in values for `modules.docs.config`:

  Keep the old surface and add the new one:

  ```json
  "emDash": { "mode": "all", "paths": ["README.md", "CHANGELOG.md", "docs/**/*.md"], "exclude": [] }
  ```

  Turn the check off entirely:

  ```json
  "emDash": { "mode": "off" }
  ```

  `mode` is `public`, `all` (the public paths plus every rule file), or `off`. `paths` and
  `exclude` entries are a glob string or the `{"path", "why"}` object form, matched the way every
  other docs path slot is; `exclude` narrows `paths` and can never drop a rule file under `all`.
  A malformed field is a `manifest` finding and falls back to its own default, so a typo reverts
  that field to the default set rather than turning the scan off, and the manifest family names it.
  An explicit `"paths": []` is a second off switch: an empty array wins over the default, scans
  nothing, and is not a defect. The finding is otherwise unchanged: family `shape`, message
  `em dash character`.
- **The plugin and marketplace descriptions are rewritten for a general audience.** They are what
  an adopter reads in a plugin listing, and they used to open with the author's name and assume a
  reader who already knew what the package was for. Nothing about the plugin's behavior changes.

### Added
- **The package now states its license, by path.** `LICENSE` carries MIT and `LICENSE-DOCS`
  carries the CC BY 4.0 legal code, both verbatim from their canonical sources. `NOTICE` says
  which path takes which: MIT for the checker payload, the CLI, the hook, module `files/`
  directories, the schema, `scripts/`, `tests/`, and the JSON manifests; CC BY 4.0 for rule
  files, skills, markdown templates, `docs/`, `README.md`, and this file. Code examples inside
  documentation are MIT wherever the surrounding prose sits, so a snippet can be pasted without
  an attribution string attached. The expression for the repository as a whole is
  `MIT AND CC-BY-4.0`, and `package.json` and `plugins/house/.claude-plugin/plugin.json` now
  carry `"license": "MIT"`. Until now a vendoring repo had no stated terms at all, which is the
  one question an adopter cannot answer for itself. `NOTICE` also carries an attribution for
  every upstream in `docs/handbook/upstreams.md` that contributed text, structure, a schema
  shape, or a working method, and says why the one share-alike upstream in that ledger
  propagates no condition here. The same relaunch adds the community files an adopter looks for
  before filing anything: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, and the four
  issue forms under `.github/ISSUE_TEMPLATE/`.

- **A written breaking-change policy: rule content is minor, and major is the named surface**
  (`docs/decisions/0011-rule-content-changes-are-minor.md`). Rewriting a rule, adding a heading,
  adding a default-off module, or adding an optional schema key is a minor. Renaming or removing
  a rule heading, removing or renaming a config slot, tightening what the branch guard denies,
  changing the `house.json` or vendored-tree layout, and raising the Node floor are the breaking
  classes. The reasoning is that nothing reaches an adopting checkout without a person running
  `/house-rules:sync` and approving the printed plan, and the checker's report of a newer release
  is a warning that never fails a run. Below 1.0 a breaking change is still announced as one in
  this file and carried by the next minor. `docs/handbook/conventions.md` points at the record
  from the paragraph that enumerates the public surface.

## [0.4.1] - 2026-09-01

### Fixed
- **A no-op repo-local guard file no longer disarms the branch guard, and the checker no longer
  <!-- docs-drift-ignore: a CONSUMER-side path; this repo ships the hook at plugins/house/hooks/ and has no vendored copy of its own -->
  certifies one** (#27). The hook deferred to `.claude/hooks/no-direct-master.sh` by mere file
  EXISTENCE, so an empty file, or one containing only `exit 0`, removed branch protection
  entirely. `checkGuard` certified that same file by bare `existsSync`, so the two failures
  compounded: the repo reported a reachable guard while nothing enforced anything. Protection
  reported but absent is worse than no guard, because it is the state nobody investigates.

  Both sides now share one predicate: a local guard file counts only if it has a line that is not
  blank, not a comment or shebang, and not a bare `exit 0`. The predicate fails toward DENY --
  a local guard whose shape is unrecognized leaves the plugin hook armed, costing a branch
  creation rather than a miss. That is the direction #27 asks every allowlist in this file to fail
  in, and the settings.json branch beside it already worked this way.

  The old behavior was pinned as intended by a test that planted an `exit 0` stub and asserted
  deference; that case now asserts the opposite, with five stub variants beside it.

  No adopter is affected: none of the six repos has a repo-local guard file.

### Note
- The parsing-class bypasses in #27 (a space-quoted `-c` value, a `-c` body that changes
  directory, backslash-escaped verbs) are deliberately NOT addressed here. They need the redesign
  that issue describes, not another increment; three review rounds on PR #28 showed each added
  parsing rule opening a new seam. This change is in the other category: it removes a disarm
  rather than parsing a command better.

## [0.4.0] - 2026-09-01

### Fixed
- **A documented path's existence is a property of the repo, not of the machine.** The drift
  check's kind-(c) fallback probed the DISK after a tracked-set miss, so a path that is
  gitignored by design resolved on a developer's checkout and never on a runner's:
  `npm run check:house` passed locally and the identical run failed in CI. repo-d carried
  <!-- docs-drift-ignore: these three are repo-d's paths, a different repo; they are the incident this entry describes, not a claim about this tree -->
  four such findings (`repo-g/.env`, `app/node_modules`, `.claude/worktrees/*` -- all
  correct paths, two of which must never be committed) and nobody saw them for a week, because
  its `pull_request` trigger was off over the Actions-budget pause (#21) and the local gate was
  green the whole time. A check that only passes where the untracked files happen to be is not
  a check.

  The fallback now asks git what it IGNORES rather than asking the filesystem what is there.
  Ignore rules are committed, so the answer is identical on every checkout, and "git deliberately
  keeps this out of the tree" is a better reason to exempt a path than "it happens to be on this
  disk". Glob-parent anchors go through the same door: that branch was a bare `existsSync` with
  the same machine-dependence. The probe asks for both the bare and trailing-slash spellings,
  because a `dir/` pattern matches only a directory and git cannot tell that a path it cannot see
  is one.

  Net effect per path: gitignored resolves everywhere instead of only where the file sits;
  untracked-and-unignored is now a finding everywhere instead of passing on the author's machine
  and failing in CI. Measured across all six adopters before the change: zero anchors depended on
  the disk probe, so no repo loses a passing anchor.

### Added
- **`local-only ignore` warning.** A path hidden only by `.git/info/exclude` or a global
  `core.excludesFile` still resolves, but those rules do not travel with the repo, so a fresh
  checkout will flag it. That is the same divergence in a quieter form, so it now warns (naming
  the two fixes: commit the rule, or list the path in `buildArtifactPrefixes`) instead of passing
  in silence.

### Removed
- `existsOnDiskCaseExact` and its `realpathSync.native` case-canonicalization, dead once the disk
  probe is gone. Case-exactness now comes from the tracked set alone, which is where it always
  actually came from on a fresh checkout.

## [0.3.2] - 2026-08-31

### Fixed
- **The branch guard reads an interpreter's `-c` body.** The message-argument strip removed `-c`
  and its value (meant for git's own `-c key=value`), which made a git verb inside an interpreter
  command invisible to every scan since v0.2.2 (#27). The hook now also scans a `-c`-retaining
  variant of the command and denies when either variant matches, so the change can only turn an
  allow into a deny. This closes the direct interpreter cases (an interpreter `-c` body running a
  commit on a protected branch, or a push to a protected branch from any branch). Two related
  bypasses stay open and are tracked in #27, deliberately not chased here because closing them
  means the command parsing the guard's own header warns against: a `-c` value quoted with spaces
  survives the strip, and a `-c` body that changes directory into another repo is target-blind.
  Accepted cost: any non-git command that takes a `-c` flag whose value quotes a git verb plus a
  branch name now refuses on any branch (a curl cookie-jar, a `grep -c`, a `python -c`, an
  ssh/docker `-c`), the same false-deny class as the existing quoted-verb behavior; git's own
  space-free `-c key=value` commands are unaffected.

## [0.3.1] - 2026-08-31

### Changed
- **A new carryover issue closes the one it supersedes.** The handoff skill's original form left
  every superseded session-carryover issue open, so finished sessions accumulated open issues;
  the new issue now closes its predecessor with a "superseded by" comment, keeping exactly one
  carryover open and the chain walkable in both directions.
- **The carryover form drops anything re-derivable from the recorded SHA.** Gate exit codes and
  count tables are out (they re-run in seconds and a re-run number cannot be fabricated); what
  remains is tree state, shipped PRs, the headline finding, the next-cycle list, and the
  deferred-vs-not-done split. The `Hand off through a carryover issue` rule and the handbook
  form spec say the same.
- **Post-sync feedback is one issue per item, never a digest.** The sync skill gains a step 8:
  findings only the package can act on are fixed upstream in the same session or filed as one
  closeable issue each in the package repo, ending the multi-item feedback-dump pattern.

## [0.3.0] - 2026-08-31

### Fixed
- **A rule file's own receipts stopped warning in every consumer.** A vendored rule file names
  this package's surface in its prose (`docs/handbook/`, `docs/decisions/`, `plugins/house/`,
  `tests/`), and none of those resolve in the repo that adopted it: two adopters were each
  carrying about 119 identical, unfixable warnings per run. Tokens under those four prefixes are
  now dropped in a consumer's managed files whose body matches `.house/lock.json`, and stay hard
  findings here. ADR 0010 records why the exception is scoped to lock-vouched managed files.
- **A plugin-guarded repo can clear the `guard` warning.** A new top-level `guard` key in
  `house.json` (`by`, `decided`, `why`) records that the branch guard comes from the plugin, so
  the repo no longer has to re-vendor the hook the plugin exists to retire in order to look
  compliant. The record clears the checker's warning and is never a stand-down signal for the
  hook, which still denies. `house doctor` now prints `plugin (recorded <date>)` or
  `plugin (unrecorded)` for the effective branch guard.
- **`bareScriptAllowlist` and `excludeFiles` entries take an object with a `why`.** Alongside the
  plain strings, `{"token", "kind", "why"}` and `{"path", "why"}` (also honored for
  `archiveDirs`) turn a permanent suppression into a dated record. ADR 0009 covers all three
  shapes.
- **The docs-drift ignore-file marker window skips YAML frontmatter**, so a document whose
  frontmatter sits above the marker is opted out as intended rather than scanned anyway.
- **`house check` always runs the plugin's own payload**, and says so on stderr, rather than
  silently preferring a vendored copy that may differ from what is installed.
- **`docs.config.packageRoots` re-roots script and path anchors** for a repo whose npm package
  lives in a subdirectory, so a token relative to that package resolves instead of warning.

### Added
- `dependabot.yml` ships as a one-time `github`-module scaffold, written only when the repo has a
  `package.json` for it to describe.
- A warning names any repo-authored rule file with no configured length budget, so a file that
  nothing measures is visible instead of silently unbounded.
- A ship-set invariant test holds the set of files a release actually ships.

### Removed
- The ungenerated `house:rows:start` / `house:rows:end` markers are gone from the CLAUDE.md
  skeleton. They claimed `house render` filled the table and nothing ever did; the table now
  carries an instruction to copy its rows from `.house/INDEX.md`.

### Notes
- Three upgrade hazards. (1) `guard` is a new top-level key: sync the vendored checker before
  adding it, because an older `.house/check.mjs` reports it as an unknown key. (2) A lock written
  before 0.2.3 has no `scaffolds` record, which suppresses the new `dependabot.yml` scaffold until
  `render --apply --scaffold` is run once. (3) A CLAUDE.md skeleton already scaffolded into a
  consumer does not pick up the marker removal; scaffolds are one-time by design, so edit that
  copy by hand. (4) `house check` runs the installed plugin's payload, so a repo pinned AHEAD of
  the plugin can get answers CI's vendored checker will not give; the command now prints a
  version-skew warning on stderr in that case, and the fix is updating the plugin.

## [0.2.6] - 2026-08-29

### Added
- **A rule for the auto-memory index**, in the claude-code module: one line per memory, and that
  line is the cue to open the topic file rather than the fact itself; move a fact the index is
  the only copy of down into its file before shortening the line; keep the newer cue when a later
  memory supersedes an earlier one; and read the load ceiling as a cliff, not a budget. Receipt in
  `docs/handbook/claude-code.md`, inventory rows AG-065 (port) and EXT-099 (fold).
- **`lengths` now warns on the auto-memory index.** It loads in full at the start of every session
  and the harness cuts it at 200 lines or 25KB, whichever comes first, with nothing in the session
  saying the tail was dropped. The check derives the path from `CLAUDE_CONFIG_DIR` (or the default
  config directory) plus the project directory name, which is the repo root with every separator
  turned into a dash, or `CLAUDE_CODE_PROJECT_DIR_NAME` when that is set beside `CLAUDE_CONFIG_DIR`
  (the harness ignores it on its own, so the checker does too). It warns
  past 140 lines, 17,500 bytes, or any line over 160 characters, naming the counts and the first
  three long lines.

### Notes
- The memory-index check is the first time the checker reads state outside the repo it was pointed
  at, so it warns and never fails, and it is silent when the file is absent: a CI checkout has no
  config directory, so the check is a no-op there by construction. The thresholds are compiled in
  with no `house.json` slot, because the caps belong to the harness rather than to a repo's policy.
  ADR 0008 records the boundary. Three cases in `tests/check/lengths.test.mjs` hold it: an
  over-threshold index warns at exit 0, a short one is silent, and an empty config directory is
  silent.

## [0.2.5] - 2026-08-25

### Fixed
- **Prose could disarm the branch guard.** Target resolution reads `cd <path> &&` and
  `-C <path>` out of the command, and a target that is not a repo is a deliberate fail-open. Any
  text naming a path that does not exist therefore pointed the check at nothing and a real commit
  on a protected branch was **allowed**. A heredoc body, a commit message, or a quoted string all
  did it. Confirmed against the shipped hook, then closed. (#27)

  The fix adds no parsing, on purpose. Three attempts to parse the command better were written
  and reverted this cycle, each having opened new seams; that history is on #27. A target parsed
  out of the command is now treated as a guess, and a guess that turns out not to be a repo falls
  back to the directory the command actually runs in rather than standing in for it. The guard no
  longer depends on the guess being right, and the change is monotone: it can only turn a former
  allow into a deny, so it cannot open a bypass of its own. A genuinely non-repo working
  directory still fails open, and a real `-C`/`cd` into another repo still resolves to that repo.

  Two corrections from review, neither of which reads the command any further. A **relative**
  target now resolves against the directory the command runs in rather than the hook process's
  own cwd (successive `-C` compose), so a valid `cd ../sibling-repo` is not misread as "not a
  repo". And the accepted cost is now stated where it bites: a target this same command
  **creates** (a worktree, a clone, a fresh `init`) does not resolve yet either, so it denies on
  a protected branch and must be split into two calls. The deny message used to recommend
  exactly that chained one-liner, which meant following the guard's own advice was refused; it
  now says to make the worktree in a separate call. Recognizing creation would mean parsing the
  command again, which is the approach that failed.

### Notes
- #27 stays open for its second confirmed bypass: `-c` in the message-strip list collides with
  every interpreter's `-c`, so a git command wrapped in `bash -c '...'` is invisible to the
  guard. That one needs the strip-list surgery that went wrong three times this cycle and is
  deliberately not attempted here.

## [0.2.4] - 2026-08-25

### Fixed
- **A one-time scaffold's own glob is no longer dropped on a first render.** A `paths:` glob was
  filtered against tracked files only, so on a first render `.claude/**` matched nothing and the
  `claude-code` module's default `claudeGlobs` collapsed to `CLAUDE.md` alone. A repo without one
  had the module vendor zero rules, which the manifest family reports as a finding, not a
  warning. Globs are now tested against the tracked tree plus the dests the render is about to
  write, which also means the `github` rule is vendored on the first render instead of the
  second. (#26)
- **`render` no longer deletes a rule file it just wrote.** A scaffold from the previous render
  is on disk but untracked, so it counted as neither tracked nor planned: the glob was dropped,
  the rule skipped, and the orphan sweep removed it. Two renders in a row with no `git add`
  between them flip-flopped. The render-target gate now mirrors the writer's conditions,
  `--scaffold` included.

### Changed
- **`render` never originates `CLAUDE.md`.** The skeleton is always written as
  `CLAUDE.md.house-skeleton`, matching what `bootstrap/SKILL.md` has always promised
  ("Bootstrap never originates the repo's root file"). Previously a repo with no `CLAUDE.md`
  received one authored on its behalf, opening `# TODO: Project Name`. This ships together with
  the glob fix above and not before it: alone it would have handed every fresh adopter a red
  checker. (#26)

### Notes
- **The branch-guard work planned for this release was reverted and is not shipped.** #27 is
  still open, and it now carries more than it did: two bypasses confirmed against the shipped
  hook (a heredoc body can steer target resolution into the non-repo fail-open, and `-c` in the
  message-strip list collides with every interpreter's `-c`), plus the record of three review
  rounds in which each attempted fix introduced new bypasses of its own that the committed
  suite never caught. The approach, incrementally patching a regex-based shell parser, did not
  converge; the issue proposes failing closed on ambiguity instead. Reverting leaves the hook at
  its known state with two documented holes rather than shipping an unknown one.

## [0.2.3] - 2026-08-25

### Fixed
- **A one-time scaffold is now offered once per repo, not once per `render --apply`.** The
  CLAUDE.md skeleton exists to be merged into `CLAUDE.md` by hand and then deleted, but every
  later render wrote it back, so each adopter re-sync had to `rm` `CLAUDE.md.house-skeleton`
  again to keep the commit clean. `.house/lock.json` gains a `scaffolds` list recording which
  templates a repo has already been given; a recorded template is not written again, whether or
  not its file survives. The record is keyed by template, not destination, because the
  skeleton's destination moves to the sidecar name once a `CLAUDE.md` exists. It is a record,
  never a hash: the tamper family reads `files[]` only, so nothing refuses on it and a repo may
  edit or delete a scaffold freely. (#23)

### Added
- **`house render --apply --scaffold`** ignores that record and writes back any missing
  scaffold. It still never overwrites a file on disk, so an edited copy is safe either way.

### Notes
- A lock written at 0.2.2 or earlier has no `scaffolds` key and is read as "already offered"
  for every template whose module gate passes right now, so the first re-sync at 0.2.3 is quiet
  rather than writing the skeleton one last time. The one case that seed cannot get right is
  pinned as a test: a repo that turns a module ON in the same render that upgrades it is seeded
  as though it had already been offered that module's scaffolds and does not get them;
  `--scaffold` is the way back, and that is why the flag exists.

## [0.2.2] - 2026-08-24

Findings from a multi-agent review of the whole checker surface (check.mjs, the render CLI, the branch-guard hook, and their tests) at v0.2.1.

### Fixed
- **Branch guard: commit-message text could pick where the branch check ran.** The
  target-directory resolution (`git -C <path>`, `cd <path> &&`) matched the raw command
  before message arguments were stripped, so `git commit -m "note: cd /nonexistent && push"`
  on a protected branch resolved to a non-repo path and hit the deliberate non-repo
  fail-open: an allow. Target resolution now runs on the message-stripped command, and
  `--message=...`/`-m=...` forms are stripped too. Hook tests carry the bypass cases and
  the real-`cd`/`-C` controls.
- **"Repo-local guard present" means one thing everywhere.** The hook defers only to a
  non-empty `PreToolUse` array in `.claude/settings.json`; `house doctor` reported `repo`
  for any `hooks` key (an empty block, a PostToolUse logger), and the `guard` family also
  counted a hook in `settings.local.json`, which the hook never reads. Both now mirror the
  hook, with a new `guard` test file.
- **Component drift resolves every configured extension.** The v0.1.2 fix stripped only
  `.astro`; a `Foo.tsx`, `.jsx`, `.vue`, or `.svelte` reference fell through unchecked.
- **Module defaults keyed by `module.json` name.** A module whose `name` differs from its
  directory dodged the disabled-module deviation check; the defaults reader now keys the
  way `house.json` and its sibling readers do.

## [0.2.1] - 2026-08-24

### Added
- **Every module's literal `defaultPaths` now sits behind a config slot** whose default is
  the historical set, so no co-load is unresolvable from `house.json` (#13 left `github`,
  `claude-code`, `database`, and `testing` hardcoded): `githubGlobs`, `claudeGlobs`,
  `dbGlobs`, `testRoots`. An adopter that has not set a slot renders exactly what it did
  before. (#19)
- **`coload` reports every over-budget rule combination**, once each, with the number of
  paths sharing it and an example path, instead of only the single worst path. The
  finding names the resolution order; `--json` `coloadWorst` is unchanged. (#19)
- **A raised `maxCoLoadLines` must be on the record.** New deviation kind
  `coload-ceiling` carrying the value as an integer `ceiling`; a ceiling above the default
  (400) with no entry whose `ceiling` equals it is a `manifest` finding, and a ceiling that
  is not a positive integer is one too. Adopters must sync the checker before adding the
  kind, since a v0.2.0 checker rejects it. (#19)
- **`init`, `render`, and `doctor` probe git-ignored house destinations** with
  `git check-ignore` and warn with the fix (ignore only the local settings file under
  `.claude/`, never the whole `.claude/` or `.house/` directory). `render --json` carries `ignoredDests`; `doctor` prints a
  `git-ignored house destinations` line. (#18)

### Fixed
- **A managed file git cannot see is no longer a silent zero.** The `manifest` family
  compares `.house/lock.json` against `git ls-files`: an entry on disk but gitignored is a
  `[gitignored]` finding (the drift/shape/lengths/coload families never read it); on disk
  but unstaged is an `[untracked]` warning telling you to `git add` it. (#18)
- **`render` writes the github scaffolds only when the github module is enabled.**
  `.github/PULL_REQUEST_TEMPLATE.md` and `.github/workflows/pr-checks.yml` belong to that
  module; a repo that disabled it (no CI, direct-to-main) no longer receives them, and ones
  already on disk are left in place with one note. (#18)
- **`expandPaths` dedups**: a slot value repeating a literal rendered the glob twice
  (`tests/**` in the testing rule). (#19)
- **`/house-rules:sync` skill text** now runs the real `house doctor` verb (the CLI has had
  one since v0.1.1) and tells the operator to stage rendered files by path.

## [0.2.0] - 2026-08-24

### Changed
- **BREAKING (namespace):** renamed the package, marketplace, and plugin to `house-rules`. Skills are now `/house-rules:bootstrap`, `/house-rules:sync`, etc. The GitHub repo is `dubbl-a/house-rules` (redirects preserve old links). The per-repo artifacts are unchanged: `house.json`, `.house/`, and the `house-managed` marker keep their names. Adopted repos pick up the new command names on their next `/house-rules:sync`; re-install with `claude plugin marketplace add dubbl-a/house-rules` then `claude plugin install house-rules@house-rules --scope user`.

## [0.1.2] - 2026-08-24

### Fixed

- **Component drift now resolves a spelled-out `.astro` extension.** A backticked
  `Foo.astro` reference was never matched against the component basename set (the
  `.` broke the CamelCase test), so a renamed `Foo.astro` reference went silently
  stale. The checker now strips a trailing `.astro` before resolving. (#14)
- **`render --apply` removes orphaned managed files.** When a module's `paths:`
  narrow until they match nothing, the rule is skipped -- but a copy from a prior,
  broader render used to be left on disk (a stale rule had to be `git rm`-ed by
  hand). Render now deletes any file under `.claude/rules/house/` (and any managed
  dest from the prior lock) that is no longer in the plan, so the vendored tree,
  the lock, and the plan stay in exact agreement. (#12)

### Added

- **Load-bearing default paths are now overridable.** The docs rule's document set
  (`README.md`, `CLAUDE.md`, ...) and the engineering rule's code roots (`src/**`,
  ...) moved behind config slots (`$docFiles`, `$codeRoots`) whose default is the
  historical literals, so a consumer can scope them to resolve a co-load without
  any existing repo changing behavior. (#13)
- **Lower-severity suppression holes now surface instead of passing silently** (#11):
  the disabled-module deviation check warns when module defaults are unreachable
  (P8); an excluded doc that never carried a `docs-drift-ignore-file` opt-out warns
  in consumer repos (P9); the co-load budget now counts the repo's own non-house
  `.claude/rules/*.md` and treats an always-on (no-`paths:`) rule as loading for
  every path (P12); and a whole-file `docs-drift-ignore-file` opt-out with no reason
  warns (P13). Empty `componentSuffixes`/`classPrefixes` stay a deliberate,
  documented no-op (P11).

## [0.1.1] - 2026-08-24

### Fixed
- CLAUDE.md length is now measured as a **warning**, never a silent omission. A missing `CLAUDE.md` limit in `house.json` (which previously disabled the check entirely) now warns, and an over-limit CLAUDE.md warns without blocking the gate (it is not ratchet-eligible; a trim follow-up clears it). Closes the repo-d v0.1.0 gap where a 492-line CLAUDE.md passed with zero findings because no limit was configured.

### Added

- The repo checker now closes a failing report with the three ways to fix a finding (change the
  document, change the code, or record the exception with its reason), with a positive and a
  negative control in `tests/check/cli.test.mjs`.
- `house doctor` reports whether a rule-load positive control (an `InstructionsLoaded` hook) is
  wired, so a rule whose `paths:` glob never matches is distinguishable from one that does nothing.
- `npm run check:traceability` runs the traceability gate on its own, and `npm run verify` and CI
  now both run it. It was a correct tool nothing called.
- `docs/handbook/conventions.md` states the package's public surface and what a version bump
  promises, plus the missing-harness gap that `plugins/house/evals/` answers.
- `docs/handbook/github.md` records how far a user-scope branch guard reaches and which branch
  protection is actually real per repo; the hook's own header now carries the same reconciliation.
- `docs/handbook/upstreams.md` records the ai-rulez and Packmind borrows that were made and never
  written down.

### Updated

- `CLAUDE.md.skeleton`: worktree detection before creation, worktree naming and seeding, the
  long-running-job trigger, the skippable-preview list, the unaffected control surface in a
  preview, and one library per job with its escape condition.
- Rule files gained the clauses their inventory rows promised: a retired figure gated absent from
  every surface and zero false positives as necessary but not sufficient (engineering), the
  present-and-absent render check (engineering), an unconfirmed authoring marker and a
  mechanically checkable near miss (llm-output), per-project service pinning (claude-code).
