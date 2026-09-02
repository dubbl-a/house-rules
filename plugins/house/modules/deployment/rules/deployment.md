<!-- house source rule file; vendored into consuming repos by /house-rules:sync -->
# Deployment

Merging and deploying are two different acts. These rules cover the order, the guards that run before a build, and the checks that prove a deploy actually landed.

## Deploy manually after the merge, because a merge is not a production update

Merging moves code onto the default branch and does nothing else, so never report a change as live until the deploy command has finished.
State in the repo whether a merge deploys, and name every surface where merged is not yet live: the site, a vendor-hosted email template, a generated asset, each with the one command that makes it live.
A data refresh that merges cleanly and gets announced as shipped stays invisible to every reader until someone runs the deploy.
Anchor: none (because nothing can observe that a merge was meant to ship; the named deploy script is the only path to production and the docs must say so out loud).
Receipts: `docs/handbook/deployment.md#deploy-manually-after-the-merge-because-a-merge-is-not-a-production-update`

## Chain the deploy guards before building anything, and give them one named escape hatch

Run every guard before the build starts, so a refusal costs seconds instead of a whole build: checkout clean and level with the remote, target account pinned, CI green on the tip, and the tip commit belonging to a merged pull request.
Unchecked is not passing, so an empty list of check runs fails closed rather than reading as success.
Ask what else has written to the shared state the build reads, because a deploy publishes the state that store is in right now, not the state the merged pull requests imply.
Give the chain exactly one escape hatch, set through a named environment variable and described at every call site as rare and deliberate.
Anchor: `scripts/house/deploy-guards.mjs`, called as the deploy script's first step; the one escape is the `DEPLOY_FROM=any` environment variable.
Receipts: `docs/handbook/deployment.md#chain-the-deploy-guards-before-building-anything-and-give-them-one-named-escape-hatch`

## Migrate before deploying the code that reads the schema

Land the schema change first, because code deployed ahead of its migration reads tables and columns that do not exist yet, and it fails in front of users instead of in front of you.
Write the test for the app-only fast path rather than leaving it to judgment: no migration files in the diff, no pipeline or scoring change, and when any doubt remains take the full ordered ship.
In a scheduled run, apply migrations before the lanes that read them, and let independent lanes still run when an earlier unrelated lane fails.
Anchor: the ordered ship script (`npm run ship`), which runs the migration step before the deploy step and exits at the first failure by name.
Receipts: `docs/handbook/deployment.md#migrate-before-deploying-the-code-that-reads-the-schema`

## Invoke a deploy only through its named script

Put the whole sequence in one script so the order cannot drift and a step cannot be forgotten, print each step as it runs, and exit at the first failure naming the step.
Never call the platform CLI by hand: it walks up the directory tree looking for config, so a stray file at the repo root can shadow the real one and ship an ungated service.
Put the generators that produce what the build reads inside that script, because the build ships whatever the table already holds, not what the newest source data says.
Name that script as the canonical runbook and have other procedures point at it instead of inventing their own step list.
Anchor: the committed Claude Code settings allowlist, which names `npm run deploy` and never the raw platform CLI.
Receipts: `docs/handbook/deployment.md#invoke-a-deploy-only-through-its-named-script`

## Verify the deployed URL against the built file with the cache bypassed

Grep the value out of the built file and out of a cache-busted fetch of the live page and require the two to agree, because one live fetch cannot separate built wrong from built but not deployed from built, deployed, and read stale.
A query-string buster is not always enough, so when pages disagree with each other, fetch the origin that has no cache in front of it.
Where a platform setting can override a file the repo ships, read the served file first, since the committed one looks correct either way.
Enumerate the success markers a run must print and require the pre-flight grep to come back empty, so that it worked is checkable rather than asserted.
Anchor: none (because the URLs worth smoke-testing change with each release; write the fetch and diff commands inline in the runbook and list the markers the run must print).
Receipts: `docs/handbook/deployment.md#verify-the-deployed-url-against-the-built-file-with-the-cache-bypassed`

## Repoint and deploy the consumer before dropping the producer's column

Repoint the consumer at the new source, deploy that consumer, and only then drop the old column, because a change merged in the consumer but not yet shipped is not done, it is a landmine for the next publish.
Keep the old path readable for a window after the cutover, which turns an irreversible drop into something you can back out of.
Separate what a consumer reads today, which is frozen, from additive slack you may still change freely, and write that split down where the producer's owner will read it.
Anchor: none (because only the consumer knows what it reads; keep a contract file listing every published column and require a drop migration to cite it).
Receipts: `docs/handbook/deployment.md#repoint-and-deploy-the-consumer-before-dropping-the-producers-column`

## Restore a backup before calling it a backup

A backup nobody has restored is a hypothesis, so document the restore procedure and run it on a stated cadence, not for the first time during an incident.
Encrypt the backup at rest and prune by count on the client, so a stretch offline expires nothing and a leaked bucket yields nothing readable.
Anchor: `restore-test.sh`, run at setup and on the cadence the backup doc states, which records the last passing restore.
Receipts: `docs/handbook/deployment.md#restore-a-backup-before-calling-it-a-backup`

## Don't

Anchor: `scripts/house/deploy-guards.mjs`, the ordered ship script, and the settings allowlist, which are what refuse these in practice.

Don't report a change as live because its pull request merged.
Don't build before the guards have run; a refusal after the build is a build you paid for and threw away.
Don't read an empty list of CI check runs as a pass.
Don't deploy without asking what else has written to the shared state the build reads.
Don't add a second escape hatch; the one named environment variable is the whole exemption surface.
Don't deploy code ahead of the migration it depends on, and don't take the app-only fast path without running its written test.
Don't call the platform CLI directly, from the repo root or anywhere else.
Don't trust a single live fetch, and don't trust a query-string buster on its own.
Don't trust the committed file when a platform setting can override it at the edge.
Don't drop a producer's column while any consumer still reads it in production.
Don't hardcode a staging or preview URL in a canonical tag or a meta tag; the full rule on reading config from the environment lives in engineering.md.
Don't count a backup stream that has never been restored.
Don't use time-based retention that can delete your last backup while you are offline.
