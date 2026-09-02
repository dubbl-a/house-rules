<!-- docs-drift-ignore-file: point-in-time survey captured 2026-08-23; anchors record what was true on that date -->
# Source: external-guidance (survey agent output, 2026-08-23)

# Engineering best-practices brief: solo dev + Claude Code (researched 2026-08-23)

Rule shape: `RULE — why — source`. Tags: **[official]** = Anthropic/GitHub docs, **[widely-held]** = multiple credible sources, **[opinion]** = single source.

---

## (a) Documentation maintenance

1. **Keep root CLAUDE.md under 200 lines** — longer files consume context and measurably reduce adherence — https://code.claude.com/docs/en/memory — **[official]**
2. **For every line ask "would removing this cause Claude to make a mistake?" and cut if not** — bloated CLAUDE.md causes Claude to ignore your actual instructions — https://code.claude.com/docs/en/best-practices — **[official]**
3. **Exclude anything Claude can derive from the code** (file layouts, dependency lists, standard language conventions, "write clean code") — it costs tokens and buys nothing — https://code.claude.com/docs/en/best-practices — **[official]**
4. **Include only what Claude can't infer**: non-guessable bash commands, conventions that differ from defaults, env quirks, repo etiquette, gotchas, project-specific architectural decisions — that is the "why over what" payload — https://code.claude.com/docs/en/best-practices — **[official]**
5. **Move anything path-specific to `.claude/rules/*.md` with `paths:` frontmatter** — scoped rules load only when Claude reads a matching file, so unrelated sessions pay nothing — https://code.claude.com/docs/en/memory — **[official]**
6. **Move multi-step procedures and reference material to skills, not CLAUDE.md** — skills load on demand; only their description costs context every session — https://code.claude.com/docs/en/features-overview — **[official]**
7. **Keep a SKILL.md body under 500 lines and keep file references exactly one level deep from SKILL.md** — Claude partially reads (`head -100`) nested references and gets incomplete information — https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices — **[official]**
8. **Write skill descriptions in third person, stating both what it does and when to use it** — the description is injected into the system prompt and is the only signal for selection among 100+ skills — https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices — **[official]**
9. **Ban time-sensitive statements from docs; put superseded guidance in an "Old patterns" section** — dated conditionals silently become wrong — https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices — **[official]**
10. **Ship the docs edit in the same PR as the code that changes it** — when docs live in a separate PR they are an afterthought and drift — https://buildwithfern.com/post/docs-as-code — **[widely-held]**
11. **Never mix Diátaxis modes in one document** (tutorial / how-to / reference / explanation) — each serves a different user need and mixing them degrades all four — https://diataxis.fr/ — **[widely-held]**
12. **Prune on evidence, not schedule: if Claude repeatedly ignores a rule, the file is too long; if Claude asks a question the file answers, the phrasing is ambiguous** — treat CLAUDE.md like code and test changes by observing behavior — https://code.claude.com/docs/en/best-practices — **[official]**
13. **Enforcement anchor:** run `/doctor` on a checked-in CLAUDE.md — it proposes trims for derivable content and keeps pitfalls and rationale — https://code.claude.com/docs/en/memory — **[official]**
14. **Let auto-memory hold learnings, CLAUDE.md hold rules** — auto memory is Claude-written per-repo learnings capped at 200 lines / 25KB of `MEMORY.md`; CLAUDE.md is human-written instruction — https://code.claude.com/docs/en/memory — **[official]**

---

## (b) Software architecture

