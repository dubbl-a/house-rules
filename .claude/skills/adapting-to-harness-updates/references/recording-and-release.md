# Recording and release

## Where the results land

1. **`docs/handbook/sources/harness-survey.md`** gets a new dated section at the end:
   - `## Addendum, YYYY-MM-DD: Claude Code X.Y.Z` for a delta. Link the changelog, then give one
     bullet per change that touches the package, each with its disposition and the file that
     handles it.
   - `## Re-survey, YYYY-MM-DD (Claude Code X.Y.Z)` for a full run. Include the result counts,
     where the bank lives, corrected citations, open questions answered, and open questions
     still open.
2. **The handbook chapter a fact belongs to.** Model and tier facts go in
   `docs/handbook/claude-code.md` as a dated paragraph with a URL per fact. Any other rule's
   reasoning goes in the chapter its `Receipts:` line names.
3. **The research bank.** This applies only to a full run. Save facts, classifications,
   verifications, the report, the critic, an `INDEX.tsv`, and a copy of the scripts as run, in a
   dated directory beside the previous run. The bank is outside the repo. Name its path in the
   survey section.

Keep `Claude Code X.Y.Z` in the survey heading. `scripts/check-harness-release.mjs` reads the last
heading that carries it as the baseline, so a heading without it leaves the detector reporting an
older baseline. If an open `harness-update` issue exists from before the watcher stopped filing
them, close it from the PR that adds the section.

Keep the method in the skill and the dates in these records. The skill never carries a version
number or an "as of".

## Shipping

Group the edits into pull requests by module when the reword count is large. A survey section and
a handful of rewords can share one PR. The CHANGELOG entry belongs to the release PR, never to a
feature PR.

Release, per the repo's version rules:
1. Choose the class. Under ADR 0012, below 1.0 the breaking class (ADR 0011) takes the minor and
   everything else the patch. Rule prose with no heading renamed and no change to the guard's
   deny set is a patch.
2. Bump `plugins/house/.claude-plugin/plugin.json`, the pin in `house.json`, and every release tag
   in `README.md`'s install section (`tests/readme-pin.test.mjs` fails until they match).
3. Cut the CHANGELOG section. Its summary sentence names the class and the ADR it follows.
4. Run `node plugins/house/scripts/house render --apply --repo .`, then run the gate with
   `npm run verify`.
5. The maintainer squash-merges on green CI.
6. `.github/workflows/release.yml` does the rest on that push to main: it tags the merge commit,
   creates the GitHub release from the CHANGELOG section, then opens a `render --apply` pull
   request in each adopting repo and squash-merges it once its checks pass (it reads their
   Actions runs; the sync token needs Contents rw, Pull requests rw, and Actions read). When a sync leg fails,
   fix the cause and use "Re-run failed jobs" on that run, not "Re-run all jobs". The installed
   plugin follows the marketplace when its auto-update is on (it is on for the maintainer's
   machine); otherwise run `claude plugin update house-rules@house-rules`.

## How an update reaches the maintainer

Nothing in this path asks the maintainer to remember a command or a folder; the one human step
arrives in their inbox.

1. `.github/workflows/harness-watch.yml` runs hourly on GitHub. When the changelog shows a version
   newer than the last survey heading, it fires the claude.ai routine "house-rules harness triage"
   once per version (remembered in the Actions cache) and opens no issue.
2. The routine runs the prompt in [routine-prompt.md](routine-prompt.md) in a cloud session on the
   maintainer's plan: survey, rewords, refuter rounds until clean, release prep when rules change,
   `npm run verify`, a ready pull request, then one email to the maintainer through a send-only
   Gmail connector. The routine builds every opportunity in that PR, larger ones included. When a
   release has nothing to adopt, it opens no PR: it comments the triage on the rolling
   issue titled `Survey pending: Claude Code updates checked, nothing to adopt yet`, and the next
   PR records those versions and closes it.
3. The maintainer reads the pull request's plain summary and merges it, usually from the GitHub app.
4. `.github/workflows/release.yml` releases and syncs, as in Shipping step 6.

`routine-prompt.md` is the copy of record. The routine itself lives on claude.ai, so a change to
the prompt there must be copied into that file in the same pull request, and the reverse.

A refuter is worth sending when a rewording touches a hook, the guard, the model tiers, or text
every adopter vendors. For a small text change the gate covers, reading the diff is usually
enough.
