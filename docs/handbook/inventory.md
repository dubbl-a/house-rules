<!-- docs-drift-ignore-file: Stage A inventory; source cells cite other repos and point-in-time survey headings -->
# Harvest inventory (Stage A)

Every distinct practice found in the six source catalogs (three of them held privately; see the
legend below) and the memory corpus, one row each, with its disposition and its single destination. This file plus
`manifest.json` are the source of truth for every later build agent.

Rows whose Source cell carries `(testing sweep 2026-08-24)` were added by the ninth-module
(testing) sweep. That same pass repointed a handful of earlier rows to `rule:testing.md`, keeping
their ids: the test-conventions rows Stage A parked in a chapter (TW-134, EXT-040, MEM-010) and
three whose home was the wrong artifact (TW-135, AS-032, EXT-028).

Rows AG-065 and EXT-099 came in on the memory-index pass, which read the official memory
documentation against one repo's live auto-memory index. Neither has a line in the six source
catalogs, so both cite what was read instead.

Rows EXT-086 to EXT-098 and PA-035 to PA-039 came in on the reconciliation pass that read the two
testing source catalogs (`sources/testing-sweep.md`, `sources/testing-external.md`) after a
template bug had kept them out of the spec stage. That pass also repointed EXT-084 to the renamed
`rule:testing.md` heading, so the demotion call itself stays engineering.md's and only the
suite-level obligation is ported here.

## ID prefixes

| Prefix | Source |
| --- | --- |
| `TW-` | repo-a |
| `AG-` | repo-b (repo 1 of 2 covered by the same survey) |
| `AS-` | repo-c (repo 2 of 2 covered by the same survey) |
| `SB-` | repo-d (repo 1 of 2 covered by the same survey) |
| `RT-` | repo-e (repo 2 of 2 covered by the same survey) |
| n/a | `repo-f`, `repo-g` are sibling repositories mentioned in passing, not surveyed |
| `MEM-` | memory corpus (`~/.claude/projects/<repo-a>/memory/`) |
| `EXT-` | external official or widely-held guidance (`sources/external-guidance.md`) |
| `PA-` | prior art, borrow/reuse decisions (`sources/prior-art.md`) |

The survey files behind `TW-`, `AG-`, `AS-`, `SB-`, and `RT-` are held in the maintainer's private archive and are not part of this repository.

## Dispositions

`port` becomes a rule heading. `generalize` is ported with repo specifics removed.
`cross-ref` means another file points at its canonical home. `fold` is absorbed into another
rule's text without its own heading. `handbook-only` is context or a receipt, no rule.
`drop` carries its reason after a semicolon in the Practice cell.

## Destination tokens

| Token | Artifact |
| --- | --- |
| `rule:<file>#<slug>` | `plugins/house/modules/<module>/rules/<file>` heading |
| `chapter:<module>` | `docs/handbook/<module>.md` |
| `skill:<name>` | `plugins/house/skills/<name>/SKILL.md` |
| `template:<name>` | `plugins/house/templates/<name>` |
| `script:<name>` | a Phase 4 script or managed module file |
| `schema` | `plugins/house/schema/house.schema.json` |
| `adr:000N` | `docs/decisions/000N-*.md` |
| `xref:<token> -> <ID>` | the pointing artifact, and the canonical row it points at |

---

## repo-a (TW)

