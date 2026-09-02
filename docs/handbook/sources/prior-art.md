<!-- docs-drift-ignore-file: point-in-time survey captured 2026-08-23; anchors record what was true on that date -->
# Source: prior-art (survey agent output, 2026-08-23)

Research complete across four parallel sweeps plus my own. Findings below.

---

# Build vs Reuse: house plugin survey

## 0. Foundations, verified against official docs

Both load-bearing assumptions hold, confirmed verbatim at [code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory) and [plugins-reference](https://code.claude.com/docs/en/plugins-reference):

- **Plugins cannot ship rules.** The plugin layout enumerates `skills/`, `commands/`, `agents/`, `workflows/`, `output-styles/`, `themes/`, `monitors/`, `hooks/`, `bin/`, `settings.json`, `.mcp.json`, `.lsp.json`. No `rules/`. Docs add: "A `CLAUDE.md` file at the plugin root is not loaded as project context."
- **`@` imports do not save context.** "Splitting into `@path` imports helps organization but doesn't reduce context, since imported files load at launch."

Three corrections to the design, all from the same docs:

1. `.claude/rules/*.md` with `paths:` frontmatter is a **first-class native feature**, and it lazy-loads exactly as assumed: "Path-scoped rules trigger when Claude reads files matching the pattern, not on every tool use." You are vendoring into a supported slot, not a hack.
2. **The real incumbent is symlinks, not any tool.** Docs: "The `.claude/rules/` directory supports symlinks, so you can maintain a shared set of rules and link them into multiple projects." That is the zero-effort solo-dev answer. It gives no pinning, no per-repo config, no deviation record, and propagates unreviewed upstream changes instantly. Your manifest plus lock is the argument against it and the pitch should say so out loud.
3. **`InstructionsLoaded` hook** exists to "log exactly which instruction files are loaded, when they load, and why." That is your positive control that a vendored rule actually loads. Use it, because a rule whose glob silently fails to match is indistinguishable from one that does nothing. Known glob traps: a `paths` list shares a 1,000-expanded-pattern budget, and a stray `[` makes a pattern match nothing.

`SessionStart` stdout **is** user-visible ("Claude Code adds plain-text stdout as context"), so component 3's one-liner works as designed.

---

## 1. Vendoring, manifest, lock, sync

| Candidate | Verdict |
| --- | --- |
| **ai-rulez** ([Goldziher/ai-rulez](https://github.com/Goldziher/ai-rulez)) TOML config with `[[includes]] source = "https://github.com/co/ai-rules.git"`, `merge_strategy = "local-override"`, and `ai-rulez verify` to prove committed output matches sources. Closest OSS analogue by far. Not better: ref pinning undocumented, no lock for includes, emits skills plus inline CLAUDE.md, never `paths:`-scoped rules. MIT, ~138 stars, active. | **BORROW** (remote include + merge strategy + `verify`) |
| **copier** ([copier-org/copier](https://github.com/copier-org/copier)) Renders from a template and can re-run it: `copier update` re-renders the OLD pinned version from `.copier-answers.yml`, diffs against your tree, replays onto a fresh render of the NEW version. MIT, 3.5k stars, v9.17.2 on 2026-08-19. Better on merging (it never refuses, it merges), worse on everything else. | **BORROW** (synthetic-baseline 3-way merge, `_migrations` keyed to version ranges) |
| **cruft** ([cruft/cruft](https://github.com/cruft/cruft)) `.cruft.json` stores template URL, commit, context, and a `skip` glob list; `cruft check --exit-code` is a CI drift gate. MIT, 1.6k stars, **no commits in 20 months**. | **BORROW** (`skip` list, CI drift gate) |
| **projen** ([projen/projen](https://github.com/projen/projen)) Synthesizes config from `.projenrc`, writes generated files read-only with a "managed by projen" marker, and an anti-tamper CI check fails the build on any diff. Apache-2.0, 2.9k stars, active. Not better for prose: it forbids local edits rather than negotiating them. | **BORROW** (in-file managed marker + anti-tamper CI check) |
| **carvel vendir** ([carvel-dev/vendir](https://github.com/carvel-dev/vendir)) `vendir.yml` declares managed dirs, `vendir.lock.yml` records resolved SHAs, `includePaths` slices a subset out of upstream. Apache-2.0, 392 stars. Structurally the closest to your vendoring half. | **BORROW** (resolved-SHA lock, `includePaths` as module selector) |
| **Packmind** ([PackmindHub/packmind](https://github.com/PackmindHub/packmind)) Apache-2.0 platform: captures, versions, and distributes coding standards to 8 agents with glob scoping and a "Context-Evaluator" drift tool. 307 stars, active. Not better for one person: Docker/K8s server, approval workflows, SaaS gravity. | **BORROW** (drift-evaluator framing) |
| **ruler** ([intellectronica/ruler](https://github.com/intellectronica/ruler)) MIT, 2.9k stars, 177k npm/month. Concatenates `.ruler/*.md` into per-agent files with a `<!-- Source: path -->` header. Per-repo source, no remote pull, no version, **no `.claude/rules/` output**. | **BORROW** (provenance header), else IGNORE |
| **rulesync**, **awesome-cursorrules**, **AGENTS.md**, **airul**, **contextfiles** | **IGNORE**. Cross-tool fanout or copy-paste catalogs, not cross-repo distribution. |
| **TechNickAI/ai-coding-config** MIT, 24 stars. 33 rules, 24 agents, bootstrap script, `/ai-coding-config update` that "shows what changed, preserves your customizations." Nearest personal-scale analogue. No documented hashes, manifest, or pin. | **BORROW** (selective interactive update) |
| **d-padmanabhan/agent-engineering-handbook** MIT. 40+ `.mdc` rules with `files.include/exclude` globs, 35+ skills, hooks, MCP server. Consumed by copy or symlink; "no built-in versioning system." | **BORROW** (`rules/INDEX.md` manifest), else IGNORE |
| **cookiecutter**, **Yeoman**, **Backstage scaffolder**, **repo-file-sync-action**, **actions-template-sync**, **Nx/Turbo generators**, **Sourcegraph Batch Changes**, **multi-gitter/octoherd/mani/meta** | **IGNORE** for this component. One-shot generation, push-based sync that lets template win by default, or fan-out runners with no per-file ownership model. |
| **Continue.dev Hub** | **Dead.** Cursor acqui-hired Continue June 2026, repo read-only, `hub.continue.dev` no longer resolves. It was the strongest versioned rule registry. Its death is the argument for vendoring over runtime resolution. |

**Nothing does versioned cross-repo distribution of path-scoped rule files with drift detection.** Three tools each hold two legs and drop the third. The gap is real.

---

## 2. `check.mjs`

| Candidate | Verdict |
| --- | --- |
| **ctxlint** ([YawLabs/ctxlint](https://github.com/YawLabs/ctxlint)) MIT, ~10 stars, v1.1.3. Lints CLAUDE.md/AGENTS.md/.cursorrules against the repo: `paths` flags non-existent file refs, `commands` checks documented commands against package.json scripts and Makefile targets, `hook-coverage` checks hook scripts exist. Covers two of your six anchor classes, with git-rename detection and autofix. Very young. | **BORROW** (git-history rename resolution, `.ctxlintignore` vs `exclude` split) |
| **Sphinx nitpicky mode** With `default_role='py:obj'` and `nitpicky=True`, a bare backticked token becomes a cross-reference and an unresolvable one fails the build; `nitpick_ignore` is the hatch. The genuine conceptual ancestor. Scoped to Python objects only. | **BORROW** (hatches keyed to `(kind, target)`, not line numbers) |
| **rustdoc `broken_intra_doc_links`** Resolves backticked symbols in doc comments, denied in CI. Its history shows backtick candidates need leniency heuristics, which is your main false-positive risk. | **BORROW** (backticks make it a candidate, absence means be lenient) |
| **markdownlint / markdownlint-cli2** MIT, ~5k stars, active. 60+ rules; MD001 heading increment, MD003 style, MD013 length, MD043 required structure, MD051 fragments. Zero code-reference awareness. | **REUSE** for rule-shape lint |
| **remark-validate-links** MIT, remarkjs, active. Validates `[text](path)` and `path#heading` against real files and headings, offline and git-aware. | **REUSE** for markdown links |
| **Vale** MIT, ~5k stars. Its `script` check runs Tengo with only the `text` module and a `scope` string: no filesystem, no shell, so it structurally cannot read the repo. | **REUSE** for em dashes and prose style only |
| **lychee** Apache-2.0/MIT, 3.9k stars. | **REUSE** for external URL liveness |
| **fiberplane/drift** MIT, 133 stars, active. `drift link` binds a doc to an AST symbol via XxHash3 fingerprint and fails CI when the anchored code changes. Mechanically opposite: detects anchored code changing, not references resolving. Unanchored stale backticks are invisible. | **BORROW** (AST fingerprinting, later) |
| **agnix / cclint** Schema linters for CLAUDE.md/AGENTS.md/SKILL.md. No reference resolution. | **BORROW** (frontmatter schema validation for `paths:`) |
| **Doc-example testers** (markdown-doctest, mdBook test, Rust/Python doctest, doc-drift-guard) and **snippet transclusion** (embedme, mkdocs Snippets) | **IGNORE**. Both operate on fenced **blocks**. Transclusion does nothing for "run `npm run check:images`" in a sentence, and your anchors are overwhelmingly inline mentions. |
| **knip / ts-prune / depcheck / dotenv-linter / scriptlint** | **IGNORE**. None read markdown. |
| **GitHub native Actions budgets** ([docs](https://docs.github.com/en/billing/how-tos/set-up-budgets)) Budgets block runners when exceeded, with threshold alerts. | **REUSE** for spend enforcement; keep your check only if it estimates minutes *before* merge, which GitHub does not do. |

---

## 3. Hooks

**karanb192/claude-code-hooks** ([repo](https://github.com/karanb192/claude-code-hooks)), MIT, 484 stars, 20 plugins, 1,570 tests, all Node. Ships **`git-safety`** (blocks pushes to main/master, protected-branch deletion, direct changes on a protected branch, destructive `gh` operations, tiered by `HOOK_SAFETY_LEVEL`), **`config-guard`** (blocks the agent tampering with settings.json and hooks), and **`guard-pack`** (all six guards in one ~35ms process). Not better than yours on substance: no documented worktree handling, no per-repo carve-outs, no opt-out. But it is better engineered than a first draft. **BORROW**: the tiered safety-level env var, `config-guard` as a concept you do not have, and `guard-pack`'s single-process batching.

**mattpocock/skills git-guardrails**: a skill that installs a bash PreToolUse hook. No worktree, quoting, or override handling documented. **IGNORE**.

**hookify** (official, Apache-2.0): declarative markdown-plus-frontmatter rules compiled into hooks, five event types, **ships zero pre-built rules**. **BORROW** the authoring format if you want your carve-outs declarative.

Two doc caveats that must shape the guard. First: "Because the `if` filter is best-effort, use the permission system rather than a hook to enforce a hard allow or deny." Your no-direct-master guard should be a hook **plus** a `permissions.deny` entry, not a hook alone. Second: community writeups document the exact fail-open trap you are guarding against, where a missing `jq` exits 0 and passes everything through.

For the SessionStart pin check, [BrunoMiguelMonteiro's gist](https://gist.github.com/BrunoMiguelMonteiro/9a60d4c792fb5b0c3f79c2e4fcb2c5e0) reads `~/.claude/plugins/installed_plugins.json`, runs `git fetch` in each marketplace clone, and counts `git rev-list --count installed..HEAD`. **BORROW** the caching (once per day via a timestamp file) and note the open Claude Code bugs (#25244, #35752, #46081, #44276) showing `plugin update` reads a stale marketplace cache. Those bugs are themselves an argument for vendoring.

---

## 4. Workflow skills

**obra/superpowers** ([repo](https://github.com/obra/superpowers)), MIT, 13 skills across 15 harnesses, SessionStart activation hook. Ships `using-git-worktrees`, `finishing-a-development-branch`, `requesting-code-review`, `writing-plans`, `executing-plans`, `dispatching-parallel-agents`, `writing-skills`. **No ADR, no retro, no handoff, no conventions lookup, no manifest or sync concept.** Your worktree and ship skills overlap materially; the rest do not. **BORROW** `writing-skills` as your skills-authoring reference rather than writing that chapter cold.

**Official plugins** (Apache-2.0, 33.9k stars): `commit-commands` (commit/push/PR) overlaps the first half of `/ship`; `claude-md-management` ships `claude-md-improver` (audits CLAUDE.md against the codebase) and `/revise-claude-md` (captures session learnings) which is the direct analogue of `/house-rules:revise-docs`, but it **appends to CLAUDE.md**, which is precisely the behavior your skill exists to prevent. `code-review`, `pr-review-toolkit`, `feature-dev`, `security-guidance`, `session-report`, `claude-code-setup`: adjacent, not competing. **REUSE** `commit-commands` and `pr-review-toolkit` rather than rebuilding; **IGNORE** `claude-md-management` and say why in your handbook.

**ECC** ([affaan-m/ECC](https://github.com/affaan-m/ECC)), MIT, 286 skills across 7 harnesses. Despite the volume it has **no ADR, retro, handoff, worktree, ship, or conventions skill**. It does have "manifest-driven targeted component installation with state tracking," worth a look. Star count reported inconsistently by scrapers; treat as large but unverified.

---

## 5. Handbook and ADRs

**microsoft/code-with-engineering-playbook**: 13 sections (code reviews, CI/CD, source control, documentation, observability, security). **Contains nothing on AI coding agents.** No license stated in the README. **IGNORE** as a source, **BORROW** its section taxonomy.

**Diátaxis** ([diataxis.fr](https://diataxis.fr/)): adopted by Cloudflare, Gatsby, Vonage. **No enforcement tooling exists.** Worth adopting as a structuring discipline, not as a dependency.

**ADR tooling**: `adr-tools` (5.6k stars) is **GPL**, which matters if house is MIT: shell out to it, never copy from it. **MADR** ([adr/madr](https://github.com/adr/madr)) is the template to adopt, and `log4brains` builds a searchable ADR site from MADR files. Verdict: **REUSE the MADR template**, hand-roll the `/adr` skill around it.

*Caveat: one delegated sweep on GitLab handbook, llms.txt, and Backstage TechDocs did not return before this report. Those three are the thinnest part of the survey.*

---

## (a) Five strongest opportunities, ranked

1. **Replace refuse-on-hash-mismatch with copier's synthetic-baseline merge, but keep refusal as the default.** Store `{upstream_version, upstream_content_sha}` in the lock, re-fetch the *pinned old* version, and you have all three merge inputs for `git merge-file`. Then `--merge` becomes opt-in. Critical constraint: use `.rej` sidecar semantics, never inline `<<<<<<<` markers. An agent reading a rule file containing conflict markers will follow both branches or one at random, which is worse than a stale rule.
2. **Split "deviation" from "drift," using cruft's `skip` plus projen's marker.** A deliberately forked file goes in `house.json` as a deviation and is skipped forever. An accidental change fails loudly. Add `house check` to `prebuild` so it gates the way your existing checks do. This is the single biggest correctness gap in the current design.
3. **Stamp every vendored file with a self-describing provenance header**, ruler's idea upgraded: `<!-- house: module@version sha256:... -->`. Drift detection then needs no lock lookup, and any human opening the file knows it is managed. Pair with the **`InstructionsLoaded` hook** as your positive control that the rule actually loads.
4. **Add copier's `_migrations` keyed to version ranges.** Rule modules get renamed, split, and merged. A hash comparison cannot express "`testing.md` became `testing/unit.md` in v3," so a rename degrades into delete-plus-add and destroys local deviations.
5. **Shrink `check.mjs` and let commodity be commodity.** Delete from scope: external URLs (lychee), `[text](path)` and `path#heading` (remark-validate-links), heading style and length (markdownlint MD001/MD003/MD013/MD043), em dashes (one Vale rule or a regex). Keep the anchor resolver, the `paths:` glob validator, the ratchet, and the two or three rule-shape rules no generic linter expresses. Also pin the no-direct-master guard with a `permissions.deny` entry, because the docs say the hook `if` filter is best-effort and fails open.

## (b) Genuinely novel

- **Versioned cross-repo distribution of `paths:`-scoped rule files with hash drift detection and recorded deviations.** No tool does this. Symlinks are the only incumbent and they discard every property you want.
- **Anchor resolution across six classes in a polyglot repo.** ctxlint does paths and npm scripts; Sphinx and rustdoc each do one language's symbols. **Nobody** validates `#id` against rendered `dist/` HTML, CSS class prefixes in use, or env vars referenced in code.
- **Upstream-first `/house-rules:propose`.** Every tool surveyed answers a local edit by merging, overwriting, or ignoring. None routes it back to the source.
- **Retro as invariants plus deltas plus proposals.** 286 ECC skills and 13 superpowers skills contain no analogue.
- **A single zero-dependency `check.mjs`.** Every candidate is an npm, cargo, or pip install.
- **`## Don't` sections, no-dates-in-rule-prose, and the length ratchet** as lintable rule shape.

## (c) Does anything make the initiative unnecessary?

**No.** The nearest single answers each fail on one axis. `ai-rulez` has remote includes and a `verify` command but no pinning, no lock, and does not emit `paths:`-scoped rules. Packmind has versioning, drift detection, and glob scoping but is an org-scale Docker/K8s platform with approval workflows, wrong shape for one person. Native symlinks are free and instant but give up every guarantee the manifest exists to provide. RuleSync.dev has cross-repo sync but is closed SaaS with no path scoping.

The sharpest warning is **Continue.dev Hub**: the strongest versioned rule registry, acqui-hired by Cursor in June 2026, repo read-only, hosted content deleted, DNS gone. Anything that resolves rules at runtime from someone else's service is one acquisition from failing. Vendoring is the correct architecture, and that is the case to make in ADR one.

**Sources:** [Claude Code memory](https://code.claude.com/docs/en/memory) · [plugins reference](https://code.claude.com/docs/en/plugins-reference) · [hooks reference](https://code.claude.com/docs/en/hooks) · [ai-rulez](https://github.com/Goldziher/ai-rulez) · [copier](https://github.com/copier-org/copier) · [cruft](https://github.com/cruft/cruft) · [projen](https://github.com/projen/projen) · [vendir](https://github.com/carvel-dev/vendir) · [Packmind](https://github.com/PackmindHub/packmind) · [ruler](https://github.com/intellectronica/ruler) · [ctxlint](https://github.com/YawLabs/ctxlint) · [fiberplane/drift](https://github.com/fiberplane/drift) · [markdownlint](https://github.com/DavidAnson/markdownlint) · [remark-validate-links](https://github.com/remarkjs/remark-validate-links) · [Vale](https://docs.vale.sh) · [claude-code-hooks](https://github.com/karanb192/claude-code-hooks) · [superpowers](https://github.com/obra/superpowers) · [claude-plugins-official](https://github.com/anthropics/claude-plugins-official) · [ECC](https://github.com/affaan-m/ECC) · [ai-coding-config](https://github.com/TechNickAI/ai-coding-config) · [agent-engineering-handbook](https://github.com/d-padmanabhan/agent-engineering-handbook) · [code-with-engineering-playbook](https://github.com/microsoft/code-with-engineering-playbook) · [Diátaxis](https://diataxis.fr/) · [adr-tools](https://github.com/npryce/adr-tools) · [MADR](https://github.com/adr/madr) · [GitHub Actions budgets](https://docs.github.com/en/billing/how-tos/set-up-budgets) · [plugin update checker gist](https://gist.github.com/BrunoMiguelMonteiro/9a60d4c792fb5b0c3f79c2e4fcb2c5e0)

---

Research complete across five clusters. Three subagents are still running on template-sync and rules-centralization depth, but I independently covered that ground; findings below are from sources I fetched and verified myself plus the completed handbook survey.

## The two verified facts your design rests on

Both of your stated premises check out, quoted from current docs:

- **Plugins cannot ship rules.** `code.claude.com/docs/en/plugins-reference` enumerates exactly twelve component types (skills, commands, agents, workflows, output-styles, themes, hooks, MCP, LSP, monitors, bin, settings). There is no `rules` type, and the doc says plainly: *"A `CLAUDE.md` file at the plugin root is not loaded as project context. Plugins contribute context through skills, agents, and hooks rather than CLAUDE.md."*
- **`@` imports do not save context.** `code.claude.com/docs/en/memory` states: *"Splitting into `@path` imports helps organization but doesn't reduce context, since imported files load at launch."*

But the same memory doc surfaces a third fact that undercuts part of component 1: **`.claude/rules/` natively supports symlinks for exactly your use case**, with the documented example `ln -s ~/shared-claude-rules .claude/rules/shared`. Also note `paths` is confirmed as the frontmatter key, path-scoped rules trigger on file read (not every tool use), rules without `paths` load at launch, and there is a 1,000-expanded-pattern / 4 MiB brace budget per rule. Plugin manifests do support `dependencies` with semver constraints and a `version` pin, so your marketplace half gets versioning for free.

## Candidates

**ctxlint (YawLabs)** — github.com/YawLabs/ctxlint — Lints AI context files against the actual codebase: broken backticked file paths, build/test commands that do not match package.json scripts or Makefile targets, env var syntax, YAML frontmatter, stale context, token waste, contradictions. 41 core rules plus 29 MCP and 12 session rules. Overlap: component 2, almost completely. Better? **Yes.** It already does the check you called novel, ships as a single self-contained zero-runtime-dependency bundle with a GitHub Action, `--fix`, `.ctxlintignore`, and exit codes 0/1/2. Verdict: **REUSE.** MIT, v0.9.10.

**agents-lint (giacomo)** — github.com/giacomo/agents-lint — Zero-dependency Node ≥18 linter for AGENTS.md/CLAUDE.md/MEMORY.md: verifies referenced paths exist, verifies `npm run <script>` targets exist in package.json (workspace-aware), flags files over 15,000 chars, flags pre-2024 date references, checks MEMORY.md frontmatter. Overlap: component 2, including your length limits and your "no dates in rule prose" rule. Better? Yes for those specific checks. Verdict: **REUSE or BORROW** its scoring model (0 to 100, errors -15, warnings -7) as your ratchet mechanism. MIT.

**agnix (agent-sh)** — github.com/agent-sh/agnix — 448 rules across nine tools validating CLAUDE.md, AGENTS.md, SKILL.md, hooks and MCP configs for spec correctness, with three-tier autofix, LSP, IDE plugins, GitHub Actions, WASM. Overlap: component 2's rule-shape lint and manifest/frontmatter validation. Better? Yes on breadth and packaging. Verdict: **REUSE** for shape and schema validity. MIT OR Apache-2.0.

**copier** — copier.readthedocs.io — Template engine whose `copier update` regenerates a fresh project at your pinned template version, diffs it against your working tree to extract local edits, then replays those edits onto the new template version. State lives in `.copier-answers.yml`; conflicts surface as git-style inline markers or `.rej` files; versions pin to PEP 440 git tags. Overlap: component 1's manifest, pin, and sync. Better? **Yes on the merge semantics, no on fit.** Verdict: **BORROW** the answers-file-plus-three-way-merge model. Your design refuses to overwrite locally edited files; copier shows that refusal is the weak option, because you can instead replay the local delta onto the new upstream and only stop at true conflicts.

**ai-rules-sync (lbb00)** — github.com/lbb00/ai-rules-sync — The closest direct competitor to component 1. `ais` CLI pulls rules, skills, commands and subagents from arbitrary git repos into a global cache at `~/.config/ai-rules-sync/repos/`, then symlinks them into projects. Has `ais check` (are you behind upstream) and `ais update --dry-run`. Better? Partly: the cross-repo distribution mechanism is built and yours is not. But it has **no pinning, no lock file, and no local-modification detection**, because symlinks mean upstream changes propagate instantly. Verdict: **BORROW** the global-cache-plus-symlink layout; keep your pin and lock. Unlicense.

**Packmind** — github.com/PackmindHub/packmind — Open-core context engineering platform: captures standards, versions them as auditable artifacts, distributes to eight agent formats (CLAUDE.md, .cursor/rules, AGENTS.md, copilot-instructions), supports glob scoping, and ships a "Context-Evaluator" that flags outdated rules. Overlap: components 1 and 2. Better? Not for you: it is a Docker/Kubernetes server with submission and approval workflows, sized for an org with RBAC and SOC 2. Verdict: **BORROW** the "context as versioned auditable artifact plus drift evaluator" framing. Apache-2.0, 307 stars.

**ruler / ai-rulez / rulesync** — github.com/intellectronica/ruler, github.com/Goldziher/ai-rulez, npmjs.com/package/rulesync — All three read a single in-repo source (`.ruler/`, `.ai-rulez/`) and fan out to per-tool config files. Overlap: superficial. Better? No: this is cross-**tool** fanout inside one repo, not cross-**repo** distribution, which is the axis you care about. Verdict: **IGNORE** for component 1, though ai-rulez's 33 builtin rule domains are a content reference. rulesync is very active (v8.23.0).

**TechNickAI/ai-coding-config** — github.com/TechNickAI/ai-coding-config — 18 commands, 24 agents, 6 skills, 33 rules, distributed by bootstrap script, plugin marketplace, or symlink, with an `/ai-coding-config update` that "shows what changed, lets you choose what to update, preserves your customizations." Overlap: components 1 and 4. Better? No: the update flow is undocumented internally and there is no manifest, lock, or pin. Verdict: **BORROW** the selective-update UX. MIT, 24 stars.

**karanb192/claude-code-hooks** — github.com/karanb192/claude-code-hooks — 20-plugin hook marketplace in Node. Includes `git-safety` (blocks pushes to main/master, protected-branch deletion, direct changes on a protected branch, destructive `gh` operations, tiered by `HOOK_SAFETY_LEVEL`), `config-guard` (blocks the agent tampering with its own guardrail config), `instructions-audit`, and `guard-pack` (six guards in one process, ~35ms instead of six spawns). Overlap: component 3, directly. Better? **Yes for the branch guard.** It is tested (1,570 tests across Node 18/20/22) and already tiered. It does not document worktree handling or per-repo carve-outs, which is your genuine delta. Verdict: **REUSE `git-safety` as the base, BORROW `guard-pack`'s single-process batching and `config-guard` wholesale.** MIT, 484 stars.

**hookify (Anthropic official)** — github.com/anthropics/claude-plugins-official — Define hooks as markdown files with YAML frontmatter in `.claude/`, matching on `bash`/`file`/`prompt`/`stop`/`all`, action `warn` or `block`. Ships **no** pre-built rules. Overlap: component 3's authoring layer. Verdict: **BORROW** the markdown-rule hook format so your guards are declarative rather than bash. Apache-2.0.

**mattpocock/skills git-guardrails** — github.com/mattpocock/skills — A skill that installs a PreToolUse bash hook blocking destructive git operations via exit code 2. Overlap: component 3. Better? No: no worktree handling, no override path. Verdict: **BORROW** only the skill-installs-a-hook pattern.

**obra/superpowers** — github.com/obra/superpowers — 13 skills across testing, debugging, collaboration and meta, including `using-git-worktrees`, `finishing-a-development-branch`, `requesting-code-review`, `writing-plans`, `executing-plans`, `writing-skills`. Distributed via marketplace across 15 harnesses, activated by a SessionStart hook. **No ADR skill, no retro skill, no cross-repo versioning or manifest.** Overlap: component 4, roughly half. Verdict: **BORROW** `using-git-worktrees` and `finishing-a-development-branch` as the starting text for your worktree and ship skills, and `writing-skills` as your skills-authoring chapter. MIT.

**Anthropic official plugins** — `claude-md-management` (audits CLAUDE.md against the codebase, plus `/revise-claude-md` to capture session learnings) is a near-exact match for your `revise-docs` skill, though it appends to CLAUDE.md rather than routing to the right file, which is precisely the behavior you want to avoid. `commit-commands`, `code-review`, `pr-review-toolkit`, `feature-dev`, `security-guidance` and `session-report` overlap component 4 in the commodity direction. `claude-code-setup` recommends automations per codebase. Verdict: **BORROW** claude-md-management's audit half; **IGNORE** its revise half. Apache-2.0, 33.9k stars.

**affaan-m/ECC** — github.com/affaan-m/ECC — 286 skills, 68 agents, hooks, manifest-driven selective install with state tracking, cross-harness memory. Overlap: component 4 by volume. Better? No: despite the scale it ships **no** ADR, retro, handoff, worktree, or conventions skill. Verdict: **BORROW** the manifest-driven selective install with state tracking. MIT.

**d-padmanabhan/agent-engineering-handbook** — github.com/d-padmanabhan/agent-engineering-handbook — 40+ glob-scoped `.mdc` rules, 35+ skills, slash commands, an MCP server for on-demand rule retrieval, Cursor hooks, and an eval harness. Installed by copy, symlink, or `setup-workspace.sh`; consumers pin via git submodule or tag; `rules/INDEX.md` is the manifest. Overlap: components 1, 4 and 5 simultaneously. This is the single closest thing to your whole initiative. Better? No on drift semantics (no hashes, no lock), yes on the MCP-server retrieval idea. Verdict: **BORROW** the MCP-server-as-rule-retrieval alternative to vendoring. MIT.

**MADR / adr-tools / log4brains** — adr.github.io/madr, github.com/npryce/adr-tools, github.com/thomvaill/log4brains — MADR 4.0.0 is dual MIT/CC0 and is what every other tool defaults to. adr-tools is GPL bash on the older Nygard template but gets monotonic numbering and bidirectional supersede links right. log4brains is Apache-2.0 Node with a static site, low recent velocity. Verdict: **REUSE MADR's template verbatim; BORROW adr-tools' supersede semantics; IGNORE both CLIs.**

**FlorianBruniaux/claude-code-ultimate-guide** — 26k lines, 271 templates, a model-selection decision tree, 38 security hooks, 66 skills. Overlap: component 5's Claude Code chapter, already written at greater length. Verdict: **BORROW** its model-tiering tree and hook-security taxonomy as skeleton. CC BY-SA 4.0, 5.8k stars, updated three days ago. (Recorded verdict; see `docs/handbook/upstreams.md` for what was actually taken.)

**microsoft/code-with-engineering-playbook** — 13 engineering chapters under CC-BY-4.0, 2.7k stars, actively maintained, and **zero AI-agent content**. Verdict: **BORROW** the section taxonomy and link out rather than rewriting code review, CI and testing chapters.

**github/awesome-copilot** — 38.2k stars, MIT: the one real registry of instruction files scoped by `applyTo` globs, with a searchable portal and a machine-readable index. Verdict: **BORROW** the index-over-rule-files idea for your marketplace.

**Others checked and dismissed:** Cursor `.mdc` rules (BORROW the `alwaysApply` boolean; your `paths`-only frontmatter cannot express "always load this one"), llms.txt (publish-side companion, not a competitor; you already ship one), AGENTS.md (no registry, no content packs; BORROW nesting as a portability hedge), Diátaxis (no enforcement tooling exists after four years, which is the tell), Backstage TechDocs, GitLab handbook, Basecamp, adr-manager, awesome-cursorrules, cookiecutter, Yeoman.

## (a) Five strongest reuse or borrow opportunities

1. **Drop the docs-drift check and depend on ctxlint.** It validates backticked paths, npm-script commands, env vars and frontmatter against the real repo, ships zero-runtime-dependency with a GitHub Action, and has ignore files. Change: `.house/check.mjs` shrinks to a thin wrapper that runs `npx @yawlabs/ctxlint` plus your project-specific rules, and your CI budget concern largely evaporates. Cross-check its coverage against agents-lint and keep whichever wins per rule.
2. **Replace refuse-to-overwrite with copier's three-way merge.** Regenerate the pinned upstream version, diff against the working tree to extract the local delta, replay it onto the new version, and emit conflict markers only on real collisions. Your lock file's content hashes become the baseline for that regeneration rather than a tripwire. This turns every local edit from a blocked sync into an automatic carry-forward.
3. **Fork `git-safety` from karanb192/claude-code-hooks instead of writing the master guard.** Add your worktree awareness and manifest-driven carve-outs on top. Also take `guard-pack`'s single-process batching (your three hooks will otherwise cost three process spawns per tool call) and `config-guard` outright, since nothing in your plan stops the agent editing its own hooks.
4. **Adopt MADR 4.0.0 verbatim for `/adr`,** plus adr-tools' zero-padded numbering and bidirectional supersede links. Do not wrap either CLI (adr-tools is GPL with the wrong template; log4brains would bolt a Next.js site onto your stack).
5. **Reconsider vendoring against native symlinks.** `.claude/rules/` supports symlinked directories and files natively, and ai-rules-sync already implements global-cache-plus-symlink cross-repo distribution. Change: make symlink the default install mode and vendoring the opt-in for repos that must be self-contained (CI, collaborators, offline). That halves the surface of `/house-rules:sync`.

## (b) What remains genuinely novel

- **The per-repo `house.json` with recorded deviations.** Every tool surveyed tracks what version you are on; none records *why this repo deliberately differs from house*. copier stores answers, ai-rules-sync stores nothing, agent-engineering-handbook stores an index. A deviations ledger that the sync respects and the check validates is unserved.
- **`/house-rules:propose`, the upstream-first flow.** No tool has a path from "I edited a managed file locally" back to "so change it upstream." copier resolves conflicts locally and forgets; Packmind has approval workflows but they are org governance, not a solo loop.
- **The retro skill's invariants / deltas / proposals shape.** Nothing public does this. ECC's 286 skills have no retro; superpowers has none; the official plugins have none. The requirement that every check carry a `why` and a `remedy` is yours alone.
- **Rule-shape lint tied to house style** (imperative headings, mandatory `## Don't` section, no em dashes, no dates or version numbers in rule prose). agnix validates spec conformance and agents-lint flags pre-2024 dates, but the opinionated shape contract is not something an external linter can hold.
- **The handbook's join.** Roughly 60 percent of a generic engineering handbook already exists better under CC-BY (Microsoft), and the Claude Code chapter exists at greater length under CC BY-SA (ultimate-guide). What nobody has published is a real repo's invariants welded to the enforcement gates and the decisions behind them. Write that; link out for the rest.

## (c) Would anything make the initiative unnecessary?

No single candidate does. The closest is **d-padmanabhan/agent-engineering-handbook**, which spans rules plus skills plus commands plus hooks plus handbook in one MIT repo, but it has no drift detection, no lock, no per-repo config, and its content is framework-generic. **ctxlint does make component 2 largely unnecessary**, and that is the one component I would cut rather than build. **ai-rules-sync plus native symlinks makes roughly half of component 1 unnecessary**, leaving the pin, the lock, the deviations ledger and `/house-rules:propose` as the part worth writing.

One caution for the hook design, quoted from the hooks reference: *"Because the `if` filter is best-effort, use the permission system rather than a hook to enforce a hard allow or deny."* The `if` filter fails open when a Bash command cannot be parsed. Your no-direct-master guard should therefore match broadly and decide in-script, and be backed by a `permissions.deny` entry, not rely on `if` narrowing. On the SessionStart pin-behind notice: plain-text stdout on SessionStart **is** shown to the user (it is one of three events where that is true), so that design works as planned.

Sources: [plugins reference](https://code.claude.com/docs/en/plugins-reference), [memory docs](https://code.claude.com/docs/en/memory), [hooks reference](https://code.claude.com/docs/en/hooks), [ctxlint](https://github.com/YawLabs/ctxlint), [agents-lint](https://github.com/giacomo/agents-lint), [agnix](https://github.com/agent-sh/agnix), [copier update](https://copier.readthedocs.io/en/stable/updating/), [ai-rules-sync](https://github.com/lbb00/ai-rules-sync), [Packmind](https://github.com/PackmindHub/packmind), [ruler](https://github.com/intellectronica/ruler), [ai-rulez](https://github.com/Goldziher/ai-rulez), [ai-coding-config](https://github.com/TechNickAI/ai-coding-config), [claude-code-hooks](https://github.com/karanb192/claude-code-hooks), [superpowers](https://github.com/obra/superpowers), [claude-plugins-official](https://github.com/anthropics/claude-plugins-official), [ECC](https://github.com/affaan-m/ECC), [agent-engineering-handbook](https://github.com/d-padmanabhan/agent-engineering-handbook), [MADR](https://adr.github.io/madr/), [adr-tools](https://github.com/npryce/adr-tools), [log4brains](https://github.com/thomvaill/log4brains), [claude-code-ultimate-guide](https://github.com/FlorianBruniaux/claude-code-ultimate-guide), [code-with-engineering-playbook](https://github.com/microsoft/code-with-engineering-playbook), [awesome-copilot](https://github.com/github/awesome-copilot), [Diátaxis](https://diataxis.fr/), [llms.txt](https://llmstxt.org/)
