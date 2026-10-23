---
name: sync
description: This skill should be used when the user runs "/house-rules:sync", or asks to "sync house", "update vendored rules", "pull the latest house version", or "check managed files for local edits".
disable-model-invocation: true
---

# House sync

Bring a repo's vendored house files up to date with the installed plugin, without ever discarding a local edit silently. Invoke this skill only through `/house-rules:sync`. It is not a lookup skill and it writes files, so it never fires from a plain question about conventions (use `/house-rules:conventions` for that).

The CLI this skill drives:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/house <init|render|check> [--repo <path>] [--apply] [--force-managed <path>]
```

`--repo` defaults to the current directory. Nothing below invents a subcommand outside `init`, `render`, `check`, plus the read-only `doctor` (steps 0 and 7) and `changes <from> [<to>]` (step 7b).

## Default path: plan, then apply

Sync has exactly one default path. Run it in this order every time, starting at step 0.

### 0. Check the loaded plugin before touching the repo

Do this before any worktree, branch or render. Sync writes what the loaded plugin ships, so a stale plugin writes stale files.

First, is this session running an old copy? Claude Code keeps one directory per installed version next to `${CLAUDE_PLUGIN_ROOT}`, and a session keeps running the copy it loaded at start even after a newer one is installed. Read the loaded version from `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`, then list the newest cached version:

```
ls "$(dirname "${CLAUDE_PLUGIN_ROOT}")" | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1
```

The `grep` drops any entry that is not a plain `X.Y.Z` directory name, and `sort -V` compares numerically, so `0.22.10` sorts above `0.22.9` (a plain `sort` would not). If the loaded version is older than that newest one, stop here: tell the user the plugin was updated but this session still runs the old copy, and to restart Claude Code and run `/house-rules:sync` again. Do not create a worktree or run render.

Otherwise run the doctor (the same command as step 7) and read two of its lines now:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/house doctor --repo <path>
```

- **`latest release ...`.** When it says `(N behind)`, the loaded plugin is older than the newest published release, so a sync would pin the repo to an old version. Say so, point to the README's install section ("To move a pin": move the `#vX.Y.Z` pin and, when `~/.claude/settings.json` declares one, the `extraKnownMarketplaces` `ref`), and continue only if the user wants to sync to the loaded version. `not checked` (offline) never blocks.
- **`deep-research fork: ...`.** `current` needs nothing. `STALE (...)` or `not installed` does not block the sync: print the `--install` command doctor gave, once, in the sync report. `--install` builds the fork from the loaded plugin's script, so when the plugin is behind or the session is stale, tell the user to run it only after moving to the new plugin, not before.

### 1. Confirm the repo has adopted house

Read `house.json` at the repo root. Missing `house.json` means this repo was never bootstrapped: stop and tell the user to run `/house-rules:bootstrap` first. Do not treat a missing manifest as "nothing to sync."

