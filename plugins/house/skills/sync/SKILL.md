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

`--repo` defaults to the current directory. Nothing below invents a subcommand outside `init`, `render`, `check`.

## Default path: plan, then apply

Sync has exactly one default path. Run it in this order every time.

### 1. Confirm the repo has adopted house

Read `house.json` at the repo root. Missing `house.json` means this repo was never bootstrapped: stop and tell the user to run `/house-rules:bootstrap` first. Do not treat a missing manifest as "nothing to sync."

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

### 4b. Stage what render wrote, by path

```
git add house.json .house/ .claude/rules/house/
```

Add `scripts/house/` to that command only when the render plan listed a file there; git refuses the whole command when any pathspec matches nothing. By explicit path, never `git add -A`: the checker and CI read `git ls-files`, so a rendered file that is not staged is one nobody checks, and a blanket add would sweep in whatever else is lying in the tree.

Render's `Scaffolded` list (`.github/PULL_REQUEST_TEMPLATE.md`, `.github/workflows/pr-checks.yml`, the CLAUDE.md skeleton) is not a managed file, so the `[untracked]` warning cannot see it: review those files, then stage them by path too.

A scaffold is offered once per repo, not once per render. The lock's `scaffolds` list records which templates this repo has already been given; a template recorded there is never written again, whether or not its file is still on disk. So a `CLAUDE.md.house-skeleton` that was merged into `CLAUDE.md` and deleted stays deleted, and no re-sync has to `rm` it. If a repo wants one back, `render --apply --scaffold` writes any missing scaffold and still never overwrites a file that is there. Expect the `scaffolds` key to appear in the lock diff on the first sync at 0.2.3 or later; it is a record, not a hash, and nothing refuses on it.

### 5. Bump the pin

After a successful apply, update `house.json`'s version pin to the plugin version actually loaded this session. Read that version from:

```
${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json
```

Never read `installed_plugins.json` for this. `installed_plugins.json` records install state across repos and can lag or differ from what is loaded right now; `plugin.json` under `CLAUDE_PLUGIN_ROOT` is the version actually running this sync.

### 6. Verify with the vendored checker

Run the checker the way CI and `prebuild` will actually run it, not the plugin's own copy:

```
node .house/check.mjs
```

`node ${CLAUDE_PLUGIN_ROOT}/scripts/house check --repo <path>` runs the identical logic against the plugin's own payload and is useful before `.house/check.mjs` has been vendored into the repo (a first-time sync). Once the vendored copy exists, running it directly proves the file that ships is the file that passes, not a copy that only looks the same.

A `[untracked]` warning here means step 4b was skipped for that file; stage it and re-run. A `[gitignored]` finding means the ignore rule from step 4 still swallows a managed file.

### 7. Print doctor output

After check runs, run the doctor and report its lines:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/house doctor --repo <path>
```

What each printed line means (labels as `doctor` prints them):

- **`effective branch guard: plugin | repo | NONE`.**
  - `NONE`: no `house.json` and no repo-local hook. Nothing is guarding direct commits to a protected branch right now.
  - `repo`: a repo-local `.claude/hooks/no-direct-master.sh` file exists, or `.claude/settings.json` carries a `hooks` block. The repo hook wins during migration; the plugin hook defers and exits 0.
  - `plugin`: `house.json` exists and neither repo-local hook signal is present. The plugin hook is the one actually enforcing `branchPolicy` and `protectedBranches`. It prints as `plugin (recorded <date>)` when `house.json` carries a `guard` record and `plugin (unrecorded)` when it does not, which is only about whether the checker's `guard` warning is cleared: the hook enforces the same either way.
- **`jq on PATH: yes | no`.** The hook still denies without it (hand-written deny JSON), but report the gap so it gets fixed.
- **`pin vX matches plugin vY` | `pin vX differs from installed plugin vY`.** `house.json`'s `version` against the plugin's own `plugin.json`, the same comparison as step 5. `differs` means the pin bump has not landed yet or was skipped.
- **`npm wiring (.house/check.mjs referenced by): <scripts> | none found`.** Expect a `check:docs` (or equivalent lightweight) script invoking `.house/check.mjs --only=drift,todo` and a `check:house` script invoking the full `.house/check.mjs`. If either is missing, print the copy-pasteable snippet rather than editing `package.json` directly:
  ```
  "check:docs": "node .house/check.mjs --only=drift,todo"
  "check:house": "node .house/check.mjs"
  ```
- **`rule-load positive control: ...`.** Whether an `InstructionsLoaded` hook is wired; without one, a rule whose glob never matches looks exactly like a rule that does nothing.
- **`git-ignored house destinations: none | <paths>`.** Anything but `none` is a destination the checker cannot see; fix the ignore rule as in step 4.

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

## Don't

- Don't merge a locally modified file. There is no merge mode; refuse and route to one of the three exits.
- Don't overwrite a locally modified file under `--apply` without `--force-managed` naming that exact path.
- Don't read `installed_plugins.json` to decide the pin. Read the loaded plugin's own `plugin.json`.
- Don't compute the doctor lines by hand. `house doctor` is the CLI verb that prints them; this skill reports what it printed.
- Don't `git add -A` after render. Stage the rendered paths by name.
- Don't skip printing the plan before applying, even when every file is clean.
- Don't run against a repo with no `house.json` as if nothing needs to happen. Say so and stop.
- Don't file a multi-item digest issue for package-side findings. One issue per actionable item, or fix it upstream in the same session.
