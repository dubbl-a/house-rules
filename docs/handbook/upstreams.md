<!-- docs-drift-ignore-file: external upstream references; anchors are not repo paths -->
# Upstream provenance ledger

Every public source this package reuses or borrows from, pinned to what was
consulted, so staying current is a deliberate, diffable act rather than a
re-fork. The Relationship column, in one line each: what was taken (REUSE,
BORROW); what shaped a choice without being taken (INFORMED); what was
evaluated and not adopted (CONSULTED, REJECTED); and what is cited as an
authority (CITED). REUSE and BORROW are the two that carry an ongoing rule:

- **REUSE (dependency):** consumed at a pinned version; staying current is a
  version bump that must pass this package's own positive and negative
  controls before landing. Never vendored without its version recorded.
- **BORROW (adapted text or idea):** a one-time adaptation, deliberately
  diverged into house style and welded to house gates. Not tracked as a fork.
  Each entry records what was taken and how to re-check; the quarterly trim
  (docs module) includes glancing at this ledger for upstream movement worth
  re-importing. Re-importing is a normal PR against this package.

Every REUSE and BORROW row with a git remote carries a machine-readable pin in
`scripts/upstream-pins.json`, keyed by the row's Upstream cell: the remote, the
branch or tag, the commit consulted, and the paths that were taken. A branch pin
records the default-branch head as of the Consulted date; a row that names a
version pins that tag. `npm run check:upstreams` walks the pins and prints one
verdict per row (exit 0 unchanged, 1 a row moved, 3 a remote or the pins file
could not be read), and `.github/workflows/upstream-watch.yml` runs it weekly
beside `npm run check:kit`, keeping one `upstream-update` issue whose table lists
every moved row, updated in place and closed only by the maintainer. A branch pin moves on any commit to that branch, so a move is a
prompt to look, not proof the taken paths changed. Two REUSE or BORROW rows have
no pin, and the pins file lists them with the reason: the evals article is a web
page with no git remote, and the deep-research fork is read from the installed
Claude Code binary, which its own checker watches after each upgrade. Rows with
no ongoing rule (INFORMED, CONSULTED, REJECTED, CITED) are not pinned.

What a move means depends on the relationship, and nothing is ever pulled for
you. A moved REUSE row is a re-vendor at the new version, landed as a normal PR
that passes this package's own controls. A moved BORROW row is a review: the
checker names the paths to re-read, and re-importing anything is an editorial
choice made in a normal PR, never a merge. Either way, the pin's sha (and tag)
and the row's Consulted date move together in that PR.

The three `anthropics/claude-plugins-official` rows (`claude-md-management`,
`plugin-dev`, `skill-creator`) are pinned to the marketplace repo on each
plugin's path, not to whatever version sits in this machine's plugin cache,
because a cache is machine-local and a pin has to read the same everywhere.

Adopters need nothing new: roster, hook, and rule updates that come out of an
upstream review reach them through the plugin release flow, and this ledger and
its pins stay in the package repo.

