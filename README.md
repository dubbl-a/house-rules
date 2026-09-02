# house-rules

One maintainer's opinionated conventions for working in a repository with Claude Code, published so
other people can adopt them and shipped as a Claude Code plugin and marketplace. They keep changing,
and nothing reaches your repo without a person approving the diff, so read each update as you would a
dependency bump, take the parts you want, and fork the package for the last word. A repo never
imports house-rules; it adopts a rendered snapshot.

## What you get

No single piece below is novel. What this package puts together is the whole loop.

- **Vendored rule files** copied byte for byte, so a session reads them from your own checkout.
- **A lock file and a drift and tamper checker**: `.house/lock.json` hashes every managed file, and
  `node .house/check.mjs` catches a hand-edit, a stale doc reference, and a file over its ceiling.
- **A module manifest**, `house.json`, plus a deviations ledger and per-file ratchets: declining a
  default or raising a limit costs a dated, written reason the checker reads back on every run.
- **Paired behavioral evals**, `plugins/house/evals/`: a positive and a negative control per gate,
  holding a session to the rules under a real task.
- **Upstream-first sync**: the next version arrives as a plan you approve, and a locally modified
  managed file is refused with its diff rather than overwritten.

## The two tiers

**Rule files** are vendored byte-for-byte into a consuming repo's `.claude/rules/house/` by
`/house-rules:sync`. They are what a session reads: an imperative heading, a one-clause why, an
`Anchor:` line naming what enforces it, and a `Receipts:` pointer. Nothing explains itself at length.

**Handbook receipts** live here, in `docs/handbook/`, one chapter per rule file with a same-named
section for every heading it carries: the incident, the worked example, or the rejected alternative
that earned the rule. `docs/decisions/` holds the numbered ADRs for a call made once, not per repo.

## How this sits next to other tools

Skill packs teach a session a procedure while it works; this runs alongside one, not in place of it.
It covers the half that persists: conventions that live in a repository, with something that enforces
them. Rules are rendered and vendored into your repo because the Claude Code plugin format has no
rules component and a `CLAUDE.md` at a plugin root is not loaded (`docs/handbook/origins.md`), so your
own checkout is the only place a rule reliably lives. Cross-tool sync tools fan one source out to many
agents and copy-paste collections hand you a starting text; both finish at delivery, which is where
this package starts.

## Prerequisites

Node 22 or newer, `git`, and bash. The GitHub CLI (`gh`) is a requirement of the pull-request workflow
these rules assume rather than of the checker: the worktree cleanup script, the deploy guards, and the
handoff skill shell out to it. No language or framework is assumed. The docs gate resolves `npm run`
tokens against `package.json` scripts only where that file exists: the header comment on
`plugins/house/payload/check.mjs` says a checked repo may or may not have one, so without it they are
skipped, not failed. `bareScriptAllowlist` and `packageRoots` tune the rest.

## Adopting house-rules in a repo

Install the plugin once per machine:

    claude plugin marketplace add dubbl-a/house-rules
    claude plugin install house-rules@house-rules --scope user

Inside the target repo, run `/house-rules:bootstrap`. It probes the repo, proposes a `house.json`,
and on approval writes the vendored rules, templates, `.house/check.mjs`, `.house/lock.json`, and
`.house/INDEX.md`. Run `/house-rules:sync` later, after this package or the repo's `house.json` changes.

Wire the checker in by hand: add `"check:docs": "node .house/check.mjs --only=drift,todo"` and
`"check:house": "node .house/check.mjs"` to `package.json`'s scripts, and run `node .house/check.mjs`
as a CI step.

## house.json, in one line each

- **modules**: which of `claude-code`, `docs`, `engineering`, `github`, `testing`, `database`,
  `deployment`, `data-pipelines`, `llm-output` are on or off, plus each one's config; bootstrap
  probes the repo for the modules whose package default is `detect`.
- **deviations**: the dated ledger of what this repo declined from a house default and why; required
  whenever a default-on module is off, `branchPolicy` is not `pr`, a `carveOuts` glob is added, or
  `maxCoLoadLines` is raised above the default (kind `coload-ceiling`).
- **ratchet**: per-file line ceilings the checker tightens on its own whenever a file shrinks;
  raising one takes a written, dated reason in `ratchetRaises`.
- **guard**: optional dated record that the plugin supplies the branch guard, clearing that warning.

## The checker

`node .house/check.mjs` runs ten families: `drift`, `todo`, `tamper`, `behind`, `shape`, `lengths`,
`coload`, `manifest`, `minutes`, `guard`; scope a run with `--only=fam,fam`. Exit 0 is clean (warnings
still print), 1 means findings, and 2 means an unusable `house.json` reached a family that needs one
(`tamper`, `manifest`, `coload`, `guard`); the rest fall back to defaults instead. The full config
vocabulary each family reads is in the header comment atop `plugins/house/payload/check.mjs`.

## Versioning and breaking changes

A change to the prose inside a rule file ships as a minor, not a major. Rule bodies are the bulk of
what you vendor and nearly every release rewrites some of them, but no rule byte reaches your
checkout until you run `/house-rules:sync` and approve the plan it prints, so a rewrite is a
proposal to your repo rather than a delivery into it.

Major is the named surface: renaming or removing a rule heading, removing or renaming a config slot,
tightening what the branch guard denies, changing the layout of `house.json` or of the vendored
`.house/` directory, and raising the Node floor in `package.json`. Below 1.0 there is no major slot
to spend, so such a change is announced as breaking in `CHANGELOG.md` and carried by the next minor.
The full class lists and the reasoning are in `docs/decisions/0011-rule-content-changes-are-minor.md`.

## License

Code is MIT (`LICENSE`), rule prose and documentation are CC BY 4.0 (`LICENSE-DOCS`), and code
examples inside documentation are MIT wherever the surrounding prose sits. The SPDX expression for
the repository is `MIT AND CC-BY-4.0`; `NOTICE` lists which paths fall under which and names every
upstream that contributed text, structure, or a working method.

## Contributing and security

`CONTRIBUTING.md` covers the branch-and-PR flow, the upstream-first rule, how to record a deviation
or raise a limit, and `npm run verify`, the local gate. `SECURITY.md` is how to report a
vulnerability privately, and `CODE_OF_CONDUCT.md` applies wherever this project runs.

## Where to look next

`docs/handbook/` for why a rule reads the way it does, `docs/decisions/` for a call this package
made once, and `plugins/house/evals/` for the cases that hold a session to these rules under a task.
