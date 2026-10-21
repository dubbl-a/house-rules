# Adjudicated rewords, batch C (github, evals, security, llm-output, retrieval)

Survey of Claude Code 2.1.306, 2026-10-21. Sources were read from the live docs (`<page>.md`, fetched 2026-10-21 into the scratchpad `adjC-docs/`), from `claude --help` on 2.1.306, and from the banked facts. Paths are relative to the survey-src root. Each OLD is one verbatim substring of the named file, checked with `grep -F`. Inventory items are numbered 1 to 28 in file order. The mapping is at the end.

Builder notes:
- `.claude/rules/house/{github,evals,security,security-server}.md` are vendored copies of the module files. Regenerate them with the repo's render or sync step. Do not hand-edit them.
- No entry adds a line. github.md stays at 160 lines.
- No rule NEW contains a date, a percent, or an em dash. Headings, Anchor: lines, and Receipts: lines are unchanged.

---

## E1. plugins/house/modules/github/rules/github.md, "Budget Actions minutes as account-wide money" (items 1, 24)

Verdict: AMEND
Evidence: https://code.claude.com/docs/en/github-actions.md lists "Set `--max-turns` in `claude_args` to limit iterations" and "Set workflow-level timeouts to avoid runaway jobs" under cost best practices. https://code.claude.com/docs/en/cli-reference.md says of `--max-turns`: "Exits with an error when the limit is reached. No limit by default."
Why: "caps nothing" hides an opt-in turn cap the action does have. The job timeout is already covered by this rule's own `timeout-minutes` line, so the NEW names only the turn cap. Item 24's cloud scheduled-task clause is rejected: this rule is about the Actions minutes pool, and saying where a cron could move is new advice, not a correction.
OLD: An agent workflow caps nothing; its minutes draw from the same pool.
NEW: An agent workflow sets no turn cap unless its `claude_args` pass `--max-turns`; its minutes draw from the same pool.

## E2. plugins/house/modules/github/rules/github.md, "Protect the default branch at the remote, and name an owner for what runs with privilege" (items 2, 25)

Verdict: AMEND
Evidence: https://code.claude.com/docs/en/auto-mode-config.md: "Auto mode allows pushes to any branch of the repository you're working in, including the default branch, and pull request creation by default." https://code.claude.com/docs/en/routines.md: "Claude pushes its work to a branch prefixed with `claude/` unless your prompt directs it to push to another branch. To control which branches a run can push to, use branch protection rules or rulesets on GitHub. ... GitHub applies them to the GitHub access you connected, so a rule that access can bypass doesn't block a run's push."
Why: the NEW merges both items into one sentence. Item 2's clause "a hosted review never blocks a merge" is dropped, because the gate rule's Anchor already says it. Item 25's text was meant for the Anchor; it moves into the rule sentence, so no Anchor edit is needed.
OLD: Require a pull request and passing required checks before the default branch moves, since the local hook floor binds only a machine that armed it.
NEW: Require a pull request and passing required checks before the default branch moves, with no bypass for the access an agent pushes through, since the local hook floor binds only a machine that armed it, auto mode allows a push to the default branch by default, and a cloud run's `claude/` branch prefix is a default, not a restriction.

## E3. plugins/house/modules/github/rules/github.md, "Gate every PR on checks that need no credential, and name what is not gated" (item 22)

Verdict: AMEND
Evidence: https://code.claude.com/docs/en/code-review.md: "A review never approves or blocks the pull request." https://code.claude.com/docs/en/code-review-local.md: "`--comment`: posts the findings on a GitHub pull request as inline comments", and "`--post`: on an `ultra` cloud review of a `github.com` pull request, preselects posting the finished findings to the PR".
Why: item 22's clause about the agent action is dropped. An Actions job can itself be wired as a required check, so "lands as a run log" is not always true.
OLD: A hosted agent review posts a neutral, non-blocking check: name it a gap, not a gate.
NEW: A hosted agent review posts a neutral, non-blocking check, and `/code-review`, local or ultra, posts only comments: name each a gap, not a gate.

