---
paths:
  - .claude/**
  - CLAUDE.md
---
<!-- house-managed v0.13.1 module=claude-code source=modules/claude-code/rules/claude-code.md body-sha256=dcf3c8ec2c9395ab1ac7ca65c08cb74bb0bb0cfa311b5e650be7de12542879a2 DO NOT EDIT: propose upstream (see docs in dubbl-a/house-rules), record a deviation, or house render --force-managed <path> -->
<!-- house source rule file; vendored into consuming repos by /house-rules:sync -->
# Claude Code conventions

What belongs in the root file, what belongs in a scoped rule, what belongs in a skill, and what has to be a hook.

## Put only what Claude would get wrong without it in the root file

Ask of every line whether removing it would cause a mistake, and cut the line when the answer is no.
A file layout, a dependency list, or generic craft advice is derivable from the code; a non-guessable command, a differing convention, and an environment quirk are not.
Open the file by naming what to read first and which file wins a conflict, and leave learnings to auto-memory so the file holds rules only.
The harness advises this already but stops at advice: its checkup proposes cutting derivable content, and its size guidance the model may ignore.
Anchor: `node .house/check.mjs --only=lengths` turns that advice into a gate, holding the root file to a line ceiling and a byte ceiling, and refuses to ratchet it.
Receipts: `docs/handbook/claude-code.md#put-only-what-claude-would-get-wrong-without-it-in-the-root-file`

## Keep the auto-memory index to hooks, and hold it under its cap

Write one line per memory as the cue to open the file, not the fact itself, since the index loads every session while the topic file loads only on demand.
Move any fact the index is the only copy of into its topic file before shortening the line; a trim that loses the fact is worse than the long line it replaced.
The harness already shortens the index after a write and errors past the load ceiling; treat that as the floor and add what it cannot see.
Keep the newer cue when a later memory supersedes an earlier one, and let the older topic file record the hand-off so the index never carries two answers.
Treat the documented load ceiling as a cliff rather than a budget, because everything past it is dropped on the next load and no session says so.
Anchor: `node .house/check.mjs --only=lengths` warns when the index nears either load ceiling or carries a line too long to be a cue, and stays silent where no memory directory exists.
Receipts: `docs/handbook/claude-code.md#keep-the-auto-memory-index-to-hooks-and-hold-it-under-its-cap`

## Give a domain rule a paths list, and never leave a rule file unscoped

Scope every domain rule with `paths:` so a session that never touches the domain never pays for it.
A rule file with no `paths:` is not unscoped, it is always-on at root-file priority, so if it belongs in every session move it into the root file instead.
Confirm the scoping defers loading before you count on it, and tell the reader to grep the rules directory when no matching file is open.
Anchor: check.mjs `drift` validates every rule file's `paths:` first segment against the tree, and `coload` caps the summed budget of the rules that match any one path.
Receipts: `docs/handbook/claude-code.md#give-a-domain-rule-a-paths-list-and-never-leave-a-rule-file-unscoped`

## Make a procedure a skill, not a rule

Move a multi-step procedure and its reference material into a skill, where only the description costs context every session.
A skill's description, even truncated by the harness, costs less each load than an instruction file's whole body.
The harness points a growing instruction file to a path-scoped rule and stops there; what it never says is what a skill then owes you.
Give its description one sentence naming its exact inputs and the filter it applies, then disclose the rest on demand: references read when needed, scripts whose output alone enters context.
Give the skill a hazards section naming what has gone wrong, and say when an edit to it takes effect.
Keep personal rules in a separate instruction file so the mechanics stay portable, and write a few evaluations before the prose to fix real gaps, not imagined ones.
Anchor: `node .house/check.mjs --only=lengths` caps a rule file far below what a procedure needs, so a procedure that grows has nowhere to hide.
Receipts: `docs/handbook/claude-code.md#make-a-procedure-a-skill-not-a-rule`

## Keep a skill body short, its references one level deep, and its name equal to its directory

Hold the body under its configured cap and move detail into references rather than appending, and keep references exactly one level deep; a nested file gets partially read.
No documented cap covers the body itself; the harness only documents a truncated listing and a compaction pass that keeps each skill's opening slice and drops the least recent, so a long body is what stops surviving.
Open any reference past the length threshold with a table of contents, so a partial read shows scope.
Write the description in third person, saying what the skill does and when to use it, and offer a default with an escape hatch rather than a menu.
Keep time-sensitive facts out of the method; the full rule on that lives in docs.md.
The harness treats a personal or project skill's name as a display label, invoking it by directory, while a plugin skill's name replaces the last segment of its namespaced command; a legal mismatch is an error in both here.
Anchor: check.mjs `lengths` caps the skill body, and `shape` fails any skill whose name differs from its directory, including a plugin skill.
Receipts: `docs/handbook/claude-code.md#keep-a-skill-body-short-its-references-one-level-deep-and-its-name-equal-to-its-directory`

## Disable model invocation on a skill with side effects

Set `disable-model-invocation: true` on any skill that writes, deploys, or spends, so nothing in the session can fire it on its own and its body costs nothing until a caller names it.
The harness blocks a model-initiated call to a skill with this field set and keeps a scheduled prompt from firing one; treat that as the floor, since it cannot decide which effects count as side effects.
Remember that a print-mode run expands a named skill before the turn starts, so the gate is the caller who wrote the string, not a person watching a prompt.
Make the later phases of a procedure explicit opt-in gates rather than an automatic continuation.
Expect an automatic mode to route a production deploy through a classifier rather than through you; answer with explicit intent, not a route around it.
Anchor: none (because frontmatter cannot tell which effects are side effects; skill review is the check).
Receipts: `docs/handbook/claude-code.md#disable-model-invocation-on-a-skill-with-side-effects`

## Set the model explicitly on every subagent and workflow agent

Name the model on every agent call, because an omitted one silently inherits the session's, and a wide fan-out then runs at whatever tier you happened to be in.
Match the tier to the task: mechanical joins and receipt checks at the small tier, code and prose in the middle, judgment and adjudication at the top.
Keep the session's own tier for the session: a subagent, a teammate, or a workflow agent runs one tier below it by default, so set the subagent model variable in user settings to that tier as the floor; an explicit call-level model still wins.
Reach for the plugin's pinned roster before a bare agent call (scout small, researcher and builder middle, refuter and debugger top tier below the session's), since each pins its model, effort, and tools in a file the harness enforces.
Expect a managed model list to apply as given, not merged with yours, so a named tier can be unavailable.
Expect the harness to substitute and warn rather than fail, stepping a blocked call down to the newest allowed model in its family: the checker and the fork's model map make that step-down visible.
State the tier a procedure requires and stop when the session is below it, and give a scripted run the print-mode budget ceiling flag so a cost constraint is enforced, not just stated; that figure is a spend estimate, not the bill.
When a bundled workflow exposes no model input, as `/deep-research` does, run a fork of its script by path with a model on every call, and run `scripts/house/check-deep-research-upstream.mjs` after each upgrade: read its verdict by name, since each outcome is its own exit code, unchanged needs nothing, drifted or missing means rebuild (a missing binary or missing bundled script counts as drift; rebuild the fork), a bad argument means fix the call, and SUNSET means delete the fork.
Give that fork a depth that fits the question: the native fan-out runs roughly 110 agents regardless of what is asked, while the fork scales from about 35 to 130, light for a lookup or a single procedure, standard by default, deep for a contested or multi-domain question a decision rides on, with `args.budget` for a field the presets get wrong.
Anchor: the eval pair at `plugins/house/evals/explicit-model-tier/`, whose arms differ only in whether each call sets a model.
Receipts: `docs/handbook/claude-code.md#set-the-model-explicitly-on-every-subagent-and-workflow-agent`

## Make a must-hold rule a hook, fail it closed, and test it with real payloads

Turn a rule that must hold every time into a hook; a rule file is advisory context, and only a pre-tool hook stops the action.
Know the floor under the hook: a deny rule is evaluated whatever the hook returns, and a bare, safe-mode, or restricted session never loads project hooks, so anything that must survive needs a deny rule in managed settings too.
Fail it closed: a crash, a missing helper, or an unreadable payload denies rather than passing quietly, since a silent exit reads as no decision and never as approval.
Know where that exit stops binding: only the pre-tool event reads a failing exit as a block, while the permission-request event ignores it and runs on, so a guard there has to deny through its decision object instead.
Fail its text handling closed too: where a guard rewrites the command before matching, err toward rewriting less than intended, since text left in only adds denials while text wrongly removed hides the verb and bypasses. Pin both directions in the tests.
Keep the decision in the script rather than a hook's fine-grained filter, which the harness itself documents as best-effort, unfit for a hard allow or deny.
Escalate as autonomy rises, from a prompt, to a check the agent runs before you walk away, to a hook, to a verification subagent.
Read a permission block as evidence of a wrong step earlier, not as an obstacle to route around.
Anchor: `bash tests/hooks/run.sh` drives real payloads through the real hook wiring, with a denied case, an allowed case, and a planted internal failure.
Receipts: `docs/handbook/claude-code.md#make-a-must-hold-rule-a-hook-fail-it-closed-and-test-it-with-real-payloads`

## Run adversarial review in a fresh subagent with a named lens

The harness ships a review that already runs in its own subagent over the branch diff; start there and add what it lacks: a named lens, and a reviewer told to flag only correctness and requirement gaps.
Send a refuter only when the change carries logic, a guard or hook, or facts someone will act on; a prompted reviewer usually reports something even when the work is sound, and chasing every finding over-engineers.
Read the diff yourself for a text-only or mechanical change a gate already covers, and rerun the tests yourself; that review buys nothing a gate does not already buy.
Run one review round per change, add a second only when the first returned a must-fix and the fix was more than mechanical, and leave any further round to the user; each round costs a full top-tier review.
Delegate file-heavy investigation the same way, so only the summary reaches the main context; the full rule on a verify phase's UNVERIFIED lives in engineering.md.
Let the reviewer apply mechanical fixes in its own commit, and land judgment-level changes as proposals.
Remember that a background review's applied fixes land outside the session's checkpoints, so git is the only way back.
After an interrupt, work inline, and recover a killed fan-out's finished results from its transcripts rather than re-running it.
Anchor: none (because a lens is prose, not a flag; the review report is the only artifact).
Receipts: `docs/handbook/claude-code.md#run-adversarial-review-in-a-fresh-subagent-with-a-named-lens`

## Plan when the approach is uncertain, and clear the context after two failed corrections

Plan first when the approach is uncertain or the change spans files, and skip it when you could describe the diff in one sentence, since planning has real overhead.
Clear the context after two failed corrections on the same issue; a context full of failed approaches loses to a clean session with a better prompt.
Re-read the source of a ruling immediately before you act on it, not once at session start, since a ruling can land mid-session.
Anchor: none (because the harness cannot see that a correction failed; the second failed attempt is the signal).
Receipts: `docs/handbook/claude-code.md#plan-when-the-approach-is-uncertain-and-clear-the-context-after-two-failed-corrections`

## Treat git state as shared across sessions

Assume another checkout can move your branch mid-run and strand uncommitted work; ask before switching and commit early.
Enter a worktree before the first edit or branch, with the harness's worktree tool or `git worktree add -b <branch> <path> origin/<default>`, as the first step of every plan; the main checkout is what every peer and the user hold.
Never create a branch in the main checkout, not even for a one-commit change: the rubric that would license an exception is one every session answers in its own favor, and a worktree costs one command.
Leave the main checkout on the default branch for reading, merging, and cleanup.
Read the current branch immediately before every commit and push, not what it was at session start.
Squash-merge another session's branch, not rebase it, and never force-clean a checkout you do not own.
Anchor: the pre-tool branch guard at `plugins/house/hooks/no-direct-master.sh`, which re-reads the branch on every git command it sees and refuses a `checkout -b` or `switch -c` in a main checkout.
Receipts: `docs/handbook/claude-code.md#treat-git-state-as-shared-across-sessions`

## Keep the committed settings narrow and the local settings local

Commit an allowlist covering the repo's own script surface and read-side platform commands, nothing broader, and authorize deploy and egress verbs through a skill instead.
Allow-list network fetches per domain rather than blanket, and pin the servers and services the project enables by name rather than inheriting whatever is installed, since a print-mode run loads them with no approval prompt.
Pin them from the deny side too, since the disable list binds in every session type including an untrusted checkout, and give a scripted run the strict server-config flag so it connects only what it was handed.
Reach for a deny rule when you want the blanket, since a deny can wildcard every tool of every server while an allow must name its server; keep a parameter-scoped rule on a server tool out of settings, since the loader silently skips it.
Keep the wide accreted list in `settings.local.json`, gitignored and free of machine paths, and forward-declare a script you are about to add so its first run prompts nothing.
Prune it on a cadence, since permission lists merge across scope rather than override, so one broad grant supersedes every narrow one and a stale entry outlives the rename that orphaned it.
Shape the list rather than only pruning it: allow a tool broadly and deny its escape hatches, since hazards are finite and stable per tool while safe invocations are unbounded, growing with every approval.
Write each deny in both the leading and the interior form, and run it against the invocation it must block and the innocent one it might catch; a pattern's reach is not what reading it suggests.
Say in the file that this is not a boundary, since a heredoc and a pipe still run under a broad allow and are deliberately left open, and never grow the deny list chasing completeness.
Leave the allow half to the operator; an agent can tighten a settings file but cannot grant itself a permission in one.
Anchor: `plugins/house/templates/settings.json` ships the narrow committed allowlist with no hooks block, beside a deny list naming each tool's inline-code and shell-escape flags, and `/house-rules:sync` refuses a managed file that was edited locally.
Receipts: `docs/handbook/claude-code.md#keep-the-committed-settings-narrow-and-the-local-settings-local`

## Read a resume file as a harness artifact, not a handoff

Treat a checkpoint file the harness writes as a record of where a session stopped, not a protocol the next session follows.
It carries a session id, a snapshot ref, and a resume command, not state anyone can diff, and it is stale the moment the tree moves.
Anchor: the `/house-rules:handoff` skill, which produces the handoff artifact so a checkpoint file is never mistaken for one.
Receipts: `docs/handbook/claude-code.md#read-a-resume-file-as-a-harness-artifact-not-a-handoff`

## Hand off through the repo, not a standing issue

Open an issue only for work someone will do; a standing issue with nothing to act on is noise in the tracker, not a handoff.
Auto memory is the harness's own place for ongoing work, but it is machine-local and never shared, so it cannot be the channel the next session reads.
Turn each next-cycle item into its own issue, after checking that an open one does not already cover it, so the tracker stays a list of work, not snapshots.
Record a thing deferred by decision, with its reason, where the decision already lives (the CHANGELOG, a decision record, a code comment), and file an issue closed as not planned only when no such place exists; the rest is re-derivable from the default branch and merged PRs.
Print the handoff's snapshot in the session rather than filing it anywhere. Gate verdicts and counts are re-run from the recorded commit, never copied in, since a copied number goes stale and a re-run one cannot be fabricated.
Anchor: the `/house-rules:handoff` skill, whose required sections are that shape.
Receipts: `docs/handbook/claude-code.md#hand-off-through-the-repo-not-a-standing-issue`

## Check for a peer session before driving shared external state

List the running agents before driving a shared application, database, or checkout; a peer session may already own it.
Never ship from a main checkout another session occupies; deploy from the merged worktree instead.
Anchor: the guard chain in `scripts/house/deploy-guards.mjs`, whose main-at-origin check aborts when the main checkout is not where the deploy assumed.
Receipts: `docs/handbook/claude-code.md#check-for-a-peer-session-before-driving-shared-external-state`

## Don't

Don't lean on a hook's fine-grained filter for a hard allow or deny; match broadly and keep the decision in the script.
Don't enumerate safe invocations where a deny on the escape hatch would do, and don't ship a deny pattern you have not run.
Anchor: each prohibition above is the negative of a rule in this file; that rule names the enforcement.
