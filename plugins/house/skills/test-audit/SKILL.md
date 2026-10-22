---
name: test-audit
description: This skill should be used when the user runs "/house-rules:test-audit", or asks to "audit the tests", "prune the test suite", "find redundant tests", or "speed up the test suite" for the current repo.
disable-model-invocation: true
---

# Test audit

Audits the current repo's tests with the house-rules method (#363): a survey of the suites and the
CI critical path, auditors over batches of test files, one merged candidate list, an Opus refuter
that plants a defect against every removal and merge claim, a builder that applies the confirmed
list as one commit in a worktree, and an Opus review with a bounded rework loop. The method is a
Workflow script, `test-audit.js` beside this file, which the steps below run. The skill writes a
branch and spends a lot of agent time, so it never fires on its own.

The agents apply the testing rules shipped with the plugin
(`${CLAUDE_PLUGIN_ROOT}/modules/testing/rules/testing.md`), not the repo's vendored copy, which
can lag until the next sync.

## Default path

1. Confirm the working directory is a git repo with a GitHub remote and name its default branch
   (`git symbolic-ref --short refs/remotes/origin/HEAD`). Stop if there is no remote: the CI
   survey and the PR step need one. The audit reads the default branch at origin, not the working
   tree.
2. State the agent count before starting: about 12 to 16 (survey, up to 4 auditors and their
   re-reads, merge, up to 4 refuters, builder, reviewer, and 2 agents per rework round, at most
   2 rounds). Ask for a go-ahead if the user has not already given one. `apply: false` stops after
   the refuters and builds nothing.
3. Copy the script into the session scratchpad, because the Workflow tool only runs a script it
   can already read:

   ```
   cp ${CLAUDE_PLUGIN_ROOT}/skills/test-audit/test-audit.js <scratchpad>/test-audit.js
   ```

4. Run `Workflow({ scriptPath: "<scratchpad>/test-audit.js", args })` with:

   | arg | value |
   |---|---|
   | `root` | absolute path of the repo (`git rev-parse --show-toplevel`) |
   | `rules` | `${CLAUDE_PLUGIN_ROOT}/modules/testing/rules/testing.md`, expanded to an absolute path |
   | `scratch` | a directory under the session scratchpad, such as `<scratchpad>/test-audit` |
   | `date` | today's date as YYYY-MM-DD (the script cannot read the clock) |
   | `apply` | optional, default true |
   | `maxAuditors` | optional, default 4 |

   `root` and `scratch` must hold no spaces. The script creates branch `tests-audit-<date>` and a
   worktree under `<root>/.claude/worktrees/`.
5. When it returns, summarize for the user: how many findings were confirmed, refuted, and
   dropped (and why), the unread ranges if any, test counts and durations before and after, the
   CI critical path, every round's verdict from `rounds`, and the final verdict.
6. Only when the returned `verdict === 'ACCEPT'`, push the branch and open a PR from the
   worktree, using the repo's PR template. A `null` verdict means a review returned nothing, so
   the work is not reviewed: report that and stop. On `REWORK` after the last round, report
   `remainingMustFix` and stop: the maintainer decides. Never merge. If a PR body would pass GitHub's size limit, write a summary and attach
   the detail (the confirmed list with its planted-defect evidence) as a comment or file.

## The rework loop

After the first review, while the verdict is `REWORK` and fewer than 2 rework rounds have run, a
builder (Sonnet) fixes the must-fixes only as a new commit in the same worktree, and an Opus
refuter reviews that commit alone. After 2 rounds the script stops, logs that it stopped, and
returns the open must-fixes. A third round would mean the design is the problem; hand it to the
user.

## Hazards

- An auditor often reads only part of a large test file and reports it as done. The script has
  each auditor report the ranges it read and sends it back for the rest; do not shortcut that by
  raising `maxAuditors` past the number of files or by dropping the re-read.
- A "covered elsewhere" claim is not accepted until a planted defect makes the named covering
  test fail. Do not accept a removal the refuters did not confirm, even a plausible one.
- Running `npm run verify` (or any heavy suite) in several worktrees at once overloads a laptop
  and makes timing assertions fail for no reason. The script runs the builder once; do not run
  suites in parallel yourself while it works.
- A builder that stops early returns a placeholder report. Check the worktree (`git log`,
  `git status`, the diff), not the report, before pushing.
- The builder branches from the commit the refuters proved claims against, and stops and reports
  if branch `tests-audit-<date>` or its worktree already exists. Rerunning on the same date needs
  a new `date` or the old worktree and branch removed first.
- A PR body over GitHub's size limit is rejected: write a summary and attach the detail.
- The script pushes nothing and merges nothing. Pushing and the PR are this skill's step 6.

## When an edit takes effect

An edit to this skill or its script reaches a session only after the plugin updates (the next
release) or the session reloads plugins. The copy in the scratchpad is a snapshot: re-copy it
before every run.