## E4. plugins/house/modules/github/rules/github.md, "Give a workflow read-only permissions and pin every action by SHA" (item 23)

Verdict: AMEND
Evidence: https://code.claude.com/docs/en/github-actions.md shows every example workflow as `uses: anthropics/claude-code-action@v1`. The same page says: "When you install the app, you accept its full permission set. GitHub doesn't let you accept a subset. If your organization requires only the permissions the Claude Code GitHub Action uses, create a custom GitHub App with Contents, Issues, and Pull requests instead".
Why: "same pins" already says to repin. What the rule lacks is that the native setup arrives tag-pinned, and that the app's token sits outside the workflow's own `permissions:`. The docs show the tag form in their examples, not in the setup PR itself, so the NEW says "documented workflows".
OLD: A workflow the agent platform's setup installs counts too: same permissions, same pins.
NEW: A workflow the agent platform's setup installs counts too: same permissions, same pins, though its documented workflows pin the action by version tag; its shared app takes a permission set GitHub will not let you narrow, so where only the action needs an app, a custom one is the least-privilege route.

## E5. plugins/house/modules/github/rules/github.md, "Keep credentials out of the repo, the commit, and the chat" (item 26)

Verdict: AMEND
Evidence: https://code.claude.com/docs/en/cloud-environments.md: "Anyone who uses the environment can read the values. In an Anthropic-hosted environment, use a network secret instead for a key the agent proxy can attach to a request." The same page: "A network secret is an API key or token you store on a cloud environment so Claude can call that API from any session in the environment without seeing the key." Its table adds: "A key the agent proxy can't attach stays in an environment variable." https://code.claude.com/docs/en/github-actions.md shows the action running Claude Code inside the workflow.
Why: a workflow that runs the agent action is itself an agent session. Item 26 said "never an environment variable", but the docs allow one for a key the proxy cannot attach, so the NEW says "where the proxy can attach it".
OLD: Run a credentialed diagnostic as a workflow so the token stays with the runner and never enters an agent session.
NEW: Run a credentialed diagnostic as a workflow step with no agent in it, so the token stays with the runner and never enters an agent session; in a cloud session, hold a token as a network secret where the proxy can attach it, since anyone using the environment can read its variables.

Receipt check: docs/handbook/inventory.md TW-059 paraphrases the original source item and does not quote this rule line. No receipt edit.

## E6. plugins/house/modules/github/rules/github.md, "Enforce the branch policy where git resolves the ref, and let the text scan catch only the ways to disable it" (item 27)

Verdict: AMEND (wider than proposed)
Evidence: https://code.claude.com/docs/en/cloud-environments.md, "What carries over": "Plugins and marketplaces declared in your repo's `.claude/settings.json` | No | A cloud session doesn't install the plugins a repository turns on under `enabledPlugins`". The same section says cloud sessions "start from a fresh clone".
Why: the floor is armed by the house plugin's SessionStart hook (`plugins/house/hooks/hooks.json`: "Arms the floor (core.hooksPath) at session start"). Neither `.claude/settings.json` nor the settings template carries a hook. So nothing arms the floor in any cloud session, not only in the multi-repo and project-thread sessions item 27 names.
OLD: `plugins/house/hooks/no-direct-master.sh` treats a tampered or unarmed floor as unarmed and refuses any unreadable git verb.
NEW: `plugins/house/hooks/no-direct-master.sh` treats a tampered or unarmed floor as unarmed and refuses any unreadable git verb. A cloud session installs no plugin a repo declares, so nothing arms the floor there and the remote branch rule is the only guard.

## E7. plugins/house/modules/llm-output/rules/llm-output.md, "Refute with named lenses, drop by default, and log the drops" (item 3)

Verdict: AMEND
Evidence: https://code.claude.com/docs/en/code-review.md: "1. **Find**: several agents examine the diff and the surrounding code in parallel. 2. **Verify**: a verification step checks the candidate findings against the code and filters out false positives."
Why: the docs give no basis for "one agent per issue class". The NEW changes only that phrase and keeps the rest of the sentence.
OLD: already fans out one agent per issue class and verifies candidates before reporting
NEW: already runs several finder agents in parallel and a verification step that filters false positives before reporting

