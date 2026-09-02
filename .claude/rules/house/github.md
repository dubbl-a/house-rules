---
paths:
  - .github/**
  - .githooks/**
  - .env.example
---
<!-- house-managed v0.5.0 module=github source=modules/github/rules/github.md body-sha256=a30f20c56d3b1b851f7cccc7bfb1a380e0ee5e737b3335b97d2a51b708cd7a17 DO NOT EDIT: propose upstream (see docs in dubbl-a/house-rules), record a deviation, or house render --force-managed <path> -->
<!-- house source rule file; vendored into consuming repos by /house-rules:sync -->

# GitHub, CI, and credentials

How work reaches the default branch, what CI is allowed to know, and where credentials are not.
Each rule names the thing that enforces it, or says plainly that nothing does.

## Gate every PR on checks that need no credential, and name what is not gated

Gate on file-only checks, so the gate runs with no database, no network, and no secret to leak. Push everything stateful to a pipeline retro or a local pre-deploy step.
Name what is deliberately not gated, and why, inside the workflow that does the gating, because an unstated gap reads as coverage.
Run the same set from one local command before opening the PR, and fail loudly on a missing secret before any lane starts.
Anchor: the rendered `.github/workflows/pr-checks.yml`, whose wall-time target and concurrency policy ship with the pr-checks.yml template; `npm run check:house` runs the same set locally. A hosted agent review posts a neutral check that never blocks a merge, so it is one of the gaps to name rather than a gate to lean on.
Receipts: `docs/handbook/github.md#gate-every-pr-on-checks-that-need-no-credential-and-name-what-is-not-gated`

## Give a workflow read-only permissions and pin every action by SHA

Declare read-only `permissions:` on every workflow and grant write per job, because anyone with write access to the repo can read every secret configured for it. Write the reason for the permission set beside the block.
Pin every third-party action to a full-length commit SHA, the only immutable reference a tag cannot fake.
Never interpolate event data straight into a `run:` block; route it through an intermediate variable, and never check out untrusted code in a privileged trigger.
Anchor: the rendered `.github/workflows/pr-checks.yml` ships the read-only default and the SHA pins; copy it when you add a workflow.
Receipts: `docs/handbook/github.md#give-a-workflow-read-only-permissions-and-pin-every-action-by-sha`

## Budget Actions minutes as account-wide money

Treat CI minutes as one pool shared by every repo on the account, billed per job with a per-job minimum, so the number of runs costs as much as their duration.
Pause an expensive cron by hand, then ship a one-shot job to re-enable it, because a token cannot re-enable another repo's workflow.
Read the check-run annotation when a run dies at startup, because a billing failure carries no logs and looks nothing like a code failure.
Anchor: `node .house/check.mjs --only=minutes` estimates scheduled runs against `actionsBudgetMinutes`; the platform's own spending budget is the hard stop. An agent workflow caps nothing on its own, and its runner minutes draw on the same account pool as every other job.
Receipts: `docs/handbook/github.md#budget-actions-minutes-as-account-wide-money`

## Open an issue instead of failing a scheduled run, and comment out a cron with its reason

Have a scheduled audit open or update an issue rather than turn the run red, because a recurring red X trains you to ignore the run.
Keep a read-only data-quality report non-failing on purpose, and say so in a comment, so a data finding never reads as a broken build.
Comment a cron out with its reason instead of deleting it, so restoring the cadence is two lines. Verify a stale issue's premise against current code and live data before planning against it.
Anchor: none (because a failure policy is a per-workflow editorial choice that no checker can read).
Receipts: `docs/handbook/github.md#open-an-issue-instead-of-failing-a-scheduled-run-and-comment-out-a-cron-with-its-reason`

## Turn on push protection, head-branch deletion, and grouped dependency updates

Turn on secret scanning push protection, which blocks a credential before it is in history rather than after.
Turn on automatic deletion of head branches so a merged branch stops accumulating.
Configure grouped dependency updates and leave security updates on, because grouping cuts PR volume without muting the updates that matter.
Anchor: the rendered `.github/dependabot.yml` carries the grouping; the other two are repository settings, so confirm them in settings at adoption.
Receipts: `docs/handbook/github.md#turn-on-push-protection-head-branch-deletion-and-grouped-dependency-updates`

## Make the PR template force a docs-check answer

Ask every PR for a summary, a test plan, and a docs check.
Make the docs check binary: either the docs edit is in this PR, or the PR says why none is needed.
Keep the template in the platform's own directory, which is the first place it is looked for.
Anchor: the rendered `.github/PULL_REQUEST_TEMPLATE.md`. A hosted review flags stale docs only as a non-blocking nit on newly introduced drift, and only where it runs, so the template is what makes the answer mandatory.
Receipts: `docs/handbook/github.md#make-the-pr-template-force-a-docs-check-answer`

## Never put a closing keyword beside an issue number you do not mean to close

A closing keyword closes the issue at merge whatever words sit in front of it, because the negation is never parsed.
Write "does not address" with no keyword when the issue should stay open.
Check the issue's state after merging any PR that mentions an issue you meant to keep.
Anchor: none (because the platform parses the body at merge time and no pre-merge check reads it).
Receipts: `docs/handbook/github.md#never-put-a-closing-keyword-beside-an-issue-number-you-do-not-mean-to-close`

## Ship phased work as commits on one PR

Ship a multi-phase change as commits on one PR when there is one reviewer, because a PR per step buys review nobody is performing.
After merging a stack's parent, confirm each child re-targeted its base, and fix forward from the leaf when a merge landed on a feature branch instead.
Anchor: none (because PR granularity is a judgment call, and the base-retarget confirmation is a look at the open PR list).
Receipts: `docs/handbook/github.md#ship-phased-work-as-commits-on-one-pr`

## Stage explicit paths, never everything at once

Stage by path, because staging everything sweeps in untracked local-only files that were never meant to leave the machine.
Anchor: the `pre-commit` template refuses a staged secret, which is the backstop for a wide add and not a licence to make one. A permission rule broad enough to allow staging allows the sweep-everything form too, so the approval prompt is no filter on what one add pulls in.
Receipts: `docs/handbook/github.md#stage-explicit-paths-never-everything-at-once`

## Classify a merged branch by its PR state, not by merge detection

Ask the platform whether the branch's PR merged, because merge-detection flags lie under squash merging and a refusal to delete is not evidence that deleting is unsafe.
Cross-check a branch's unique commits by their squash-title references on the protected branch.
Read a closed-but-unmerged PR's closing comment before calling the branch dead or salvageable. When a merge looks like it failed locally, verify the PR state before retrying, because it may already have landed remotely.
Anchor: `scripts/house/cleanup-worktree.sh`, which classifies from PR state through the platform CLI before it deletes anything. The harness's own worktree sweep reads local state only and never asks the platform, so it can neither confirm nor refute a squash merge.
Receipts: `docs/handbook/github.md#classify-a-merged-branch-by-its-pr-state-not-by-merge-detection`

## Never delete the branch from the worktree being merged

Do not pass a delete-branch flag from the checkout that has the branch open, because the branch is pinned there and the flag fails noisily.
Remove the worktree first, then the local branch, then the remote branch through the API.
Anchor: `scripts/house/cleanup-worktree.sh`, run from the main checkout after the PR merges. The harness clears a clean worktree and its branch only as the session exits, so a deletion ordered before that is still yours to sequence.
Receipts: `docs/handbook/github.md#never-delete-the-branch-from-the-worktree-being-merged`

## Keep credentials out of the repo, the commit, and the chat

Keep env files, account ids, and API keys out of the repo, and set every secret through the platform's secret command rather than a config file.
Load a vendor key from an env-file flag at run time, never from a committed file.
Run a credentialed diagnostic as a workflow so the token stays with the runner and never enters an agent session.
Anchor: push protection at the remote, backstopped by the `pre-commit` template's staged-secret refusal; the remote is the guard, the hook is the backstop. Credential files stay readable to a session, and a subprocess inherits the session environment, unless a credential setting or deny-read rule says otherwise, so nothing local keeps a key out of the chat for you.
Receipts: `docs/handbook/github.md#keep-credentials-out-of-the-repo-the-commit-and-the-chat`

## Scan the built output after scrubbing the build, and plant a canary to prove the scanner fires

Scrub the build environment and hide the secrets file from disk during the build, because an adapter can read that file directly and walk around the environment.
Scan the built output anyway, and fail the build on an embedded credential or embedded personal data.
Write obviously fake credentials before the build in CI and scan after it, so a scrub regression fails the PR instead of shipping. A scanner that has never fired is not evidence of a clean build.
Anchor: `scripts/house/scan-dist-secrets.mjs --self-test` as a CI step after the build, with the canary written before it and removed after. A build run from a session inherits that session's environment unless it is scrubbed, so the same scrub before scan applies off CI.
Receipts: `docs/handbook/github.md#scan-the-built-output-after-scrubbing-the-build-and-plant-a-canary-to-prove-the-scanner-fires`

## Give a restricted key exactly one writable scope

Give a key one writable scope and read-only access everywhere else, so a leak has a blast radius you can state in one sentence.
Read the scopes off the vendor dashboard on the day you issue the key, and cross-check them with a live probe of every resource, because the dashboard label and the key's real reach can disagree.
Anchor: a probe test that calls every resource the key can reach and asserts each write outside the one scope fails.
Receipts: `docs/handbook/github.md#give-a-restricted-key-exactly-one-writable-scope`

## Never log a vendor object

Log ids, amounts, and outcomes, never a customer, charge, or row object, because observability is how personal data leaves a database sideways.
Keep the same data out of error messages and URLs.
Anchor: a unit test asserting the logger receives named scalar fields and never a vendor object.
Receipts: `docs/handbook/github.md#never-log-a-vendor-object`

## Treat a preview URL as production for exposure

A preview URL outside the auth policy leaks exactly what production would leak.
Cover every route with the policy and allow no bypasses; adding one is a decision to write down, not a route to add.
Verify by hand with an unauthenticated request to each route after any change to auth or routing.
Anchor: the deploy script's post-deploy step that sends an unauthenticated request to every route on the production and preview hosts.
Receipts: `docs/handbook/github.md#treat-a-preview-url-as-production-for-exposure`

## Label a non-secret as a non-secret

Say beside a deliberately public value that it is public and why, so nobody redacts it by reflex or reads the redaction as proof it was sensitive.
Anchor: `.env.example`, where each public value carries the reason it is safe to commit.
Receipts: `docs/handbook/github.md#label-a-non-secret-as-a-non-secret`

## Don't

Don't gate a PR on a check that needs a live credential.
Don't leave a gap in the gate unnamed, and don't leave a workflow on default write permissions.
Don't pin an action to a tag, and don't interpolate event data straight into a `run:` block.
Don't check out untrusted code in a privileged workflow trigger.
Don't delete a cron you are only pausing, and don't turn a scheduled audit red over something that is not a broken build.
Don't write a closing keyword next to an issue number you mean to leave open.
Don't open a PR per phase when one reviewer is reviewing the whole thing.
Don't stage everything at once.
Don't trust a merge-detection flag under squash merging.
Don't pass a delete-branch flag from the worktree holding the branch.
Don't commit an env file, an account id, or an API key, and don't paste one into a session.
Don't trust a secret scrub you have never watched fail.
Don't give one key write access to a second scope.
Don't log a vendor object, in a log line, an error message, or a URL.
Don't leave a preview URL outside the auth policy.
Don't redact a value that is deliberately public.
Anchor: each prohibition above is the negative of a rule in this file; that rule names the enforcement.
