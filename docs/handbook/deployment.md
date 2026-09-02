# Deployment

## Why this exists

Every rule below guards one failure class: work that looks finished, a pull request merged, a build that exited 0, a nightly job that ran, but is not actually live, correctly ordered, or recoverable, and nothing observes the gap until a reader hits it or an incident forces a restore. A merge is a git operation; a deploy is a separate, deliberate act. A green build proves the code compiles, not that the guards it depends on ran first, that the schema it reads already exists, or that the URL it shipped to actually changed. A backup stream nobody has restored is a belief, not a backup.

## Deploy manually after the merge, because a merge is not a production update

repo-a's deployment rule states the boundary plainly: "Deploys are manual." "PR merge ≠ production update." (TW-146, `.claude/rules/deployment.md`). There is no Actions workflow and no git-integration push to production; the only path from a merged PR to a live site is `npm run build && wrangler deploy`, run by hand from the master checkout. The rule is enforced by convention plus the pre-flight guard chain described in the next section, not by any tooling that fires automatically on merge.

The rule generalizes as: state whether a merge deploys, and name every surface where merged is not yet live. repo-a's own second surface makes the point (MEM-078, `project_resend_template_deploy_manual.md`): the welcome and city-request Resend email templates live in code, but only take effect after a separate `restore-resend-template.ts --apply` run distinct from the site deploy. A merged PR that edits template copy leaves the old copy live until that command runs. So the rule is not "run the deploy script," it is "name every surface (the site, a vendor-hosted template, a generated asset) and the one command that makes each of them live."

## Chain the deploy guards before building anything, and give them one named escape hatch

repo-b's `deployment.md` chains four guards ahead of every build (AG-039, anchored to `scripts/lib/deploy-guards.mjs`): the checkout is clean and level with `origin`, the target Cloudflare account is pinned, CI is green on the tip commit with an empty list of check runs treated as fail-closed ("unchecked isn't passing"), and the tip commit belongs to a merged pull request. The guards run before `npm run build` starts, specifically "so a refusal never wastes a build" (AG-040): the build is the expensive step, and a refusal that only fires after it has already run is a build paid for and thrown away.

repo-a pre-flights its own build the same way, with `assertMasterAtOrigin('deploy.mjs', { allowUntracked: true })`, tolerating untracked files on the reasoning that the build only ships committed source (TW-148). Both repos give the chain exactly one escape hatch, the `DEPLOY_FROM=any` environment variable, documented at every call site as rare and deliberate rather than a routine override.

The chain checks the repo's own git state, not what else has written to the shared infrastructure the build reads. repo-a's laptop Postgres is shared across every worktree; a deploy publishes whatever the database holds at that moment, not the state the merged pull requests imply (MEM-069, `project_shared_laptop_db_deploy_hazard.md`). A parallel session's unfinished pipeline run ships anyway if nobody asks what else has touched the store first, because none of the four guards above can see it.

## Migrate before deploying the code that reads the schema

repo-d's `npm run ship` orders itself merge, score, sync (which migrates), enrich, intel-sync, deploy, and that ordering is documented as load-bearing: "a deploy before the migration leaves new endpoints/tables missing, learned the hard way" (SB-031). The repo also carries a documented app-only shortcut, `npm run deploy`, gated behind a written test for when the fast path is provably safe: no `migrations/*.sql` in the diff, no pipeline or scoring-config change. When any doubt remains, the rule is to run the full ordered ship instead of trusting judgment on the fast path.

The same ordering constraint shows up in repo-d's scheduled sync workflow, not only its manual ship command (SB-023, the ordering note on `.github/workflows/attio-neon-sync.yml`): migrations apply before the lanes that read them, while independent downstream lanes are still allowed to run if an earlier, unrelated lane fails transiently. Putting the required step first, without making every lane hostage to every other lane's failure, is the same discipline applied to a cron job instead of a release.

## Invoke a deploy only through its named script

repo-a's `npm run deploy` (`scripts/deploy.mjs`, TW-147) chains `npm run build`, `wrangler deploy`, and `npm run indexnow:submit` in one script, printing each step as it runs and exiting at the first failure by name. The order is load-bearing for a specific reason recorded alongside it: IndexNow re-fetches each URL to confirm it changed, so it has to run after the deploy is live, not before it. The rule file names that same script as the canonical runbook other procedures should point at, rather than each inventing its own step list (TW-149).

Any generator that produces an aggregate the build reads has to run inside that same script, before the build step, because the build ships whatever the table already holds, not what the newest source data says (MEM-077, `project_cloudflare_deploy_manual.md`).