| ID | Source (path or path#heading) | Practice (one line, imperative) | Disposition | Destination |
| --- | --- | --- | --- | --- |
| TW-001 | repo-a:.claude/rules/maintaining-docs.md §Anchor every UI/feature claim | Anchor every claim to a grep-able token, because free-form prose drifts silently while anchored prose fails the build | port | rule:docs.md#anchor-every-claim-to-a-grep-able-token |
| TW-002 | same §Anchor, closing paragraph | Generalize a claim that genuinely cannot be anchored so it still reads true after the next refactor | fold | rule:docs.md#anchor-every-claim-to-a-grep-able-token |
| TW-003 | same, token vocabulary | Name the anchor kinds a repo actually uses: script name, path, component, section id, class prefix, env var | generalize | rule:docs.md#anchor-every-claim-to-a-grep-able-token |
| TW-004 | same §The mechanical gate | Validate every rule file's `paths:` globs, because an unresolvable glob means the rule never loads and rots unseen | port | rule:docs.md#give-every-rule-file-a-paths-list-whose-first-segment-resolves |
| TW-005 | same §The mechanical gate | Keep the archive tier outside the drift gate, and never "fix" a stale name in a dated entry | fold | rule:docs.md#opt-a-point-in-time-doc-out-with-a-file-level-reason |
| TW-006 | same, escape hatch | Give the gate a per-line escape hatch that carries a reason | fold | rule:docs.md#opt-a-point-in-time-doc-out-with-a-file-level-reason |
| TW-007 | same §The mechanical gate, closing | Run the gate before pushing; the build wiring is the safety net, local-first is the workflow | port | rule:docs.md#run-the-docs-gate-before-pushing-and-in-the-build |
| TW-008 | same §What belongs where | Route a fact by its litmus test across root file, rule file, README, skill, and archive | port | rule:docs.md#put-a-fact-where-its-litmus-test-says-it-belongs |
| TW-009 | same §What belongs where, archive bullet | Write dated incidents, measurements, and decision evidence to an archive doc that is never loaded into context | fold | rule:docs.md#opt-a-point-in-time-doc-out-with-a-file-level-reason |
| TW-010 | same §Durable rules link their receipts | State a rule as imperative plus one-clause why plus enforcement anchor plus a pointer to its receipt | port | rule:docs.md#state-a-rule-as-imperative-why-anchor-receipts |
| TW-011 | same, anti-pattern note | Never let a rule file become an incident log; a rule needing a date, a name, or a measured number is history wearing a rule's clothes | port | rule:docs.md#move-dates-names-and-measured-numbers-out-of-rule-prose |
| TW-012 | same, parenthetical on an upstream plugin | Record why an evaluated upstream tool was not adopted, naming the failure mode that decided it | handbook-only | chapter:docs |
| TW-013 | same §Targets and discipline | Hold the root file, each rule file, and the README to line targets, because shorter files get better adherence | port | rule:docs.md#keep-files-under-budget-and-raise-a-ceiling-only-with-a-written-reason |
| TW-014 | same §Targets and discipline | Cut, don't append; files should not grow monotonically, and trim on a fixed cadence even when nothing obvious is a candidate | port | rule:docs.md#cut-dont-append-and-trim-on-a-fixed-cadence |
| TW-015 | same, bloat smells list | Name the bloat smells so a reviewer can spot them: walkthroughs, versioned stack lists, deep nesting, non-workaround code blocks | fold | rule:docs.md#cut-dont-append-and-trim-on-a-fixed-cadence |
| TW-016 | same, HTML maintainer note | Put maintainer notes in block comments, which are stripped before context injection and cost nothing | fold | rule:docs.md#opt-a-point-in-time-doc-out-with-a-file-level-reason |
| TW-017 | private survey (repo-a), gap note after §1 | Enforce length limits mechanically with a ratchet instead of documenting them and hoping | generalize | script:check.mjs |
| TW-018 | repo-a:scripts/check-docs-drift.mjs | Read the haystack once and match by substring, so the scan stays fast on a whole tree | generalize | script:check.mjs |
| TW-019 | same, line-by-line loop | Skip fenced code blocks and HTML comments before extracting tokens, because neither is load-bearing context | generalize | script:check.mjs |
| TW-020 | same, `checkAnchor()` | Leave an unrecognized token unenforced rather than raise a false positive, and say so in the docs | generalize | script:check.mjs |
| TW-021 | same, report | End a failure report with the three ways to fix it: fix the doc, rename the code, or add the ignore comment | generalize | script:check.mjs |
| TW-022 | same, module-level consts | Hoist repo-specific token namespaces (path prefixes, class prefixes, component suffixes, haystack dirs) into config | generalize | schema |
| TW-023 | repo-a:scripts/check-explainer-anchors.mjs | Derive the allowed anchor set from the target itself, never from a hand-maintained list | generalize | script:check.mjs |
| TW-024 | same, stated why | A missing fragment does not 404, so nothing surfaces a dead in-page link without a gate | handbook-only | chapter:docs |
| TW-025 | repo-a:.claude/rules/build-record.md | Generate every published figure and gate it verbatim in each surface that carries it; a retired value must appear in none | fold | rule:engineering.md#keep-one-implementation-per-computation-and-let-the-gate-and-the-report-share-it |
| TW-026 | same | Never hand-edit generated data to make its gate pass, which reintroduces the exact failure the gate exists to prevent | fold | rule:engineering.md#never-let-a-gate-mint-the-answer-key-it-grades-against |
| TW-027 | same, pinned vs derived vs retired | A pinned figure is not a stale figure: its as-of date is part of the claim | fold | rule:docs.md#move-dates-names-and-measured-numbers-out-of-rule-prose |
| TW-028 | same, gate scope | Keep a gate file-only so it runs where there is no database and no network | fold | rule:github.md#gate-every-pr-on-checks-that-need-no-credential-and-name-what-is-not-gated |
| TW-029 | repo-a:CLAUDE.md, whole-file shape | Give the root file a fixed section spine that ends in a pointer to the doc-maintenance rule | generalize | template:CLAUDE.md.skeleton |
| TW-030 | repo-a:CLAUDE.md §Domain rules (path-scoped) | Scope a domain rule with `paths:` so it costs nothing in sessions that never touch the domain | port | rule:claude-code.md#give-a-domain-rule-a-paths-list-and-never-leave-a-rule-file-unscoped |
| TW-031 | same, discovery fallback | Tell the reader how to find a rule when no matching file is open | fold | rule:claude-code.md#give-a-domain-rule-a-paths-list-and-never-leave-a-rule-file-unscoped |
| TW-032 | repo-a:issue #638 split precedent | Split a rule file on a real axis (write-side rules, measurement rules, dated evidence), not by size alone | fold | rule:docs.md#split-a-file-only-when-splitting-narrows-what-loads |
| TW-033 | repo-a:.claude/rules/match-measurement.md header | Cross-reference a sibling file instead of restating it, and say "never restate them here" out loud | fold | rule:docs.md#split-a-file-only-when-splitting-narrows-what-loads |
| TW-034 | repo-a:.claude/rules/entity-resolution.md | Keep constants in code and reference them from docs, because a stale threshold in prose reads as a rule | fold | rule:docs.md#move-dates-names-and-measured-numbers-out-of-rule-prose |
| TW-035 | repo-a:.claude/hooks/no-direct-master.sh | Block a commit on the protected branch, a push from it, and any push whose refspec targets it | port | script:no-direct-master.sh |
| TW-036 | same, worktree awareness | Resolve the target worktree's branch by parsing the command, so a command aimed at a sibling checkout is judged against that checkout | port | script:no-direct-master.sh |
| TW-037 | same, quote handling | Strip quoted text and comments before matching, so a commit message naming the branch cannot false-positive | port | script:no-direct-master.sh |
| TW-038 | same, stated limitation | Say plainly that the hook is fail-fast UX and server-side branch protection is the real guarantee | fold | script:no-direct-master.sh |
| TW-039 | same, content carve-out | Allow a carve-out only when every changed path matches, and never let an empty diff satisfy it | port | script:no-direct-master.sh |
| TW-040 | repo-a:scripts/test-no-direct-master.sh | Test the guard with cases that must block and cases that must pass, and build its literal tokens so the test cannot trip itself | port | script:hook-tests |
| TW-041 | repo-a:scripts/lib/assert-master-at-origin.mjs | Pre-flight any script that reads the working tree and then pushes effects to a live system | port | script:deploy-guards.mjs |
| TW-042 | same, error output | Print the working directory, both SHAs, and labeled remediations when a guard refuses | fold | rule:engineering.md#make-an-error-message-teach-the-fix |
| TW-043 | repo-a:scripts/cleanup-worktree.sh | Tear a worktree down in ordered steps, killing only processes rooted inside it and refusing the main checkout | port | script:cleanup-worktree.sh |
| TW-044 | same, remote delete | Delete the remote branch through the API, because a push from the protected checkout is blocked by the guard | fold | script:cleanup-worktree.sh |
| TW-045 | repo-a:CLAUDE.md §Contributing workflow | Branch and open a PR for every change, even solo and even trivial, with a `kind/short-name` branch | port | template:CLAUDE.md.skeleton |
| TW-046 | same, docs ride along | Ship the docs edit in the same PR as the code that changes documented behavior, with the exceptions named | port | rule:docs.md#ship-the-docs-and-changelog-edit-in-the-same-pr-as-the-change |
| TW-047 | same, changelog | Log only what the repo's audience would notice; refactors, infra, and silent fixes live in git history | fold | rule:docs.md#ship-the-docs-and-changelog-edit-in-the-same-pr-as-the-change |
| TW-048 | same, local preview | Preview a rendered surface before asking approval, state the scope of the approval, and never self-approve | port | template:CLAUDE.md.skeleton |
| TW-049 | same, skippable list | Name the change classes for which preview is skippable, and default to previewing when in doubt | fold | template:CLAUDE.md.skeleton |
| TW-050 | same, merge flag | Never delete the branch from the worktree being merged, because the flag fails on a pinned branch | port | rule:github.md#never-delete-the-branch-from-the-worktree-being-merged |
| TW-051 | same §Worktree policy | Scale the branch location to the change size, requiring every Tier 1 condition before branching in the main checkout | port | template:CLAUDE.md.skeleton |
| TW-052 | same, worktree mechanics | Give each worktree its own install, a dev-server port ladder, and symlinks (never copies) for shared gitignored fixtures | handbook-only | chapter:github |
| TW-053 | repo-a:.github/workflows/pr-checks.yml | Keep the PR gate under a minute and state the wall-time target as a design constraint | port | template:pr-checks.yml |
| TW-054 | repo-a:.github/workflows/* | Declare least-privilege `permissions:` per workflow with the reason written beside it | port | rule:github.md#give-a-workflow-read-only-permissions-and-pin-every-action-by-sha |
| TW-055 | same, deprecation flag | Date a temporary config flag and say what makes it removable | fold | rule:engineering.md#pin-a-framework-default-your-output-depends-on-with-the-reason-beside-it |
| TW-056 | same, concurrency groups | Choose a concurrency policy per workflow and write down why cancel or queue is right for it | port | template:pr-checks.yml |
| TW-057 | repo-a:.github/workflows/link-check.yml | Open an issue rather than fail a scheduled run, because a recurring red X trains you to ignore it | port | rule:github.md#open-an-issue-instead-of-failing-a-scheduled-run-and-comment-out-a-cron-with-its-reason |
| TW-058 | repo-a:.github/workflows/enrich-scan.yml | Comment a cron out with its reason instead of deleting it, so restoring the cadence is two lines | fold | rule:github.md#open-an-issue-instead-of-failing-a-scheduled-run-and-comment-out-a-cron-with-its-reason |
| TW-059 | repo-a:.github/workflows/cf-diagnose.yml | Run a credentialed diagnostic as a workflow so the token never enters an agent session | port | rule:github.md#keep-credentials-out-of-the-repo-the-commit-and-the-chat |
| TW-060 | repo-a:.github/workflows/pr-checks.yml, comment | Name what is deliberately not gated and why, inside the workflow that does the gating | port | rule:github.md#gate-every-pr-on-checks-that-need-no-credential-and-name-what-is-not-gated |
| TW-061 | repo-a:.github/PULL_REQUEST_TEMPLATE.md | Force a summary, a test plan, and a docs-check answer on every PR | port | template:PULL_REQUEST_TEMPLATE.md |
| TW-062 | repo-a:issues #605 to #638, carryover chain | Hand off through a carryover issue rather than a file, so the next session starts from state it can diff | port | rule:claude-code.md#hand-off-through-a-carryover-issue |
| TW-063 | same | Give the carryover issue a fixed shape: staleness disclaimer, exact tree state, gate exit codes, live counts, shipped PRs, the headline finding, a next-cycle list, what was deferred by decision, and supersession of the previous one | port | skill:handoff |
| TW-064 | repo-a:scripts/lib/retro.mjs | Define an invariant as key, severity, title, why, remedy, and check, and treat a violation as something that never announces itself where it was created | port | rule:engineering.md#assert-an-invariant-where-its-state-is-created-with-a-why-and-a-remedy |
| TW-065 | same, required fields | Require a why and a remedy on every check, for the person reading the failure late at night | fold | rule:engineering.md#assert-an-invariant-where-its-state-is-created-with-a-why-and-a-remedy |
| TW-066 | same, `hasHardFailure` | Exit non-zero on a hard violation so bad state cannot flow downstream to a publish or a deploy | fold | rule:engineering.md#assert-an-invariant-where-its-state-is-created-with-a-why-and-a-remedy |
| TW-067 | same, three questions | Report invariants, then deltas against the previous run, then proposals, in descending loudness | port | rule:data-pipelines.md#end-every-pipeline-run-with-a-retro-of-invariants-deltas-and-proposals |
| TW-068 | same, `NOT_MEASURED` sentinel | Say "not measured" with a null delta rather than invent a zero that reads exactly like data loss | fold | rule:engineering.md#report-not-evaluable-and-not-measured-rather-than-a-fabricated-zero |
| TW-069 | same, two output surfaces | Ship both a written report and a terminal digest that carries the fix line, because nobody reads the file | fold | rule:data-pipelines.md#end-every-pipeline-run-with-a-retro-of-invariants-deltas-and-proposals |
| TW-070 | same, report preamble | Read agreement with a shown suggestion as anchored agreement, not accuracy, because the reviewer was looking at that evidence | fold | rule:llm-output.md#read-agreement-with-a-shown-suggestion-as-anchored-not-accurate |
| TW-071 | repo-a:scripts/retro/cli.mjs | Assert the running role before a pipeline touches anything, and refuse to run as the wrong one | fold | rule:database.md#give-each-initiative-its-own-least-privilege-role |
| TW-072 | same, all-domains form | Provide an all-domains form as the at-a-glance health check for pipelines that run rarely | fold | rule:data-pipelines.md#end-every-pipeline-run-with-a-retro-of-invariants-deltas-and-proposals |
| TW-073 | repo-a:scripts/retro/domains/*.mjs headers | Open each guard by naming the failure class it exists to catch | fold | rule:engineering.md#land-a-build-time-guard-with-the-code-it-protects |
| TW-074 | repo-a:scripts/retro/domains/publish.mjs | A retro that cannot run is worse than one with a narrower scope | fold | rule:data-pipelines.md#end-every-pipeline-run-with-a-retro-of-invariants-deltas-and-proposals |
| TW-075 | repo-a:scripts/retro/domains/schema.mjs | Keep a table registry and check it against live grants in both directions | fold | rule:database.md#add-the-table-registry-line-in-the-same-pr-as-the-migration |
| TW-076 | repo-a:scripts/check-equal-treatment.mjs | Make the product's one non-negotiable invariant a build gate; drop, because the promise is the product's, and the two transferable halves ship as TW-077 and TW-078 | drop | n/a |
| TW-077 | same, shared comparison logic | Share one comparison implementation between the gate and the report so they can never disagree about what the rule means | port | rule:engineering.md#keep-one-implementation-per-computation-and-let-the-gate-and-the-report-share-it |
| TW-078 | same, waiver design | Require a reason on a waiver, print it, scope it to one run, and keep it deliberately awkward | port | rule:engineering.md#make-every-waiver-print-its-reason-and-give-an-integrity-gate-none |
| TW-079 | same, paired invariant | Give an integrity invariant no waiver at all, and short-circuit it before the waiver prompt | fold | rule:engineering.md#make-every-waiver-print-its-reason-and-give-an-integrity-gate-none |
| TW-080 | repo-a, repo-wide env escapes | Make every escape hatch carry its reason, as a repo-wide convention rather than a one-off | fold | rule:engineering.md#make-every-waiver-print-its-reason-and-give-an-integrity-gate-none |
| TW-081 | repo-a:scripts/check-image-optimization.mjs | Check the emitted bytes for both real format and real shrink, because either check alone misses a whole failure | port | rule:engineering.md#verify-the-served-artifact-not-the-source |
| TW-082 | same, origin story | The option's name was not evidence; only the bytes were | fold | rule:engineering.md#verify-the-served-artifact-not-the-source |
| TW-083 | same, `MIN_SHRINK` comment | Justify a threshold constant in a comment beside it, with the range that makes it right | fold | rule:engineering.md#pin-a-framework-default-your-output-depends-on-with-the-reason-beside-it |
| TW-084 | repo-a:package.json lifecycle | Run guards first, generators second, and the check that needs the output after the build | fold | rule:engineering.md#land-a-build-time-guard-with-the-code-it-protects |
| TW-085 | repo-a:CLAUDE.md §Build-time guards | Guards exist for a failure class that renders fine, builds green, and is invisible to review | fold | rule:engineering.md#land-a-build-time-guard-with-the-code-it-protects |
| TW-086 | repo-a:.claude/rules/database.md §Migrations | Number migrations, apply them in filename order, run each in a transaction, and record the filename in a ledger | fold | rule:database.md#write-forward-only-numbered-idempotent-migrations-each-opening-with-what-and-why |
| TW-087 | same | Make every migration idempotent | fold | rule:database.md#write-forward-only-numbered-idempotent-migrations-each-opening-with-what-and-why |
| TW-088 | same, squash and baseline | Squash old migrations to a baseline outside the runner's glob, pre-seed the ledger, and provide one idempotent setup command | fold | rule:database.md#write-forward-only-numbered-idempotent-migrations-each-opening-with-what-and-why |
| TW-089 | same, registry line | Add the registry line for a new table in the same PR as its migration | port | rule:database.md#add-the-table-registry-line-in-the-same-pr-as-the-migration |
| TW-090 | repo-a:db/SECURITY.md, .claude/rules/database.md | Separate publishable data from sensitive data by schema and by role, and never let one role reach the other | generalize | rule:database.md#give-each-initiative-its-own-least-privilege-role |
| TW-091 | repo-a:src/lib/db/client.ts | Enforce the firewall with a runtime guard, not only a grant, when the build itself runs as a privileged role | fold | rule:database.md#give-each-initiative-its-own-least-privilege-role |
| TW-092 | repo-a:db/SECURITY.md | Ship a firewall with its own falsification procedure | cross-ref | xref:rule:database.md -> TW-108 |
| TW-093 | repo-a:.claude/rules/database.md §gotchas | State when a rule's inverse does not generalize, so nobody reasons from one to the other | fold | rule:database.md#give-each-initiative-its-own-least-privilege-role |
| TW-094 | same §Backups | Encrypt backups, prune by count client-side so being offline never deletes one, and run the restore test on a cadence | fold | rule:deployment.md#restore-a-backup-before-calling-it-a-backup |
| TW-095 | repo-a, script env handling | Load vendor keys from an env-file flag and keep the env file out of git | fold | rule:github.md#keep-credentials-out-of-the-repo-the-commit-and-the-chat |
| TW-096 | repo-a:.claude/rules/entity-resolution.md, env asymmetry | Never let a write script pick its target database out of a dotfile | port | rule:database.md#never-let-a-write-script-pick-its-target-from-a-dotfile |
| TW-097 | repo-a:CLAUDE.md §What not to do | Keep env files, account ids, and API keys out of the repo | fold | rule:github.md#keep-credentials-out-of-the-repo-the-commit-and-the-chat |
| TW-098 | repo-a:.claude/rules/deployment.md, design.md | Label a value that is deliberately public as a non-secret, so nobody redacts it by reflex | port | rule:github.md#label-a-non-secret-as-a-non-secret |
| TW-099 | repo-a:.claude/rules/enrichment.md | Name a cost constraint as a load-bearing invariant so nothing quietly breaks it | fold | rule:engineering.md#assert-an-invariant-where-its-state-is-created-with-a-why-and-a-remedy |
| TW-100 | repo-a:src/lib/db/client.ts | Fail fast on missing config, because a silent fallback ships stale content | fold | rule:engineering.md#make-an-error-message-teach-the-fix |
| TW-101 | repo-a:.claude/rules/entity-resolution.md | Log idempotency rather than assume it: an unchanged input hash inside the window is a no-op, and a force flag overrides | port | rule:data-pipelines.md#make-a-pipeline-idempotent-and-resumable-and-log-the-idempotency-rather-than-assume-it |
| TW-102 | repo-a:scripts/enrich/* appliers | Mark applied rows so a re-run cannot double-apply | fold | rule:data-pipelines.md#make-a-pipeline-idempotent-and-resumable-and-log-the-idempotency-rather-than-assume-it |
| TW-103 | repo-a:.claude/rules/finance-pipeline.md | Test with a known-answer case as well as the no-op case, because zero is also what a broken run prints | port | rule:engineering.md#prove-a-check-can-fail-before-trusting-that-it-passed |
| TW-104 | repo-a:scripts/outbound, backfill, prune | Default to a dry run and require an explicit apply flag to write | port | rule:data-pipelines.md#default-to-a-dry-run-and-require-an-explicit-flag-to-write |
| TW-105 | repo-a:scripts/outbound/push-leads.mjs | Roll out in tiers with a small first push before the full one | fold | rule:data-pipelines.md#default-to-a-dry-run-and-require-an-explicit-flag-to-write |
| TW-106 | repo-a:.claude/rules/outbound.md §Lessons | Never trust a vendor success response past a plan cap; reconcile against an independent listing | port | rule:data-pipelines.md#reconcile-a-vendors-success-response-against-an-independent-count |
| TW-107 | repo-a:scripts/match/restore-reviewed-links.mjs | Head a destructive script with a do-not-run note when even its dry run would produce regressions | fold | rule:data-pipelines.md#default-to-a-dry-run-and-require-an-explicit-flag-to-write |
| TW-108 | repo-a:.claude/rules/council-acquisition.md | Validate the body before writing anything, because a status code is not a content check | port | rule:engineering.md#validate-the-body-before-writing-it-because-a-status-code-is-not-a-content-check |
| TW-109 | same, orphan artifacts | Write neither the artifact nor its ledger row on a rejection, because an orphan file is invisible on both axes | fold | rule:engineering.md#validate-the-body-before-writing-it-because-a-status-code-is-not-a-content-check |
| TW-110 | same, circuit breaker | Abandon a kind after a few consecutive refusals, so a wrong URL costs three requests rather than forty | fold | rule:data-pipelines.md#archive-first-parse-second-and-write-the-ledger-row-in-the-same-transaction |
| TW-111 | same, unrecognised type | Refuse an unrecognised type rather than guess it | fold | rule:data-pipelines.md#name-dont-act-on-ambiguous-data |
| TW-112 | repo-a:.claude/rules/council-meetings.md §Archive first | Archive first, parse second, and write the artifact and its ledger row in one transaction so provenance cannot diverge | port | rule:data-pipelines.md#archive-first-parse-second-and-write-the-ledger-row-in-the-same-transaction |
| TW-113 | same, content addressing | Content-address the artifact, supersede rather than clobber, and key on the source URL, never the basename | fold | rule:data-pipelines.md#archive-first-parse-second-and-write-the-ledger-row-in-the-same-transaction |
| TW-114 | same, polite-scraping terms | Fetch politely: identified agent, timeout, per-host delay floor, targeted URLs only, stated volume | handbook-only | chapter:data-pipelines |
| TW-115 | repo-a:.claude/rules/council-acquisition.md | Report a gap in the source as its own outcome rather than a silence | fold | rule:engineering.md#report-not-evaluable-and-not-measured-rather-than-a-fabricated-zero |
| TW-116 | repo-a:.claude/rules/match-measurement.md | Give a gate three verdicts, one of which is NOT EVALUABLE, and never let it print "passed" when it could not evaluate | port | rule:engineering.md#report-not-evaluable-and-not-measured-rather-than-a-fabricated-zero |
| TW-117 | same | Refuse to let a gate mint the answer key it grades against, and treat a clean validation as the moment to check the key | port | rule:engineering.md#never-let-a-gate-mint-the-answer-key-it-grades-against |
| TW-118 | same | Seed the sampling so two initializing runs are byte-identical, or the baseline fingerprint means nothing | port | rule:engineering.md#make-a-measuring-instrument-reproducible |
| TW-119 | same | Leave the baseline at post-change numbers in the PR that moves them, with the why in the PR body | fold | rule:engineering.md#make-a-measuring-instrument-reproducible |
| TW-120 | same | Enforce blinding in the file on disk, not in the reviewer's instructions, because an instruction is not a control | fold | rule:llm-output.md#read-agreement-with-a-shown-suggestion-as-anchored-not-accurate |
| TW-121 | same | A capped list under a heading claiming completeness must print the true total and say it is a sample | fold | rule:engineering.md#show-the-ratio-and-the-sample-because-one-number-is-never-the-accuracy |
| TW-122 | same | Give no label source deference; rank by which verdict is more recent and better evidenced | fold | rule:engineering.md#never-let-a-gate-mint-the-answer-key-it-grades-against |
| TW-123 | same | Absence is not confidence: report an explicit false and a missing value separately | port | rule:engineering.md#read-a-missing-field-as-missing-because-absence-is-not-confidence |
| TW-124 | same | One number is never the accuracy: label every figure with its estimand and its sample, and never average disagreeing estimands | port | rule:engineering.md#show-the-ratio-and-the-sample-because-one-number-is-never-the-accuracy |
| TW-125 | same | Never quote one conditional's number against another's, because both can be true at once | fold | rule:engineering.md#show-the-ratio-and-the-sample-because-one-number-is-never-the-accuracy |
| TW-126 | same | Watch the apparatus for staleness, not only the data it measures | fold | rule:engineering.md#make-a-measuring-instrument-reproducible |
| TW-127 | same | Zero false positives is necessary, not sufficient: show the signal catches something, and return null when it cannot evaluate | fold | rule:engineering.md#prove-a-check-can-fail-before-trusting-that-it-passed |
| TW-128 | same | A population statistic orders a worklist; it never decides a row | fold | rule:data-pipelines.md#name-dont-act-on-ambiguous-data |
| TW-129 | same | Read growth in reviewer-corrected labels as gold-set decay, not as improvement | fold | rule:engineering.md#make-a-measuring-instrument-reproducible |
| TW-130 | same | Measure blocking recall rather than assume it, because a precision fixture is blind to what blocking never surfaced | fold | rule:engineering.md#show-the-ratio-and-the-sample-because-one-number-is-never-the-accuracy |
| TW-131 | repo-a:.claude/rules/build-record.md | Prefer ratios to bare decimals and keep the sample size visible, because the same percentage over different n is a different claim | fold | rule:engineering.md#show-the-ratio-and-the-sample-because-one-number-is-never-the-accuracy |
| TW-132 | same | State a share on a denominator that could have been the numerator, and subtract the structurally ineligible or say you did not | port | rule:engineering.md#normalize-against-fixed-anchors-never-against-the-live-population |
| TW-133 | same | Gate a number on a diagram exactly like a number in prose | fold | rule:engineering.md#keep-one-implementation-per-computation-and-let-the-gate-and-the-report-share-it |
| TW-134 | repo-a:tests/, vitest.config.mjs | Keep tests flat and named after the modules they mirror, with fixtures beside them | port | rule:testing.md#mirror-the-module-layout-in-the-test-tree-and-keep-each-fixture-beside-its-test |
| TW-135 | repo-a:vitest.config.mjs comment | Explain a non-obvious test-runner setting in the config file itself, with the incident that produced it | port | rule:testing.md#explain-a-test-runner-config-quirk-in-the-config-with-the-incident-that-produced-it |
| TW-136 | repo-a:email-snapshots/ | Commit the rendered artifact and let CI re-render and diff it as a drift gate | port | template:pr-checks.yml |
| TW-137 | repo-a:.github/workflows/pr-checks.yml, stated scope | Keep the PR gate to pure functions and push everything stateful to the retro | fold | rule:github.md#gate-every-pr-on-checks-that-need-no-credential-and-name-what-is-not-gated |
| TW-138 | repo-a:.claude/rules/design.md §Don't | Name one library per job and the condition under which that choice may change | generalize | template:CLAUDE.md.skeleton |
| TW-139 | repo-a:src/lib/db types | Derive types from the schema so the typechecker fails on column drift | fold | rule:engineering.md#keep-one-implementation-per-computation-and-let-the-gate-and-the-report-share-it |
| TW-140 | repo-a:.claude/rules/database.md, design.md §gotchas | Record the symptom alongside the fix, so the next reader recognises the failure before diagnosing it | fold | rule:engineering.md#make-an-error-message-teach-the-fix |
| TW-141 | repo-a:.claude/rules/database.md, schema shape | Add columns first and a table only for row churn, because ownership never justifies a new table | port | rule:database.md#let-row-lifecycle-decide-a-new-table-never-ownership |
| TW-142 | same, display-text fields | Keep a display-text field as text unless something reads it; drop, because the heuristic is tied to one rendering stack | drop | n/a |
| TW-143 | repo-a:.claude/rules/design.md §Images | Author images through the framework pipeline with dimensions and a single eager hero; drop, because it is framework-specific and the byte check that verifies the outcome ports as TW-081 | drop | n/a |
| TW-144 | repo-a:db/NEON-CONTRACT.md | Repoint and deploy the consumer before dropping the producer's column, because merged-but-unshipped is a landmine | port | rule:deployment.md#repoint-and-deploy-the-consumer-before-dropping-the-producers-column |
| TW-145 | repo-a:scripts/lib/is-main.mjs | Replace the main-module guard that silently no-ops under unusual paths, and ship it with its own test | port | script:is-main.mjs |
| TW-146 | repo-a:.claude/rules/deployment.md | Deploy manually after the merge, because a PR merge is not a production update | port | rule:deployment.md#deploy-manually-after-the-merge-because-a-merge-is-not-a-production-update |
| TW-147 | repo-a:scripts/deploy.mjs | Chain the deploy sequence in one script so the order cannot drift, printing each step and exiting at the first failure by name | fold | rule:deployment.md#invoke-a-deploy-only-through-its-named-script |
| TW-148 | same, pre-flight and escape | Pre-flight the deploy with the guard chain and document its single escape hatch at every call site | fold | rule:deployment.md#chain-the-deploy-guards-before-building-anything-and-give-them-one-named-escape-hatch |
| TW-149 | repo-a:.claude/rules/deployment.md | Name the canonical runbook that other procedures should copy, rather than letting each invent its own | fold | rule:deployment.md#invoke-a-deploy-only-through-its-named-script |
| TW-150 | same | Never hardcode an environment-specific URL in a canonical tag | cross-ref | xref:rule:deployment.md -> EXT-046 |
| TW-151 | same, vendor quirks | Record a vendor quirk with its mitigation and the consequence of removing the mitigation | fold | rule:engineering.md#pin-a-framework-default-your-output-depends-on-with-the-reason-beside-it |
| TW-152 | same, edge override | Check the served file first when an edge setting can override a repo file, and verify after deploying with the command written inline | fold | rule:deployment.md#verify-the-deployed-url-against-the-built-file-with-the-cache-bypassed |
| TW-153 | same, platform toggles | Name the platform settings that must stay off with the observable symptom of each; drop, because it is vendor console detail | drop | n/a |
| TW-154 | same, link-preview runbook | Keep a diagnostic runbook that separates our failure from a third party's cached failure | handbook-only | chapter:deployment |
| TW-155 | same, build-record deploy | Require a pre-flight grep to return empty, then diff the live page against the committed file | fold | rule:deployment.md#verify-the-deployed-url-against-the-built-file-with-the-cache-bypassed |
| TW-156 | repo-a:.claude/settings.json | Keep the committed allowlist narrow and read-only, with the wide accreted list local, gitignored, and free of machine paths | port | rule:claude-code.md#keep-the-committed-settings-narrow-and-the-local-settings-local |
| TW-157 | repo-a:.claude/commands/* | Give a command a one-sentence description naming its exact inputs and filter | fold | rule:claude-code.md#make-a-procedure-a-skill-not-a-rule |
| TW-158 | repo-a:.claude/commands/bootstrap-candidate.md | State the model tier a procedure requires and stop if the session is below it | fold | rule:claude-code.md#set-the-model-explicitly-on-every-subagent-and-workflow-agent |
| TW-159 | same, cost constraint | State a cost constraint as a rule the procedure may not break | fold | rule:claude-code.md#set-the-model-explicitly-on-every-subagent-and-workflow-agent |
| TW-160 | same, approval | Never let the model approve its own work: status stays pending until a human moves it | fold | rule:llm-output.md#quarantine-model-output-until-a-human-moves-it |
| TW-161 | same, inline context | Carry review context inline with the row so a review step never has to resolve a path | fold | rule:llm-output.md#keep-a-deterministic-backbone-and-let-the-model-fill-the-slots |
| TW-162 | same, sibling naming | Name the sibling procedure and the structural blind spot each one fills | fold | rule:docs.md#split-a-file-only-when-splitting-narrows-what-loads |
| TW-163 | same, migration lineage | Record schema lineage inline so a stale table name in a prompt still resolves | fold | rule:database.md#write-forward-only-numbered-idempotent-migrations-each-opening-with-what-and-why |
| TW-164 | repo-a:.claude/skills/README.md | Keep a skill body short, references one level deep, a table of contents past a threshold, and a third-person description carrying trigger phrases | port | rule:claude-code.md#keep-a-skill-body-short-its-references-one-level-deep-and-its-name-equal-to-its-directory |
| TW-165 | same | Give a default with an escape hatch, not a menu of options, and assume the reader is smart | fold | rule:claude-code.md#keep-a-skill-body-short-its-references-one-level-deep-and-its-name-equal-to-its-directory |
| TW-166 | same | Keep time-sensitive facts out of a method | cross-ref | xref:rule:claude-code.md -> TW-011 |
| TW-167 | same, progressive disclosure | Disclose progressively: references read on demand, and scripts whose output alone enters context | fold | rule:claude-code.md#make-a-procedure-a-skill-not-a-rule |
| TW-168 | repo-a:.claude/skills/data-story/SKILL.md | Open a skill with what to read first, and name which file wins a conflict | fold | rule:claude-code.md#put-only-what-claude-would-get-wrong-without-it-in-the-root-file |
| TW-169 | same, opt-in gates | Make the later phases of a procedure explicit opt-in gates rather than an automatic continuation | fold | rule:claude-code.md#disable-model-invocation-on-a-skill-with-side-effects |
| TW-170 | repo-a:.claude/RESUME.md | Read a checkpoint file as a harness artifact, not as a handoff protocol | port | rule:claude-code.md#read-a-resume-file-as-a-harness-artifact-not-a-handoff |
| TW-171 | repo-a:.claude/launch.json | Name each dev configuration with its environment and its port, one per active checkout | port | template:launch.json |
| TW-172 | repo-a:.claude/worktrees/ | Keep the per-checkout scratch directory untracked and on the guard's allowed-dirty list | fold | script:deploy-guards.mjs |
| TW-173 | repo-a:docs/data-dictionary.md | Index the reference docs and say "start here, then follow the link" | fold | rule:docs.md#put-a-fact-where-its-litmus-test-says-it-belongs |
| TW-174 | repo-a:docs/finance-data-dictionary.md | Trace every published number to the source field it came from | handbook-only | chapter:docs |
| TW-175 | repo-a:turnout-model data dictionary | Log every assumption behind a modelled number, with its source and status | fold | rule:engineering.md#make-a-measuring-instrument-reproducible |
| TW-176 | repo-a:docs/impact-brief-writing-guide.md | Say outright when a method doc is project-agnostic and meant to be copied | fold | rule:docs.md#put-a-fact-where-its-litmus-test-says-it-belongs |
| TW-177 | repo-a:docs/data-stories/log.md | Register which slices have already been mined so a recut is not read as a new finding; drop, because it serves one analysis practice with no fleet surface | drop | n/a |
| TW-178 | repo-a:published data story README | Label a published dataset floor, not final, when later amendments will move it | fold | rule:engineering.md#show-the-ratio-and-the-sample-because-one-number-is-never-the-accuracy |
| TW-179 | repo-a:docs/match/design-history.md, head | Open the archive with a contract: point-in-time anchors, read each entry as a dated observation, and keep the rule in the rule file | fold | rule:docs.md#opt-a-point-in-time-doc-out-with-a-file-level-reason |
| TW-180 | same, index table | Title each archive entry as a one-line lesson and cite it from the rule by quoted heading | fold | rule:docs.md#state-a-rule-as-imperative-why-anchor-receipts |
| TW-181 | repo-a:docs/research/candidate-positions-brief.md | State supersession inside the doc that supersedes | cross-ref | xref:rule:docs.md -> SB-030 |
| TW-182 | repo-a:docs/postmortems/2026-06-02-results-blackout.md | Give a postmortem a fixed section spine that ends in a runbook | handbook-only | chapter:docs |
| TW-183 | repo-a:.claude/rules/council-meetings.md §Don't | Zero samples is a failure, not a pass | fold | rule:engineering.md#report-not-evaluable-and-not-measured-rather-than-a-fabricated-zero |
| TW-184 | repo-a:.claude/rules/entity-resolution.md | Being the only candidate is not evidence; require corroboration before treating a single match as settled | fold | rule:llm-output.md#cite-or-stay-silent |
| TW-185 | same | Said nothing is not said yes | cross-ref | xref:rule:llm-output.md -> TW-123 |
| TW-186 | repo-a:.claude/rules/content.md | Repoint a dead source, never delete it, and verify the replacement contains the cited claim rather than merely responding | fold | rule:llm-output.md#cite-or-stay-silent |
| TW-187 | repo-a:.claude/rules/build-record.md | Report limits without performing contrition: say what the reader can act on | handbook-only | chapter:docs |
| TW-188 | same | Teach every term at first use or cut it | handbook-only | chapter:docs |
| TW-189 | repo-a:.claude/rules/council-meetings.md §Don't | Filter before publishing a count, and state the denominator | cross-ref | xref:rule:engineering.md -> TW-124 |
| TW-190 | repo-a:.claude/rules/finance-pipeline.md | Two copies of one cascade drift, so keep one implementation on purpose | cross-ref | xref:rule:data-pipelines.md -> TW-077 |
| TW-191 | private survey (repo-a), the section marking this practice repo-specific | Editorial bright line and its equal-treatment gate; drop, because the promise is the product's, not a fleet convention | drop | n/a |
| TW-192 | same | Two-schema layout, editor role, CRUD surface, and named table registry contents; drop, because they are one instance of the ported least-privilege pattern | drop | n/a |
| TW-193 | same | Cloudflare and Astro platform specifics; drop, because they are vendor detail with no fleet-wide claim | drop | n/a |
| TW-194 | same | Domain pipelines, hardcoded local identifiers, and machine-local paths; drop, because they are domain content, not conventions | drop | n/a |
| TW-195 | same | The build record as an object; drop, because it is a personal artifact about the repo rather than a repo artifact | drop | n/a |
| TW-196 | repo-a:scripts/test-no-direct-master.sh, payload cases (testing sweep 2026-08-24) | Drive a test through the real entry point with a real payload, never through a helper that restates the rule, because two copies of one rule pass together whenever both are wrong | port | rule:testing.md#feed-a-real-payload-through-the-real-wiring-and-never-re-implement-the-logic-under-test |
| TW-197 | repo-a:email-snapshots/, .github/workflows/pr-checks.yml (testing sweep 2026-08-24) | Read the diff a snapshot gate prints, and say what changed, before accepting the new snapshot, because accepting it unread turns a drift gate into a rubber stamp | port | rule:testing.md#read-the-snapshot-diff-before-accepting-it-because-a-snapshot-is-a-drift-gate |
| TW-198 | repo-a:src/lib/results/**, scripts/council/** (testing sweep 2026-08-24) | Pin a check that depends on a live upstream to a recorded fixture inside the gate and run the live version on its own cadence, because a red that turns on someone else's uptime teaches the reader to ignore red | fold | rule:testing.md#quarantine-a-flaky-test-loudly-and-never-retry-it-into-silence |
| TW-199 | repo-a:.github/workflows/pr-checks.yml, stated scope (testing sweep 2026-08-24) | Record what the gate runs today and what it deliberately leaves ungated, so a later reader can tell an accepted gap from an oversight | handbook-only | chapter:testing |
| TW-200 | repo-a:.claude/rules/maintaining-docs.md §Anchor every UI/feature claim, worked example (phase 6 review 2026-08-24) | The Bad/Good example pair illustrating the anchor rule, written against real race-page section ids; drop, because the ids name repo-a's own page structure, would read as broken anchors on any other repo, and the abstract vocabulary they illustrate already ports as TW-003 | drop | n/a |

---

## repo-b (AG)

| ID | Source (path or path#heading) | Practice (one line, imperative) | Disposition | Destination |
| --- | --- | --- | --- | --- |
| AG-001 | repo-b:CLAUDE.md §What this is | Give a new subsystem its own path-scoped rule file rather than more of the root file | fold | rule:docs.md#split-a-file-only-when-splitting-narrows-what-loads |
| AG-002 | repo-b:CLAUDE.md §Domain rules | Make the root file a dispatch table carrying almost no domain content of its own | port | template:CLAUDE.md.skeleton |
| AG-003 | repo-b:.claude/rules/maintaining-docs.md §Anchor | Anchor every claim, not only every UI claim, to a grep-able token | cross-ref | xref:rule:docs.md -> TW-001 |
| AG-004 | same | A rule file without `paths:` is not unscoped, it is always-on at root-file priority; if it belongs in every session it belongs in the root file | fold | rule:claude-code.md#give-a-domain-rule-a-paths-list-and-never-leave-a-rule-file-unscoped |
| AG-005 | same | Require each `paths:` glob's first non-glob segment to resolve | cross-ref | xref:rule:docs.md -> TW-004 |
| AG-006 | same §Targets | Hold the same line targets for root file, rule files, and README | cross-ref | xref:rule:docs.md -> TW-013 |
| AG-007 | same | Cut, don't append | cross-ref | xref:rule:docs.md -> TW-014 |
| AG-008 | same | Trim on a cadence, and accept that finding no candidate is a valid outcome | cross-ref | xref:rule:docs.md -> TW-014 |
| AG-009 | same §Durable rules link their receipts | End a rule with a receipts pointer to the design-history entry by quoted heading | cross-ref | xref:rule:docs.md -> TW-010 |
| AG-010 | same | Move a rule that needs a date, a name, or a measured number into history | cross-ref | xref:rule:docs.md -> TW-011 |
| AG-011 | same §Archive tier | Scan the archive tier by default and let a point-in-time file opt out at file level, with the reason stated | port | rule:docs.md#opt-a-point-in-time-doc-out-with-a-file-level-reason |
| AG-012 | same, plugin note | Do not adopt a tool whose default habit is appending session learnings to the root file | handbook-only | chapter:docs |
| AG-013 | same, bloat smells | Cut any paragraph that exists to record that something happened rather than to change what Claude does next | fold | rule:docs.md#cut-dont-append-and-trim-on-a-fixed-cadence |
| AG-014 | same §When a topic outgrows one file | Pick the escape valve by what is squeezing: rules split into a path-scoped directory, history moves to the archive with one-hop links | port | rule:docs.md#split-a-file-only-when-splitting-narrows-what-loads |
| AG-015 | same | Never split a topic that reads as one thing: two files that always load together are strictly worse than one | fold | rule:docs.md#split-a-file-only-when-splitting-narrows-what-loads |
| AG-016 | repo-b:tests/docs-drift-rules.test.mjs | Discover rule files recursively and pin the recursion with a test | generalize | script:check.mjs |
| AG-017 | repo-b:scripts/check-docs-drift.mjs | Enumerate documents from the tracked file list so a new doc is covered the moment it is tracked | generalize | script:check.mjs |
| AG-018 | same | Build the path-prefix list at runtime from the tree, so a new top-level directory needs no script edit | generalize | script:check.mjs |
| AG-019 | repo-b:.claude/hooks/no-direct-master.sh | Fail the guard closed when a dependency is missing, emitting a hand-written deny rather than crashing into "no decision" | port | script:no-direct-master.sh |
| AG-020 | same | Isolate the push clause at the next separator so an unrelated later command is not judged with it | port | script:no-direct-master.sh |
| AG-021 | same | Parse both the directory-flag form and the change-directory forms, including the semicolon variant | fold | script:no-direct-master.sh |
| AG-022 | same, `EXEMPT_REPOS` | Match an exemption on the canonical toplevel path, keep the list short, and record the justification in the file | port | script:no-direct-master.sh |
| AG-023 | same, cross-repo scope | State that a user-scope guard reaches every repo the session touches, including repos it was not written for | handbook-only | chapter:github |
| AG-024 | same, stated why | Say which protection is real: where the platform gives no server-side branch protection, the hook and the deploy guards are the protection | fold | script:no-direct-master.sh |
| AG-025 | repo-b:.claude/settings.json | Allowlist the repo's own script surface plus read-side platform commands, and nothing broader | fold | rule:claude-code.md#keep-the-committed-settings-narrow-and-the-local-settings-local |
| AG-026 | repo-b:.claude/settings.local.json | Prune the local allowlist periodically, because a broad accreted grant supersedes the careful narrow ones | fold | rule:claude-code.md#keep-the-committed-settings-narrow-and-the-local-settings-local |
| AG-027 | repo-b:.claude/commands/new-tool.md | Split pure logic out of markup first, because untested logic buried in a template is what the procedure exists to prevent | fold | rule:engineering.md#build-the-simplest-thing-that-answers-the-question |
| AG-028 | repo-b:.claude/skills/okr-coach/ | Keep a deterministic backbone (process as data, constants in config, arithmetic in code) and let the model supply judgment | port | rule:llm-output.md#keep-a-deterministic-backbone-and-let-the-model-fill-the-slots |
| AG-029 | same, session retrospective step | Hold a high bar for a lesson: "no lesson today" is the correct output most sessions, and a real one becomes a named edit shipped as a PR | port | rule:llm-output.md#report-no-finding-rather-than-manufacture-one |
| AG-030 | repo-b:.claude/skills/drafting-in-notion/SKILL.md | Freeze numbered drafts, keep the human's authored spans immutable without an itemized before-and-after, and check the decision ledger before publishing | fold | rule:llm-output.md#reword-a-locked-claim-never-strengthen-it |
| AG-031 | repo-b:.claude/skills/gtm-brain/SKILL.md | An answer without a quote is a bug, and "not in corpus" is a required output | fold | rule:llm-output.md#cite-or-stay-silent |
| AG-032 | same | Verify every quote mechanically rather than trusting the generation | fold | rule:llm-output.md#cite-or-stay-silent |
| AG-033 | repo-b:.worktreeinclude | Keep the shared-file list deliberately empty, make each entry earn its place, and record removals with the reasoning | port | template:.worktreeinclude |
| AG-034 | same, secret-spread note | Do not spread a secret across checkouts for a convenience the checkout does not need | fold | template:.worktreeinclude |
| AG-035 | repo-b:CLAUDE.md, shared git state | Treat git state as shared across sessions: a checkout elsewhere can move your branch mid-run and strand uncommitted work | port | rule:claude-code.md#treat-git-state-as-shared-across-sessions |
| AG-036 | repo-b:.github/workflows/pr-checks.yml | Run everything CI runs from one local command before opening the PR | fold | rule:github.md#gate-every-pr-on-checks-that-need-no-credential-and-name-what-is-not-gated |
| AG-037 | same, canary step | Write obviously fake credentials before the build and scan the output afterwards, so a scrub regression fails the PR | port | rule:github.md#scan-the-built-output-after-scrubbing-the-build-and-plant-a-canary-to-prove-the-scanner-fires |
| AG-038 | repo-b:scripts/scan-dist-secrets.mjs | Give the scanner a self-test mode that proves detection fires against a planted canary using no real secret | port | script:scan-dist-secrets.mjs |
| AG-039 | repo-b:.claude/rules/deployment.md | Chain four guards before any build: clean branch at origin, account pinned, CI green with zero runs failing closed, and PR provenance | port | rule:deployment.md#chain-the-deploy-guards-before-building-anything-and-give-them-one-named-escape-hatch |
| AG-040 | same | Chain the guards before building anything, so a refusal never wastes a build | fold | rule:deployment.md#chain-the-deploy-guards-before-building-anything-and-give-them-one-named-escape-hatch |
| AG-041 | same | Scrub the build environment and hide the secrets file from disk during the build, because the adapter reads the file directly | fold | rule:github.md#scan-the-built-output-after-scrubbing-the-build-and-plant-a-canary-to-prove-the-scanner-fires |
| AG-042 | same, auto-mode caveat | Expect an allow-listed production deploy to be classifier-blocked in an automatic mode, and give explicit intent instead of routing around it | fold | rule:claude-code.md#disable-model-invocation-on-a-skill-with-side-effects |
| AG-043 | repo-b:.claude/rules/revops.md | Drive writes from a policy registry that is the only writable field set and fails closed on an unknown policy | port | rule:data-pipelines.md#drive-writes-from-a-policy-registry-that-fails-closed-on-an-unknown-policy |
| AG-044 | same | Match deterministically and never let an ambiguous case match | cross-ref | xref:rule:data-pipelines.md -> SB-020 |
| AG-045 | same | Gate deletion behind one script, one call site, its own breadcrumb, and a dry-run default | fold | rule:data-pipelines.md#default-to-a-dry-run-and-require-an-explicit-flag-to-write |
| AG-046 | same, prune brake | Refuse to delete more than a set share of rows in one run, with an explicit force flag to override | port | rule:data-pipelines.md#brake-a-prune-at-a-share-of-the-table-and-unit-test-the-brake |
| AG-047 | same | Stamp a timestamp only on substantive change, so an unchanged record writes nothing | port | rule:data-pipelines.md#write-nothing-when-a-record-is-unchanged |
| AG-048 | same | Key human-authored and derived tuning tables separately so they survive every rebuild | fold | rule:database.md#let-row-lifecycle-decide-a-new-table-never-ownership |
| AG-049 | repo-b:.claude/rules/network-etl.md | The machine may not vouch for its own guess: the first dry run may admit nobody, and human review files are never overwritten | fold | rule:llm-output.md#quarantine-model-output-until-a-human-moves-it |
| AG-050 | repo-b:.claude/rules/brain/corpus.md | Make the ledger the idempotency contract: a new content hash means re-ingest | fold | rule:data-pipelines.md#make-a-pipeline-idempotent-and-resumable-and-log-the-idempotency-rather-than-assume-it |
| AG-051 | repo-b:.claude/rules/brain/retrieval.md | Keep an eval yardstick file and run QA gates before trusting a batch | fold | rule:engineering.md#prove-a-check-can-fail-before-trusting-that-it-passed |
| AG-052 | repo-b:.claude/rules/console/app.md | Make offline development the default posture, so the common path needs no live backing service | fold | rule:engineering.md#build-the-simplest-thing-that-answers-the-question |
| AG-053 | repo-b:okrs/README.md | Treat a closed cycle as a record, not a draft: a new cycle is a sibling directory, and resolution fails closed on a missing set | fold | rule:docs.md#opt-a-point-in-time-doc-out-with-a-file-level-reason |
| AG-054 | same | Report drift against a source-of-truth document as a warning, not a failure, when the local copy is only a worksheet | fold | rule:engineering.md#report-not-evaluable-and-not-measured-rather-than-a-fabricated-zero |
| AG-055 | repo-b:lib/plan-okr-sync.mjs | Back a fallible prose instruction with a machine check that reports every value that moved between revisions | fold | rule:engineering.md#prove-a-check-can-fail-before-trusting-that-it-passed |
| AG-056 | repo-b:okrs/2026-q3/okrs.md, amendments | Open a change entry by saying plainly whether the substance moved, then what changed and what is still open | fold | rule:docs.md#ship-the-docs-and-changelog-edit-in-the-same-pr-as-the-change |
| AG-057 | repo-b:.claude/rules/learning.md | Additions displace: a living document trades new material against old rather than accumulating | fold | rule:docs.md#cut-dont-append-and-trim-on-a-fixed-cadence |
| AG-058 | repo-b:docs/secondarrow-site.md | Open a forward-looking spec with a file-level opt-out and its reason, since its paths are deliberate forward references | fold | rule:docs.md#opt-a-point-in-time-doc-out-with-a-file-level-reason |
| AG-059 | repo-b:docs/runbooks/recovery.md | Write the recovery runbook for the store that has no second copy anywhere | handbook-only | chapter:database |
| AG-060 | repo-b:CLAUDE.md §Contributing workflow | Keep private financial and personal material out of any published surface; drop, because it is a repo-private content policy with no fleet-wide surface | drop | n/a |
| AG-061 | repo-b:.claude/rules/*, whole set | End every rule file with a `## Don't` section | fold | rule:docs.md#state-a-rule-as-imperative-why-anchor-receipts |
| AG-062 | private survey (repo-b), §12 D13 | Decide whether a changelog is core or opt-in for a repo with no external audience | handbook-only | chapter:docs |
| AG-063 | same §12 D9 | Verify per repo whether server-side branch protection actually exists, because two hooks encoded contradictory threat models | handbook-only | chapter:github |
| AG-064 | same §13, item 9 | Keep judgment with the human and bookkeeping in code, so nothing is re-derived from memory | cross-ref | xref:rule:llm-output.md -> AG-028 |
| AG-065 | repo-b:auto-memory index (memory-index audit 2026-08-29) | Keep the auto-memory index to one cue line per memory and hold it under its load ceiling, moving any fact it is the only copy of into the topic file before the line shortens | port | rule:claude-code.md#keep-the-auto-memory-index-to-hooks-and-hold-it-under-its-cap |

---

## repo-c (AS)

| ID | Source (path or path#heading) | Practice (one line, imperative) | Disposition | Destination |
| --- | --- | --- | --- | --- |
| AS-001 | repo-c:CLAUDE.md, whole file | Keep the root file short enough to sit well under its own target | cross-ref | xref:rule:docs.md -> TW-013 |
| AS-002 | repo-c:CLAUDE.md §Build-time guards | Make build-time guards a first-class root-file section that names each guard and the silent failure it prevents | port | rule:engineering.md#land-a-build-time-guard-with-the-code-it-protects |
| AS-003 | same | Land a guard with the code it protects, not before | fold | rule:engineering.md#land-a-build-time-guard-with-the-code-it-protects |
| AS-004 | same | Guards exist for a class of failure that renders fine, builds green, and is invisible to review | fold | rule:engineering.md#land-a-build-time-guard-with-the-code-it-protects |
| AS-005 | repo-c:CLAUDE.md, inline ignore | Use the per-line ignore inside the root file itself when an example must not resolve as a path | cross-ref | xref:rule:docs.md -> TW-006 |
| AS-006 | repo-c:.claude/rules/maintaining-docs.md | Show a bad and good pair for the anchor rule, so the rule is legible without the linter; drop, because a house rule file admits a claim, a why, an `Anchor:` line, and a `Receipts:` pointer and nothing else, so a worked example pair has no legal place in one, and the legibility it buys is carried instead by the chapter's narration of repo-c's pair and by the checker's own finding line, which names the failing token and now closes with the three ways to fix it | drop | n/a |
| AS-007 | same | Document the escape hatch's parsing quirk, since only the closing marker terminates the reason text | fold | rule:docs.md#opt-a-point-in-time-doc-out-with-a-file-level-reason |
| AS-008 | same §Archive tier | Say honestly that the archive tier is empty until a domain earns one | fold | rule:docs.md#opt-a-point-in-time-doc-out-with-a-file-level-reason |
| AS-009 | repo-c:.claude/rules/*, heading style | Write every rule heading as an imperative whose text is the rule | fold | rule:docs.md#state-a-rule-as-imperative-why-anchor-receipts |
| AS-010 | repo-c:.claude/rules/services.md | Store a link with its provenance, never infer it, and never collapse two roles that differ | port | rule:database.md#treat-provenance-columns-as-behavior |
| AS-011 | repo-c:.claude/rules/database.md | Write forward-only numbered migrations with no down-migrations, because the fix for a bad migration is the next migration | port | rule:database.md#write-forward-only-numbered-idempotent-migrations-each-opening-with-what-and-why |
| AS-012 | same | Open every migration file with a comment saying what it is for and why, for the reader a year later | fold | rule:database.md#write-forward-only-numbered-idempotent-migrations-each-opening-with-what-and-why |
| AS-013 | same | Treat provenance columns as load-bearing behavior: a manual provenance is never overwritten by a sync | fold | rule:database.md#treat-provenance-columns-as-behavior |
| AS-014 | same | Store money as integer cents and ban the floating-point type | port | rule:database.md#store-money-as-integer-cents-and-reconcile-against-the-books |
| AS-015 | same | Put a scoping key on every scoped table and roll forward by inserting rows under a new key, never by migration or truncate | fold | rule:database.md#let-row-lifecycle-decide-a-new-table-never-ownership |
| AS-016 | repo-c:.claude/rules/stripe.md | Give a restricted key exactly one writable scope, read the scopes on a dated day, and cross-check with a live probe of every resource | port | rule:github.md#give-a-restricted-key-exactly-one-writable-scope |
| AS-017 | same | Derive fees from the authoritative object, never from arithmetic | fold | rule:database.md#store-money-as-integer-cents-and-reconcile-against-the-books |
| AS-018 | same | Make the sync idempotent and resumable | cross-ref | xref:rule:data-pipelines.md -> TW-101 |
| AS-019 | same, repo-c:docs/DATA-POLICY.md | Never log a customer, charge, or row object, because the leak path is observability | port | rule:github.md#never-log-a-vendor-object |
| AS-020 | repo-c:.claude/rules/finance.md | Make unmapped input loud: fail a build gate when input lands in no bucket above a threshold | port | rule:data-pipelines.md#make-unmapped-input-loud |
| AS-021 | same | Reconcile against an external ground truth as the correctness gate, and do not trust the sync until the figures tie out | fold | rule:database.md#store-money-as-integer-cents-and-reconcile-against-the-books |
| AS-022 | repo-c:.claude/rules/sheets.md | Parse an external tabular source by header, never by position | fold | rule:data-pipelines.md#make-unmapped-input-loud |
| AS-023 | same | Pre-commit the contract for a hypothetical write path: a dry-run diff a human reads first, and an audit row per write | fold | rule:data-pipelines.md#default-to-a-dry-run-and-require-an-explicit-flag-to-write |
| AS-024 | repo-c:.claude/rules/deployment.md | Cover every route with the auth policy and allow zero bypasses, verifying by hand with an unauthenticated request after any change | fold | rule:github.md#treat-a-preview-url-as-production-for-exposure |
| AS-025 | same | Set secrets through the platform's secret command only, never in a config file, never in the repo, never pasted into a session | fold | rule:github.md#keep-credentials-out-of-the-repo-the-commit-and-the-chat |
| AS-026 | same | A preview URL not behind the same policy is the same leak as production | port | rule:github.md#treat-a-preview-url-as-production-for-exposure |
| AS-027 | repo-c:docs/BACKUP.md | A backup that has never been restored is not a backup, so document the restore test and its cadence | port | rule:deployment.md#restore-a-backup-before-calling-it-a-backup |
| AS-028 | repo-c:CLAUDE.md, verify the render | Show the real data before merging anything that changes a report, because a report that renders beautifully and is quietly wrong is the failure that matters | fold | rule:engineering.md#verify-the-served-artifact-not-the-source |
| AS-029 | repo-c:README.md | Don't document a command that does not exist yet; a README that tells you to run a missing command is worse than a short one | port | rule:docs.md#dont-document-a-command-that-does-not-exist |
| AS-030 | repo-c:CLAUDE.md §Don't | Send an unresolved row to a review surface and never guess it | cross-ref | xref:rule:data-pipelines.md -> TW-128 |
| AS-031 | repo-c:.claude/hooks/no-direct-master.sh | Tailor the guard's deny message to teach the correct next command inline | fold | script:no-direct-master.sh |
| AS-032 | repo-c:scripts/test-no-direct-master.sh, pr-checks.yml | Run the guard's own test as its own CI step, because code that guards the workflow deserves a test more than most | port | rule:testing.md#test-the-guard-itself-as-its-own-ci-step |
| AS-033 | repo-c:.claude/settings.json | Allow-list a forward-declared script before it exists so the first run needs no prompt | fold | rule:claude-code.md#keep-the-committed-settings-narrow-and-the-local-settings-local |
| AS-034 | repo-c:.claude/settings.json, hook entry | Do not rely on a best-effort matcher filter to scope a hook; match broadly and decide in the script | fold | rule:claude-code.md#make-a-must-hold-rule-a-hook-fail-it-closed-and-test-it-with-real-payloads |
| AS-035 | repo-c:.github/workflows/pr-checks.yml | Set read-only permissions with a written rationale on the workflow | cross-ref | xref:rule:github.md -> TW-054 |
| AS-036 | same | Carry a "deliberately not gated here" block naming what is excluded and why | cross-ref | xref:rule:github.md -> TW-060 |
| AS-037 | same | Trigger the PR gate on pull requests only, rather than also on pushes to the protected branch that bill twice | fold | template:pr-checks.yml |
| AS-038 | repo-c:.github/PULL_REQUEST_TEMPLATE.md | Force the docs check as a binary: either the docs edit is included, or a reason is written | port | rule:github.md#make-the-pr-template-force-a-docs-check-answer |
| AS-039 | repo-c:CLAUDE.md §Contributing workflow | Allow a standalone docs PR when there is no code change at all | fold | rule:docs.md#ship-the-docs-and-changelog-edit-in-the-same-pr-as-the-change |
| AS-040 | repo-c:CLAUDE.md §Worktree tiers | Name the two tiers with their exact commands, the slash-to-dash naming convention, per-worktree install, and a port ladder | cross-ref | xref:template:CLAUDE.md.skeleton -> TW-051 |
| AS-041 | repo-c:.claude/skills/README.md | Open a reference file over a threshold with a table of contents, so a partial read still shows scope | fold | rule:claude-code.md#keep-a-skill-body-short-its-references-one-level-deep-and-its-name-equal-to-its-directory |
| AS-042 | same | Never chain reference to reference, because a nested file is partially read | fold | rule:claude-code.md#keep-a-skill-body-short-its-references-one-level-deep-and-its-name-equal-to-its-directory |
| AS-043 | same | Keep skills on the docs workflow, not a code deploy | fold | rule:docs.md#ship-the-docs-and-changelog-edit-in-the-same-pr-as-the-change |
| AS-044 | same, live drift bug | A skills README that cites a worked example the repo does not have is drift the doc gate must catch | generalize | script:check.mjs |
| AS-045 | repo-c:docs/GLOSSARY.md | Gate model code on reading the glossary, so nobody reverse-engineers the vocabulary from a notes column | handbook-only | chapter:docs |
| AS-046 | repo-c:docs/DATA-POLICY.md | Name the containment layers and say honestly what the policy does not cover | handbook-only | chapter:github |
| AS-047 | repo-c:docs/exploration-playbook.md | Keep the original worked examples when porting a method, because the moves transfer and the tables do not | fold | rule:docs.md#put-a-fact-where-its-litmus-test-says-it-belongs |
| AS-048 | repo-c:.claude/rules/database.md | Contrast a technology choice with the sibling repo's different choice, so the reason is legible | handbook-only | chapter:database |

---

## repo-d (SB)

| ID | Source (path or path#heading) | Practice (one line, imperative) | Disposition | Destination |
| --- | --- | --- | --- | --- |
| SB-001 | repo-d:CLAUDE.md:451 | Ship the docs edit in the same branch as the change that adds or renames a script, env var, command, or maintenance step | cross-ref | xref:rule:docs.md -> TW-046 |
| SB-002 | repo-d:CLAUDE.md:452 | Append a changelog entry for anything the repo's readers would notice, and leave refactors in git history | cross-ref | xref:rule:docs.md -> TW-047 |
| SB-003 | repo-d:CLAUDE.md:453 | Run the docs gate before opening a docs or script PR | cross-ref | xref:rule:docs.md -> TW-007 |
| SB-004 | repo-d:README.md, GUIDE.md, plan.md | Split doc roles explicitly: working rules, human runbook, strategy, changelog, deep references, orientation | fold | rule:docs.md#put-a-fact-where-its-litmus-test-says-it-belongs |
| SB-005 | repo-d:CLAUDE.md, rule shape | Write each rule as claim, mechanism, why, and the hazard it prevents | fold | rule:docs.md#state-a-rule-as-imperative-why-anchor-receipts |
| SB-006 | repo-d:CLAUDE.md, dated amendments | Let every hazard line carry the date or outage that produced it, so a reader can tell which rules are load-bearing | handbook-only | chapter:docs |
| SB-007 | private survey (repo-d), §2, gap note | A single unscoped root file with no length discipline makes every session pay the full file | handbook-only | chapter:claude-code |
| SB-008 | repo-d:.githooks/pre-commit | Refuse to stage sensitive data or secrets at commit time, with an explicit allow-list of legitimate exceptions and a documented bypass | port | template:pre-commit |
| SB-009 | same, install step | Point the hooks path at the tracked hooks directory once per clone, and document the step | fold | template:pre-commit |
| SB-010 | repo-d:.claude/launch.json | Give the harness one named dev-server configuration and port instead of per-session improvisation | cross-ref | xref:template:launch.json -> TW-171 |
| SB-011 | repo-d:.claude/settings.json | Allow-list exactly the repo's own read and idempotent pipeline commands, and authorize deploy and egress verbs through the skill instead | fold | rule:claude-code.md#keep-the-committed-settings-narrow-and-the-local-settings-local |
| SB-012 | repo-d:.claude/settings.local.json | Allow-list network fetches per domain rather than blanket, and pin service enablement per project | fold | rule:claude-code.md#keep-the-committed-settings-narrow-and-the-local-settings-local |
| SB-013 | same, stale entries | Prune one-off approvals and paths left over from a rename | cross-ref | xref:rule:claude-code.md -> AG-026 |
| SB-014 | repo-d:.claude/skills/merge-and-deploy/SKILL.md | Shape a ship skill as pre-flight, push and PR, merge, fast-forward, ordered deploy, cleanup, and a report of what shipped | handbook-only | chapter:claude-code |
| SB-015 | same §Multi-session reality | Never ship from a main checkout another session occupies; deploy from the merged worktree instead | fold | rule:claude-code.md#check-for-a-peer-session-before-driving-shared-external-state |
| SB-016 | same | When a merge succeeded remotely but the local state disagrees, verify the PR state before retrying rather than merging twice | fold | rule:github.md#classify-a-merged-branch-by-its-pr-state-not-by-merge-detection |
| SB-017 | same §Hazards | Give a ship procedure a hazards section naming what has actually gone wrong | fold | rule:claude-code.md#make-a-procedure-a-skill-not-a-rule |
| SB-018 | repo-d:CLAUDE.md:459 | Treat a long-running pipeline run you do not want to interrupt as a first-class reason for a worktree, and seed the gitignored state it needs | fold | template:CLAUDE.md.skeleton |
| SB-019 | repo-d:scripts/cleanup-worktree.sh | Kill processes by absolute worktree path, refuse to remove the current checkout, and print the remote delete rather than running it | fold | script:cleanup-worktree.sh |
| SB-020 | repo-d:.claude/skills/intel-enrichment/SKILL.md, CLAUDE.md | Name, don't act, on ambiguous data: hold when identity is uncertain, report duplicates for a human to merge, and write down the cost asymmetry that justifies holding | port | rule:data-pipelines.md#name-dont-act-on-ambiguous-data |
| SB-021 | repo-d:.github/workflows/attio-neon-sync.yml | Offset a cron off the top of the hour, set a timeout, and choose non-cancelling concurrency for a job that must finish | port | template:pr-checks.yml |
| SB-022 | same, secrets guard | Fail loudly on a missing secret before any lane runs, rather than midway through | fold | rule:github.md#gate-every-pr-on-checks-that-need-no-credential-and-name-what-is-not-gated |
| SB-023 | same, ordering | Apply migrations before the lanes that read them, and let independent downstream lanes still run after a transient failure | fold | rule:deployment.md#migrate-before-deploying-the-code-that-reads-the-schema |
| SB-024 | same, non-failing report | Keep a read-only data-quality report deliberately non-failing, and say so in a comment, so a data finding never turns the run red | fold | rule:github.md#open-an-issue-instead-of-failing-a-scheduled-run-and-comment-out-a-cron-with-its-reason |
| SB-025 | repo-d:check-docs.mjs | Exclude a line that is talking about another repo from the anchor check | generalize | script:check.mjs |
| SB-026 | repo-d:migrations/001_schema.sql | Keep a baseline migration that replays idempotently and is edited in place, with a separate retire file for drops | fold | rule:database.md#write-forward-only-numbered-idempotent-migrations-each-opening-with-what-and-why |
| SB-027 | repo-d:docs/neon-tables.md | Keep a table registry of purpose, writer, readers, and data class, so the next review starts from a lookup rather than archaeology | fold | rule:database.md#add-the-table-registry-line-in-the-same-pr-as-the-migration |
| SB-028 | repo-d:db/connection.mjs, CLAUDE.md | Give each initiative its own least-privilege role and its own env file, and never cross the streams | port | rule:database.md#give-each-initiative-its-own-least-privilege-role |
| SB-029 | repo-d:CLAUDE.md, wrangler trap | Invoke a deploy only through its named script, because the tool walks up the tree and a stray root config can ship an ungated service | port | rule:deployment.md#invoke-a-deploy-only-through-its-named-script |
| SB-030 | repo-d:docs/cloud-native-architecture.md | Head a superseded doc with a dated banner naming exactly what the implementation did instead, rather than deleting it | fold | rule:docs.md#opt-a-point-in-time-doc-out-with-a-file-level-reason |
| SB-031 | repo-d:npm run ship | Order the ship so the schema lands before the code, and give the fast path a written test for when it is provably safe | port | rule:deployment.md#migrate-before-deploying-the-code-that-reads-the-schema |
| SB-032 | same, success markers | Enumerate the success markers a run must print, so "it worked" is checkable | fold | rule:deployment.md#verify-the-deployed-url-against-the-built-file-with-the-cache-bypassed |
| SB-033 | repo-d:CLAUDE.md, parity diff | Require a byte-identical parity diff of the derived output when changing a scoring formula | fold | rule:engineering.md#make-a-measuring-instrument-reproducible |
| SB-034 | repo-d:.claude/skills/intel-enrichment/SKILL.md, accuracy quarantine | Generate into an untracked directory and let a human move the file into the tracked one, so the move is the sign-off | port | rule:llm-output.md#quarantine-model-output-until-a-human-moves-it |
| SB-035 | same, refuters | Refute with named lenses, tier the number of passes by stakes, drop by default, and log every drop so the loss is visible | port | rule:llm-output.md#refute-with-named-lenses-drop-by-default-and-log-the-drops |
| SB-036 | same, evidence gate | Allow no claim without non-empty evidence, and let identity confidence cap or forbid whole output classes | port | rule:llm-output.md#cite-or-stay-silent |
| SB-037 | same, confidence | Round confidence down, never up | fold | rule:llm-output.md#cite-or-stay-silent |
| SB-038 | repo-d:lib/intel-validate.mjs | Require a mechanical validation, including a sensitive-data pattern check, to exit clean before anything syncs | fold | rule:llm-output.md#gate-output-on-status-tags |
| SB-039 | repo-d:CLAUDE.md, idempotency per lane | Name the idempotency contract per lane: delta-only, append-only with a client-supplied key, conflict-do-nothing, or immutable once dispatched | fold | rule:data-pipelines.md#make-a-pipeline-idempotent-and-resumable-and-log-the-idempotency-rather-than-assume-it |
| SB-040 | repo-d:config/attio-payload.json, CLAUDE.md | Do not edit a policy value to describe behavior; a typo in a policy string silently stops a lane | fold | rule:data-pipelines.md#drive-writes-from-a-policy-registry-that-fails-closed-on-an-unknown-policy |
| SB-041 | repo-d:publish-voters.mjs | Refuse a publish that would delete more than a set share of rows, and unit-test the brake rule | cross-ref | xref:rule:data-pipelines.md -> AG-046 |
| SB-042 | repo-d:CLAUDE.md §PII | Keep the built client code-only and fail the build on any embedded personal data | fold | rule:github.md#scan-the-built-output-after-scrubbing-the-build-and-plant-a-canary-to-prove-the-scanner-fires |
| SB-043 | same | Name the real guard and call the hook a backstop, rather than claiming the backstop is the protection | fold | template:pre-commit |
| SB-044 | repo-d:CLAUDE.md §Don't | Say when a repo declines an upstream editorial rule and why | port | template:CLAUDE.md.skeleton |
| SB-045 | repo-d:.gitignore | Explain a non-obvious ignore rule in a comment, especially an anchored one | fold | rule:engineering.md#pin-a-framework-default-your-output-depends-on-with-the-reason-beside-it |
| SB-046 | repo-d:git log, commit types | Use a dedicated commit type for applied review findings; drop, because commit-message taxonomy is below the level this package governs | drop | n/a |
| SB-047 | repo-d:.claude/worktrees/ | A directory the skill describes but the convention contradicts is stale; delete one of them; drop, because it is one repo's housekeeping, and its general form (walk each documented path against the repo's real state and fix the contradiction in the same pull request rather than filing it) is already ported at rule:docs.md#dont-document-a-command-that-does-not-exist | drop | n/a |
| SB-048 | repo-d:docs/org-identity-model.md | Model committee versus legal entity as distinct identities; drop, because it is domain data modelling with no fleet-wide claim | drop | n/a |
| SB-049 | repo-d:.claude/skills/intel-enrichment/SKILL.md, wave shape | Record the wave shape a generated-content pipeline settled on: scope, evidence bundles, drafts, adversarial fact-check, mechanical validation, human review gate, commit, sync, ship | handbook-only | chapter:llm-output |

---

## repo-e (RT)

| ID | Source (path or path#heading) | Practice (one line, imperative) | Disposition | Destination |
| --- | --- | --- | --- | --- |
| RT-001 | repo-e:CLAUDE.md §Repository topology | Distribute a skill by symlinking one canonical checkout, with the constraint reasoning and the recreate command written down; drop, because the topology is specific to a repo that is itself a skill | drop | n/a |
| RT-002 | same, hot-reload caveat | State when a change is picked up, because a skill edit lands only on the next start | fold | rule:claude-code.md#make-a-procedure-a-skill-not-a-rule |
| RT-003 | repo-e:CLAUDE.md §Git worktree workflow | Detect an existing worktree before creating one, and continue in it rather than duplicating | fold | template:CLAUDE.md.skeleton |
| RT-004 | repo-e:CLAUDE.md:43 | Allow a direct-to-branch policy when the repo genuinely has no CI, no deploy, and no second contributor, and record the reasoning | port | schema |
| RT-005 | same:44-52 | Record the dated reversal when a foreign repo's guard silently changed this repo's workflow, and scope the guard rather than retire it | handbook-only | chapter:github |
| RT-006 | repo-e:CLAUDE.md §Deliberate deviations | Keep a per-repo deviations section, dated, naming what the repo declines from upstream and why | port | template:CLAUDE.md.skeleton |
| RT-007 | repo-e:SKILL.md §Non-negotiables | Allow no claim that is not in the source bank or explicitly confirmed in session, with no exception for plausible filler | fold | rule:llm-output.md#cite-or-stay-silent |
| RT-008 | same, locked claims | Reword a locked claim to mirror the target's vocabulary, but never strengthen the claim, the metric, the scope, or the verb | port | rule:llm-output.md#reword-a-locked-claim-never-strengthen-it |
| RT-009 | same, status tags | Gate output on status tags, with a dated promotion ritual that edits the source when a fact is confirmed | port | rule:llm-output.md#gate-output-on-status-tags |
| RT-010 | same, near misses | Turn a near miss into a question, never an insertion, and check it instead of carrying it forward when it is mechanically checkable | fold | rule:llm-output.md#cite-or-stay-silent |
| RT-011 | same, approval gate | Generate no file before the user approves the diff, because silence is not approval | port | rule:llm-output.md#treat-silence-as-not-approval |
| RT-012 | same, gaps | Report an unmet requirement in a gap report rather than papering over it | fold | rule:llm-output.md#report-no-finding-rather-than-manufacture-one |
| RT-013 | repo-e:conflict_ledger.md | Keep an append-only numbered dated ruling ledger; a ruled value is canonical, an unruled one stays flagged and blocked from output | fold | rule:engineering.md#record-a-significant-decision-as-a-numbered-immutable-record |
| RT-014 | same, supersession | Supersede a ruling by number with a visible marker, never by editing the original | fold | rule:engineering.md#record-a-significant-decision-as-a-numbered-immutable-record |
| RT-015 | repo-e:scripts/score_resume.py | State the judgment and determinism split as architecture, and label which dimensions are which in the output | fold | rule:llm-output.md#keep-a-deterministic-backbone-and-let-the-model-fill-the-slots |
| RT-016 | same, honesty note | Attach the caveat to the number so the number cannot travel without its limits | fold | rule:engineering.md#show-the-ratio-and-the-sample-because-one-number-is-never-the-accuracy |
| RT-017 | repo-e:resume_instructions.md:19 | A page count is not a render check: assert the new content present and the old absent, and normalize both sides before asserting | fold | rule:engineering.md#verify-the-served-artifact-not-the-source |
| RT-018 | same | When a check cannot run, say so and reason about the risk; never imply a check that did not run | fold | rule:engineering.md#report-not-evaluable-and-not-measured-rather-than-a-fabricated-zero |
| RT-019 | repo-e:check_pagefit.py | Demote a gate that has been wrong before: keep the false-positive tally inside the checker and make its verdict advisory | port | rule:engineering.md#demote-a-gate-that-has-been-wrong-before |
| RT-020 | repo-e:resume_instructions.md, re-read ruling | Re-read the source immediately before use, not once at session start, because a ruling can land mid-session | fold | rule:claude-code.md#plan-when-the-approach-is-uncertain-and-clear-the-context-after-two-failed-corrections |
| RT-021 | same, peer-session pre-check | List running agents before driving a shared external application, because a peer session may own the active document | port | rule:claude-code.md#check-for-a-peer-session-before-driving-shared-external-state |
| RT-022 | repo-e:scripts/check_dupes.py | Turn a review finding into a mechanical check rather than a note | fold | rule:engineering.md#prove-a-check-can-fail-before-trusting-that-it-passed |
| RT-023 | repo-e:reviews/2026-07-24-writing-efficacy-review.md | Judge a system first against its own rules, then against current external guidance with the sources listed | port | rule:engineering.md#search-public-prior-art-before-building-a-tool-and-record-what-you-did-not-adopt |
| RT-024 | same, hybrid protocol | Apply mechanical fixes in the review commit and land judgment-level changes only as proposals | fold | rule:claude-code.md#run-adversarial-review-in-a-fresh-subagent-with-a-named-lens |
| RT-025 | repo-e:SKILL.md §Persistence | Leave every run auditable through a paired input and output artifact plus a log line, so a run is reproducible without the original source | fold | rule:data-pipelines.md#make-a-pipeline-idempotent-and-resumable-and-log-the-idempotency-rather-than-assume-it |
| RT-026 | repo-e:SKILL.md, portability note | Keep the portable mechanics in the skill and the personal rules in separate instruction files | fold | rule:claude-code.md#make-a-procedure-a-skill-not-a-rule |
| RT-027 | repo-e:.claude/settings.local.json | A local allow entry frozen around an expired session id is dead weight; drop it in the periodic prune | cross-ref | xref:rule:claude-code.md -> AG-026 |

---

## Memory corpus (MEM)

Paths are relative to `~/.claude/projects/<repo-a>/memory/`.

| ID | Source (path or path#heading) | Practice (one line, imperative) | Disposition | Destination |
| --- | --- | --- | --- | --- |
| MEM-001 | feedback_no_op_is_not_evidence.md | A tool reporting zero changes is not evidence it works; pair the no-op case with a case whose answer is known independently | cross-ref | xref:rule:engineering.md -> TW-103 |
| MEM-002 | same | Before believing a pass, ask what a totally broken version would have printed | fold | rule:engineering.md#prove-a-check-can-fail-before-trusting-that-it-passed |
| MEM-003 | feedback_verify_rendered_not_source.md | Grep the built output or query the live DOM before asserting a front-end defect, because what the source says and what renders diverge | cross-ref | xref:rule:engineering.md -> TW-081 |
| MEM-004 | same | Count rules in the built artifact, not in the source files | fold | rule:engineering.md#verify-the-served-artifact-not-the-source |
| MEM-005 | feedback_grep_built_output_not_source.md | After any value sweep, grep the built output for the literal value and expect zero, then widen the guard as well as fixing the instance | fold | rule:engineering.md#verify-the-served-artifact-not-the-source |
| MEM-006 | same | A guard sharing the migration's blind spot cannot falsify it; only an independent representation of the output can | fold | rule:engineering.md#prove-a-check-can-fail-before-trusting-that-it-passed |
| MEM-007 | feedback_prove_no_visual_change.md | Prove a no-visual-change claim with a computed-style diff across pages and widths, and explain every surviving delta | fold | rule:engineering.md#verify-the-served-artifact-not-the-source |
| MEM-008 | same, corollary | When a no-op refactor turns up a real bug, split it out and describe it as a correction rather than burying it | fold | rule:docs.md#ship-the-docs-and-changelog-edit-in-the-same-pr-as-the-change |
| MEM-009 | project_css_diff_harness_traps.md | Run the positive control first (perturb one value, confirm it is reported, revert) before trusting any zero-delta result | fold | rule:engineering.md#prove-a-check-can-fail-before-trusting-that-it-passed |
| MEM-010 | same, traps 1 to 4 | Take both captures from the same checkout, verify the working tree actually changed, suppress only provably identical deltas, and key snapshots on a stable identity | fold | rule:testing.md#read-the-snapshot-diff-before-accepting-it-because-a-snapshot-is-a-drift-gate |
| MEM-011 | feedback_verify_deploys_cache_busted.md | Verify a deploy against both the built file and a cache-bypassed fetch, which separates built-wrong from not-deployed from read-stale | port | rule:deployment.md#verify-the-deployed-url-against-the-built-file-with-the-cache-bypassed |
| MEM-012 | same | A query-string cache buster is not always enough; hit the origin that has no cache in front of it | fold | rule:deployment.md#verify-the-deployed-url-against-the-built-file-with-the-cache-bypassed |
| MEM-013 | feedback_verify_endorsements_raw_markup.md | Verify an external finding against raw markup and the heading tree, never a fetched summary, and respect explicit authoring markers | fold | rule:llm-output.md#cite-or-stay-silent |
| MEM-014 | same, neighbour test | Diff the whole block against what is already published rather than trusting the extractor's hits | fold | rule:llm-output.md#cite-or-stay-silent |
| MEM-015 | feedback_blind_panel_derived_field_leak.md | Audit every field a review packet prints for provenance: a field written by the process under test is not evidence | port | rule:llm-output.md#read-agreement-with-a-shown-suggestion-as-anchored-not-accurate |
| MEM-016 | same | Read unanimity as a signal to audit the instrument, not as confirmation | fold | rule:llm-output.md#read-agreement-with-a-shown-suggestion-as-anchored-not-accurate |
| MEM-017 | feedback_known_failure_mode_bias.md | Before attributing an oddity to a known failure mode, ask whether both readings could be true at once | fold | rule:llm-output.md#refute-with-named-lenses-drop-by-default-and-log-the-drops |
| MEM-018 | feedback_measure_before_modelling.md | Check whether the platform already measures the thing directly before building a model of it | fold | rule:engineering.md#build-the-simplest-thing-that-answers-the-question |
| MEM-019 | same | Prefer a measured floor and ceiling to a modelled point, tag anything modelled, and never compare across units | fold | rule:engineering.md#show-the-ratio-and-the-sample-because-one-number-is-never-the-accuracy |
| MEM-020 | feedback_calibrated_analysis_briefs.md | Label every claim verified, inferred, or unknown throughout the body, and segregate opinion under a marked heading | fold | rule:llm-output.md#gate-output-on-status-tags |
| MEM-021 | same | Include an explicit limitations section naming what was not checked | fold | rule:llm-output.md#report-no-finding-rather-than-manufacture-one |
| MEM-022 | same | Verify outcomes before treating a track record as established | fold | rule:llm-output.md#cite-or-stay-silent |
| MEM-023 | feedback_published_number_verification.md | Reach a stated confidence level and corroborate against the primary source before changing a published number | fold | rule:llm-output.md#cite-or-stay-silent |
| MEM-024 | feedback_pipeline_retro_and_loop_in.md | End a pipeline with a retro of invariants, deltas, and proposals, print the proposals rather than adopting them, and ship a compact digest | cross-ref | xref:rule:data-pipelines.md -> TW-067 |
| MEM-025 | same | Validate a proposed guard against labeled data and check the corpus assembly first, because a corpus missing its positives scores every candidate perfectly | fold | rule:engineering.md#never-let-a-gate-mint-the-answer-key-it-grades-against |
| MEM-026 | same, decisive metric | Score a proposal by whether it would have killed something a human approved, not by its hit rate on rejections | cross-ref | xref:rule:llm-output.md -> TW-070 |
| MEM-027 | feedback_signal_orders_not_decides.md | A signal good enough to order a worklist is not good enough to decide a row, in either direction | cross-ref | xref:rule:data-pipelines.md -> TW-128 |
| MEM-028 | same | Find the first real row that tests a clean-looking mechanical rule before shipping it | fold | rule:data-pipelines.md#name-dont-act-on-ambiguous-data |
| MEM-029 | project_matcher_eval_state.md | Labels derived from the tool under test measure drift, not accuracy; say which rows are human-labeled before quoting any number | fold | rule:engineering.md#never-let-a-gate-mint-the-answer-key-it-grades-against |
| MEM-030 | same | Regenerate a fixture from the source under a seed rather than curating it, and prove the regeneration is byte-identical | fold | rule:engineering.md#make-a-measuring-instrument-reproducible |
| MEM-031 | project_scorer_retune_in_flight.md | Treat a holdout as spent once it has been validated against, and draw a fresh one from unconsumed labels | fold | rule:engineering.md#make-a-measuring-instrument-reproducible |
| MEM-032 | same | Pre-register a tuning sweep in the tool's own header before running it | fold | rule:engineering.md#never-let-a-gate-mint-the-answer-key-it-grades-against |
| MEM-033 | feedback_branch_pr_workflow.md | Read "commit" as branch, commit, push the branch, and open a PR, even for solo work | cross-ref | xref:template:CLAUDE.md.skeleton -> TW-045 |
| MEM-034 | same | Treat a permission block citing review bypass as evidence of a wrong step earlier, not an obstacle to work around | fold | rule:claude-code.md#make-a-must-hold-rule-a-hook-fail-it-closed-and-test-it-with-real-payloads |
| MEM-035 | feedback_worktree_parallel_work.md | Scale the branch location to the change size, require all Tier 1 conditions, and escalate on ambiguity | cross-ref | xref:template:CLAUDE.md.skeleton -> TW-051 |
| MEM-036 | same, 2026-06-05 failure | Check the current branch immediately before every commit and push on a shared checkout, because a peer session can move it | fold | rule:claude-code.md#treat-git-state-as-shared-across-sessions |
| MEM-037 | feedback_no_branch_on_master.md | Never offer branching in the main checkout as an option for work that renders; default to a worktree | fold | template:CLAUDE.md.skeleton |
| MEM-038 | feedback_phase_pr_grouping.md | Ship a phase as commits on one PR, not a PR per step, when there is one reviewer | port | rule:github.md#ship-phased-work-as-commits-on-one-pr |
| MEM-039 | feedback_explicit_git_staging.md | Stage explicit paths, never everything at once, because untracked local-only files get swept in | port | rule:github.md#stage-explicit-paths-never-everything-at-once |
| MEM-040 | feedback_git_branch_cleanup_squash.md | Classify a branch by its PR state, because merge-detection flags lie under squash merging and a refusal to delete is not evidence of unsafety | port | rule:github.md#classify-a-merged-branch-by-its-pr-state-not-by-merge-detection |
| MEM-041 | same | Cross-check a branch's unique commits by their squash-title references appearing on the protected branch | fold | rule:github.md#classify-a-merged-branch-by-its-pr-state-not-by-merge-detection |
| MEM-042 | same | Read a closed-not-merged PR's closing comment before treating the branch as dead or as salvageable | fold | rule:github.md#classify-a-merged-branch-by-its-pr-state-not-by-merge-detection |
| MEM-043 | same | Delete a remote branch through the API when a push from the protected checkout is guarded | cross-ref | xref:script:cleanup-worktree.sh -> TW-044 |
| MEM-044 | feedback_stacked_pr_misfire.md | After merging a stack's parent, confirm each child's base retargeted, and fix-forward from the leaf when a merge landed on a feature branch | fold | rule:github.md#ship-phased-work-as-commits-on-one-pr |
| MEM-045 | feedback_pr_body_closing_keywords.md | Never put a closing keyword beside an issue number you do not mean to close, because negation is not parsed | port | rule:github.md#never-put-a-closing-keyword-beside-an-issue-number-you-do-not-mean-to-close |
| MEM-046 | same | Check the issue state after merging a PR that mentions an issue you intended to leave open | fold | rule:github.md#never-put-a-closing-keyword-beside-an-issue-number-you-do-not-mean-to-close |
| MEM-047 | feedback_docs_ride_along.md | Edit the docs in the same branch as the code, and say in the PR body that you checked when no edit was needed | cross-ref | xref:rule:docs.md -> TW-046 |
| MEM-048 | feedback_post_apply_digest_ride_along.md | Ship every artifact a run produces in one hygiene PR, including the ones the script's own instructions forget to mention | fold | rule:docs.md#ship-the-docs-and-changelog-edit-in-the-same-pr-as-the-change |
| MEM-049 | feedback_self_review_docs_vs_hooks.md | Before opening a docs PR, walk each documented command against the repo's hooks and script list and fix any contradiction in the same PR | fold | rule:docs.md#dont-document-a-command-that-does-not-exist |
| MEM-050 | same, escape hatch | Mark a deliberately archival command inline so a later reader does not flag it as drift | fold | rule:docs.md#dont-document-a-command-that-does-not-exist |
| MEM-051 | feedback_local_preview_before_merge.md | Perform the visible-surface review yourself, including a control page the change should not have touched, then report what was seen | port | template:CLAUDE.md.skeleton |
| MEM-052 | same | Escalate rather than assume for subjective calls, irreversible actions, and anything crossing the product's bright line | fold | template:CLAUDE.md.skeleton |
| MEM-053 | feedback_broadcast_phone_testsend.md | Test a rendering that a desktop preview structurally cannot reproduce on the real client before sending | fold | rule:engineering.md#verify-the-served-artifact-not-the-source |
| MEM-054 | feedback_newsletter_two_renderers.md | When one input feeds two renderers, change both and the shared types in the same PR, then grep the built output to confirm | fold | rule:engineering.md#keep-one-implementation-per-computation-and-let-the-gate-and-the-report-share-it |
| MEM-055 | feedback_model_tiering_no_fable_default.md | Set the model explicitly on every subagent and workflow agent, because an omitted model silently inherits the session's | port | rule:claude-code.md#set-the-model-explicitly-on-every-subagent-and-workflow-agent |
| MEM-056 | same | Treat a verify phase that errored as UNVERIFIED and triage inline, rather than trusting its empty findings list | fold | rule:engineering.md#report-not-evaluable-and-not-measured-rather-than-a-fabricated-zero |
| MEM-057 | feedback_interrupt_kills_workflows.md | Prefer inline work after an interrupt, and recover a killed fan-out's finished results from the transcripts rather than re-running | fold | rule:claude-code.md#run-adversarial-review-in-a-fresh-subagent-with-a-named-lens |
| MEM-058 | feedback_no_carve_outs_on_removal.md | When told to remove something, enumerate every surface in source and in the built output and remove them all in one pass | port | rule:engineering.md#enumerate-from-the-system-of-record-and-fail-hard-on-a-missing-member |
| MEM-059 | feedback_no_nocodb_review.md | Auto-approve only the confidence band and action set that are safe, and carry the rest forward instead of pausing for a click | fold | rule:llm-output.md#gate-output-on-status-tags |
| MEM-060 | same | Surface borderline rejections inline so an override is cheap | fold | rule:llm-output.md#gate-output-on-status-tags |
| MEM-061 | same | Check whether a stale pending backlog is already-applied duplicates before treating it as work | fold | rule:data-pipelines.md#make-a-pipeline-idempotent-and-resumable-and-log-the-idempotency-rather-than-assume-it |
| MEM-062 | project_suppress_committee_donor_clusters.md | Suppress durably through the status the queue builder actually skips on, because the intuitive status re-surfaces every refresh | fold | rule:data-pipelines.md#make-a-pipeline-idempotent-and-resumable-and-log-the-idempotency-rather-than-assume-it |
| MEM-063 | feedback_manual_updates_claude_executes.md | Surface the real candidate records for a human to direct, then execute the write and fan it through every downstream stage | fold | rule:llm-output.md#quarantine-model-output-until-a-human-moves-it |
| MEM-064 | same | Mirror the pipeline's exact output fields when a scoped hand write is unavoidable, so the next full run is a no-op | fold | rule:data-pipelines.md#write-nothing-when-a-record-is-unchanged |
| MEM-065 | feedback_no_manual_relationship_entry.md | Derive graph edges in the pipeline, never by hand, and leave a type extensible rather than shipping a low-precision matcher | fold | rule:data-pipelines.md#name-dont-act-on-ambiguous-data |
| MEM-066 | feedback_publish_without_rematch.md | Ask what actually changed before re-running a chain: a finished master edit needs the publish step alone | fold | rule:data-pipelines.md#make-a-pipeline-idempotent-and-resumable-and-log-the-idempotency-rather-than-assume-it |
| MEM-067 | project_matcher_standalone_degrades_db.md | Never measure stored against live in the middle of a chain, because the intermediate state looks exactly like data loss | fold | rule:data-pipelines.md#end-every-pipeline-run-with-a-retro-of-invariants-deltas-and-proposals |
| MEM-068 | project_retro_snapshot_branch_skew.md, project_retro_delta_branch_skew.md | Trust an invariant line and be sceptical of a delta line while parallel sessions run, and look for a key being absent rather than zero | fold | rule:data-pipelines.md#end-every-pipeline-run-with-a-retro-of-invariants-deltas-and-proposals |
| MEM-069 | project_shared_laptop_db_deploy_hazard.md | Ask what else has touched shared state before deploying, because a deploy publishes the state the store is in, not the state the merges imply | fold | rule:deployment.md#chain-the-deploy-guards-before-building-anything-and-give-them-one-named-escape-hatch |
| MEM-070 | same | Squash-merge another session's branch rather than rebasing it, and never force-clean a checkout you do not own | fold | rule:claude-code.md#treat-git-state-as-shared-across-sessions |
| MEM-071 | project_migration_number_collision.md | Take the next migration number from the applied ledger, the tracked files, and every sibling checkout's uncommitted files | fold | rule:database.md#write-forward-only-numbered-idempotent-migrations-each-opening-with-what-and-why |
| MEM-072 | same, baseline hazard | Regenerate a schema dump only from a checkout rebased onto the current protected branch | fold | rule:database.md#write-forward-only-numbered-idempotent-migrations-each-opening-with-what-and-why |
| MEM-073 | project_meeting_archive_single_homed.md | Home a large gitignored artifact in one checkout, symlink it from the others, and check for a symlink before any force-clean | handbook-only | chapter:github |
| MEM-074 | feedback_row_lifecycle_not_ownership.md | Test row lifecycle, not who writes the data, when deciding whether machine output gets its own table | cross-ref | xref:rule:database.md -> TW-141 |
| MEM-075 | same | Make a machine writer enumerate the columns it does not own, because forgetting is silent editorial loss | fold | rule:database.md#treat-provenance-columns-as-behavior |
| MEM-076 | project_jsonb_double_encode.md | Verify a scripted write to a structured column by reading the stored type back before running the consumer | fold | rule:engineering.md#validate-the-body-before-writing-it-because-a-status-code-is-not-a-content-check |
| MEM-077 | project_cloudflare_deploy_manual.md | Run the generator that produces an aggregate before deploying, because the build reads whatever the table already holds | fold | rule:deployment.md#invoke-a-deploy-only-through-its-named-script |
| MEM-078 | project_resend_template_deploy_manual.md | Name every surface where code merged is not yet live, and the command that makes each live | fold | rule:deployment.md#deploy-manually-after-the-merge-because-a-merge-is-not-a-production-update |
| MEM-079 | project_automode_deploy_block.md | Expect an automatic mode to block a production deploy by classifier, and supply explicit intent rather than routing around it | cross-ref | xref:rule:claude-code.md -> AG-042 |
| MEM-080 | project_github_actions_budget_2026_08.md | Budget CI minutes as one account-wide pool billed per job with a minimum, so run count matters as much as duration | port | rule:github.md#budget-actions-minutes-as-account-wide-money |
| MEM-081 | same | Pause a cron by hand and ship a dated one-shot job that re-enables it, since a token cannot re-enable another repo's workflow | fold | rule:github.md#budget-actions-minutes-as-account-wide-money |
| MEM-082 | same | Read a startup failure's check-run annotation, because a billing failure carries no logs and looks nothing like a code failure | fold | rule:github.md#budget-actions-minutes-as-account-wide-money |
| MEM-083 | project_backlog_cleared_2026_08.md | Verify a stale issue's premise against current code and the live data before planning against it | fold | rule:github.md#open-an-issue-instead-of-failing-a-scheduled-run-and-comment-out-a-cron-with-its-reason |
| MEM-084 | same | Look at the rendered output, not only the data, when auditing a backlog | cross-ref | xref:rule:engineering.md -> TW-081 |
| MEM-085 | feedback_adjudicate_broader_voter_file.md | When both surfaced candidates look wrong, search the full source rather than choosing between the two on offer | fold | rule:data-pipelines.md#name-dont-act-on-ambiguous-data |
| MEM-086 | reference_deterministic_first_citations.md | Verify a citation before making it, and never attribute a principle to a practitioner who did not state it | fold | rule:llm-output.md#cite-or-stay-silent |
| MEM-087 | project_donor_dedup_fixtures.md | Turn a real surfaced cluster into the acceptance test for the tool that will handle it | fold | rule:engineering.md#prove-a-check-can-fail-before-trusting-that-it-passed |
| MEM-088 | feedback_impact_brief_writing_guide.md | Tag every load-bearing number with its provenance and commit the command that re-pulls it | fold | rule:engineering.md#make-a-measuring-instrument-reproducible |
| MEM-089 | same | Lead with impact, cut model-sounding prose, teach a term at first use, and make a limitations section mandatory | handbook-only | chapter:docs |
| MEM-090 | feedback_no_em_dashes.md | Keep em dashes out of rule and body prose, and scope any exception to a named surface | fold | rule:docs.md#state-a-rule-as-imperative-why-anchor-receipts |
| MEM-091 | feedback_html_doc_design_preference.md | Follow the established house design language when converting a doc to a standalone page; drop, because it is one operator's visual preference | drop | n/a |
| MEM-092 | feedback_editorial_bright_line.md | Hold equal treatment across candidates in every race; drop, because it is the product's promise and belongs in its own repo | drop | n/a |
| MEM-093 | feedback_no_new_libs.md | Name the library set and require the trade-off to be surfaced before adding to it | cross-ref | xref:template:CLAUDE.md.skeleton -> TW-138 |
| MEM-094 | same | Verify a claimed technology transition against the codebase before writing a rule that describes it | fold | rule:docs.md#anchor-every-claim-to-a-grep-able-token |
| MEM-095 | feedback_check_county_directly.md | Answer a question about an upstream source by querying the upstream, not by reading your own cache of it | fold | rule:engineering.md#verify-the-served-artifact-not-the-source |
| MEM-096 | feedback_repo_f_pii_dont_belabor.md | Raise a genuinely novel exposure once and move on; drop, because it is per-operator risk appetite on one effort | drop | n/a |
| MEM-097 | user_maintainer.md | Frame technical work for an experienced full-stack engineer and default to the conservative editorial choice | handbook-only | chapter:origins |
| MEM-098 | feedback_blind_panel_derived_field_leak.md, the case | Record the panel that came back unanimous on a field the process under test had written, and what changed when the field was suppressed and the panel re-run | handbook-only | chapter:llm-output |
| MEM-099 | feedback_no_op_is_not_evidence.md, project_css_diff_harness_traps.md (testing sweep 2026-08-24) | Commit the case that must fail beside the case that must pass, so the suite itself carries the proof that the check can still fail | port | rule:testing.md#ship-every-gate-with-a-positive-control-and-a-negative-control |
| MEM-100 | project_tech_debt_primer.md (testing sweep 2026-08-24) | Record which tests the debt list still owes and why each was deferred, because the missing test is usually the one whose fixture is expensive to build | handbook-only | chapter:testing |

---

## External guidance (EXT)

Source is `sources/external-guidance.md`; each row keeps that brief's numbering within its section.

| ID | Source (path or path#heading) | Practice (one line, imperative) | Disposition | Destination |
| --- | --- | --- | --- | --- |
| EXT-001 | external-guidance.md#a-documentation-maintenance 1 | Keep the root instruction file short, because a longer file measurably reduces adherence | cross-ref | xref:rule:docs.md -> TW-013 |
| EXT-002 | same 2 | For every line ask whether removing it would cause a mistake, and cut if not | port | rule:claude-code.md#put-only-what-claude-would-get-wrong-without-it-in-the-root-file |
| EXT-003 | same 3 | Exclude anything derivable from the code: file layouts, dependency lists, generic advice | fold | rule:claude-code.md#put-only-what-claude-would-get-wrong-without-it-in-the-root-file |
| EXT-004 | same 4 | Include only what cannot be inferred: non-guessable commands, conventions that differ from defaults, environment quirks, gotchas | fold | rule:claude-code.md#put-only-what-claude-would-get-wrong-without-it-in-the-root-file |
| EXT-005 | same 5 | Move anything path-specific into a scoped rule file so unrelated sessions pay nothing | cross-ref | xref:rule:claude-code.md -> TW-030 |
| EXT-006 | same 6 | Move multi-step procedures and reference material into skills, where only the description costs context | port | rule:claude-code.md#make-a-procedure-a-skill-not-a-rule |
| EXT-007 | same 7 | Keep a skill body under the documented line cap and its references exactly one level deep | cross-ref | xref:rule:claude-code.md -> TW-164 |
| EXT-008 | same 8 | Write a skill description in third person saying both what it does and when to use it | cross-ref | xref:rule:claude-code.md -> TW-164 |
| EXT-009 | same 9 | Ban time-sensitive statements and put superseded guidance in an old-patterns section | cross-ref | xref:rule:docs.md -> TW-011 |
| EXT-010 | same 10 | Ship the docs edit in the same PR as the code, because a separate docs PR is an afterthought | cross-ref | xref:rule:docs.md -> TW-046 |
| EXT-011 | same 11 | Never mix tutorial, how-to, reference, and explanation modes in one document | fold | rule:docs.md#put-a-fact-where-its-litmus-test-says-it-belongs |
| EXT-012 | same 12 | Prune on evidence: a repeatedly ignored rule means the file is too long, and a question the file answers means the phrasing is ambiguous | fold | rule:docs.md#cut-dont-append-and-trim-on-a-fixed-cadence |
| EXT-013 | same 13 | Run the built-in doctor on a checked-in instruction file to propose trims | handbook-only | chapter:claude-code |
| EXT-014 | same 14 | Let auto-memory hold learnings and the instruction file hold rules | fold | rule:claude-code.md#put-only-what-claude-would-get-wrong-without-it-in-the-root-file |
| EXT-015 | external-guidance.md#b-software-architecture 1 | Record each architecturally significant decision as a numbered immutable record in the repo | port | rule:engineering.md#record-a-significant-decision-as-a-numbered-immutable-record |
| EXT-016 | same 2 | Never edit a decided record; supersede it and mark the old one superseded | fold | rule:engineering.md#record-a-significant-decision-as-a-numbered-immutable-record |
| EXT-017 | same 3 | Use a short standard template so writing a record stays part of normal flow | fold | rule:engineering.md#record-a-significant-decision-as-a-numbered-immutable-record |
| EXT-018 | same 4 | Write a record only for a decision with measurable architectural effect, because a record for every choice devalues the set | fold | rule:engineering.md#record-a-significant-decision-as-a-numbered-immutable-record |
| EXT-019 | same 5 | Diagram at context and container level and stop unless a lower level earns itself | handbook-only | chapter:engineering |
| EXT-020 | same 6 | Add complexity only when it demonstrably improves outcomes; start with the simplest thing that works | port | rule:engineering.md#build-the-simplest-thing-that-answers-the-question |
| EXT-021 | same 7 | Prefer a predictable fixed code path over an autonomous agent whenever the steps are knowable in advance | fold | rule:llm-output.md#keep-a-deterministic-backbone-and-let-the-model-fill-the-slots |
| EXT-022 | same 8 | Justify every configuration constant in a comment, because an unexplained value is unexplained to the agent too | port | rule:engineering.md#pin-a-framework-default-your-output-depends-on-with-the-reason-beside-it |
| EXT-023 | same 9 | Write instructions at the right altitude: specific enough to guide, general enough to leave heuristics | fold | rule:docs.md#state-a-rule-as-imperative-why-anchor-receipts |
| EXT-024 | same 10 | Treat context as a finite resource and seek the smallest set of high-signal tokens | fold | rule:claude-code.md#put-only-what-claude-would-get-wrong-without-it-in-the-root-file |
| EXT-025 | same 11 | Prefer just-in-time loading of paths, queries, and links over preloading the payload | fold | rule:claude-code.md#give-a-domain-rule-a-paths-list-and-never-leave-a-rule-file-unscoped |
| EXT-026 | same 12 | Consolidate near-duplicate tools and scripts into one, because proliferation distracts about which to pick | fold | rule:engineering.md#build-the-simplest-thing-that-answers-the-question |
| EXT-027 | same 13 | Make an error message teach the fix rather than report the failure | port | rule:engineering.md#make-an-error-message-teach-the-fix |
| EXT-028 | external-guidance.md#c-development-workflow 1 | Give the agent a check it can run before you walk away, or you become the verification loop | port | rule:testing.md#give-the-agent-a-check-it-can-run-before-you-walk-away |
| EXT-029 | same 2 | Require evidence rather than assertion: the command, its output, the screenshot | fold | rule:engineering.md#prove-a-check-can-fail-before-trusting-that-it-passed |
| EXT-030 | same 3 | Escalate the gate as autonomy rises, from prompt to condition to hook to verification subagent | fold | rule:claude-code.md#make-a-must-hold-rule-a-hook-fail-it-closed-and-test-it-with-real-payloads |
| EXT-031 | same 4 | Run adversarial review in a fresh subagent told to flag only correctness and requirement gaps | port | rule:claude-code.md#run-adversarial-review-in-a-fresh-subagent-with-a-named-lens |
| EXT-032 | same 5 | Use plan mode when the approach is uncertain or the change spans files, and skip it when the diff fits in one sentence | port | rule:claude-code.md#plan-when-the-approach-is-uncertain-and-clear-the-context-after-two-failed-corrections |
| EXT-033 | same 6 | Delegate file-heavy investigation to a subagent that returns only a summary | fold | rule:claude-code.md#run-adversarial-review-in-a-fresh-subagent-with-a-named-lens |
| EXT-034 | same 7 | Clear the context after two failed corrections on the same issue | fold | rule:claude-code.md#plan-when-the-approach-is-uncertain-and-clear-the-context-after-two-failed-corrections |
| EXT-035 | same 8 | Make any rule that must hold every time a hook, because the instruction file is advisory context | port | rule:claude-code.md#make-a-must-hold-rule-a-hook-fail-it-closed-and-test-it-with-real-payloads |
| EXT-036 | same 9 | Promote a setup to a plugin the moment a second repository needs it | handbook-only | chapter:origins |
| EXT-037 | same 10 | Disable model invocation on any skill with side effects, which saves context and guarantees only you fire it | port | rule:claude-code.md#disable-model-invocation-on-a-skill-with-side-effects |
| EXT-038 | same 11 | Build a few evaluations before writing extensive skill or rule documentation, or you document imagined problems | fold | rule:claude-code.md#make-a-procedure-a-skill-not-a-rule |
| EXT-039 | same 12 | Keep a pre-commit hook fast and push slow checks to CI, because a slow hook gets bypassed then disabled | port | template:pre-commit |
| EXT-040 | same 13 | Follow the test pyramid: many fast unit tests, fewer integration, very few end-to-end | port | rule:testing.md#scale-the-pyramid-to-the-repo-you-have-and-route-what-the-pr-gate-cannot-afford |
| EXT-041 | same 14 | Adopt a conventional commit format so changelog generation mechanizes; drop, because no fleet repo uses one consistently and the format is below the level this package governs | drop | n/a |
| EXT-042 | same 15 | Maintain the changelog by hand under an unreleased heading in reverse-chronological dated sections | fold | rule:docs.md#ship-the-docs-and-changelog-edit-in-the-same-pr-as-the-change |
| EXT-043 | same 16 | Version the conventions package with semantic versioning and declare its public surface | handbook-only | chapter:conventions |
| EXT-044 | same 17 | Add a dry-run flag to every irreversible script and default a destructive prompt to no | cross-ref | xref:rule:data-pipelines.md -> TW-104 |
| EXT-045 | same 18 | Use plan, validate, execute for batch or destructive work, so a machine-verifiable intermediate catches errors before anything is touched | fold | rule:data-pipelines.md#default-to-a-dry-run-and-require-an-explicit-flag-to-write |
| EXT-046 | external-guidance.md#d-deployment 1 | Store all config in the environment, so the repo could be published open-source at any moment without leaking a credential | port | rule:engineering.md#read-config-from-the-environment-and-keep-build-release-and-run-separate |
| EXT-047 | same 2 | Avoid named config groups, which multiply combinations and make deploys brittle | fold | rule:engineering.md#read-config-from-the-environment-and-keep-build-release-and-run-separate |
| EXT-048 | same 3 | Separate build, release, and run strictly, give every release a unique id, and never mutate a release | fold | rule:engineering.md#read-config-from-the-environment-and-keep-build-release-and-run-separate |
| EXT-049 | same 4 | Keep the run stage simple even when the build stage is complex, because a runtime failure happens when nobody is watching | fold | rule:engineering.md#read-config-from-the-environment-and-keep-build-release-and-run-separate |
| EXT-050 | same 5 | Resist different backing services between development and production, even behind an adapter | fold | rule:engineering.md#read-config-from-the-environment-and-keep-build-release-and-run-separate |
| EXT-051 | same 6 | Smoke-test the running URL end to end, because release testing proves shippability and deployment testing proves the deploy worked | cross-ref | xref:rule:deployment.md -> MEM-011 |
| EXT-052 | same 7 | Treat cache invalidation as part of the deploy and assert against a cache-busted fetch | fold | rule:deployment.md#verify-the-deployed-url-against-the-built-file-with-the-cache-bypassed |
| EXT-053 | same 8 | Take a full backup immediately before a destructive migration and keep a tested rollback path | port | rule:database.md#back-up-before-a-destructive-migration-and-diff-after-it |
| EXT-054 | same 9 | Run a post-migration schema and data diff rather than declaring success on a zero exit code | fold | rule:database.md#back-up-before-a-destructive-migration-and-diff-after-it |
| EXT-055 | same 10 | Decommission in phases, keeping the old path readable for a window after cutover | fold | rule:deployment.md#repoint-and-deploy-the-consumer-before-dropping-the-producers-column |
| EXT-056 | same 11 | Keep a manual deploy step where the environment cannot be reproduced, but make it one scripted idempotent command | cross-ref | xref:rule:deployment.md -> TW-147 |
| EXT-057 | external-guidance.md#e-github-workflow 1 | Prefer repository rulesets to classic branch protection, because several can target one branch and enforcement toggles without deletion | handbook-only | chapter:github |
| EXT-058 | same 2 | On the default branch require a PR, block force pushes, and require the CI check, so the gate is a property of the repo | fold | rule:github.md#gate-every-pr-on-checks-that-need-no-credential-and-name-what-is-not-gated |
| EXT-059 | same 3 | Enable automatic deletion of head branches | port | rule:github.md#turn-on-push-protection-head-branch-deletion-and-grouped-dependency-updates |
| EXT-060 | same 4 | Enable secret scanning push protection so a credential is blocked before it enters history | fold | rule:github.md#turn-on-push-protection-head-branch-deletion-and-grouped-dependency-updates |
| EXT-061 | same 5 | Pin every third-party action to a full-length commit SHA, the only immutable reference | fold | rule:github.md#give-a-workflow-read-only-permissions-and-pin-every-action-by-sha |
| EXT-062 | same 6 | Default workflow permissions to read-only and grant write per job | fold | rule:github.md#give-a-workflow-read-only-permissions-and-pin-every-action-by-sha |
| EXT-063 | same 7 | Never interpolate event data directly into a run block; route it through an intermediate variable | fold | rule:github.md#give-a-workflow-read-only-permissions-and-pin-every-action-by-sha |
| EXT-064 | same 8 | Never check out untrusted code in a privileged workflow trigger | fold | rule:github.md#give-a-workflow-read-only-permissions-and-pin-every-action-by-sha |
| EXT-065 | same 9 | Keep the PR gate around a minute, because a gate you route around is not a gate | cross-ref | xref:rule:github.md -> TW-053 |
| EXT-066 | same 10 | Configure grouped dependency updates and leave security updates on | fold | rule:github.md#turn-on-push-protection-head-branch-deletion-and-grouped-dependency-updates |
| EXT-067 | same 11 | Put issue and PR templates in the platform directory, which is checked first | fold | template:PULL_REQUEST_TEMPLATE.md |
| EXT-068 | same 12 | Use the platform CLI for all repository interaction from an agent, because it is the most context-efficient path | fold | rule:github.md#classify-a-merged-branch-by-its-pr-state-not-by-merge-detection |
| EXT-069 | same 13 | Skip code owners on a solo repo, since it only requests reviews and enforces nothing without required reviews | handbook-only | chapter:github |
| EXT-070 | external-guidance.md#things-the-sources-disagree-on | Feature branches versus direct-to-trunk for one person is contested, and an agent producing the diff is the strongest argument for the PR gate | handbook-only | chapter:origins |
| EXT-071 | same | Imports organize but do not economize context; only scoped rules and skills defer loading | handbook-only | chapter:claude-code |
| EXT-072 | same | Pre-commit hook scope is contested; the only consensus is the speed constraint | handbook-only | chapter:github |
| EXT-073 | same | Decision-record formality is contested: architecturally significant only, versus any significant decision | handbook-only | chapter:engineering |
| EXT-074 | same | Path-scoped rule reliability is disputed upstream; do not assume the scoping works without checking | cross-ref | xref:rule:claude-code.md -> TW-030 |
| EXT-075 | external-guidance.md#notable-gaps | No authoritative source covers manual versus automatic deploy for solo projects, or how to version a behavioral conventions package | handbook-only | chapter:origins |
| EXT-076 | same | No standard harness exists for asserting that a rule changed agent behavior, which is what the eval suite is for | handbook-only | chapter:conventions |
| EXT-077 | testing sweep 2026-08-24, martinfowler.com/articles/practical-test-pyramid.html | Shape the pyramid to what the repo can afford: keep the credential-free, second-scale tests in the pull-request gate and route anything needing a database, a network, or a secret to a scheduled run | fold | rule:testing.md#scale-the-pyramid-to-the-repo-you-have-and-route-what-the-pr-gate-cannot-afford |
| EXT-078 | same, martinfowler.com/articles/mocksArentStubs.html | Never assert against a value the test computed the way the code computes it, because the test then proves only that two copies agree | fold | rule:testing.md#feed-a-real-payload-through-the-real-wiring-and-never-re-implement-the-logic-under-test |
| EXT-079 | testing sweep 2026-08-24, mutation-testing rationale (widely-held) | Give every gate a case it must fail as well as a case it must pass, because a suite of passing cases cannot tell a working check from one that always passes | fold | rule:testing.md#ship-every-gate-with-a-positive-control-and-a-negative-control |
| EXT-080 | testing sweep 2026-08-24, jestjs.io/docs/snapshot-testing | Keep a snapshot small enough to read, because a snapshot nobody can read is accepted rather than reviewed | fold | rule:testing.md#read-the-snapshot-diff-before-accepting-it-because-a-snapshot-is-a-drift-gate |
| EXT-081 | testing sweep 2026-08-24, flaky-test quarantine (widely-held) | Quarantine a flaky test into a named, reported list with an owner and a removal condition rather than deleting it or wrapping it in a retry, because a retry converts an intermittent defect into silence | port | rule:testing.md#quarantine-a-flaky-test-loudly-and-never-retry-it-into-silence |
| EXT-082 | testing sweep 2026-08-24, martinfowler.com/bliki/TestCoverage.html | Use coverage as a search-light for code nothing exercises, never as a target, because a number set as a goal is met by tests written for the number | port | rule:testing.md#treat-coverage-as-a-search-light-never-as-a-target |
| EXT-083 | same | Read the uncovered branches rather than the percentage, and take a coverage threshold back out of the gate once it starts producing assertion-free tests | fold | rule:testing.md#treat-coverage-as-a-search-light-never-as-a-target |
| EXT-084 | testing sweep 2026-08-24, alert fatigue in continuous integration (widely-held) | Keep a demoted suite check running and print its false-positive tally in the run, because a red that is usually wrong trains the reader to skip every red; when a check earns demotion is engineering.md's call | port | rule:testing.md#keep-a-demoted-check-running-reported-and-counted |
| EXT-085 | testing sweep 2026-08-24, things the sources disagree on | Whether a solo repo should gate on a coverage number at all is contested; the only consensus is that a threshold set as a goal stops measuring what it named | handbook-only | chapter:testing |
| EXT-086 | testing sweep 2026-08-24, obra/superpowers docs/testing.md two-tier split | Split the deterministic harness tests from the model-behavior evals and give each tier its own budget and cadence, because a tier that costs money and answers differently every run cannot be the thing that decides a merge | port | rule:testing.md#split-deterministic-tests-from-model-behavior-evals-and-give-each-its-own-budget-and-cadence |
| EXT-087 | same, `claude plugin eval --max-cost-usd` and the TribeAI per-task ceiling | Give the eval tier a cost ceiling the runner enforces, an overage that exits non-zero rather than spending, and a cadence a person can pause by hand | fold | rule:testing.md#split-deterministic-tests-from-model-behavior-evals-and-give-each-its-own-budget-and-cadence |
| EXT-088 | same, superpowers `evals/` explicitly excluded from CI | Keep the eval tier out of the pull-request gate and run it nightly or on demand, because a paid nondeterministic tier that can block a merge gets switched off the first week it is wrong | fold | rule:testing.md#split-deterministic-tests-from-model-behavior-evals-and-give-each-its-own-budget-and-cadence |
| EXT-089 | testing sweep 2026-08-24, `claude plugin eval --ablation with-without` | Read the with-and-without ablation delta as the measurement rather than the pass rate, because a rule that scores the same in both arms taught nothing | port | rule:testing.md#prove-an-eval-can-fail-then-grade-it-with-the-cheapest-grader-that-can |
| EXT-090 | same, the built-in's six grader types and Anthropic's three grader classes | Climb the grader ladder from the bottom: a deterministic grader for anything a string, a file, or a tool call can settle, and a model judge only above that, because judges are noisiest on long artifacts | fold | rule:testing.md#prove-an-eval-can-fail-then-grade-it-with-the-cheapest-grader-that-can |
| EXT-091 | same, default repeat count, threshold, and skill-creator's benchmark aggregation | Repeat every trial and report the spread rather than a single green run, and keep pass@k and pass^k as separate claims | fold | rule:testing.md#prove-an-eval-can-fail-then-grade-it-with-the-cheapest-grader-that-can |
| EXT-092 | same, skill-creator grader critique and Anthropic transcript review | Grade the grader: have it flag an assertion too easy to satisfy, and read the transcripts before trusting the number | fold | rule:testing.md#prove-an-eval-can-fail-then-grade-it-with-the-cheapest-grader-that-can |
| EXT-093 | testing sweep 2026-08-24, Anthropic skill authoring best practices | Write the eval cases from observed failures before the prose, then write only enough rule text to pass them | cross-ref | xref:rule:testing.md -> EXT-038 |
| EXT-094 | testing sweep 2026-08-24, Anthropic "Demystifying evals for AI agents" | Grade what the agent produced and the end state it left, not the path it took, because a valid unanticipated path is not a failure | handbook-only | chapter:testing |
| EXT-095 | same, ranked-patterns SKIP verdict | Reject golden transcript snapshots of an agent run, because path matching is too rigid for agents that regularly find valid approaches the eval designer did not anticipate | handbook-only | chapter:testing |
| EXT-096 | testing sweep 2026-08-24, skill-eval-action negative trigger case; Anthropic two-sided case design | Require a case that must not fire beside every case that must, on the eval tier as well as the gate tier, because one-sided evals create one-sided optimization | handbook-only | chapter:testing |
| EXT-097 | testing sweep 2026-08-24, VoxCore84 hook tester; karanb192 integration tier | Feed each hook event its own captured payload on stdin and assert the real exit-code contract, where zero passes, two is an intentional block, and anything else is a crash | handbook-only | chapter:testing |
| EXT-098 | sources/testing-external.md, sections 2, 6, 7, 9, 10 and its disagreements list | Record the testing doctrine read and deliberately not ported at this pass, with the reason, so a deferral stays visible instead of reading as an oversight | handbook-only | chapter:testing |
| EXT-099 | code.claude.com/docs/en/memory, the auto-memory load ceiling | Read the first-200-lines-or-25KB memory load as a hard cut that drops the rest silently, and keep one line per entry with the detail in topic files | fold | rule:claude-code.md#keep-the-auto-memory-index-to-hooks-and-hold-it-under-its-cap |

---

## Prior art (PA)

Source is `sources/prior-art.md`, plus the testing sweep's own upstreams ledger for PA-035 and
after. Most rows are borrow or reuse decisions whose home is ADR 0006 and the origins chapter; a
few are mechanics the package adopts directly, and the testing rows land in the testing chapter.

| ID | Source (path or path#heading) | Practice (one line, imperative) | Disposition | Destination |
| --- | --- | --- | --- | --- |
| PA-001 | prior-art.md#0-foundations | Vendor into a supported slot rather than a hack, because path-scoped rule files are a first-class native feature | handbook-only | chapter:origins |
| PA-002 | same | Say out loud that native symlinks are the real incumbent, and that they give up pinning, per-repo config, and a deviation record | port | adr:0001 |
| PA-003 | same | Use the instructions-loaded log as the positive control that a vendored rule actually loads | generalize | script:house |
| PA-004 | same, glob traps | Respect the expanded-pattern budget and avoid a stray bracket, which makes a pattern match nothing | generalize | script:check.mjs |
| PA-005 | prior-art.md#1-vendoring-manifest-lock-sync, ai-rulez | Borrow the remote include, the merge strategy, and a verify command that proves committed output matches source | handbook-only | chapter:origins |
| PA-006 | same, copier | Borrow the synthetic-baseline three-way merge and version-keyed migrations, and keep refusal as the default rather than silent replay | port | adr:0001 |
| PA-007 | same, cruft | Borrow a skip list and a CI drift gate with a non-zero exit | generalize | script:check.mjs |
| PA-008 | same, projen | Borrow the in-file managed marker plus an anti-tamper check that fails the build on any diff | generalize | script:house |
| PA-009 | same, vendir | Borrow the resolved-hash lock and include paths as the module selector | generalize | script:house |
| PA-010 | same, ruler | Stamp every vendored file with a self-describing provenance header naming module, version, and body hash | port | adr:0001 |
| PA-011 | same, Continue.dev Hub | Never resolve rules at runtime from someone else's service, because a hosted registry is one acquisition from disappearing | fold | adr:0001 |
| PA-012 | same, Packmind | Borrow the framing of context as a versioned auditable artifact with a drift evaluator | handbook-only | chapter:origins |
| PA-013 | prior-art.md#2-checkmjs, ctxlint | Evaluate the external linter against the real trees with controls, and adopt it only as a strict superset with zero false positives | port | adr:0006 |
| PA-014 | same, agents-lint and agnix | Evaluate the schema and shape linters the same way, and record what each failed to hold | fold | adr:0006 |
| PA-015 | same, Sphinx and rustdoc ancestry | Treat a backticked token as a candidate and be lenient when it does not resolve, and key hatches to kind and target rather than line number | generalize | script:check.mjs |
| PA-016 | same, commodity linters | Let commodity be commodity: link checking, heading style, and prose style belong to existing tools, and the anchor resolver is what stays | port | adr:0006 |
| PA-017 | prior-art.md#3-hooks, karanb192 git-safety | Evaluate the tested branch guard, and keep the local one only for the worktree awareness and per-repo carve-outs it has and that one lacks | port | adr:0002 |
| PA-018 | same, guard-pack | Batch guards into one process rather than paying a spawn per tool call | handbook-only | chapter:claude-code |
| PA-019 | same, config-guard | Consider blocking the agent from editing its own guardrail config | handbook-only | chapter:claude-code |
| PA-020 | same, docs caveat | Match the guard broadly and decide in the script, because the matcher filter is best-effort and fails open | cross-ref | xref:script:no-direct-master.sh -> AS-034 |
| PA-021 | same, community writeups | Guard against the documented fail-open trap where a missing dependency exits zero and passes everything through | cross-ref | xref:script:no-direct-master.sh -> AG-019 |
| PA-022 | prior-art.md#4-workflow-skills, superpowers | Borrow the worktree and finishing-a-branch skills as starting text, and the skills-authoring skill as the authoring reference | handbook-only | chapter:origins |
| PA-023 | same, official plugins | Borrow the audit half of the instruction-file management plugin and reject its append half, saying why | port | skill:revise-docs |
| PA-024 | same, commodity skills | Do not rebuild commodity skills such as commit and code review | fold | adr:0005 |
| PA-025 | prior-art.md#5-handbook-and-adrs, MADR | Adopt the decision-record template verbatim, with zero-padded numbering and bidirectional supersede links, and wrap no CLI | port | adr:0006 |
| PA-026 | same, playbooks | Link out for generic engineering material and write only the join of this fleet's invariants to its gates and decisions | port | adr:0005 |
| PA-027 | prior-art.md, awesome-copilot | Emit an index of file, headings, and a one-line why, so a lookup does not load every rule | port | skill:conventions |
| PA-028 | prior-art.md#b-genuinely-novel | Record a per-repo deviations ledger that the sync respects and the check validates, which nothing surveyed provides | port | schema |
| PA-029 | same | Route a local edit to a managed file back upstream rather than merging, overwriting, or ignoring it | port | skill:sync |
| PA-030 | same | Keep the rule-shape contract in-house, because no external linter expresses imperative headings, a required don't section, and no dates in rule prose | generalize | script:check.mjs |
| PA-031 | prior-art.md#a-five-strongest, item 2 | Split deviation from drift: a deliberate fork is recorded and skipped forever, an accidental change fails loudly | port | adr:0001 |
| PA-032 | same, conflict markers | Never write conflict markers into a rule file, because an agent reading one will follow both branches or one at random | fold | adr:0001 |
| PA-033 | prior-art.md, GitHub native budgets | Reuse the platform's spending budget for enforcement, and keep a local check only for what it estimates before merge | cross-ref | xref:rule:github.md -> MEM-080 |
| PA-034 | prior-art.md#c-does-anything-make-it-unnecessary | Record that no single candidate covers versioned cross-repo distribution with drift detection and recorded deviations | handbook-only | chapter:origins |
| PA-035 | testing sweep 2026-08-24, upstreams ledger 1 and its closing note | Borrow superpowers' two-tier split, its cost guidance, and its headless-probe shape, and borrow nothing from an unlicensed or stale hook repo | handbook-only | chapter:testing |
| PA-036 | same, upstreams ledger 2, skill-creator | Borrow skill-creator's eval, grading, and benchmark file triple, its grader-critiques-the-eval step, its blind comparator with a later unblinding analyzer, and its train/test split | handbook-only | chapter:testing |
| PA-037 | same, upstreams ledger 3, karanb192 | Borrow the zero-dependency runner, per-plugin colocated tests, and an explicit stdin/stdout integration tier, and scope out the runtime matrix where the package pins one runtime | handbook-only | chapter:testing |
| PA-038 | same, vendor tooling verdict | Adopt no eval vendor, because the built-in runner already gives cases, graders, ablation, repeats, and cost ceilings with no new dependency and no key plumbing | handbook-only | chapter:testing |
| PA-039 | same, adopt-as-practice items and per-case isolation | Pin a cheap model as a canary, scaffold each eval case into a fresh workspace, and blind the comparison until analysis | handbook-only | chapter:testing |
