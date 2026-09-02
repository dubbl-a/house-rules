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

| Upstream | Consulted | License | Relationship | What was taken | Re-check |
| --- | --- | --- | --- | --- | --- |
| adr.github.io/madr (MADR 4.0.0) | 2026-08-23 | MIT/CC0 | BORROW | the decision-record template in `docs/decisions/0000-template.md` | diff the template against the MADR repo's current `template/` |
| github.com/obra/superpowers | 2026-08-23 | MIT | BORROW | starting text and hazard framing for worktree and finish-branch guidance (v0.2 skills; handbook worked examples) | re-read `using-git-worktrees`, `finishing-a-development-branch`, `writing-skills` |
| anthropics/claude-plugins-official `claude-md-management` | 2026-08-23 | Apache-2.0 | BORROW | the audit half of its prompt for `/house-rules:revise-docs`; its append-to-CLAUDE.md default is the failure mode the routing replaces | local marketplace cache updates with the plugin |
| anthropics/claude-plugins-official `plugin-dev` | 2026-08-23 | Apache-2.0 | BORROW | plugin/hook schema shapes used to author this package | same |
| github.com/Goldziher/ai-rulez | 2026-08-23 | MIT | BORROW (ideas only) | the remote-include shape, the local-override merge strategy, and a `verify` command that proves committed output still matches its sources; the closest OSS analogue, not adopted because its include refs are unpinned, it has no lock, and it never emits `paths:`-scoped rules | re-read its README on a minor release; check whether include pinning or a lock has landed |
| github.com/PackmindHub/packmind | 2026-08-23 | Apache-2.0 | BORROW (framing only) | the framing of context as a versioned, auditable artifact with a drift evaluator over it; not adopted because it is a Docker/Kubernetes server with submission and approval workflows, sized for an org rather than one person | re-read if house ever needs a multi-user approval path |
| github.com/karanb192/claude-code-hooks | 2026-08-23 | MIT | BORROW (ideas only) | guard-pack single-process batching noted for a future multi-hook version; config-guard considered and not adopted | re-check if house ships more than one PreToolUse hook |
| github.com/YawLabs/ctxlint | 2026-08-24 (v0.24.1) | MIT | BORROW (idea only) | evaluated against the three real trees, not adopted (does not honor `docs-drift-ignore`, does not strip HTML comments before scanning, false-positives on URL routes); its `paths:`-glob-matches-zero check was ported into `validateRulesFrontmatter` instead -- deciding case in ADR 0006 | re-evaluate on a major if it gains `docs-drift-ignore` support or comment stripping |
| github.com/giacomo/agents-lint | 2026-08-24 | MIT | REJECTED | not separately run: its path- and npm-script-existence checks are a subset of what ctxlint's evaluation and `check.mjs`'s own anchors already cover -- deciding case in ADR 0006 | re-run only if its coverage diverges from ctxlint's or `check.mjs`'s |
| github.com/agent-sh/agnix | 2026-08-24 (v0.49.0) | MIT OR Apache-2.0 | REJECTED | evaluated against the three real trees, not adopted: a prompt-hygiene linter orthogonal to docs-drift, misses the bare-script class, and flags this package's own `.claude/` convention as a portability smell -- deciding case in ADR 0006 | re-evaluate if it adds anchor-resolution rules or drops the portability-smell rule |
| copier.readthedocs.io | 2026-08-23 | MIT | REJECTED | its update-replay model was considered for sync and rejected on purpose (ADR 0001): a silently carried local edit is what the deviations ledger makes explicit | none needed; revisit only if the refusal model proves too costly |
| contributor-covenant.org (Contributor Covenant 2.1) | 2026-09-01 | CC BY 4.0 | REUSE (adapted) | the whole of `CODE_OF_CONDUCT.md`, reproduced with its Attribution section intact and its Enforcement sentence rewritten to name this project's own reporting channels; the license permits an adaptation as long as the change is stated, which `NOTICE` does | re-check on a Contributor Covenant release |
| github.com/microsoft/code-with-engineering-playbook | 2026-08-23 | CC-BY-4.0 | BORROW (links) | handbook chapters link out for generic engineering material instead of rewriting it | links checked by the drift gate's external-link posture |
| FlorianBruniaux/claude-code-ultimate-guide | 2026-08-23 | CC BY-SA 4.0 | BORROW (idea only) | the idea of matching model tier to task kind, re-expressed for the claude-code chapter in this package's own structure and words (checked 2026-09-01: no shared prose, only shared links); credited in that chapter's Sources and in NOTICE | re-read on a Claude Code major |
| github.com/obra/superpowers (testing) | 2026-08-24 | MIT | BORROW | two-tier harness/eval split with cost posture; pressure-scenario skill-testing method; headless `claude -p` probe shape with premature-action detection | re-read `docs/testing.md` and `writing-skills` on plugin update (installed locally) |
| anthropics/claude-plugins-official `skill-creator` | 2026-08-24 | Apache-2.0 | BORROW | evals/grading/benchmark schema triple; grader-critiques-the-eval; blind comparator then unblinding analyzer; train/test split; variance aggregation | local marketplace cache updates with the plugin |
| github.com/karanb192/claude-code-hooks (testing) | 2026-08-24 | MIT | BORROW | zero-dependency node --test colocated per plugin; explicit stdin/stdout integration tier | re-check on major |
| github.com/VoxCore84/claude-code-hook-tester | 2026-08-24 | MIT | BORROW | per-event mock payloads on stdin, and the three-way outcome contract a hook test must assert (0 passes, 2 is an intentional block, anything else is a crash) rather than reading any non-zero exit as a failure | re-check on a hook-protocol change |
| anthropic.com/engineering/demystifying-evals-for-ai-agents | 2026-08-24 | docs | BORROW (citation anchor) | grader classes; isolation; outcome-over-path; two-experts task quality; pass@k vs pass^k; two-sided case design | re-read on republication |
| github.com/skill-bench/skill-eval-action | 2026-08-24 | MIT | BORROW (idea only) | mandatory negative trigger case; upsert-one-PR-comment reporting | none |
| github.com/antfu/eslint-config | 2026-09-01 | MIT | INFORMED | the README's opening contract (personal opinionated config; review the diff on every update, or fork) and the loose pole of the breaking-change policy (rule changes are not breaking) | on the next README rewrite |
| typescript-eslint.io/users/versioning | 2026-09-01 | docs | INFORMED | the strict pole ADR 0011 weighed (preset and default changes are breaking) | re-read on an ADR 0011 revisit |
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

Internal bases (not public, recorded for the same reason): repo-b
`scripts/check-docs-drift.mjs` and `.claude/hooks/no-direct-master.sh` are the
implementation bases for `payload/check.mjs` and the plugin hook; repo-a
`maintaining-docs.md` and `match-measurement.md` are the doc-kit and evidence
bases; repo-c's PR template ships verbatim as a template. Those repos adopt the
package back, which closes their fork loop; this ledger exists so the public
loop stays closeable too.