repo-d names the concrete failure a named script prevents (SB-029, `CLAUDE.md`): "Deploy ONLY via `npm run deploy` or from `worker/`." Wrangler walks up the directory tree looking for its config, so a stray root-level `wrangler.jsonc` shadows the real one in `worker/` and ships an ungated public Worker. The trap file is gitignored, and the fix is written down in three places at once: CLAUDE.md, the deploy skill's Hazards section, and the cleanup-worktree verification checklist, one incident producing three separate enforcement points rather than one.

## Verify the deployed URL against the built file with the cache bypassed

A single live fetch cannot tell built wrong from not yet deployed from deployed but read stale; only comparing the built file against a cache-bypassed fetch of the live page separates the three (MEM-011, `feedback_verify_deploys_cache_busted.md`). A `?cb=$RANDOM` query string is the usual buster, but it is not always enough: when pages disagree with each other, the fix is to fetch the origin that has no cache sitting in front of it (MEM-012). External guidance treats this as standard practice, not a repo-a idiosyncrasy: release testing proves shippability, deployment testing proves the deploy mechanism worked, and cache invalidation is part of the deploy, asserted against a cache-busted fetch rather than assumed (EXT-052).

repo-a also has a case where a query string was not the answer at all, because a platform toggle, not the repo, decided what was served. Cloudflare's "Manage robots.txt" setting overrides the committed `public/robots.txt` at the edge, so the file in the repo "still looked fine" while the served file had regressed unnoticed (TW-152). The runbook now says to check the live file first, with a plain `curl` against the production URL, before trusting the repo at all. The build-record deploy path, a separate Vercel-hosted artifact, applies the same discipline as an explicit two-sided gate: a pre-flight grep across the built output that must come back empty, then a diff of the live page against the committed file after the deploy runs (TW-155).

repo-d's ship script names the success markers a run must print, so "it worked" is checkable rather than asserted (SB-032): a clean audit-bundle line, the migration filenames that ran, the upsert row counts, and a deployed confirmation carrying a version id. A pre-flight grep that must print nothing, paired with an enumerated list of what a clean run must print, are the same check aimed in two directions: the anti-pattern has to be provably absent, and the wanted output has to be provably present.

The same repo carries the third shape this rule needs, for the case where the served artifact is correct and a third party is still serving the old answer (TW-154). Its recurring link-preview failure has a two-step runbook whose whole job is to split our failure from someone else's cached one: fetch the URL from the edge and read the status, then read what the third party's own debugger reports for the same URL. The two answers are what classify the incident, and the runbook writes the classification out rather than leaving it to be re-derived: an edge that returns 200 while the third party still shows 403 means the failure is cached on their side and is not currently an edge issue, so the fix is a re-scrape there rather than another deploy here. Without that second reading the same symptom reads as a live regression, and the response is a deploy that cannot change anything.

## Repoint and deploy the consumer before dropping the producer's column

repo-a's `db/NEON-CONTRACT.md` is marked FROZEN for exactly this reason (TW-144): any laptop-side change that touches the source of a published column requires the consumer repointed and deployed first, because merged code that has not shipped in the consumer's Worker "is not done, it's a landmine for the next publish." The contract distinguishes what a consumer reads today, which is frozen and cannot change without coordination, from additive slack the producer may still change freely. The worked example it names for doing this safely is the three-step order: repoint, deploy, then drop, never drop before the deploy has landed.

External guidance frames the same move as a general decommissioning practice, not something repo-a-specific: decommission in phases, keeping the old path readable for a window after cutover, because that is what converts an irreversible cutover into a reversible one (EXT-055).

## Restore a backup before calling it a backup

repo-c's `docs/BACKUP.md` states the rule as a definition, not a preference (AS-027): "A backup that has never been restored is not a backup." The doc documents the restore test itself and the cadence it runs on, rather than treating a nightly job's exit code as proof the data is recoverable.

repo-a's backup section adds the failure modes a restore-only rule does not cover by itself (TW-094): backups are encrypted and pruned by count on the client rather than by age, so a stretch of the laptop being offline never deletes the last good copy, and the restore test itself runs on a stated cadence rather than only once at setup.

## Sources

- https://bug0.com/knowledge-base/deployment-testing, cited for treating cache invalidation as part of the deploy and asserting against a cache-busted fetch (EXT-052).
- https://streamkap.com/resources-and-guides/data-migration-best-practices, cited for decommissioning in phases and keeping the old path readable for a window after cutover (EXT-055).