Receipt (quotes the same wrong claim):
File: docs/handbook/llm-output.md
OLD: Native floor, as of 2026-09-02: hosted Code Review fans out one agent per issue class and verifies candidates before ranking them,
NEW: Native floor, as of 2026-10-21: hosted Code Review has "several agents examine the diff and the surrounding code in parallel," then "a verification step checks the candidate findings against the code and filters out false positives" before ranking,

## E8. plugins/house/modules/llm-output/rules/llm-output.md, "Read agreement with a shown suggestion as anchored, not accurate" (item 4)

Verdict: AMEND
Evidence: https://code.claude.com/docs/en/skills.md: "**Version comparison**: runs a blind A/B between two versions of the skill". The same page says the skill-creator plugin is installed with "/plugin install skill-creator@claude-plugins-official".
Why: the comparator belongs to an official-marketplace plugin, not to the harness. The NEW uses the docs' own phrase rather than the blog's.
OLD: The harness's skill comparator already judges two outputs without knowing which is which
NEW: The skill-creator plugin's version comparison already runs a blind A/B between two versions of a skill

Receipt (adds the source for the corrected attribution):
File: docs/handbook/llm-output.md
OLD: Blinding is enforced in the file written to disk, not in the panelist's instructions.
NEW: Blinding is enforced in the file written to disk, not in the panelist's instructions. The native comparison the rule extends belongs to the skill-creator plugin, installed from the official marketplace and not built into Claude Code: its version comparison "runs a blind A/B between two versions of the skill" (https://code.claude.com/docs/en/skills#run-evals-with-skill-creator, read at Claude Code 2.1.306).

## E9. plugins/house/modules/evals/rules/evals.md, "Show the ratio and the sample, because one number is never the accuracy" (item 5)

Verdict: AMEND
Evidence: https://code.claude.com/docs/en/plugin-evals.md shows the summary header `CASE        WITH  W/OUT Δ      RUNS COST    NOTES`. The same page says "With one arm the table shows `SCORE` and `PASS%` columns" and "Perfect runs is the share of with-plugin runs where every grader passed."
Why: "reports a mean score" with "a mean alone" understates what the runner prints. Item 5's "reports no pass ratio across runs" is wrong too, because of PASS% and Perfect runs. The gap the runner leaves is the estimand.
OLD: the harness's eval runner repeats each case and reports a mean score, but a mean alone lets one set of runs read as near certain or near impossible, so attaching the sample and estimand to every rate is this repo's requirement
NEW: the harness's eval runner repeats each case and prints its run count beside a mean score, but names no estimand, so attaching the estimand to every rate is this repo's requirement

## E10. plugins/house/modules/evals/rules/evals.md, "Evaluate the path a session actually takes" (items 6, 19)

