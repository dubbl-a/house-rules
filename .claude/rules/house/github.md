---
paths:
  - .github/**
  - .githooks/**
  - .env.example
---
<!-- house-managed v0.17.0 module=github source=modules/github/rules/github.md body-sha256=70bc2a82ceb0d04bc2075b1dc244314a5ca7bfcbecc04949ed8d52bb368df07e DO NOT EDIT: propose upstream (see docs in dubbl-a/house-rules), record a deviation, or house render --force-managed <path> -->
<!-- house source rule file; vendored into consuming repos by /house-rules:sync -->

# GitHub, CI, and credentials

How work reaches the default branch, what CI may know, and where credentials are not.
Each rule names what enforces it, or says plainly that nothing does.

## Gate every PR on checks that need no credential, and name what is not gated

Gate on file-only checks, so the gate runs with no database, network, or secret to leak. Push stateful checks to a retro or a local pre-deploy step.
Name what is deliberately not gated, and why, inside the workflow that gates: an unstated gap reads as coverage.
Run the same set locally before opening the PR, and fail loudly on a missing secret before any lane starts.
Anchor: the rendered `.github/workflows/pr-checks.yml`, wall-time target and concurrency shipped with the template; `npm run check:house` runs it locally. A hosted agent review posts a neutral, non-blocking check: name it a gap, not a gate.
Receipts: `docs/handbook/github.md#gate-every-pr-on-checks-that-need-no-credential-and-name-what-is-not-gated`

## Give a workflow read-only permissions and pin every action by SHA

Declare read-only `permissions:` on every workflow and grant write per job, since repo write access can read every configured secret. Write the reason beside the block.
Pin every third-party action to a full-length commit SHA, the only reference a tag cannot fake.
Never interpolate event data into a `run:` block or an agent's prompt input; route it through a variable, and never check out untrusted code, or expose a secret to it, in a privileged trigger.
Anchor: the rendered `.github/workflows/pr-checks.yml` ships the read-only default and SHA pins; copy it for a new workflow. A workflow the agent platform's setup installs counts too: same permissions, same pins.
Receipts: `docs/handbook/github.md#give-a-workflow-read-only-permissions-and-pin-every-action-by-sha`

## Budget Actions minutes as account-wide money

Treat CI minutes as one pool shared by every repo on the account, billed per job with a per-job minimum, so run count costs like duration.
Pause an expensive cron by hand, then ship a one-shot job to re-enable it, since a token cannot re-enable another repo's workflow.
Read the check-run annotation when a run dies at startup: a billing failure carries no logs and looks nothing like code failure.
Set the slot to null on a public repo, since its minutes are unmetered, and let the check say so instead of estimating against a stale budget.
Anchor: `node .house/check.mjs --only=minutes` estimates scheduled runs against `actionsBudgetMinutes`; the platform's spending budget is the hard stop. An agent workflow caps nothing; its minutes draw from the same pool.
Receipts: `docs/handbook/github.md#budget-actions-minutes-as-account-wide-money`

## Open an issue instead of failing a scheduled run, and comment out a cron with its reason

Have a scheduled audit open or update an issue rather than turn the run red, since a recurring red X trains you to ignore it.
Keep a read-only data-quality report non-failing on purpose, and say so in a comment, so a finding never reads as a broken build.
Comment a cron out with its reason instead of deleting it, so restoring the cadence is two lines. Verify a stale issue's premise against current code and live data first.
Anchor: none (because a failure policy is a per-workflow editorial choice no checker can read). A scheduled agent run writes only to its run log unless its prompt directs it to post and its allowed tools include the issue command, so grant those before counting on the issue.
Receipts: `docs/handbook/github.md#open-an-issue-instead-of-failing-a-scheduled-run-and-comment-out-a-cron-with-its-reason`

## Turn on push protection, head-branch deletion, and grouped dependency updates

Turn on secret scanning push protection, blocking a credential before it enters history.
Turn on automatic head-branch deletion so a merged branch stops accumulating.
Configure grouped dependency updates and leave security updates on, since grouping cuts PR volume without muting updates that matter.
Anchor: the rendered `.github/dependabot.yml` carries the grouping; the other two are repository settings, confirmed at adoption.
Receipts: `docs/handbook/github.md#turn-on-push-protection-head-branch-deletion-and-grouped-dependency-updates`

## Protect the default branch at the remote, and name an owner for what runs with privilege

Require a pull request and passing required checks before the default branch moves, since the local hook floor binds only a machine that armed it.
Once the repo has a second maintainer, require a review from someone other than the author and name code owners for workflow, release, and agent config files, so a change to what runs with privilege reaches a named reviewer; a solo repo has nobody to route to, and its required checks are the gate.
Turn on multi-factor sign-in for every account with write access, enforced by the organization where there is one, and give each collaborator the least role that works.
Anchor: where there is a second maintainer, a code-owners file covering the workflow directory is the part a repo file carries; the branch rule and the required checks are repository settings and the sign-in requirement an organization or account one, each confirmed at adoption like push protection.
Receipts: `docs/handbook/github.md#protect-the-default-branch-at-the-remote-and-name-an-owner-for-what-runs-with-privilege`

## Make the PR template force a docs-check answer

Ask every PR for a summary, a test plan, and a docs check.
Make the docs check binary: either the docs edit is in this PR, or the PR says why none is needed.
Keep the template in the platform's own directory, the first place it is looked for.
Anchor: the rendered `.github/PULL_REQUEST_TEMPLATE.md`. A hosted review flags stale docs only as a non-blocking nit where it runs, so the template makes the answer mandatory.
Receipts: `docs/handbook/github.md#make-the-pr-template-force-a-docs-check-answer`

## Never put a closing keyword beside an issue number you do not mean to close

A closing keyword closes the issue at merge whatever words sit in front of it, since the negation is never parsed.
Write "does not address" with no keyword when the issue should stay open.
Check the issue's state after merging any PR that mentions one you meant to keep.
Anchor: none (because the platform parses the body at merge time and no pre-merge check reads it).
Receipts: `docs/handbook/github.md#never-put-a-closing-keyword-beside-an-issue-number-you-do-not-mean-to-close`

## Ship phased work as commits on one PR

Ship a multi-phase change as commits on one PR with one reviewer, since a PR per step buys review nobody performs.
After merging a stack's parent, confirm each child re-targeted its base, and fix forward from the leaf if a merge landed on a feature branch instead.
Anchor: none (because PR granularity is a judgment call; base-retarget confirmation is a look at the open PR list). A fan-out command such as /batch or a background session works each unit in its own worktree, so say which shape phased work takes before launching one.
Receipts: `docs/handbook/github.md#ship-phased-work-as-commits-on-one-pr`

## Stage explicit paths, never everything at once

Stage by path, since staging everything sweeps in untracked local-only files never meant to leave the machine.
Anchor: the `pre-commit` template refuses a staged secret, and auto mode's classifier blocks a secret-bearing commit by default; both backstop a wide add without licensing one, and neither catches a local-only file that holds no secret. A staging-broad permission rule allows sweep-everything too, so the prompt filters nothing.
Receipts: `docs/handbook/github.md#stage-explicit-paths-never-everything-at-once`

## Classify a merged branch by its PR state, not by merge detection

Ask the platform whether the branch's PR merged: merge-detection flags lie under squash merging, and refusal to delete isn't evidence deleting is unsafe.
Cross-check a branch's unique commits by squash-title references on the protected branch.
Read a closed-but-unmerged PR's closing comment before calling the branch dead or salvageable. When a merge looks failed locally, verify the PR state before retrying, since it may have landed.
Expect the harness's auto-mode classifier to refuse an agent-side remote-branch delete, a bulk one above all; hand the user the exact command instead of retrying it another way, and treat automatic head-branch deletion (the settings rule above) as what stops merged branches accumulating in the first place.
Anchor: `scripts/house/cleanup-worktree.sh` classifies from PR state through the platform CLI before deleting anything, prints the manual command when the remote delete fails, and reports when head-branch deletion is off. The harness's worktree sweep reads only local state, so it can't confirm or refute a squash merge.
Receipts: `docs/handbook/github.md#classify-a-merged-branch-by-its-pr-state-not-by-merge-detection`

## Never delete the branch from the worktree being merged

Don't pass a delete-branch flag from the checkout with the branch open, since it's pinned there and the flag fails noisily.
Remove the worktree first, then the local branch, then the remote through the API.
Anchor: `scripts/house/cleanup-worktree.sh`, run from the main checkout after the PR merges. The harness clears a clean worktree and branch only at session exit, so an earlier deletion is yours to sequence.
Receipts: `docs/handbook/github.md#never-delete-the-branch-from-the-worktree-being-merged`

## Keep credentials out of the repo, the commit, and the chat

Keep env files, account ids, and API keys out of the repo, and set every secret through the platform's secret command, not a config file.
Load a vendor key from an env-file flag at run time, never a committed file.
Run a credentialed diagnostic as a workflow so the token stays with the runner and never enters an agent session.
Anchor: push protection at the remote, backstopped by the `pre-commit` template's staged-secret refusal; remote is the guard, hook the backstop. By default credential files stay readable to a session and a subprocess inherits its environment; a Read deny rule, the sandbox's credential deny or mask, and the subprocess scrub variable narrow that, but none is on until configured.
Receipts: `docs/handbook/github.md#keep-credentials-out-of-the-repo-the-commit-and-the-chat`

## Scan the built output after scrubbing the build, and plant a canary to prove the scanner fires

Scrub the build environment and hide the secrets file from disk during the build, since an adapter can read that file directly and bypass it.
Scan the built output anyway, and fail the build on an embedded credential or personal data.
Write obviously fake credentials before the CI build and scan after, so a scrub regression fails the PR instead of shipping. An unfired scanner is not evidence of a clean build.
Anchor: `scripts/house/scan-dist-secrets.mjs --self-test` as a CI step after the build, canary written before and removed after. A session-run build inherits that environment unless scrubbed, so the same applies off CI.
Receipts: `docs/handbook/github.md#scan-the-built-output-after-scrubbing-the-build-and-plant-a-canary-to-prove-the-scanner-fires`

## Give a restricted key exactly one writable scope

Give a key one writable scope and read-only access elsewhere, so a leak has a blast radius statable in one sentence.
Read the scopes off the vendor dashboard the day you issue the key, and cross-check with a live probe of every resource, since the dashboard label and real reach can disagree.
Anchor: a probe test that calls every resource the key can reach and asserts each write outside the one scope fails.
Receipts: `docs/handbook/github.md#give-a-restricted-key-exactly-one-writable-scope`

## Never log a vendor object

Log ids, amounts, and outcomes, never a customer, charge, or row object, since observability is how personal data leaves a database sideways.
Keep the same data out of errors and URLs.
Anchor: a unit test asserting the logger receives named scalar fields and never a vendor object.
Receipts: `docs/handbook/github.md#never-log-a-vendor-object`

## Treat a preview URL as production for exposure

A preview URL outside the auth policy leaks what production would.
Cover every route with the policy and allow no bypasses; adding one is a decision to write down, not a route to add.
Verify by hand with an unauthenticated request to each route after any auth or routing change.
Anchor: the deploy script's post-deploy step, sending an unauthenticated request to every route on production and preview hosts.
Receipts: `docs/handbook/github.md#treat-a-preview-url-as-production-for-exposure`

## Label a non-secret as a non-secret

Say beside a deliberately public value that it is public and why, so nobody redacts it by reflex or reads the redaction as proof of sensitivity.
Anchor: `.env.example`, where each public value carries the reason it is safe to commit.
Receipts: `docs/handbook/github.md#label-a-non-secret-as-a-non-secret`

## Ship the community files the platform looks for, and keep issue intake as forms

Ship a code of conduct, a security policy naming a private reporting route and a response time, and a contributing guide: the platform's community-profile check reads a missing one as a gap, and a newcomer reads neglect.
Take issue intake through YAML forms with blank issues disabled, so a report starts structured, not free-text.
The pull-request template already has its own rule above; point here rather than repeating it.
Anchor: confirm the community-profile endpoint at adoption, like confirming push protection; a checker family here is a later cycle if it earns one.
Receipts: `docs/handbook/github.md#ship-the-community-files-the-platform-looks-for-and-keep-issue-intake-as-forms`

## Enforce the branch policy where git resolves the ref, and let the text scan catch only the ways to disable it

Enforce a protected-branch policy inside `.githooks/pre-commit` and `.githooks/pre-push`, where git has already resolved the real repository, HEAD, and ref, not by reading a command's text.
Arm the floor with `core.hooksPath`, set by `house render --apply` and every session start: a hook `.git/config` never points at never runs.
Read the policy from `HEAD:house.json`, never the working tree, so a flipped `branchPolicy` counts only once landed.
Keep the PreToolUse hook's job to verifying the floor is intact (every vendored hook byte-identical to the plugin's copy, `core.hooksPath` pointing at it) and refusing its short disable/bypass list (`--no-verify`, `core.hooksPath` or `include.path` in any form, `GIT_CONFIG_*`, `git replace`, `send-pack`, a `GIT_DIR`-named repo), never inferring a branch or tree from text, since the harness documents text-matched rules as no boundary, lets auto mode push to the default branch by default, and loads no project hooks in a bare or safe-mode session while git still runs its own.
Read `house doctor` for whether the floor is armed here, since `core.hooksPath` is machine-local state a repo-only checker cannot see.
Anchor: `.githooks/pre-commit` and `.githooks/pre-push` (vendored here, kept executable by render and arming) are the floor; `core.hooksPath` arms it, set by `house render --apply` and a `SessionStart` hook, reported by `house doctor`. `plugins/house/hooks/no-direct-master.sh` treats a tampered or unarmed floor as unarmed and refuses any unreadable git verb.
Receipts: `docs/handbook/github.md#enforce-the-branch-policy-where-git-resolves-the-ref-and-let-the-text-scan-catch-only-the-ways-to-disable-it`

## Don't

Don't leave a gate gap unnamed, or a workflow on default write permissions.
Don't pass a delete-branch flag from the worktree holding the branch.
Don't ship without a code of conduct, a security policy, or a contributing guide, or leave blank issues enabled.
Anchor: each prohibition above is the negative of a rule in this file; that rule names the enforcement.
