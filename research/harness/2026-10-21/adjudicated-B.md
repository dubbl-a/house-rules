# Adjudicated rewords, batch B (docs, engineering, testing, database, deployment)

Sources fetched 2026-10-21 into the scratchpad `fetchB/` folder: code.claude.com pages (memory, best-practices, code-review, code-review-customize, code-review-pull-requests, code-review-local, code-review-setup, code-review-troubleshooting, skills, tools-reference, auto-mode-config, permission-modes, sandboxing, settings-reference, llms.txt) and the prompt-audit source that `/doctor prompt-audit` runs, https://raw.githubusercontent.com/anthropics/skills/main/skills/claude-api/shared/prompt-audit.md. Line numbers below are lines in those fetched files.

Tally: 14 inventory items, 14 passages (no duplicates to merge). ACCEPT 0, AMEND 6, REJECT 8.

Key finding: the docs page describes the prompt audit with "such as" (memory.md:94), so its three named problem classes are examples, not the full list. memory.md:98 says "The audit runs through the bundled `/claude-api` skill", and that skill's prompt-audit.md names provenance, unenforced instructions, volatile specifics, the recency trap, and the empty-diff stance. So all four prompt-audit corrections are REJECT.

---

## 1. plugins/house/modules/docs/rules/docs.md
Heading: Anchor every claim to a grep-able token
Verdict: REJECT
Evidence: the same file already names this floor under "Don't document a command that does not exist": "The harness's prompt audit flags a command or file that does not exist in instruction files when someone runs it; the gate carries that check to the README, the changelog, and every scanned doc, on every commit." That matches memory.md:94 ("references to files or commands that don't exist"). The reword would repeat it and add a line.
OLD: (none)
NEW: (none)

