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
older baseline. Close the open `harness-update` issue from the PR that adds the section.

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
2. Bump `plugins/house/.claude-plugin/plugin.json` and the pin in `house.json`.
3. Cut the CHANGELOG section. Its summary sentence names the class and the ADR it follows.
4. Run `node plugins/house/scripts/house render --apply --repo .`, then run the gate with
   `npm run verify`.
5. Squash-merge on green CI, tag the merge commit, and create the GitHub release from the
   CHANGELOG section.
6. Update the installed plugin, then re-sync each adopting repo with its own `render --apply`
   pull request.

A refuter is worth sending when a rewording touches a hook, the guard, the model tiers, or text
every adopter vendors. For a small text change the gate covers, reading the diff is usually
enough.