| Upstream | Consulted | License | Relationship | What was taken | Re-check |
| --- | --- | --- | --- | --- | --- |
| adr.github.io/madr (MADR 4.0.0) | 2026-08-23 | MIT/CC0 | BORROW | the decision-record template in `docs/decisions/0000-template.md` | diff the template against the MADR repo's current `template/` |
| github.com/obra/superpowers | 2026-08-23 | MIT | BORROW | starting text and hazard framing for worktree and finish-branch guidance (v0.2 skills; handbook worked examples) | re-read `using-git-worktrees`, `finishing-a-development-branch`, `writing-skills` |
| anthropics/claude-plugins-official `claude-md-management` | 2026-08-23 | Apache-2.0 | BORROW | the audit half of its prompt for `/house-rules:revise-docs`; its append-to-CLAUDE.md default is the failure mode the routing replaces | `npm run check:upstreams` against `plugins/claude-md-management/` in the marketplace repo |
| anthropics/claude-plugins-official `plugin-dev` | 2026-08-23 | Apache-2.0 | BORROW | plugin/hook schema shapes used to author this package | `npm run check:upstreams` against `plugins/plugin-dev/` in the marketplace repo |
| github.com/Goldziher/ai-rulez | 2026-10-07 | MIT | BORROW (ideas only) | the remote-include shape, the local-override merge strategy, and a `verify` command that proves committed output still matches its sources; the closest OSS analogue, still not adopted; the original reasons (unpinned include refs, no lock, no `paths:`-scoped rules) no longer hold as of v5, which adds `ai-rulez.lock` and native `paths` rules, so the case is open for review | re-read its README on a minor release; the lock has landed, so check whether its lock model changes what house.json pins |
| github.com/PackmindHub/packmind | 2026-10-07 | Apache-2.0 | BORROW (framing only) | the framing of context as a versioned, auditable artifact with a drift evaluator over it; not adopted because it is a Docker/Kubernetes server with submission and approval workflows, sized for an org rather than one person | re-read if house ever needs a multi-user approval path |
| github.com/karanb192/claude-code-hooks | 2026-08-23 | MIT | BORROW (ideas only) | guard-pack single-process batching noted for a future multi-hook version; config-guard considered and not adopted | re-check if house ships more than one PreToolUse hook |
| github.com/YawLabs/ctxlint | 2026-08-24 (v0.24.1) | MIT | BORROW (idea only) | evaluated against the three real trees, not adopted (does not honor `docs-drift-ignore`, does not strip HTML comments before scanning, false-positives on URL routes); its `paths:`-glob-matches-zero check was ported into `validateRulesFrontmatter` instead -- deciding case in ADR 0006 | re-evaluate on a major if it gains `docs-drift-ignore` support or comment stripping |
| github.com/giacomo/agents-lint | 2026-08-24 | MIT | REJECTED | not separately run: its path- and npm-script-existence checks are a subset of what ctxlint's evaluation and `check.mjs`'s own anchors already cover -- deciding case in ADR 0006 | re-run only if its coverage diverges from ctxlint's or `check.mjs`'s |
| github.com/agent-sh/agnix | 2026-08-24 (v0.49.0) | MIT OR Apache-2.0 | REJECTED | evaluated against the three real trees, not adopted: a prompt-hygiene linter orthogonal to docs-drift, misses the bare-script class, and flags this package's own `.claude/` convention as a portability smell -- deciding case in ADR 0006 | re-evaluate if it adds anchor-resolution rules or drops the portability-smell rule |
| copier.readthedocs.io | 2026-08-23 | MIT | REJECTED | its update-replay model was considered for sync and rejected on purpose (ADR 0001): a silently carried local edit is what the deviations ledger makes explicit | none needed; revisit only if the refusal model proves too costly |
| contributor-covenant.org (Contributor Covenant 2.1) | 2026-09-01 | CC BY 4.0 | REUSE (adapted) | the whole of `CODE_OF_CONDUCT.md`, reproduced with its Attribution section intact and its Enforcement sentence rewritten to name this project's own reporting channels; the license permits an adaptation as long as the change is stated, which `NOTICE` does | re-check on a Contributor Covenant release |
| github.com/microsoft/code-with-engineering-playbook | 2026-08-23 | CC-BY-4.0 | BORROW (links) | handbook chapters link out for generic engineering material instead of rewriting it | links checked by the drift gate's external-link posture |
| FlorianBruniaux/claude-code-ultimate-guide | 2026-08-23 | CC BY-SA 4.0 | BORROW (idea only) | the idea of matching model tier to task kind, re-expressed for the claude-code chapter in this package's own structure and words (checked 2026-09-01: no shared prose, only shared links); credited in that chapter's Sources and in NOTICE | re-read on a Claude Code major |
| github.com/obra/superpowers (testing) | 2026-08-24 | MIT | BORROW | two-tier harness/eval split with cost posture; pressure-scenario skill-testing method; headless `claude -p` probe shape with premature-action detection | re-read `docs/testing.md` and `writing-skills` on plugin update (installed locally) |
| anthropics/claude-plugins-official `skill-creator` | 2026-08-24 | Apache-2.0 | BORROW | evals/grading/benchmark schema triple; grader-critiques-the-eval; blind comparator then unblinding analyzer; train/test split; variance aggregation | `npm run check:upstreams` against `plugins/skill-creator/` in the marketplace repo |
| github.com/karanb192/claude-code-hooks (testing) | 2026-08-24 | MIT | BORROW | zero-dependency node --test colocated per plugin; explicit stdin/stdout integration tier | re-check on major |
| github.com/VoxCore84/claude-code-hook-tester | 2026-08-24 | MIT | BORROW | per-event mock payloads on stdin, and the three-way outcome contract a hook test must assert (0 passes, 2 is an intentional block, anything else is a crash) rather than reading any non-zero exit as a failure | re-check on a hook-protocol change |
| anthropic.com/engineering/demystifying-evals-for-ai-agents | 2026-08-24 | docs | BORROW (citation anchor) | grader classes; isolation; outcome-over-path; two-experts task quality; pass@k vs pass^k; two-sided case design | re-read on republication |
| github.com/skill-bench/skill-eval-action | 2026-08-24 | MIT | BORROW (idea only) | mandatory negative trigger case; upsert-one-PR-comment reporting | none |
| github.com/antfu/eslint-config | 2026-09-01 | MIT | INFORMED | the README's opening contract (personal opinionated config; review the diff on every update, or fork) and the loose pole of the breaking-change policy (rule changes are not breaking) | on the next README rewrite |
| typescript-eslint.io/users/versioning | 2026-09-01 | docs | INFORMED | the strict pole ADR 0011 weighed (preset and default changes are breaking) | re-read on an ADR 0011 revisit |
| github.com/npm/node-semver | 2026-09-09 | docs | CITED | the 0.x caret-range rule ADR 0012 adopts: `^0.2.3` resolves to `>=0.2.3 <0.3.0`, patch-only compatibility below 1.0 | re-read on an ADR 0012 revisit |
| doc.rust-lang.org/cargo/reference/specifying-dependencies | 2026-09-09 | docs | CITED | Cargo's matching 0.x caret-requirement rule ADR 0012 adopts: `0.2.3` resolves to `>=0.2.3, <0.3.0` | re-read on an ADR 0012 revisit |
| prettier.io/docs/option-philosophy | 2026-09-01 | docs | INFORMED | why `modules.docs.config.emDash` is a small fixed surface (three modes, two lists) rather than a knob per exception | re-read on republication |
| eslint.org/docs/latest/extend/shareable-configs | 2026-09-01 | docs | INFORMED | later-wins overrides as the model for per-repo config over package defaults | re-read on republication |
| github.com/tsconfig/bases | 2026-09-01 | MIT | CONSULTED (not adopted) | runtime-tracking versions and automated daily publishing; this package keeps semver and manual releases | re-read on a tsconfig/bases major |
| cruft.github.io/cruft | 2026-09-01 | MIT | INFORMED | the update, check, and skip-list trio that validated render plus checker plus deviations; already discussed in `docs/handbook/sources/prior-art.md` | re-read on a cruft major |
| rulesync.dev | 2026-09-01 | docs | CONSULTED (not adopted) | CLI-pull distribution of rule files from a hosted source; no render or per-repo override step | re-read on republication |
| github.com/intellectronica/ruler | 2026-09-01 | MIT | CONSULTED (not adopted) | cross-tool fan-out of one rules source; no lock, checker, or ledger | re-read on a ruler major |
| github.com/yelmuratoff/agent_sync | 2026-09-01 | GPL-3.0-only | CONSULTED (not adopted) | a hash manifest for its own generated outputs; the comparison that kept this package from claiming hash drift as novel | re-read on its next release |
| github.com/lirantal/agent-rules | 2026-09-01 | Apache-2.0 | CONSULTED (not adopted) | one-shot scaffolding of curated rules; no update story | re-read on its next release |
| github.com/PatrickJS/awesome-cursorrules | 2026-09-01 | CC0-1.0 | CONSULTED (not adopted) | a copy-paste rule collection; the demand signal and the missing update story | re-read on its next release |
| github.com/jameskomo/config-drift-checker | 2026-09-01 | FSL-1.1-ALv2 (not OSI-approved) | CONSULTED (not adopted) | a with-and-without ablation of an agent config; the comparison that kept this package from claiming evals as novel | re-read on its next release |
| github.com/prime-radiant-inc/superpowers-evals | 2026-09-01 | none found (all rights reserved) | CONSULTED (not adopted) | a skill-behavior eval harness | re-read on its next release |
| github.com/hesreallyhim/awesome-claude-code | 2026-09-01 | CC BY-NC-ND 4.0 | INFORMED | listing thresholds (14 days of activity or 100 stars) and form-only intake; the reason issue forms exist here | re-read if the listing thresholds change |
| opensource.guide/starting-a-project | 2026-09-01 | CC BY 4.0 | CITED | the four baseline files at launch | re-read on republication |
| docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/about-community-profiles-for-public-repositories | 2026-09-01 | docs | CITED | issue forms need `name` and `description` to count | re-read on republication |
| choosealicense.com/non-software | 2026-09-01 | CC BY 3.0 | CITED | split licensing for code plus prose; code examples in docs under the code license | re-read on republication |
| creativecommons.org/faq | 2026-09-01 | CC BY 4.0 | CITED | CC licenses for documentation, not software | re-read on republication |
| spdx.github.io/spdx-spec/v2.3/SPDX-license-expressions | 2026-09-01 | CC BY 3.0 | CITED | the `MIT AND CC-BY-4.0` expression | re-read on an SPDX spec update |
| linuxfoundation.org/licensebestpractices | 2026-09-01 | docs | CITED | per-content-type licensing | re-read on republication |
| code.claude.com/docs/en/plugins-reference | 2026-09-01 | docs | CITED | no rules component; a plugin-root CLAUDE.md is not loaded (the reason render and vendor exist) | re-read if a rules component ships |
| code.claude.com/docs (harness survey) | 2026-09-02 | docs | CITED | the native-feature facts behind every rule's native-floor sentence; see `docs/handbook/sources/harness-survey.md` | re-run the survey workflows on every Claude Code major |
| anthropics/claude-code bundled `deep-research` workflow (v2.1.288) | 2026-09-18 | proprietary (not redistributed) | BORROW (script forked at run time) | the five-stage research harness, re-read from the installed binary and pinned to per-stage models by `scripts/house/check-deep-research-upstream.mjs --rebuild`; the script text itself is never committed | run the check after each Claude Code upgrade; exit 0 keeps the fork unchanged, exit 1 (drift, or no binary/no bundled script found) re-derives it with `--install`, exit 2 retires it (SUNSET: native agent() calls now carry a model, or native args read a per-stage model map), exit 3 is a bad argument or a refused rebuild |
| github.com/SirRuggie/claude-code-orchestration-kit (v2.0, commit 4416994 of 2026-09-13) | 2026-09-20 | MIT | BORROW | the five-agent roster (scout, researcher, builder, refuter, debugger) with pinned model, effort, and tool lists, adapted into `plugins/house/agents/`; the always-on directives (roles, model tier, delegation, six-section brief, parallelism, verification) adapted into `plugins/house/orchestration/ORCHESTRATION.md` and injected by the session-start hook; its task-bucket system and `/task` command were not adopted | `npm run check:kit`: exit 0 unchanged, exit 1 upstream moved (rerun with `--diff` for the stat of `core/`, re-port what is worth taking, record the new sha in PINNED), exit 3 unreadable remote or bad argument |

Internal bases (not public, recorded for the same reason): repo-b
`scripts/check-docs-drift.mjs` and `.claude/hooks/no-direct-master.sh` are the
implementation bases for `payload/check.mjs` and the plugin hook; repo-a
`maintaining-docs.md` and `match-measurement.md` are the doc-kit and evidence
bases; repo-c's PR template ships verbatim as a template. Those repos adopt the
package back, which closes their fork loop; this ledger exists so the public
loop stays closeable too.
