---
name: bootstrap
description: Sets up house in a repo for the first time, proposing a house.json manifest, vendored rules, and a CLAUDE.md skeleton, dry run by default. Use for "bootstrap house" or "adopt house here".
disable-model-invocation: true
---

# Bootstrap

Bootstrap turns an unmanaged repo into a house consumer. It probes the repo, proposes a
`house.json`, and on `--apply` writes the vendored rules, templates, and a CLAUDE.md skeleton.
It never edits an existing CLAUDE.md and it never runs twice over the same manifest.
It writes only the house half of CLAUDE.md, as a separate skeleton file, and leaves the
codebase-derived half to the harness's own init command, which generates a starting CLAUDE.md or
suggests improvements to the one already there.

This skill has side effects on disk, so it never fires on its own. Run it only when asked.

## Default path

1. Dry run: probe the repo and print the proposed `house.json`. Write nothing.
2. Show the proposal to the person running the skill and wait for them to say apply it.
3. Apply: write `house.json`, then render the rules, templates, and skeleton.
4. Print the wiring block below so the person can paste it into `package.json`, CI, and their
   terminal.

Do not skip step 2. A proposal the person never saw is not a proposal, it is a surprise.

## Refuse when a manifest exists

Before probing anything, check whether `house.json` already exists at the repo root.

If it exists, refuse. Print that the repo already has a manifest and point to `/house-rules:sync`
instead. This holds in dry run too: bootstrap never drafts a second proposal over a first one,
even one nobody applied yet. A repo gets exactly one bootstrap.

## Probe the repo

Run the CLI in dry run to gather what the proposal needs:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/house init --repo <path>
```

The probe reads, and does not write:

- Stack: presence of `package.json`, its scripts, and any framework config file at the root.
- Default branch: `git symbolic-ref refs/remotes/origin/HEAD`, falling back to the current branch.
- Top-level directories, to guess which optional modules apply (`db/` suggests `database`,
  a deploy config suggests `deployment`, and so on).
- Whether `.claude/rules/` or a branch-guard hook already exists, so the proposal can say what
  bootstrap would add versus what the repo already has.
- Whether the repo's current docs scanning already excludes an archive tier, to seed
  `scanArchive` from observed behavior rather than a guess.
- Whether `git check-ignore` says any house write destination (`.claude/rules/house/`, `.house/`)
  is ignored. The checker walks `git ls-files`, so an ignored rule file is invisible to it and
  the first run prints a zero it never earned. The probe warns and names the fix: ignore only
  `.claude/settings.local.json`, never `.claude/` or `.house/`.

## Propose house.json

Every module the probe cannot rule out goes into the proposal as `"detect"`, not `true` or
`false`. `"detect"` means the repo decides at render time, not the skill guessing on its behalf.
Core modules (`docs`, `engineering`, `github`, `claude-code`) are always on. Print the full
proposed `house.json` body, not a summary, so the person reviewing it can read every field
before anything is written.

## Apply: write the manifest, the rules, and the skeleton

Only after the person says to apply:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/house init --repo <path> --apply
node ${CLAUDE_PLUGIN_ROOT}/scripts/house render --repo <path> --apply
```

`init --apply` writes `house.json`. `render --apply` writes the vendored rule files, the
templates, `.house/check.mjs`, `.house/lock.json`, `.house/INDEX.md`, and one more file:

- If the repo has a CLAUDE.md, write `CLAUDE.md.house-skeleton` beside it. Do not open the
  existing CLAUDE.md and do not write into it.
- If the repo has no CLAUDE.md, still write `CLAUDE.md.house-skeleton`, not `CLAUDE.md` itself.
  Bootstrap never originates the repo's root file. A person merges the skeleton in by hand.

Either way, an existing CLAUDE.md is byte-identical before and after every bootstrap run. That
is the control this skill is held to: diff it before you apply, diff it again after, and if
anything moved, stop and say so instead of reporting success.

The skeleton is offered once per repo: `render` records it in `.house/lock.json` under
`scaffolds`, so once it has been merged into CLAUDE.md and deleted, no later render writes it
back. `render --apply --scaffold` is the way to ask for it again.

## Print the wiring

After a successful apply, print this block verbatim so it is copy-pasteable into a plain
terminal. Fill in nothing; the person adapts it to their `package.json` and workflow file.

```
Add to package.json scripts:
  "check:docs": "node .house/check.mjs --only=drift,todo"
  "check:house": "node .house/check.mjs"

Add a CI step that runs:
  node .house/check.mjs

Install the plugin once per machine:
  claude plugin marketplace add dubbl-a/house-rules
  claude plugin install house-rules@house-rules --scope user
```

If the repo has no `.claude/settings.local.json`, say so in the printed output. That file is
where a per-repo opt-out of a house module or hook would live, and its absence means the repo
is running on defaults only.

## After bootstrap

Tell the person what is not yet done: the skeleton still needs merging into CLAUDE.md by hand
and then deleting (it will not be written again),
the wiring block still needs pasting in, and `node .house/check.mjs` is worth a local run before
the first commit so the repo starts from a clean gate rather than an inherited failure. Stage the
rendered files by path first (`house.json .house/ .claude/rules/house/`, plus `scripts/house/`
only when render listed a file there, since git refuses a pathspec that matches nothing): until
they are staged the manifest family warns `[untracked]` per file, and a wholesale `.claude/` or
`.house/` ignore is a `[gitignored]` finding, because a file git cannot see is one no family
checks. None of that is this skill's job to do for them; bootstrap stops at render.

## Don't

- Don't write `house.json` or any rendered file during the dry run. Dry run only prints.
- Don't overwrite or append to an existing CLAUDE.md, ever, under any flag.
- Don't re-propose over a repo that already has `house.json`. Send it to `/house-rules:sync`.
- Don't guess a module on or off when the probe is ambiguous. Propose `"detect"` and let the
  repo decide.
