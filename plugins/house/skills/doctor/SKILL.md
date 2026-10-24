---
name: doctor
description: This skill should be used when the user asks to "run the house doctor", "house doctor", "is house healthy here", "check house health", or to explain what a `house doctor` line means and what to do about it.
---

# House doctor

Run `house doctor` on a repo and explain each line it prints, with the next action for every line that is not clean. Read-only: this skill runs the doctor and explains. It never runs `render --apply`, `house confirm`, `house decline` or `house upgrade --apply` itself; it names them and lets the user run them. (`/house-rules:sync` is the skill that writes files.)

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/house doctor --repo <root>
```

Outside Claude Code (Antigravity CLI), where `${CLAUDE_PLUGIN_ROOT}` is not set, run `house <args>` instead of `node ${CLAUDE_PLUGIN_ROOT}/scripts/house <args>`: the plugin's `bin/house` is on the agent's PATH, and `${CLAUDE_PLUGIN_ROOT}` paths elsewhere in this skill are relative to the directory holding this `skills/` folder.

`<root>` is the repo root (the current directory when omitted). `--json` prints the same facts as one object. Report the lines the user needs to act on first, then the rest. Do not compute any line by hand; this skill reports what the doctor printed. The doctor always exits 0, so a clean exit proves nothing: read the lines.

## What each line means, and the next action

- **`effective branch guard: plugin | repo | NONE`.**
  - `NONE`: no `house.json` and no repo-local hook, or `branchPolicy` is `direct`. Nothing guards direct commits to a protected branch. Next: run `/house-rules:bootstrap` when `house.json` is absent.
  - `repo`: a repo-local `.claude/hooks/no-direct-master.sh` exists, or `.claude/settings.json` carries a `hooks` block. The repo hook wins during migration; the plugin hook defers and exits 0. Nothing to do.
  - `plugin`: `house.json` exists and neither repo-local signal is present, so the plugin hook enforces `branchPolicy` and `protectedBranches`. It prints `plugin (recorded <date>)` when `house.json` carries a `guard` record and `plugin (unrecorded; ...)` when it does not; that only decides whether the checker's `guard` warning is cleared, the hook enforces the same either way. Next, when unrecorded: add the `guard` record the line prints to `house.json`.
  - `floor (...)` and `remote (...)`: a recorded decision that the git hooks or the server's branch protection is the guard. Nothing to do; `floor` also says whether the floor is armed on this machine.
  - `caveat: assumes the house plugin is installed and enabled ...`. Printed once, under the first line that relies on the plugin (this one or the rule-load line). Doctor cannot verify plugin enablement from the repo alone; confirm in the session that the house plugin is enabled.
- **`git-hook floor: ...`.** Whether the vendored `.githooks/` tree is wired into git in THIS clone. The git setting that wires it lives in `.git/config`, so no clone, render or PR carries it; the checker never reads it (ADR 0008) and doctor is where it is reported.
  - `armed (...)`: git runs the floor. Nothing to do.
  - `NOT armed -- core.hooksPath is unset in this clone`: the floor is rendered and inert. Next: `house render --apply` arms it, as does starting a session in the repo with the plugin installed.
  - `NOT armed -- core.hooksPath is <other>`: another tool (husky, lefthook, a monorepo convention) owns the one hooks path. House never overwrites it. Next: chain the floor from the hooks there, or unset it and re-run render.
  - `not rendered here (missing: <paths>)`: at least one of the seven floor files is absent, and the line names which. All seven missing is a repo that has not rendered the floor. One missing is worse: every guard sources `.githooks/house-lib.sh` and exits non-zero when that fails, so a floor missing only the library fails every commit closed. Next: `house render --apply`.
  - `not applicable`: no `house.json` at this root, or `branchPolicy` is not `pr`.
  - Indented follow-on lines say what makes the floor quiet rather than protective. `foreign hooks in this clone's .git/hooks`: arming is refused, because the hooks path replaces `.git/hooks` wholesale; move those hooks into the chain first. `not executable`: git silently ignores a hook without the bit, a fail-open; next: `house render --apply` restores the mode (only for classes that can already read the file, so a deliberately 0600 hook comes back 0700). `reference-transaction: supported by git <version> (>= 2.28)` is fine; `inert on git <version> (needs 2.28)` is a real gap: below 2.28 `--no-verify` skips `pre-commit` and `pre-push` together and nothing else catches it, so next: upgrade git.