1. **Record each architecturally significant decision as a numbered, immutable ADR in-repo (`NNNN-title-with-dashes.md`)** — ADRs fight decision amnesia by capturing why, not just what — https://adr.github.io/ — **[widely-held]**
2. **Never edit a decided ADR; supersede it with a new one and mark the old `superseded`** — the history is the value — https://adr.github.io/ — **[widely-held]**
3. **Use Nygard's five sections (Title, Status, Context, Decision, Consequences) or MADR; keep each ADR short** — ADRs only work if they're easy to write and part of normal flow — https://adr.github.io/madr/ — **[widely-held]**
4. **Write an ADR only for decisions with measurable architectural effect** — a formal record for every choice devalues the set — https://adr.github.io/ — **[widely-held]**
5. **Diagram at C4 levels 1–2 (Context, Container) and stop unless a Component view earns itself** — the model is notation- and tooling-independent and levels are progressive zoom, not a required set — https://c4model.com/ — **[widely-held]** *(the site does not itself say "skip level 4" — see gaps)*
6. **Add complexity only when it demonstrably improves outcomes; start with the simplest thing that works** — Anthropic's stated first principle for agentic systems, and it generalizes — https://www.anthropic.com/engineering/building-effective-agents — **[official]**
7. **Prefer a predictable workflow (fixed code path) over an autonomous agent whenever the steps are knowable in advance** — agents are for open-ended problems where step count can't be predicted — https://www.anthropic.com/engineering/building-effective-agents — **[official]**
8. **Justify every configuration constant in a comment ("voodoo constants" ban)** — if you don't know why the value is right, neither will the agent — https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices — **[official]**
9. **Write instructions at the "right altitude": specific enough to guide, general enough to leave heuristics** — brittle if-else prompt logic and vague high-level guidance both fail — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents — **[official]**
10. **Treat context as a finite resource: seek the smallest set of high-signal tokens** — attention degrades as context fills — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents — **[official]**
11. **Prefer just-in-time loading (paths, queries, links) over preloading data** — progressive disclosure keeps identifiers cheap and defers the payload — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents — **[official]**
12. **Consolidate near-duplicate tools/scripts into one** — proliferation burdens context and distracts the agent about which to pick — https://www.anthropic.com/engineering/writing-tools-for-agents — **[official]**
13. **Make error messages teach the fix, not just report the failure** — actionable errors steer the agent to a better strategy on the retry — https://www.anthropic.com/engineering/writing-tools-for-agents — **[official]**

---

## (c) Development workflow

1. **Give Claude a check it can run before you walk away — tests, build exit code, linter, screenshot diff** — without a pass/fail signal, "looks done" is the only signal and you become the verification loop — https://code.claude.com/docs/en/best-practices — **[official]**
2. **Require evidence, not assertion: the test output, the command and its return, the screenshot** — reviewing evidence is faster than re-running the check, and it covers sessions you didn't watch — https://code.claude.com/docs/en/best-practices — **[official]**
3. **Escalate the gate as autonomy rises: prompt → `/goal` condition → Stop hook → verification subagent** — each step trades setup for attention — https://code.claude.com/docs/en/best-practices — **[official]**
4. **Run an adversarial review in a fresh subagent context before calling work done, and tell it to flag only correctness/requirement gaps** — a reviewer prompted to find gaps will always find some, and chasing them causes over-engineering — https://code.claude.com/docs/en/best-practices — **[official]**
5. **Use plan mode when the approach is uncertain or the change spans files; skip it when you could describe the diff in one sentence** — planning has real overhead — https://code.claude.com/docs/en/best-practices — **[official]**
6. **Delegate file-heavy investigation to subagents** — they run in a separate window and return only a summary, keeping the main context clean — https://code.claude.com/docs/en/best-practices — **[official]**
7. **`/clear` after two failed corrections on the same issue** — context polluted with failed approaches loses to a clean session with a better prompt — https://code.claude.com/docs/en/best-practices — **[official]**
8. **Any rule that must hold every time becomes a hook, not a CLAUDE.md line** — CLAUDE.md is advisory context; a `PreToolUse` hook exiting 2 is enforcement — https://code.claude.com/docs/en/hooks — **[official]**
9. **Promote to a plugin the moment a second repository needs the same setup** — that is the documented trigger, and plugin skills are namespaced to avoid collisions — https://code.claude.com/docs/en/features-overview — **[official]**
10. **Set `disable-model-invocation: true` on any skill with side effects** — it saves context and guarantees only you fire it — https://code.claude.com/docs/en/features-overview — **[official]**
11. **Build three evaluations before writing extensive skill/rule documentation** — otherwise you document imagined problems instead of real gaps — https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices — **[official]**
12. **Keep pre-commit hooks under ~5 seconds; push slow checks (typecheck, full test suite) to pre-push or CI** — hooks slower than that get bypassed with `--no-verify` and then disabled — https://tildalice.io/pre-commit-hooks-vs-ci-when-to-skip-local-checks/ — **[widely-held]**
13. **Follow the pyramid: many fast unit tests, fewer integration, very few end-to-end** — filesystem/DB integration is far slower and flakier per unit of coverage — https://martinfowler.com/articles/practical-test-pyramid.html — **[widely-held]**
14. **Adopt Conventional Commits (`type(scope): description`, `!`/`BREAKING CHANGE` for major)** — it mechanizes changelog generation and version bumps — https://www.conventionalcommits.org/en/v1.0.0/ — **[widely-held]**
15. **Maintain CHANGELOG.md by hand under `[Unreleased]`, in reverse-chronological ISO-8601-dated sections** — a diff of the commit log is noise, not a changelog — https://keepachangelog.com/en/1.1.0/ — **[widely-held]**
16. **Version the conventions package with SemVer and never modify a released version** — declare its public surface (rule names, hook contracts) so bumps mean something — https://semver.org/ — **[widely-held]**
17. **Add `--dry-run` to every irreversible script and default destructive prompts to `[y/N]`, with an explicit `--yes` for automation** — preview plus an opt-in bypass beats removing the prompt — https://nickjanetakis.com/blog/cli-tools-that-support-previews-dry-runs-or-non-destructive-actions — **[widely-held]**
18. **Use the plan-validate-execute pattern for batch or destructive work: emit a plan file, validate it with a script, then apply** — machine-verifiable intermediate output catches errors before anything is touched — https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices — **[official]**