Verdict: AMEND
Evidence:
- https://code.claude.com/docs/en/cli-reference.md: "`--system-prompt` | Replaces the entire default prompt" and "`--append-system-prompt` | Appends to the default prompt".
- https://code.claude.com/docs/en/headless.md: "If you replace it, the run also starts without the git status snapshot". The same page says `--bare` skips "auto-discovery of hooks, skills, custom commands".
- https://code.claude.com/docs/en/plugin-evals.md: "`append_system_prompt` | | Text appended to the child session's system prompt".
- Banked gap fact (workflows#have-claude-write-a-workflow): the ultracode keyword "does NOT trigger from -p prompts".

Why: the NEW covers both carriers, the runner's field and the CLI flag, under one word: "appended". Item 6's parenthetical naming the runner field is dropped.
OLD: Tell the eval session about its environment in a system note rather than by editing the skill under test, since an instruction that is right for a normal session can send the eval elsewhere, and an edited skill is no longer the one being measured.
NEW: Tell the eval session about its environment in an appended system prompt rather than by editing the skill under test or replacing the default prompt, since an instruction that is right for a normal session can send the eval elsewhere, an edited skill is no longer the one being measured, and a replaced prompt drops defaults daily sessions run with; where the instrument's mode skips a trigger daily sessions see, such as skill discovery or a typed keyword, say the score covers explicit invocation only.

Receipt check: docs/handbook/evals.md line 74 ("in a system note") is a dated receipt of what was done then. Leave it.

## E11. plugins/house/modules/evals/rules/evals.md, "Deny the eval session what the project allows, and fail a run whose results contain the key" (items 7, 20)

Verdict: AMEND (two substitutions)
Evidence:
- https://code.claude.com/docs/en/permissions.md, "What runs before you trust a folder", row for `claude -p` or the SDK with the folder never trusted. Settings-file hooks and a project skill's `allowed-tools` are "Used. Workspace trust never gates a skill's `allowed-tools` in any session". Servers in `.mcp.json` are "Connected without asking, approved or not". `permissions.allow` is "Not used".
- The same page: "To match a parameter on an MCP tool, pass a deny rule with `--disallowedTools`. When Claude Code loads a settings file, it skips any `mcp__` rule that has parentheses."
- https://code.claude.com/docs/en/plugin-evals.md: "**Nothing personal or project-level loads.**"

Why: the rule's premise is right only for a trusted folder, and it misses skill grants and servers. Item 7's opening "Where the harness's eval runner drives..." moves into the Anchor so the rule sentence stays short.
OLD: Pass every project allow the eval does not itself grant as a deny, since project settings reach a session that loads them and a broad allow written for daily work is an open door in a measurement.
NEW: Pass every project allow, project skill tool grant, and project server the eval does not itself grant as a command-line deny, since a print-mode run uses a project's skill grants and servers even in a folder it never trusted, a trusted folder adds its allows, and a broad allow written for daily work is an open door in a measurement.
OLD: the harness denies by path and tool input only and keeps run output without a re-score path
NEW: the harness's own eval runner loads no project configuration, so the deny matters where this repo's driver starts the session, and the harness denies by path and tool input only and keeps run output without a re-score path

## E12. plugins/house/modules/evals/rules/evals.md, "Count what the agent did, not only whether it passed" (item 8)

Verdict: AMEND
Evidence: https://code.claude.com/docs/en/plugin-evals.md, grader types: "`tool_used` | `tool`, `input_match`, `min`, `max` | The number of calls to `tool` whose JSON-encoded input matches the optional `input_match` regex is between `min`, default 1, and `max`".
OLD: this package ships no comparison report, so the count is this repo's addition
NEW: the harness's eval runner can bound one tool's call count per run with a grader but prints no tool-call mix per arm, so the count is this repo's addition

## E13. plugins/house/modules/evals/rules/evals.md, "Split a score gap into its causes from the transcripts before building to close it" (item 9)

Verdict: AMEND
Evidence: https://code.claude.com/docs/en/plugin-evals.md, report: "A failed grader is already expanded with its explanation, and an `llm` grader also shows the judge's votes and the evidence it was shown".
Why: item 9's Anthropic blog clause is dropped. The same file's "Grade the grader too" line already tells the reader to read transcripts.
OLD: ; the record proposing a build names the transcripts read
NEW: ; the harness's eval report shows each run's grader explanations but splits no gap by cause, so the record proposing a build names the transcripts read

## E14. plugins/house/modules/evals/rules/evals.md, "Fingerprint what two arms compare, and print every field that differs" (items 10, 21)

Verdict: AMEND (two substitutions)
Evidence:
- https://code.claude.com/docs/en/headless.md: "The `system/init` event reports session metadata including the model, tools, MCP servers, and loaded plugins." The same page: "Claude Code validates each `--mcp-config` entry at startup and skips entries that fail validation ... The run continues and exits cleanly".
- `claude --help` (2.1.306), `-p`: "Settings files that fail validation are silently ignored in this mode".
- https://code.claude.com/docs/en/plugin-evals.md, aggregate-result.json: "`claudeVersion` | ... the Claude Code version that ran the suite".

OLD: Record the harness version and a fingerprint of the labels in force with each report, compare both between arms, and print one line naming every compared field that differs, since one changed value among many on a long line is easy to miss.
NEW: Record the harness version, the model, tool, server, and plugin lists the session reports at start, and a fingerprint of the labels in force with each report, compare them between arms, and print one line naming every compared field that differs, since print mode skips a bad settings file or server entry without failing, and one changed value among many on a long line is easy to miss.
OLD: this package ships no comparison tool, so the guard and its tests are this repo's addition.
NEW: the harness's eval runner records its version in each result document but compares nothing across reports, so the guard and its tests are this repo's addition.

## E15. plugins/house/modules/evals/rules/evals.md, "Report NOT EVALUABLE and NOT MEASURED rather than a fabricated zero" (item 17)

Verdict: AMEND
Evidence:
- https://code.claude.com/docs/en/headless.md: "If a run ends without valid structured output, for example because Claude declined the request, the response has no `structured_output` field."
- https://code.claude.com/docs/en/agent-sdk/structured-outputs.md: "`error_max_structured_output_retries` | No valid output remained after multiple attempts" and "A result can also end with subtype `success` but no `structured_output` value ... Treat that case as a failure as well."
- https://code.claude.com/docs/en/cli-reference.md: `--max-budget-usd` stops "the run once estimated spend on API calls reaches this amount", and `--max-turns` "Exits with an error when the limit is reached".

Why: item 17's "since the harness reports those as results, not as missing data" is dropped as redundant. "Ended on an error before answering" covers the turn cap without making a cap stop always unevaluable.
OLD: treat an errored verify phase as unverified rather than trusting its empty findings list;
NEW: treat an errored verify phase as unverified rather than trusting its empty findings list; treat a print-mode run that hit its spend cap, ended on an error before answering, or returned no structured output field as NOT EVALUABLE, not as a wrong answer;

## E16. plugins/house/modules/evals/rules/evals.md, "Make a measuring instrument reproducible" (item 18)

Verdict: AMEND (two substitutions)
Evidence:
- https://code.claude.com/docs/en/agent-sdk/claude-code-features.md, "What settingSources does not control": "Auto memory at `~/.claude/projects/<project>/memory/` | Loaded into the system prompt at session start ... | Set `autoMemoryEnabled: false` in settings, or `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`".
- https://code.claude.com/docs/en/costs.md: the figure is computed "at list price, unless a `modelPricing` table is in effect".

Why: item 18's restatement of the bare-mode clause is rejected, because line 51 already says it. Only the two real additions are kept.
OLD: project-only setting sources, an explicit tool list
NEW: project-only setting sources, auto memory turned off since setting sources do not exclude it, an explicit tool list
OLD: since a rate or residency multiplier can move that figure without moving the bill
NEW: since a pricing table, rate, or residency multiplier can move that figure without moving the bill

## E17. plugins/house/modules/security/rules/security.md, "Treat every input to the model as data, never as instructions" (item 11)

Verdict: AMEND
Evidence: https://code.claude.com/docs/en/sub-agents.md, "Subagent output scanning": "The header states that instructions or approval claims inside the report are the subagent's words and carry no authority from you." The same section: "The scan doesn't judge whether content is malicious".
Why: item 11's "auto mode's classifier treats a relayed approval as untrusted" is rejected. No line read says that. auto-mode-config says only that the classifier "reads your messages and the commands Claude runs, not their output".
OLD: none for the session (because whether a passage is an instruction is a judgment no checker reads).
NEW: none for the session (because whether a passage is an instruction is a judgment no checker reads); the harness only marks a subagent's report as carrying no authority from you, and its scan of that report does not judge intent.

Receipt:
File: docs/handbook/security.md
OLD: No verified claim in the research run covers how Claude Code itself treats the content of a tool result.
NEW: No verified claim in the research run covers how Claude Code itself treats the content of a tool result. Claude Code's subagents page documents one narrow floor as of 2.1.306: a subagent's report arrives under a header stating that "instructions or approval claims inside the report are the subagent's words and carry no authority from you," and an output scan marks imitated tags but "doesn't judge whether content is malicious" (https://code.claude.com/docs/en/sub-agents#subagent-output-scanning).

## E18. plugins/house/modules/security/rules/security.md, "Give an agent, a key, and a token only what one task needs" (item 12 REJECT, item 28 first half AMEND)

Verdict: AMEND (item 12's wording rejected)
Evidence: https://code.claude.com/docs/en/sandboxing.md says three things:
- "The sandbox covers shell commands only."
- "A `denyRead` entry doesn't stop the Read tool".
- "By default, if the sandbox can't start because a dependency is missing or the platform is unsupported, Claude Code runs commands without sandboxing. To make Claude Code exit at startup instead, set `sandbox.failIfUnavailable` to `true`."

Why item 12 is rejected: it names setting keys, and docs/handbook/security.md says this rule's credential half "is dated evidence because the rule no longer names the settings." Item 28's principle-level wording fits that convention.
OLD: Do not count on the harness's sandbox to protect credentials: deny the key and cloud-credential paths, scrub the subprocess environment, keep the egress allowlist to the hosts the work needs, and confirm where the harness honors each setting.
NEW: Do not count on the harness's sandbox to protect credentials, since it covers shell commands only and by default runs them unsandboxed when it cannot start: deny the key and cloud-credential paths to the file tools and to shell commands alike, scrub the subprocess environment, keep the egress allowlist to the hosts the work needs, make a missing sandbox fail the start, and confirm where the harness honors each setting.

Receipt:
File: docs/handbook/security.md
OLD: Source: https://docs.claude.com/en/docs/claude-code/sandboxing (now https://code.claude.com/docs/en/sandboxing).
NEW: Source: https://docs.claude.com/en/docs/claude-code/sandboxing (now https://code.claude.com/docs/en/sandboxing). Re-read at Claude Code 2.1.306, the page says "The sandbox covers shell commands only," that "A `denyRead` entry doesn't stop the Read tool," and that by default, when the sandbox can't start, "Claude Code runs commands without sandboxing" unless `sandbox.failIfUnavailable` is set; those three lines are why the rule names the file tools beside shell commands and asks a missing sandbox to fail the start.

## E19. plugins/house/modules/security/rules/security.md, "Review a change to agent config as code, and keep a second party on every consequential action", first line (item 28 second half)

Verdict: AMEND
Evidence: https://code.claude.com/docs/en/headless.md: "Without `--bare`, a `-p` session runs the hooks in a project's `.claude/settings.json` and connects the servers in its `.mcp.json`, even in a folder you've never trusted. A `-p` session shows no workspace trust dialog and no per-server approval prompt." https://code.claude.com/docs/en/permissions.md says the trust table's `.mcp.json` row is "Connected without asking, approved or not".
OLD: A hook, a server entry, a plugin, and a settings file all run or steer commands with the full access of whoever opens the repo, and no sandbox contains them.
NEW: A hook, a server entry, a plugin, and a settings file all run or steer commands with the full access of whoever opens the repo, no sandbox contains them, and a print-mode or SDK run uses a repo's hooks and servers without the approval an interactive session asks for.

Receipt:
File: docs/handbook/security.md
OLD: which closes one path for planting a new hook but does nothing about one already installed.
NEW: which closes one path for planting a new hook but does nothing about one already installed. A scripted run asks nothing either: per the headless page at Claude Code 2.1.306, "a `-p` session runs the hooks in a project's `.claude/settings.json` and connects the servers in its `.mcp.json`, even in a folder you've never trusted" (https://code.claude.com/docs/en/headless#start-faster-with-bare-mode).

## E20. plugins/house/modules/security/rules/security.md, "Review a change to agent config as code, and keep a second party on every consequential action", Anchor (item 13)

Verdict: REJECT
Evidence:
- Banked fact (https://code.claude.com/docs/en/permission-modes, Protected paths): protected-path writes are "routed to classifier in auto". So in auto mode a model can approve a config write, and "keep the model from approving its own config write" overstates the harness.
- `plugins/house/templates/settings.json` ships no ask rule, and it allows `Bash(gh pr merge*)`. A "content-scoped ask rule" is therefore not part of this package's anchor.

No text change.

## E21. plugins/house/modules/security/rules/security.md, "Scan code and dependencies for known flaws, and give every finding an end" (item 14)

Verdict: AMEND
Evidence: https://code.claude.com/docs/en/security-guidance.md says "None of the layers block writes or commits." Its stack table has "`/security-review` | One-time security pass on the current branch, run when you ask" and "In CI | Your existing static analysis and dependency scanners | Language-specific rules, supply-chain checks, and policy enforcement the plugin does not attempt".
OLD: a scheduled scan opens an issue, per github.md's scheduled-run rule.
NEW: a scheduled scan opens an issue, per github.md's scheduled-run rule; `/security-review` runs only when asked and the security-guidance plugin blocks nothing, so both sit beside the CI scan, not in place of it.

Receipt:
File: docs/handbook/security.md
OLD: The rule gives every finding an end but sets no time frame, and the coverage map marks that gap.
NEW: The rule gives every finding an end but sets no time frame, and the coverage map marks that gap. The Anchor's last clause rests on Claude Code's own security-guidance page at 2.1.306: "None of the layers block writes or commits," `/security-review` is a "One-time security pass on the current branch, run when you ask," and CI keeps "Your existing static analysis and dependency scanners" (https://code.claude.com/docs/en/security-guidance#how-this-fits-with-other-security-tools).

## E22. plugins/house/modules/security/rules/security-server.md, "Supply untrusted input as a parameter, never by building a string" (item 16)

Verdict: AMEND (moved into the Anchor; no line added)
Evidence: https://code.claude.com/docs/en/security-guidance.md: "The check runs after the edit lands and appends the warning to Claude's context for the next step." The same page says "None of the layers block writes or commits" and describes `/security-review` as a pass "run when you ask".
OLD: Anchor: a test per sink that feeds a quote, a tag, a newline, and a shell metacharacter and asserts each arrives inert.
NEW: Anchor: a test per sink that feeds a quote, a tag, a newline, and a shell metacharacter and asserts each arrives inert; the security-guidance plugin flags this class only after the edit lands and blocks nothing, and `/security-review` runs only when asked, so the test is the gate.

Receipt:
File: docs/handbook/security.md
OLD: The coverage map ties the rule to OWASP Top 10:2025 A05 Injection and CWE-79, 89, 78, 77, 94, and 20.
NEW: The coverage map ties the rule to OWASP Top 10:2025 A05 Injection and CWE-79, 89, 78, 77, 94, and 20. The Anchor's native-floor clause: the security-guidance plugin's per-edit check "runs after the edit lands and appends the warning to Claude's context," and "None of the layers block writes or commits" (https://code.claude.com/docs/en/security-guidance, read at Claude Code 2.1.306).

## E23. plugins/house/modules/retrieval/rules/retrieval.md, "Cite a primary source for every lesson, with the quote and where it was read" (item 15)

Verdict: AMEND (item 15 trimmed)
Evidence: https://code.claude.com/docs/en/tools-reference.md: "For most fetches, it then runs the prompt against the content in a separate model call, and Claude receives the result of that call rather than the raw page." The same section: "This makes WebFetch lossy by design."
OLD: Treat a secondary write-up as a pointer to the primary source, not a substitute for it.
NEW: Treat a secondary write-up as a pointer to the primary source, not a substitute for it, and a WebFetch result the same way: it is a model's answer about the page, so take the quote from the raw text.

Receipt:
File: docs/handbook/retrieval.md
OLD: and a citation without a quote and a location cannot be checked.
NEW: and a citation without a quote and a location cannot be checked. The WebFetch clause rests on the harness's own docs: for most fetches WebFetch runs the prompt "in a separate model call, and Claude receives the result of that call rather than the raw page," which the page calls "lossy by design" (https://code.claude.com/docs/en/tools-reference#webfetch-tool-behavior, read at Claude Code 2.1.306).

---

## Item to verdict map

| # | Run | Heading (short) | Verdict | Entry |
|---|---|---|---|---|
| 1 | main | Budget minutes | AMEND | E1 |
| 2 | main | Protect default branch | AMEND | E2 |
| 3 | main | Refute with named lenses | AMEND | E7 |
| 4 | main | Anchored agreement | AMEND | E8 |
| 5 | main | Ratio and sample | AMEND | E9 |
| 6 | main | Evaluate the path | AMEND (merged) | E10 |
| 7 | main | Deny the eval session | AMEND (merged) | E11 |
| 8 | main | Count what the agent did | AMEND | E12 |
| 9 | main | Split a score gap | AMEND | E13 |
| 10 | main | Fingerprint two arms | AMEND (merged) | E14 |
| 11 | main | Inputs as data | AMEND | E17 |
| 12 | main | Least privilege | REJECT (superseded by 28) | E18 |
| 13 | main | Agent config Anchor | REJECT | E20 |
| 14 | main | Scan and end findings | AMEND | E21 |
| 15 | main | Cite a primary source | AMEND | E23 |
| 16 | gap | Injection (security-server) | AMEND | E22 |
| 17 | gap | NOT EVALUABLE | AMEND | E15 |
| 18 | gap | Reproducible instrument | AMEND | E16 |
| 19 | gap | Evaluate the path | AMEND (merged) | E10 |
| 20 | gap | Deny the eval session | AMEND (merged) | E11 |
| 21 | gap | Fingerprint two arms | AMEND (merged) | E14 |
| 22 | gap | Gate every PR | AMEND | E3 |
| 23 | gap | Read-only permissions and SHA pins | AMEND | E4 |
| 24 | gap | Budget minutes | AMEND (merged; cloud clause rejected) | E1 |
| 25 | gap | Protect default branch | AMEND (merged) | E2 |
| 26 | gap | Keep credentials out | AMEND | E5 |
| 27 | gap | Enforce branch policy | AMEND (wider) | E6 |
| 28 | gap | security.md sandbox and MCP | AMEND | E18, E19 |

Totals: 28 items, of which 0 ACCEPT, 26 AMEND, and 2 REJECT. They become 23 passages: 22 amended and 1 rejected. There are 7 handbook receipt edits.

## PROPOSALS (behavior changes, not for this reword pass)

1. **Arm the floor in cloud sessions.** A cloud session does not install the house plugin, so its SessionStart hook never sets `core.hooksPath` there. A repo-level SessionStart hook in the rendered `.claude/settings.json` would arm the floor in a single-repo cloud session. Docs: "Your repo's `.claude/settings.json` hooks and permission rules | Yes, in a session with one repository". Multi-repo sessions and project threads would still be unarmed. This changes the settings template and render, so it needs a test in `tests/hooks/`.
2. **The settings template's own merge allow.** `plugins/house/templates/settings.json` allows `Bash(gh pr merge*)`, while security.md requires something that is not the model before a merge. The remote branch rule covers the default branch. A narrower template, an ask rule in place of the allow, is a judgment call for the owner. This is an observation, not a recommendation.

## Open questions

- **Q9: settled.** permissions.md: "When Claude Code loads a settings file, it skips any `mcp__` rule that has parentheses." The rule kind is not qualified, so allow, deny, and ask rules are all skipped. Only `--disallowedTools` carries a parameter-scoped MCP deny. The banked fact ("allow rules ... skipped") was narrower than the page.
- **Q11: half settled.** The "Git Destructive" default covers "deleting remote branches, tags, or releases" (auto-mode-config.md, the `--label` example output). So github.md's "Classify a merged branch" claim holds. No default soft_deny names a production migration; the only migration text is a user-written example entry. deployment.md's question stays open.
- **Q13: settled.** The SDK retries and then ends with `error_max_structured_output_retries` ("No valid output remained after multiple attempts"). A `success` result with no `structured_output` is possible too. The CLI omits the `structured_output` field. llm-output.md's "fails a printed run on an invalid schema" and "re-prompts ... up to its retry limit" both hold.
- **Q14: not settled.** The `regex` grader's `match` documents only `not_contains` and `"count:N"`. Presence is the default ("The JavaScript regex `pattern` is found in the target"). A literal `contains` value is not documented.
- **Outside this batch.** The gap addendum's "the strict server-config flag alone still loads connectors" conflicts with agent-sdk/claude-code-features.md, which lists `strictMcpConfig: true` as a way to disable claude.ai connectors. Worth a check by whoever owns the claude-code.md rewords.
