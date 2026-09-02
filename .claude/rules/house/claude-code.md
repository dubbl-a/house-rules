---
paths:
  - .claude/**
  - CLAUDE.md
---
<!-- house-managed v0.5.0 module=claude-code source=modules/claude-code/rules/claude-code.md body-sha256=e4f2ac91c4786aed0c89489d5717e5cedd849b053d4574d22d6ba12beb37f884 DO NOT EDIT: propose upstream (see docs in dubbl-a/house-rules), record a deviation, or house render --force-managed <path> -->
<!-- house source rule file; vendored into consuming repos by /house-rules:sync -->
# Claude Code conventions

What belongs in the root file, what belongs in a scoped rule, what belongs in a skill, and what has to be a hook.

## Put only what Claude would get wrong without it in the root file

Ask of every line whether removing it would cause a mistake, and cut the line when the answer is no.
A file layout, a dependency list, or generic craft advice is derivable from the code and buys nothing; a non-guessable command, a convention that differs from the default, and an environment quirk are not.
Open the file by naming what to read first and which file wins a conflict, and leave learnings to auto-memory so the file holds rules only.
Anchor: `node .house/check.mjs --only=lengths` holds the root file to a line ceiling and a byte ceiling, and refuses to ratchet it.
Receipts: `docs/handbook/claude-code.md#put-only-what-claude-would-get-wrong-without-it-in-the-root-file`

## Keep the auto-memory index to hooks, and hold it under its cap

Write one line per memory and make that line the cue to open the file rather than the fact itself, because the index loads every session while the topic file loads only when something asks for it.
Move any fact the index is the only copy of down into its topic file before you shorten the line, since a trim that loses the fact is worse than the long line it replaced.
Keep the newer cue when a later memory supersedes an earlier one, and let the older file record the hand-off so the index never carries two answers to the same question.
Treat the documented load ceiling as a cliff rather than a budget, because everything past it is dropped on the next load and no session says so.
Anchor: `node .house/check.mjs --only=lengths` warns when the index nears either load ceiling or carries a line too long to be a cue, and stays silent where no memory directory exists.
Receipts: `docs/handbook/claude-code.md#keep-the-auto-memory-index-to-hooks-and-hold-it-under-its-cap`

## Give a domain rule a paths list, and never leave a rule file unscoped

Scope every domain rule with `paths:` so a session that never touches the domain never pays for it.
A rule file with no `paths:` is not unscoped, it is always-on at root-file priority, so if it belongs in every session move it into the root file instead.
Confirm the scoping really defers loading before you count on it, and tell the reader to grep the rules directory when no matching file is open.
Anchor: check.mjs `drift` validates every rule file's `paths:` first segment against the tree, and `coload` caps the summed budget of the rules that match any one path.
Receipts: `docs/handbook/claude-code.md#give-a-domain-rule-a-paths-list-and-never-leave-a-rule-file-unscoped`

## Make a procedure a skill, not a rule

Move a multi-step procedure and its reference material into a skill, where only the description costs context every session.
Give that description one sentence naming its exact inputs and the filter it applies, then disclose the rest on demand: references read when needed, scripts whose output alone enters context.
Give the skill a hazards section naming what has actually gone wrong, and say when an edit to it takes effect.
Keep personal rules in a separate instruction file so the mechanics stay portable, and write a few evaluations before the prose so you fix real gaps instead of imagined ones.
Anchor: `node .house/check.mjs --only=lengths` caps a rule file far below what a procedure needs, so a procedure that grows has nowhere to hide.
Receipts: `docs/handbook/claude-code.md#make-a-procedure-a-skill-not-a-rule`

## Keep a skill body short, its references one level deep, and its name equal to its directory

Hold the body under the documented cap and move detail into references rather than appending, and keep references exactly one level deep, because a nested file gets partially read.
Open any reference past the length threshold with a table of contents, so a partial read still shows scope.
Write the description in third person, saying both what the skill does and when to use it, and offer a default with an escape hatch rather than a menu.
Keep time-sensitive facts out of the method; the full rule on that lives in docs.md.
Anchor: check.mjs `lengths` caps the skill body, and `shape` fails a frontmatter name that differs from its directory.
Receipts: `docs/handbook/claude-code.md#keep-a-skill-body-short-its-references-one-level-deep-and-its-name-equal-to-its-directory`

## Disable model invocation on a skill with side effects

Set `disable-model-invocation: true` on any skill that writes, deploys, or spends, so only a person can fire it and its body costs nothing until they do.
Make the later phases of a procedure explicit opt-in gates rather than an automatic continuation.
Expect an automatic mode to block a production deploy by classifier, and answer that with explicit intent rather than a route around it.
Anchor: none (because frontmatter cannot tell which effects are side effects; skill review is the check).
Receipts: `docs/handbook/claude-code.md#disable-model-invocation-on-a-skill-with-side-effects`

## Set the model explicitly on every subagent and workflow agent

Name the model on every agent call, because an omitted one silently inherits the session's and a wide fan-out then runs at whatever tier you happened to be in.
Match the tier to the task: mechanical joins and receipt checks at the small tier, code and prose in the middle, judgment and adjudication at the top.
State the tier a procedure requires and stop when the session is below it, and state a cost constraint as a rule the procedure may not break.
Anchor: the eval pair at `plugins/house/evals/explicit-model-tier/`, whose arms differ only in whether each call sets a model.
Receipts: `docs/handbook/claude-code.md#set-the-model-explicitly-on-every-subagent-and-workflow-agent`

## Make a must-hold rule a hook, fail it closed, and test it with real payloads

Turn a rule that must hold every time into a hook, because a rule file is advisory context and only a pre-tool hook stops the action.
Fail it closed: a crash, a missing helper, or an unreadable payload denies rather than passing quietly, and the matcher stays broad because a matcher filter is best-effort, so the script decides.
Escalate as autonomy rises, from a prompt, to a check the agent runs before you walk away, to a hook, to a verification subagent.
Read a permission block as evidence of a wrong step earlier, not as an obstacle to route around.
Anchor: `bash tests/hooks/run.sh` drives real payloads through the real hook wiring, with a denied case, an allowed case, and a planted internal failure.
Receipts: `docs/handbook/claude-code.md#make-a-must-hold-rule-a-hook-fail-it-closed-and-test-it-with-real-payloads`

## Run adversarial review in a fresh subagent with a named lens

Review finished work in a fresh subagent whose lens is named, and tell it to flag only correctness and requirement gaps, because a reviewer asked for problems will always return some.
Delegate file-heavy investigation the same way, so only the summary reaches the main context; a verify phase that errors returns UNVERIFIED, and the full rule on that lives in engineering.md.
Let the reviewer apply mechanical fixes in its own commit, and land judgment-level changes as proposals.
After an interrupt, work inline, and recover a killed fan-out's finished results from its transcripts rather than re-running it.
Anchor: none (because a lens is prose, not a flag; the review report is the only artifact).
Receipts: `docs/handbook/claude-code.md#run-adversarial-review-in-a-fresh-subagent-with-a-named-lens`

## Plan when the approach is uncertain, and clear the context after two failed corrections

Plan first when the approach is uncertain or the change spans files, and skip planning when you could describe the diff in one sentence, because planning has real overhead.
Clear the context after two failed corrections on the same issue, because a context full of failed approaches loses to a clean session with a better prompt.
Re-read the source of a ruling immediately before you act on it rather than once at session start, because a ruling can land mid-session.
Anchor: none (because the harness cannot see that a correction failed; the second failed attempt is the signal).
Receipts: `docs/handbook/claude-code.md#plan-when-the-approach-is-uncertain-and-clear-the-context-after-two-failed-corrections`

## Treat git state as shared across sessions

Assume another checkout can move your branch mid-run and strand uncommitted work, so ask before switching, prefer a worktree, and commit early.
Read the current branch immediately before every commit and every push instead of trusting what it was at session start.
Squash-merge another session's branch rather than rebasing it, and never force-clean a checkout you do not own.
Anchor: the pre-tool branch guard at `plugins/house/hooks/no-direct-master.sh`, which re-reads the branch on every git command it sees.
Receipts: `docs/handbook/claude-code.md#treat-git-state-as-shared-across-sessions`

## Keep the committed settings narrow and the local settings local

Commit an allowlist covering the repo's own script surface and read-side platform commands and nothing broader, and authorize deploy and egress verbs through a skill instead.
Allow-list network fetches per domain rather than blanket, pin which servers and services the project enables rather than inheriting whatever is installed, and forward-declare a script you are about to add so its first run needs no prompt.
Keep the wide accreted list in `settings.local.json`, gitignored and free of machine paths.
Prune it on a cadence, because one broad grant supersedes every careful narrow one and a stale entry outlives the rename that orphaned it.
Anchor: `plugins/house/templates/settings.json` ships the narrow committed allowlist with no hooks block, and `/house-rules:sync` refuses a managed file that was edited locally.
Receipts: `docs/handbook/claude-code.md#keep-the-committed-settings-narrow-and-the-local-settings-local`

## Read a resume file as a harness artifact, not a handoff

Treat a checkpoint file the harness writes as a record of where a session stopped, not as a protocol the next session follows.
It carries a session id, a snapshot ref, and a resume command; it does not carry state anyone can diff, and it is stale the moment the tree moves.
Anchor: the `/house-rules:handoff` skill, which produces the handoff artifact so a checkpoint file is never mistaken for one.
Receipts: `docs/handbook/claude-code.md#read-a-resume-file-as-a-harness-artifact-not-a-handoff`

## Hand off through a carryover issue

Write the handoff as an issue that supersedes the last one, so the next session starts from state it can diff rather than prose it must trust.
Open with a staleness disclaimer telling the reader to verify before relying on anything, then give the commit and tree state, what shipped, the headline finding with its evidence, an ordered next-cycle list, and what was deferred by decision. Gate verdicts and counts are re-run from the recorded commit, never copied into the issue, because a copied number is stale the moment the tree moves and a re-run one cannot be fabricated.
Close the superseded issue when the new one opens, so exactly one carryover is open at a time and the chain stays walkable through its supersession pointers.
Keep deferred-by-decision separate from forgotten, because that is the one line the next session cannot reconstruct on its own.
Anchor: the `/house-rules:handoff` skill, whose required sections are that shape.
Receipts: `docs/handbook/claude-code.md#hand-off-through-a-carryover-issue`

## Check for a peer session before driving shared external state

List the running agents before driving a shared application, a shared database, or a shared checkout, because a peer session may already own it.
Never ship from a main checkout another session occupies; deploy from the merged worktree instead.
Anchor: the guard chain in `scripts/house/deploy-guards.mjs`, whose main-at-origin check aborts when the main checkout is not where the deploy assumed.
Receipts: `docs/handbook/claude-code.md#check-for-a-peer-session-before-driving-shared-external-state`

## Don't

Don't put a fact in the root file that Claude could derive from the code.
Don't put a fact in the memory index that belongs in its topic file.
Don't ship a rule file without `paths:`, because an unscoped file is always-on at root-file priority.
Don't let a multi-step procedure live in a rule file.
Don't chain a reference to another reference, because a nested file gets partially read.
Don't leave model invocation enabled on a skill that writes, deploys, or spends.
Don't let an agent call inherit the session's model by omitting the tier.
Don't scope a hook with a matcher filter; match broadly and decide in the script.
Don't route around a permission block, because it is evidence of a wrong step earlier.
Don't keep correcting the same failure past the second attempt in one context.
Don't trust the branch you read at session start.
Don't rebase another session's branch, and don't force-clean a checkout you do not own.
Don't commit a wide allowlist, and don't let the local one accrete unpruned.
Don't read a checkpoint file as a handoff.
Don't drive shared external state before checking for a peer session.
Anchor: each prohibition above is the negative of a rule in this file; that rule names the enforcement.