- **`jq on PATH: yes | no`.** The hook still denies without `jq` (hand-written deny JSON). Next on `no`: install `jq`.
- **`plugin version: <v>`.** The loaded plugin's own `plugin.json`. Information only.
- **`pin vX matches plugin vY` | `pin vX is behind installed plugin vY (...)` | `pin vX is ahead of installed plugin vY (...)` | `pin vX differs from installed plugin vY`.** `house.json`'s `version` against the plugin's own `plugin.json`.
  - `matches`: nothing to do.
  - `behind`: the pin bump has not landed. Next: `/house-rules:sync` (or `house render --apply` when the sync PR flow is not wanted).
  - `ahead`: the installed plugin is older than the pin. Next: update the plugin (`claude plugin update house-rules@house-rules`), restart Claude Code, re-run doctor. Never `render --apply`: it would roll the vendored files back to vY (#441).
  - `differs`: a version that is not plain semver on one side, so no direction is given. Next: read both versions and decide by hand.
- **`latest release vX; installed vY (N behind)` | `installed vY is the latest release` | `latest release vX; installed vY is ahead of it (unreleased)` | `latest release vX; installed Y is not a release version` | `latest release: not checked (<reason>)`.** The installed plugin against the latest published release of `dubbl-a/house-rules` (#305), which the pin line cannot see: a pinned install matches itself forever.
  - `(N behind)`: the install is older than the newest release. Next: `house upgrade` (prints the plan, writes nothing), then `house upgrade --apply`, then restart Claude Code and re-run doctor. See "When `house upgrade` refuses" below.
  - `is the latest release`: nothing to do. `ahead` is a local or unreleased plugin build; `not a release version` is the same with no release to compare.
  - `not checked`: offline, rate-limited or an unexpected response. Advisory only, never a failure; retry later.
- **`deep-research fork: current | STALE (<why>); rebuild with: <command> | not installed ... | not checked (...)`.** The `/deep-research` fork under `~/.claude/workflows/` (or `CLAUDE_CONFIG_DIR`). `current`: nothing to do. `STALE` or `not installed`: run the `--install` command the line prints. It builds the fork from the loaded plugin's script, so when the plugin is behind, move to the new plugin first and run it after. Advisory only.
- **`npm wiring (.house/check.mjs referenced by): <scripts> | none found`.** Expect a `check:docs` script invoking `.house/check.mjs --only=drift,todo` and a `check:house` script invoking the full `.house/check.mjs`. When either is missing, print this snippet for the user instead of editing `package.json`:
  ```
  "check:docs": "node .house/check.mjs --only=drift,todo"
  "check:house": "node .house/check.mjs"
  ```
- **`.claude/settings.local.json: present | absent`.** Information only; it must stay git-ignored (see the destinations line below).
- **`rule-load positive control: ...`.** Whether an `InstructionsLoaded` hook is wired and what its log witnessed. Without one, a rule whose glob never matches looks exactly like a rule that does nothing.
  - `repo (.claude/settings.json)`: the repo declares its own hook. Nothing to do.
  - `plugin hook; log <path>: last load <ts>, <n> of <m> vendored rules seen`: the plugin's hook is wired and has logged. When `<n>` is short of `<m>` the line continues `; not seen in this log: <names>`. Read that as a lead, not a verdict: the log self-trims, so a rule can appear there after loading only long ago. Next: open a file the named rule's `paths:` claims and re-run doctor. A name that survives is a rule whose scope is not reaching the files it was written for. The log is keyed by the main checkout's root, so a linked worktree or subdirectory writes to the same file; a `pooled <n> log files` line says how many legacy worktree-keyed logs were also read. This line carries the plugin-enablement caveat when the guard line did not.
  - `plugin hook declared; no log yet for this checkout`: next: start a session in this repo and re-run doctor.
  - `none wired`: nothing declares the hook. Next: add an `InstructionsLoaded` hook, or accept that rule loading is unverified here.
- **`target <name>: ...`.** One line per target in `house.json`. `verified:` means a logged load witnessed it; `unverified:` means nothing has, or the agent fires no instructions-loaded event. Information only.
- **`git-ignored house destinations: none | <paths>`.** Anything but `none` is a destination the checker cannot see. Next: narrow the ignore rule to `.claude/settings.local.json`, never `.claude/` or `.house/`.
- **`at-adoption steps not confirmed | declined | deferred for <module>: ...`.** Information, not a failure; they are settings no repo file shows. Report them as printed and never confirm, decline or defer on the person's behalf.
  - `not confirmed`: nobody has recorded the step. Next: do the step, then `house confirm <module> <step-id>`; or decide against it with `house decline <module> <step-id> --why "<reason>"`; or plan it for later with `house defer <module> <step-id> --why "<reason>" --until <YYYY-MM-DD> [--ref <url>]`. When the line says `sync first`, run `/house-rules:sync` first so the vendored checker reads the record.
  - `(deferral expired <date>)` on a not-confirmed step: it was deferred and the date passed. Next: ask whether it is now done (`house confirm`), still planned (`house defer` again with a new `--until`), or decided against (`house decline`).
  - `deferred`: steps planned for later, each with its `until` date, its reason, and the tracking link after a semicolon when one was given. Nothing to do until the date.
  - `declined`: decided-against steps. Nothing to do.
  - `at-adoption declined steps <module> no longer declares: ...`: remove those declined-step deviations from `house.json`.  `at-adoption deferrals <module> no longer declares: ...`: remove those deferred-step deviations from `house.json`. `at-adoption confirmations <module> no longer declares: ...`: remove them from `modules.<module>.confirmed`.
- **`house.json is present but unparseable: <error>`.** Next: fix the JSON; the lines above were computed without it.

## When `house upgrade` refuses

`house upgrade` with no `--apply` prints the plan and writes nothing. It edits the `ref` of the `extraKnownMarketplaces` entry (backup first), re-adds the marketplace at the tag and updates the plugin, at the scope where the entry lives: it handles a project or local scope entry when the install record matches the repo, run from that repo or with `--repo`. It refuses, writing nothing, when:

- a settings file it must read is unreadable or not valid JSON;
- more than one `extraKnownMarketplaces` entry names `dubbl-a/house-rules`;
- the plugin is not installed at the entry's scope, or is installed at a different scope than the entry (the two scopes disagree);
- the release list cannot be read (offline or rate-limited; exit 1);
- the tag is not a published release;
- the tag is below the installed version (add `--allow-downgrade`);
- the entry is unpinned (a branch ref, or none) and `--apply` lacks `--pin`;
- `claude` is not on `PATH`.

When a step fails after something was written, it prints what was done, what remains and a rollback. Fall back to the README's install section ("To move a pin") when it refuses and the cause cannot be fixed: remove the marketplace, move the `#vX.Y.Z` pin and the settings `ref` together, and re-add. After any move, restart Claude Code before relying on the new plugin.