Note three values now, before any render: `version` (call it vOLD; `render --apply` overwrites it with the loaded plugin's version, vNEW, so it cannot be read afterwards), `defaultBranch`, and `branchPolicy`.

With `branchPolicy` `pr`, do not write in the main checkout: the default branch is protected, and the PR is step 7b. Create the worktree now and run every later step with `--repo <worktree>`:

```
git fetch origin
git worktree add .claude/worktrees/house-sync-vNEW -b house-sync-vNEW origin/<defaultBranch>
```

Step 0 has already passed, so nothing was written before this point. With any other `branchPolicy`, work in the repo as it stands.

### 2. Plan (dry run)

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/house render --repo <path>
```

With no `--apply`, this only plans. It reads `.house/lock.json` (each entry: `path`, `module`, `source`, `bodySha256`) and compares the current body hash of every managed file on disk against the lock, then against what the newly rendered body would be. Classify each managed file into exactly one bucket:

- **Clean.** On-disk hash matches the lock. Plan: overwrite with the freshly rendered body.
- **Missing.** File absent from disk. Plan: restore it.
- **Locally modified.** On-disk hash matches neither the lock nor a rendered no-op. Plan: refuse. See the three exits below.

Print the plan before doing anything else. Do not apply anything in this step, even for clean or missing files.

### 3. Locally modified: three exits, never a silent choice

A locally modified managed file is not merged, not overwritten, and not quietly left alone. Print the diff between the on-disk file and what house would render, then print exactly these three exits, in this order, and stop for the file (it stays untouched under `--apply` too, it is simply excluded from the write):

1. **Upstream-first.** Open a PR against the house package repo itself (`dubbl-a/house-rules`) carrying the intended change, so the edit becomes the new house rule for everyone instead of a private fork. This is the preferred exit.
2. **Record a deviation and unmanage.** Add an entry to `house.json`'s `deviations` array with a `why`, drop the file from the managed set, and mirror it in the repo's CLAUDE.md `## Deviations from house` section. Use this when the edit is genuinely repo-specific and will never go upstream.
3. **Force the overwrite.** Run:
   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/house render --repo <path> --force-managed <path>
   ```
   Use this only when the local edit is confirmed disposable, never as the default because it is fastest. Ask the user to confirm before running it; never pick it unprompted on their behalf.

Do not offer a fourth option and do not turn this into an interactive menu that loops waiting for a choice. State the three exits as the outcome of the run, then let the user (or a later invocation of this skill) act on one.

### 4. Apply

Once clean and missing files are accounted for and every locally modified file has been routed to one of the three exits (or deliberately left refused), apply:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/house render --repo <path> --apply
```

This writes clean and missing files. It never writes a still-refused locally modified file; `--force-managed` is the only path that does, and only for the one path named.

If render printed a `warning: ... is git-ignored` line, stop and fix the ignore rule before going on: a destination git cannot see never reaches the checker or CI. Ignore only `.claude/settings.local.json`, never `.claude/` or `.house/`.

Render drops a default `paths:` glob that matches no tracked file, so a vendored rule's frontmatter can list fewer globs than the config or module default names. After adding files that glob would match, re-render so the rule loads on them.

If render or the checker printed `warning: module `<name>` is not in house.json, but <path> exists here`, a module shipped after this repo's `house.json` was written, and its rules are not vendored until the repo adds `"<name>": {"enabled": true}` under `modules`. Do not add the key yourself: copy the warning line verbatim into the sync PR body, under a line saying a new module applies to this repo and needs the adopter's choice. Render writes each detect module's paths into `.house/lock.json`, so the checker repeats this warning in the adopter's CI with no plugin installed there.

### 4b. Stage what render wrote, by path

```
git add house.json .house/ .claude/rules/house/
```

Add `scripts/house/` to that command only when the render plan listed a file there; git refuses the whole command when any pathspec matches nothing. By explicit path, never `git add -A`: the checker and CI read `git ls-files`, so a rendered file that is not staged is one nobody checks, and a blanket add would sweep in whatever else is lying in the tree.

Render's `Scaffolded` list (`.github/PULL_REQUEST_TEMPLATE.md`, `.github/workflows/pr-checks.yml`, the CLAUDE.md skeleton) is not a managed file, so the `[untracked]` warning cannot see it: review those files, then stage them by path too.

A scaffold is offered once per repo, not once per render. The lock's `scaffolds` list records which templates this repo has already been given; a template recorded there is never written again, whether or not its file is still on disk. So a `CLAUDE.md.house-skeleton` that was merged into `CLAUDE.md` and deleted stays deleted, and no re-sync has to `rm` it. If a repo wants one back, `render --apply --scaffold` writes any missing scaffold and still never overwrites a file that is there. Expect the `scaffolds` key to appear in the lock diff on the first sync at 0.2.3 or later; it is a record, not a hash, and nothing refuses on it.

### 4c. Gitignore tool scratch

Ensure the repo's `.gitignore` contains `.claude/worktrees/` and `.superpowers/`, appending whichever line is missing. Tool scratch that shows up in `git status` is one `git add -A` from being committed.

### 5. Confirm the pin

Confirm `house.json` now carries the loaded plugin version; render wrote it, never hand-edit it. `render --apply` sets the `version` field to the plugin version in:

```
${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json
```

Never read `installed_plugins.json` to check this. It records install state across repos and can lag or differ from what is loaded right now; `plugin.json` under `CLAUDE_PLUGIN_ROOT` is the version actually running this sync.

### 6. Verify with the vendored checker

Run the checker the way CI and `prebuild` will actually run it, not the plugin's own copy:

```
node .house/check.mjs
```

`node ${CLAUDE_PLUGIN_ROOT}/scripts/house check --repo <path>` runs the identical logic against the plugin's own payload and is useful before `.house/check.mjs` has been vendored into the repo (a first-time sync). Once the vendored copy exists, running it directly proves the file that ships is the file that passes, not a copy that only looks the same.

A `[untracked]` warning here means step 4b was skipped for that file; stage it and re-run. A `[gitignored]` finding means the ignore rule from step 4 still swallows a managed file.

### 7. Print doctor output

After check runs, run the doctor again (step 0 ran it before any write) and report its lines:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/house doctor --repo <path>
```

What each printed line means (labels as `doctor` prints them):

- **`effective branch guard: plugin | repo | NONE`.**
  - `NONE`: no `house.json` and no repo-local hook. Nothing is guarding direct commits to a protected branch right now.
  - `repo`: a repo-local `.claude/hooks/no-direct-master.sh` file exists, or `.claude/settings.json` carries a `hooks` block. The repo hook wins during migration; the plugin hook defers and exits 0.
  - `plugin`: `house.json` exists and neither repo-local hook signal is present. The plugin hook is the one actually enforcing `branchPolicy` and `protectedBranches`. It prints as `plugin (recorded <date>)` when `house.json` carries a `guard` record and `plugin (unrecorded)` when it does not, which is only about whether the checker's `guard` warning is cleared: the hook enforces the same either way.
- **`git-hook floor: ...`.** Whether the vendored `.githooks/` tree is actually wired into git in THIS clone. `core.hooksPath` lives in `.git/config`, so it is machine state no clone, no render and no PR carries; the checker never reads it (ADR 0008 keeps the checker repo-only) and doctor is where it gets reported instead.
  - `armed (core.hooksPath=<path>, <scope>)`: git runs the floor here. Nothing to do.
  - `NOT armed -- core.hooksPath is unset in this clone`: the floor is rendered and inert. `house render --apply` arms it, and so does starting a session in the repo with the plugin installed.
  - `NOT armed -- core.hooksPath is <other>`: another tool (husky, lefthook, a monorepo convention) owns the one hooksPath this repo has. House never overwrites it. Chain the floor from the hooks there, or unset it and re-run render.
  - `not rendered here (missing: <paths>)`: at least one of the seven floor files is absent, and the line names which ones. All seven missing is simply a repo that has not rendered the floor yet. One missing is worse than it looks: every guard sources `.githooks/house-lib.sh` and exits non-zero when that source fails, so a floor missing only the library fails every commit closed instead of failing open. Either way, render.
  - `not applicable`: no `house.json` at this root, or `branchPolicy` is not `pr`.
  - The indented follow-on lines report what would make the floor quiet rather than protective. `foreign hooks in this clone's .git/hooks`: arming is refused, because `core.hooksPath` replaces `.git/hooks` wholesale and would silently disable them. `not executable`: git silently ignores a hook without the bit, so a lost mode is a fail-open; render restores it (adding the bit only for the classes that can already read the file, so a deliberately 0600 hook comes back 0700 and is never widened). `reference-transaction: supported by git <version> (>= 2.28)` or `inert on git <version> (needs 2.28)`: on 2.28 and newer the floor has a member no flag turns off, and the inert line is a real gap rather than a cosmetic one. Below 2.28 `--no-verify` skips `pre-commit` and `pre-push` together and nothing else is there to catch it, so on that git the flag is refused only by the session-time PreToolUse hook, which is not there when no session is in the loop. Treat the line as a prompt to upgrade git, not as a note.
- **`jq on PATH: yes | no`.** The hook still denies without it (hand-written deny JSON), but report the gap so it gets fixed.
- **`pin vX matches plugin vY` | `pin vX is behind installed plugin vY (run \`house render --apply\` to sync)` | `pin vX is ahead of installed plugin vY (update the plugin: claude plugin update house-rules@house-rules, then restart Claude Code; render --apply would roll back)` | `pin vX differs from installed plugin vY`.** `house.json`'s `version` against the plugin's own `plugin.json`, the same comparison as step 5. `behind` means the pin bump has not landed yet or was skipped. `ahead` means the installed plugin is older than the pin: update the plugin and restart, and do not run `render --apply`, which would roll the vendored files back to vY (#441). `differs` is a version that is not plain semver on one side, so no direction is given.
- **`latest release vX; installed vY (N behind)` | `installed vY is the latest release` | `latest release vX; installed vY is ahead of it (unreleased)` | `latest release vX; installed Y is not a release version` | `latest release: not checked (<reason>)`.** The installed plugin against the latest published release of dubbl-a/house-rules (#305), which the pin line cannot see: a pinned install matches itself forever. Include this line in the sync report. `N behind` means the pin has not been moved to a newer release (the README's "To move a pin"); `ahead` is a local or unreleased plugin build; `not checked` is offline, rate-limited or an unexpected response, advisory only and never a failure.
- **`deep-research fork: current | STALE (<why>); rebuild with: <command> | not installed ... | not checked (...)`.** Read in step 0; repeat it in the sync report with the `--install` command when it is not `current`. Advisory only: it never fails a sync.
- **`npm wiring (.house/check.mjs referenced by): <scripts> | none found`.** Expect a `check:docs` (or equivalent lightweight) script invoking `.house/check.mjs --only=drift,todo` and a `check:house` script invoking the full `.house/check.mjs`. If either is missing, print the copy-pasteable snippet rather than editing `package.json` directly:
  ```
  "check:docs": "node .house/check.mjs --only=drift,todo"
  "check:house": "node .house/check.mjs"
  ```
- **`rule-load positive control: ...`.** Whether an `InstructionsLoaded` hook is wired, and what its own log has actually witnessed; without one, a rule whose glob never matches looks exactly like a rule that does nothing. `repo (.claude/settings.json)`: the repo declares its own hook. `plugin hook; log <path>: last load <ts>, <n> of <m> vendored rules seen`: the plugin's own hook is wired and has logged at least one load, with a real count of how many vendored rule files it has actually seen load. When `<n>` is short of `<m>` the line continues `; not seen in this log: <names>`, naming each vendored rule the log carries no load for, because the count alone says something is wrong and never which file to open. Read that list as a lead and not a verdict: the log self-trims, so a rule can appear there after loading only long ago, and the honest next step is to open a file the rule's `paths:` claims and re-run doctor. A name that survives that is a rule whose scope is not reaching the files it was written for. The log is keyed by the main checkout's root, so a session in a linked worktree or a subdirectory writes to the same file; doctor also reads the older `<root key>-.claude-worktrees-*.jsonl` logs and prints a `pooled <n> log files` line saying how many it read. `plugin hook declared; no log yet for this checkout`: the plugin's hook is wired but has not logged anything here yet -- start a session in this repo and re-run doctor. `none wired`: nothing declares the hook at all.
- **`git-ignored house destinations: none | <paths>`.** Anything but `none` is a destination the checker cannot see; fix the ignore rule as in step 4.
- **`at-adoption steps not confirmed | declined | deferred for <module>: ...`.** Information, not a failure. `not confirmed` lists steps nobody has recorded; a step marked `(deferral expired <date>)` was deferred and its date passed, so ask whether it is now done (`house confirm`), still planned (`house defer` with a new `--until`), or decided against (`house decline`). `deferred` lists steps planned for later, with their `until` date and the tracking link or reason. Report them as printed; do not confirm, decline, or defer on the person's behalf.

### 7b. Commit, and for `branchPolicy: pr` open the PR

Print the release notes between the old pin and the new one. Without a vOLD (no `version` in `house.json`) there is no range: say so and skip the body.

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/house changes vOLD vNEW
```

It prints the notes of each published release after vOLD up to vNEW, oldest first, as Markdown under a `## house-rules vOLD to vNEW` heading. They are the release notes as published, not trimmed to the modules this repo enables. Offline it prints `release notes not available (...)` with the releases URL and exits 0: put that line in the body as it is. If step 4 printed a `module ... is not in house.json` warning, add that line to the body too, as step 4 says.

For `branchPolicy: pr`, from the worktree (the split ORCHESTRATION.md draws: a subagent commits, the session pushes and opens the PR):

1. A subagent stages by path as in step 4b and commits with the subject `house sync vOLD to vNEW` and the `house changes` output as the body (write the subject, a blank line and the output to a file, then `git commit -F <file>`).
2. The session pushes the branch and opens the PR against `defaultBranch` with the same body.
3. Wait with `gh pr checks <n> --watch`. On a red or stuck check, report it instead of merging.
4. Merge only on the user's word. Then clean up: remove the worktree, delete the local branch, `git fetch --prune`.

For `branchPolicy: direct`, commit on the current branch with the same subject and body, and push only when the user asks. No worktree and no PR.

### 8. Route what the repo cannot fix upstream, one issue per item

A sync or compliance pass often surfaces findings and warnings only the package can act on: a
checker gap, a rule anchor naming a file that does not exist here, a config slot the repo needs
and the schema lacks. For each such item, either fix it upstream in the same session (branch and
PR against the package repo, the same upstream-first exit as step 3) or file ONE issue per
actionable item in the package repo, small enough to close with a single change.

Never batch them into a multi-item digest issue: a digest cannot be closed until its slowest item
lands, its items cannot be prioritized independently, and half-resolved digests accumulate. What
stays in this repo is only what this repo can fix.

## Escape hatches

These are exceptions surfaced inline in the default path above, not a separate menu to choose from up front:

- No `house.json`: stop at step 1, point to `/house-rules:bootstrap`.
- Locally modified file: the three exits in step 3.
- Confirmed-disposable local edit: `--force-managed <path>`, only after asking.
- First sync in a repo, `.house/check.mjs` not yet vendored: use `house check --repo <path>` in step 6 instead of the vendored path, and note that this is a one-time substitution, not the steady state.
- A branch cut before the default branch's sync: render the branch to the new version first, then merge the default branch with `-X ours`. A plain merge brings the other side's `lock.json` against this side's older bodies, and render then refuses those files as locally modified.

## Don't

- Don't merge a locally modified file. There is no merge mode; refuse and route to one of the three exits.
- Don't overwrite a locally modified file under `--apply` without `--force-managed` naming that exact path.
- Don't read `installed_plugins.json` to decide the pin. Read the loaded plugin's own `plugin.json`.
- Don't compute the doctor lines by hand. `house doctor` is the CLI verb that prints them; this skill reports what it printed.
- Don't `git add -A` after render. Stage the rendered paths by name.
- Don't skip printing the plan before applying, even when every file is clean.
- Don't run against a repo with no `house.json` as if nothing needs to happen. Say so and stop.
- Don't file a multi-item digest issue for package-side findings. One issue per actionable item, or fix it upstream in the same session.