## 2. plugins/house/modules/docs/rules/docs.md
Heading: Put a fact where its litmus test says it belongs
Verdict: AMEND (names the native floor; the classifier's version added a new sentence)
Evidence: best-practices.md:168 "For domain knowledge or workflows that are only relevant sometimes, use [skills](/docs/en/skills) instead." memory.md:88 "Move instructions that matter for only part of the codebase into [path-scoped rules]". memory.md:618 "The `/doctor` checkup proposes trims for a checked-in CLAUDE.md: it cuts content Claude can derive from the codebase". All are https://code.claude.com/docs/en/best-practices.md and https://code.claude.com/docs/en/memory.md. All of this guidance is about instruction files.
OLD: Anchor: none (because routing is a judgment call: a gate can measure a file's length, not whether a fact is in the right file).
NEW: Anchor: none (because routing is a judgment call: a gate can measure a file's length, not whether a fact is in the right file); the harness's routing guidance and its checkup's cuts cover instruction files, so routing the README, changelog, and archive is this repo's requirement.

## 3. plugins/house/modules/docs/rules/docs.md
Heading: State a rule as imperative, why, anchor, receipts
Verdict: REJECT (the current text is supported)
Evidence: prompt-audit.md:127 "#### 1e. Prohibition clusters - judge by provenance, not by whether the model "needs it"". prompt-audit.md:129 "does it carry a stated reason or encode a real business/policy constraint?" prompt-audit.md:119 "Unenforced instructions: rules no code path, eval, or reviewer checks". memory.md:98 "The audit runs through the bundled `/claude-api` skill." The classifier only saw the three examples on the docs page, which are introduced with "such as" (memory.md:94).
OLD: (none)
NEW: (none)

## 4. plugins/house/modules/docs/rules/docs.md
Heading: Move dates, names, and measured numbers out of rule prose
Verdict: REJECT (the current text is supported)
Evidence: prompt-audit.md:145 "The recency trap: one session's stumble encoded as a permanent rule". prompt-audit.md:146 "Volatile specifics: hardcoded paths, flags, version numbers, API claims with no verification date". prompt-audit.md:147 "Edits under this row and the Volatile-specifics row are proposed for the user to confirm and are never applied on a blanket request". The audit is on demand: memory.md:94 "run `/doctor prompt-audit` in a session".
OLD: (none)
NEW: (none)

## 5. plugins/house/modules/docs/rules/docs.md
Heading: Keep files under budget, and raise a ceiling only with a written reason
Verdict: REJECT (no misquote; the rule quotes the docs word for word)
Evidence: memory.md:614 (My CLAUDE.md is too large) "Files over 200 lines consume more context and may reduce adherence. Claude Code skips a file over 4 MiB." The classifier was quoting memory.md:88 instead ("Longer files consume more context and reduce adherence"). Both lines are on the page.
OLD: (none)
NEW: (none)

## 6. plugins/house/modules/docs/rules/docs.md
Heading: Cut, don't append, and trim on a fixed cadence
Verdict: REJECT (the current text is supported)
Evidence: prompt-audit.md:14 "**an audit that finds nothing should change nothing** - a clean surface is a valid outcome, and an empty diff beats a manufactured one." This is the audit that `/doctor prompt-audit` runs (memory.md:98).
OLD: (none)
NEW: (none)

## 7. plugins/house/modules/docs/rules/docs.md
Heading: Ship the docs and changelog edit in the same PR as the change
Verdict: AMEND (real inaccuracy: "only as a non-blocking nit" is not documented)
Evidence: https://code.claude.com/docs/en/code-review-customize.md:22 "A change that violates one of their rules becomes a finding at whichever severity level fits the issue." https://code.claude.com/docs/en/code-review.md:11 "A review never approves or blocks the pull request". code-review-pull-requests.md:54 says the check run "never concludes as a failure". None of the eight Code Review pages in llms.txt mentions an outdated document or says such a finding is capped at Nit (searched for "outdated", "stale", and "nit").
OLD: A hosted reviewer may flag a change that leaves a document outdated, but only as a non-blocking nit where it runs, so the template's binary is what holds it.
NEW: A hosted reviewer, where it runs, flags a change that breaks a CLAUDE.md rule but never blocks the merge, so the template's binary is what holds it.

## 8. plugins/house/modules/engineering/rules/engineering.md
Heading: Build the simplest thing that answers the question
Verdict: REJECT (the current text is supported; the reword would introduce an error)
Evidence: https://code.claude.com/docs/en/code-review-local.md:9 "Depending on your model and effort level, the review also covers reuse, simplification, and efficiency cleanups." code-review-local.md:164 "`/simplify` reviews for cleanup only and applies its fixes". The native review does flag reuse and simplification on a diff, as the current Anchor says.
OLD: (none)
NEW: (none)

## 9. plugins/house/modules/engineering/rules/engineering.md
Heading: Verify the served artifact, not the source
Verdict: AMEND (names the native floor; the classifier's "asserts nothing about the shipped bytes" could not be confirmed, so it is dropped)
Evidence: https://code.claude.com/docs/en/skills.md:25 "others, including `/verify`, run only when you invoke them". skills.md:58 "`/verify` | Build and run your app to confirm a code change does what it should, without falling back to tests or type checks". skills.md:73 says the bundled `/verify` does not get the before-commit instruction.
OLD: Anchor: a `postbuild` check reading the emitted bytes, eval case `verify-served-artifact`
NEW: Anchor: a `postbuild` check reading the emitted bytes, eval case `verify-served-artifact`; the bundled /verify runs the app only when invoked, so a byte check on every build is this repo's requirement

## 10. plugins/house/modules/engineering/rules/engineering.md
Heading: Read config from the environment, and keep build, release, and run separate
Verdict: AMEND (names the classifier floor and keeps the sandbox fact)
Evidence: https://code.claude.com/docs/en/sandboxing.md:32 "Reads | Most of the machine, including credential files such as `~/.ssh` and `~/.aws/credentials`". https://code.claude.com/docs/en/permission-modes.md:494, under "Allowed by default": "Reading `.env` and sending credentials to their matching API". https://code.claude.com/docs/en/auto-mode-config.md:31 "a force push, a secret entering the commit, ... stays blocked."
OLD: the sandbox treats reading a local env file as ordinary, so keeping
NEW: the sandbox reads a local env file by default and auto mode stops a secret entering a commit only by classifier judgment, so keeping

## 11. plugins/house/modules/testing/rules/testing.md
Heading: Give the agent a check it can run before you walk away
Verdict: REJECT (the CONFLICT is refuted; the current text is documented word for word)
Evidence: https://code.claude.com/docs/en/skills.md:71 "When a session starts with a skill named `verify` or `simplify` in place, Claude Code's commit instructions tell Claude to run it right before each commit, except for changes to docs or tests. This requires Claude Code v2.1.286 or later." skills.md:73 "The recipe that `/verify` records at your repo root is a project skill, so it counts." skills.md:202 says a same-named project skill "replaces the bundled command". skills.md:65 says `/verify` records a recipe only "without a recorded recipe", and that "At the repo root, the recorded skill replaces the bundled `/verify`." So the docs intend a repo `verify` skill, and nothing collides with it.
OLD: (none)
NEW: (none)

## 12. plugins/house/modules/database/rules/database.md
Heading: Add the table registry line in the same PR as the migration
Verdict: AMEND (real inaccuracy; the clause about which files a review reads could not be confirmed, so it is dropped rather than replaced)
Evidence: https://code.claude.com/docs/en/code-review.md:11 "A review never approves or blocks the pull request". code-review.md:25 "**Plans**: [Team and Enterprise]". There is no nit cap (see item 7). The include mechanics (code-review-customize.md:99 and :126: root-level files only, and only from a protected branch) do not say what else a review may read.
OLD: because the hosted review flags an outdated CLAUDE.md statement only as a non-blocking nit, reads a registry elsewhere only when a review instructions file asks it to, and is not available in every org.
NEW: because the hosted review never blocks a merge and is not available on every plan.

## 13. plugins/house/modules/deployment/rules/deployment.md
Heading: Migrate before deploying the code that reads the schema
Verdict: REJECT (the current text is supported; the reword would drop migrations)
Evidence: https://code.claude.com/docs/en/permission-modes.md:434, under "Blocked by default": "Production deploys and migrations". The classifier only read the auto-mode-config.md:269 summary ("production deploys").
OLD: (none)
NEW: (none)

## 14. plugins/house/modules/deployment/rules/deployment.md
Heading: Verify the deployed URL against the built file with the cache bypassed
Verdict: AMEND (names native behavior that defeats the rule's cache bypass; shortened)
Evidence: https://code.claude.com/docs/en/tools-reference.md:604 "Claude receives the result of that call rather than the raw page". tools-reference.md:613 "WebFetch caches each response for 15 minutes by default". tools-reference.md:606 "use `curl` via Bash for the unprocessed page".
OLD: write the fetch and diff commands inline in the runbook and list the markers the run must print).
NEW: write the fetch and diff commands inline in the runbook as a shell fetch, since WebFetch caches each response and hands back a model's extraction rather than the served bytes, and list the markers the run must print).

---

## Receipts and copies

- docs/handbook/{docs,engineering,database,deployment,testing}.md: none of them quotes any changed text, so no receipt entries are needed.
- Vendored copies in this repo carry the same text and need re-syncing (or the same edit):
  - .claude/rules/house/docs.md: OLD entries 2 and 7 appear verbatim.
  - .claude/rules/house/engineering.md: OLD entries 9 and 10 appear verbatim.
  - database and deployment are not vendored here.

## PROPOSALS (outside this batch; nothing here changes a checker)

- github module, same inaccuracy as items 7 and 12. plugins/house/modules/github/rules/github.md and .claude/rules/house/github.md:68 say "A hosted review flags stale docs only as a non-blocking nit where it runs". docs/handbook/github.md:90 cites a "code-review.md#claudemd" statement about outdated documentation that the current pages no longer contain. Suggested wording: "A hosted review, where it runs, never blocks the merge, so the template makes the answer mandatory." This belongs to whoever owns the github batch.

## Open questions

- OQ1 (prompt-audit scope): SETTLED. The docs list examples ("such as", memory.md:94), and the audit's source (prompt-audit.md:14, 119, 127-129, 145-147) covers provenance, unenforced instructions, volatile specifics, the recency trap, and the empty diff. Drop all four docs.md prompt-audit corrections. Doubt: the source is anthropics/skills main, not text pulled out of the 2.1.306 binary. Changelog entry 1742 ("Improved `prompt-audit` on Claude Code configuration: stale paths, stale commands and contradicting instruction files now lead the report") is consistent with it.
- OQ2 (hosted review and stale docs): SETTLED as far as the current pages go. No Code Review page mentions outdated documents. A CLAUDE.md violation becomes a finding "at whichever severity level fits" (code-review-customize.md:22), and a review never blocks. Items 7 and 12 are AMEND, and the github PROPOSAL follows from this.
- OQ15 (built-in git instructions stage specific files): NOT SETTLED. settings-reference.md:3327 confirms that built-in commit and PR instructions exist in the Bash tool's description, but no page shows what they say.
- Also settled along the way: OQ8 (a repo `verify` skill replaces the bundled one, skills.md:202 and :65, so nothing overwrites it) and the migration half of OQ11 (permission-modes.md:434 blocks "Production deploys and migrations").