---

## (d) Deployment

1. **Store all config in environment variables; the repo must be publishable open-source at any moment without leaking a credential** — that litmus test is the whole rule — https://12factor.net/config — **[widely-held]**
2. **Avoid named config groups (`development`/`staging`/`prod`)** — they cause a combinatorial explosion that makes deploys brittle — https://12factor.net/config — **[widely-held]**
3. **Separate build, release, run strictly; give every release a unique ID and never mutate a release** — an append-only release ledger is what makes rollback possible — https://12factor.net/build-release-run — **[widely-held]**
4. **Keep the run stage simple even if the build stage is complex** — a runtime failure happens when nobody is watching; a build failure happens in front of you — https://12factor.net/build-release-run — **[widely-held]**
5. **Resist different backing services between dev and prod, even behind an adapter** — the tools gap is where "passed in dev, failed in prod" comes from — https://12factor.net/dev-prod-parity — **[widely-held]**
6. **Verify the live deployment, not the build artifact: smoke-test the running URL end to end** — release testing proves shippability; deployment testing proves the deploy mechanism worked — https://bug0.com/knowledge-base/deployment-testing — **[widely-held]**
7. **Treat cache invalidation as part of the deploy and assert against a cache-busted fetch** — a correct build served from a stale cache is indistinguishable from a broken build until you bust it — https://bug0.com/knowledge-base/deployment-testing — **[widely-held]**
8. **Take a full backup immediately before any destructive migration and keep a tested, documented rollback path** — a rollback plan you haven't executed is a hypothesis — https://logisam.com/7-essential-database-migration-best-practices-for-2025/ — **[widely-held]**
9. **Run a post-migration schema/data diff rather than declaring success on exit code 0** — mismatches and missing rows do not raise errors — https://logisam.com/7-essential-database-migration-best-practices-for-2025/ — **[widely-held]**
10. **Decommission in phases: keep the old path read-only for a window after cutover** — it converts an irreversible cutover into a reversible one — https://streamkap.com/resources-and-guides/data-migration-best-practices — **[widely-held]**
11. **Keep a manual deploy step where the environment can't be reproduced** — no source found that manual deploy is wrong for solo projects (see gaps); make it a scripted, idempotent, single command regardless — **[opinion]**

---

## (e) GitHub workflow

1. **Prefer repository rulesets over classic branch protection** — several rulesets can target one branch (only one classic rule applies), enforcement can be toggled without deletion, and anyone with read access can see them — https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets — **[official]**
2. **On the default branch, require a PR, block force pushes, and require your CI check** — even solo, this makes the gate a property of the repo rather than of your discipline — same URL — **[official]**
3. **Enable "Automatically delete head branches"** — merged branches are deleted for you; note branch protection/rulesets can prevent it — https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-the-automatic-deletion-of-branches — **[official]**
4. **Enable secret scanning push protection** — it blocks credentials at push time across CLI, web UI, API, and the GitHub MCP server, before the secret is in history — https://docs.github.com/en/code-security/secret-scanning/introduction/about-push-protection — **[official]**
5. **Pin every third-party action to a full-length commit SHA** — "the only way to use an action as an immutable release" — https://docs.github.com/en/actions/reference/security/secure-use — **[official]**
6. **Set `permissions:` to read-only by default and grant write per job** — anyone with repo write access can read every configured secret, so token scope matters — same URL — **[official]**
7. **Never interpolate `github.event.*` directly into a `run:` block; route it through an intermediate env var** — that is the documented script-injection mitigation — same URL — **[official]**
8. **Never check out untrusted code in a `pull_request_target` workflow** — it runs in privileged context with cache access — same URL — **[official]**
9. **Keep the PR gate under ~1 minute** — a gate you route around is not a gate — **[opinion]**
10. **Configure `.github/dependabot.yml` (v2) with grouped updates and leave security updates on** — grouping cuts PR volume; security updates ignore PR limits and cooldowns — https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference — **[official]**
11. **Put issue and PR templates in `.github/`** — GitHub checks `.github/` first, then root, then `docs/`; one location removes the guesswork — https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/about-issue-and-pull-request-templates — **[official]**
12. **Install and use the `gh` CLI for all GitHub interaction from an agent** — CLI tools are the most context-efficient path, and unauthenticated API calls hit rate limits — https://code.claude.com/docs/en/best-practices — **[official]**
13. **Skip CODEOWNERS on a solo repo** — it only requests reviews, and it does nothing enforceable without required reviews enabled — https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners — **[official]**

---

## Things the sources DISAGREE on

- **Feature branches vs. direct-to-trunk for one person.** trunkbaseddevelopment.com says very small teams "may commit directly to trunk" after full local verification and warns against long-lived branches; Anthropic's Claude Code workflow ends every task at "commit with a descriptive message and open a PR." Both are defensible; the PR route buys you an enforcement point (required checks) that direct-to-trunk gives up. Neither source addresses the specific case of an *agent* producing the diff, which is the strongest argument for the PR gate.
- **Whether progressive disclosure saves context.** Anthropic promotes `@path` imports for organizing CLAUDE.md, but the memory docs state plainly that imports "still load and enter the context window at launch" — so imports organize, they do not economize. Only path-scoped rules and skills defer loading.
- **Pre-commit hook scope.** One camp runs formatters+linters at commit and everything else in CI; another treats pre-commit as redundant with CI entirely. Consensus is only on the speed constraint, not on whether local hooks should exist.
- **ADR formality.** adr.github.io restricts ADRs to "architecturally significant" decisions; MADR explicitly extends the format to "any significant decision, not just architecture." For a solo conventions package the MADR reading is more useful and the ADR-org reading keeps the set small.
- **Path-scoped rule reliability.** The docs say `paths:` rules load only on matching reads; an open bug report (anthropics/claude-code#16299) claims they load globally regardless. Do not assume the scoping works without checking `/context`.

## Notable gaps (no authoritative guidance found)

- **Manual vs. automatic deploy for solo projects.** No official or widely-held source addresses this tradeoff. All 12-factor/CD material assumes a team and pushes toward automation.
- **How long a CLAUDE.md/rules package should live before revision, or how to version conventions across repos.** SemVer covers libraries; nothing covers a rules package whose "API" is behavioral.
- **Testing an instruction package.** Anthropic prescribes evaluations for skills but states there is "not currently a built-in way to run these evaluations." There is no standard harness for asserting that a rule changed agent behavior.
- **C4 level guidance.** c4model.com does not itself say which levels to skip; the "stop at containers" advice is community folklore, not documented.
- **Push protection on free personal repos.** The GitHub page does not state free-tier availability for personal repos or a bulk-enable path — verify in settings rather than citing.
- **Rulesets "evaluate" mode.** Referenced widely in the wild, but the about-rulesets page documents only active/disabled. Confirm before building a rule around it.
- **Solo CODEOWNERS self-assignment.** GitHub's docs do not say whether a repo owner can be their own code owner or receive the request.

## URLs actually fetched

code.claude.com/docs/en/best-practices · /memory · /hooks · /plugins · /features-overview | platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices | anthropic.com/engineering/effective-context-engineering-for-ai-agents · /writing-tools-for-agents · /building-effective-agents | claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more | docs.github.com: /actions/reference/security/secure-use · /managing-rulesets/about-rulesets · /managing-the-automatic-deletion-of-branches · /secret-scanning/introduction/about-push-protection · /dependabot/working-with-dependabot/dependabot-options-reference · /customizing-your-repository/about-code-owners | 12factor.net/config · /dev-prod-parity · /build-release-run | adr.github.io · adr.github.io/madr | c4model.com | diataxis.fr | trunkbaseddevelopment.com | keepachangelog.com/en/1.1.0 | conventionalcommits.org/en/v1.0.0 | semver.org | blog.marcolancini.it/2026/blog-my-claude-code-setup

*Note: I was in plan mode, so this brief is returned inline rather than written to a file. No local files were touched.*
